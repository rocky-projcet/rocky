#!/usr/bin/env node

import { chmod, cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  brandMacOSAppBundle,
  copyMacOSAppBundle,
  validateMacOSAppBundle,
} from "./macos-app-bundle.mjs";
import {
  unsignedArtifactsNote,
  validatePkgComponentPlist,
} from "./macos-release-contracts.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv) {
  const options = {
    tag: "v0.1.3",
    outputDirectory: undefined,
    skipBuild: false,
    skipNpmInstall: false,
    dmg: true,
    pkg: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    switch (arg) {
      case "--tag":
        options.tag = value;
        index += 1;
        break;
      case "--output-directory":
        options.outputDirectory = path.resolve(value);
        index += 1;
        break;
      case "--skip-build":
        options.skipBuild = true;
        break;
      case "--skip-npm-install":
        options.skipNpmInstall = true;
        break;
      case "--no-dmg":
        options.dmg = false;
        break;
      case "--no-pkg":
        options.pkg = false;
        break;
      case "--help":
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.tag || options.tag.startsWith("-")) {
    throw new Error("--tag must be a release tag such as v0.1.3.");
  }

  options.outputDirectory ??= path.join(repoRoot, "releases", options.tag);
  return options;
}

function printUsage() {
  console.log(`Usage: npm run release:macos -- [options]\n\nOptions:\n  --tag <tag>                 Release tag. Defaults to v0.1.3.\n  --output-directory <path>   Artifact output directory. Defaults to releases/<tag>.\n  --skip-build                Reuse existing dist/ and web/dist/.\n  --skip-npm-install          Do not run npm ci in the staged app payload.\n  --no-dmg                    Skip optional DMG creation.
  --no-pkg                    Skip optional PKG installer creation.\n`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`>> ${command} ${args.join(" ")}`);
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: "inherit",
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with ${
            signal ? `signal ${signal}` : `exit code ${code}`
          }`
        )
      );
    });
  });
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function assertExists(filePath, label) {
  if (!(await exists(filePath))) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
}

function assertChildPath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside ${parent}: ${child}`);
  }
}

async function copyIfExists(source, target, options = {}) {
  if (await exists(source)) {
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, force: true, ...options });
  }
}

async function stageApp(options) {
  const arch = os.arch();
  const stageRoot = path.join(repoRoot, ".tmp", "macos-release", options.tag);
  const appRoot = path.join(stageRoot, "Rocky.app");
  const resourcesRoot = path.join(appRoot, "Contents", "Resources");
  const payloadRoot = path.join(resourcesRoot, "app");
  const electronAppSource = path.join(
    repoRoot,
    "node_modules",
    "electron",
    "dist",
    "Electron.app"
  );

  assertChildPath(path.join(repoRoot, ".tmp"), stageRoot);
  assertChildPath(path.join(repoRoot, "releases"), options.outputDirectory);
  await assertExists(
    electronAppSource,
    "Electron.app runtime. Run npm install on a macOS builder before packaging"
  );

  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });
  await copyMacOSAppBundle(electronAppSource, appRoot);
  await brandMacOSAppBundle({
    appRoot,
    iconSourcePath: path.join(repoRoot, "assets", "macos", "Rocky.icns"),
    version: options.tag,
  });
  await rm(payloadRoot, { recursive: true, force: true });
  await mkdir(payloadRoot, { recursive: true });

  await cp(path.join(repoRoot, "dist"), path.join(payloadRoot, "dist"), {
    recursive: true,
    force: true,
    filter: (source) => !source.includes(`${path.sep}dist${path.sep}test${path.sep}`),
  });
  await rm(path.join(payloadRoot, "dist", "test"), { recursive: true, force: true });
  await rm(path.join(payloadRoot, "dist", "web"), { recursive: true, force: true });

  await cp(path.join(repoRoot, "web", "dist"), path.join(payloadRoot, "web", "dist"), {
    recursive: true,
    force: true,
  });

  await copyIfExists(path.join(repoRoot, "package.json"), path.join(payloadRoot, "package.json"));
  await copyIfExists(path.join(repoRoot, "package-lock.json"), path.join(payloadRoot, "package-lock.json"));
  await copyIfExists(path.join(repoRoot, "README.md"), path.join(payloadRoot, "README.md"));
  await copyIfExists(path.join(repoRoot, "docs", "macos-install.md"), path.join(payloadRoot, "docs", "macos-install.md"));

  if (!options.skipNpmInstall) {
    await run("npm", ["ci", "--omit=dev", "--ignore-scripts"], { cwd: payloadRoot });
  }

  await validateMacOSAppBundle(appRoot);
  await validateApp(appRoot);
  return { appRoot, stageRoot, arch };
}

async function validateApp(appRoot) {
  const payloadRoot = path.join(appRoot, "Contents", "Resources", "app");
  await assertExists(path.join(appRoot, "Contents", "Info.plist"), "Info.plist");
  await assertExists(path.join(payloadRoot, "dist", "electron", "main.js"), "Electron main");
  await assertExists(path.join(payloadRoot, "dist", "electron", "preload.js"), "Electron preload");
  await assertExists(path.join(payloadRoot, "dist", "src", "cli.js"), "backend CLI");
  await assertExists(path.join(payloadRoot, "web", "dist", "index.html"), "built web UI");
  await assertExists(path.join(payloadRoot, "node_modules"), "runtime dependencies");
}

async function createZip(appRoot, outputDirectory, tag, arch) {
  await mkdir(outputDirectory, { recursive: true });
  const zipPath = path.join(outputDirectory, `rocky-${tag}-macos-${arch}.app.zip`);
  await rm(zipPath, { force: true });

  if (process.platform === "darwin") {
    await run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appRoot, zipPath]);
  } else {
    await run("zip", ["-qry", zipPath, path.basename(appRoot)], { cwd: path.dirname(appRoot) });
  }

  await assertExists(zipPath, "macOS app zip");
  return zipPath;
}

async function createDmg(appRoot, outputDirectory, tag, arch, enabled) {
  if (!enabled) {
    return undefined;
  }
  if (process.platform !== "darwin") {
    console.log("Skipping DMG creation: hdiutil is only available on macOS.");
    return undefined;
  }

  const dmgPath = path.join(outputDirectory, `rocky-${tag}-macos-${arch}.dmg`);
  await rm(dmgPath, { force: true });
  await run("hdiutil", [
    "create",
    "-volname",
    `Rocky ${tag}`,
    "-srcfolder",
    appRoot,
    "-ov",
    "-format",
    "UDZO",
    dmgPath,
  ]);
  await assertExists(dmgPath, "macOS DMG");
  return dmgPath;
}

function pkgVersion(tag) {
  const version = tag.replace(/^v/u, "");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`PKG version must be semver-like; got ${tag}.`);
  }
  return version;
}

function installScript(tag) {
  return `#!/bin/sh
set -eu
LOG_DIR="/Library/Logs/Rocky"
LOG_PATH="$LOG_DIR/install.log"
APP_PATH="/Applications/Rocky.app"
mkdir -p "$LOG_DIR"
printf '[%s] Rocky ${tag} installer started. Existing app: %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(test -d "$APP_PATH" && echo yes || echo no)" >> "$LOG_PATH"
exit 0
`;
}

function postinstallScript(tag) {
  return `#!/bin/sh
set -eu
LOG_DIR="/Library/Logs/Rocky"
LOG_PATH="$LOG_DIR/install.log"
mkdir -p "$LOG_DIR"
printf '[%s] Rocky ${tag} installer completed. App installed at /Applications/Rocky.app. User state is outside the app bundle and is not removed by this installer.\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG_PATH"
printf '[%s] Default per-user state root: ~/Library/Application Support/Rocky/agent-engine\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG_PATH"
exit 0
`;
}

async function createPkg(appRoot, stageRoot, outputDirectory, tag, arch, enabled) {
  if (!enabled) {
    return undefined;
  }
  if (process.platform !== "darwin") {
    console.log("Skipping PKG creation: pkgbuild is only available on macOS.");
    return undefined;
  }

  const pkgPath = path.join(outputDirectory, `rocky-${tag}-macos-${arch}.pkg`);
  const pkgRoot = path.join(stageRoot, "pkg-root");
  const scriptsRoot = path.join(stageRoot, "pkg-scripts");
  const componentsPlist = path.join(stageRoot, "pkg-components.plist");
  await rm(pkgPath, { force: true });
  await rm(pkgRoot, { recursive: true, force: true });
  await rm(scriptsRoot, { recursive: true, force: true });
  await rm(componentsPlist, { force: true });
  await mkdir(path.join(pkgRoot, "Applications"), { recursive: true });
  await mkdir(scriptsRoot, { recursive: true });
  await copyMacOSAppBundle(
    appRoot,
    path.join(pkgRoot, "Applications", "Rocky.app")
  );
  await writeFile(path.join(scriptsRoot, "preinstall"), installScript(tag), "utf8");
  await writeFile(path.join(scriptsRoot, "postinstall"), postinstallScript(tag), "utf8");
  await chmod(path.join(scriptsRoot, "preinstall"), 0o755);
  await chmod(path.join(scriptsRoot, "postinstall"), 0o755);

  await run("pkgbuild", ["--analyze", "--root", pkgRoot, componentsPlist]);
  await run("plutil", ["-replace", "0.BundleIsRelocatable", "-bool", "NO", componentsPlist]);
  await validatePkgComponentPlist(componentsPlist);
  await run("pkgbuild", [
    "--root",
    pkgRoot,
    "--component-plist",
    componentsPlist,
    "--scripts",
    scriptsRoot,
    "--identifier",
    "works.earendil.rocky",
    "--version",
    pkgVersion(tag),
    "--install-location",
    "/",
    pkgPath,
  ]);
  await assertExists(pkgPath, "macOS PKG installer");
  return pkgPath;
}

const options = parseArgs(process.argv.slice(2));

if (!options.skipBuild) {
  await run("npm", ["run", "build", "--silent"]);
  await run("npm", ["--prefix", "web", "run", "build", "--silent"]);
}

await assertExists(path.join(repoRoot, "dist", "src", "cli.js"), "dist backend CLI");
await assertExists(path.join(repoRoot, "web", "dist", "index.html"), "web build");

const { appRoot, stageRoot, arch } = await stageApp(options);
const zipPath = await createZip(appRoot, options.outputDirectory, options.tag, arch);
const dmgPath = await createDmg(appRoot, options.outputDirectory, options.tag, arch, options.dmg);
const pkgPath = await createPkg(appRoot, stageRoot, options.outputDirectory, options.tag, arch, options.pkg);

console.log("Created macOS artifacts:");
console.log(`- ${zipPath}`);
if (dmgPath) {
  console.log(`- ${dmgPath}`);
}
if (pkgPath) {
  console.log(`- ${pkgPath}`);
}
console.log(unsignedArtifactsNote(options.tag));
