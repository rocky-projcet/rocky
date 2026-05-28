#!/usr/bin/env node

import { cp, mkdir, rm, stat, writeFile, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv) {
  const options = {
    tag: "v0.1.1",
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
    throw new Error("--tag must be a release tag such as v0.1.1.");
  }

  options.outputDirectory ??= path.join(repoRoot, "releases", options.tag);
  return options;
}

function printUsage() {
  console.log(`Usage: npm run release:macos -- [options]\n\nOptions:\n  --tag <tag>                 Release tag. Defaults to v0.1.1.\n  --output-directory <path>   Artifact output directory. Defaults to releases/<tag>.\n  --skip-build                Reuse existing dist/ and web/dist/.\n  --skip-npm-install          Do not run npm ci in the staged app payload.\n  --no-dmg                    Skip optional DMG creation.
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

function plist(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Rocky</string>
  <key>CFBundleExecutable</key>
  <string>Rocky</string>
  <key>CFBundleIdentifier</key>
  <string>works.earendil.rocky</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Rocky</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${version.replace(/^v/, "")}</string>
  <key>CFBundleVersion</key>
  <string>${version.replace(/^v/, "")}</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
</dict>
</plist>
`;
}

function launcherScript() {
  return `#!/bin/sh
set -eu

APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../Resources/app" && pwd)"
LOG_DIR="$HOME/Library/Logs/Rocky"
STATE_ROOT="\${ROCKY_STATE_ROOT:-$HOME/Library/Application Support/Rocky/agent-engine}"
API_HOST="\${ROCKY_HOST:-127.0.0.1}"
API_PORT="\${ROCKY_API_PORT:-3000}"
WEB_PORT="\${ROCKY_WEB_PORT:-4173}"
WEB_URL="http://$API_HOST:$WEB_PORT"

mkdir -p "$LOG_DIR" "$STATE_ROOT"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.volta/bin:$HOME/.asdf/shims:$PATH"

find_node() {
  if [ -n "\${ROCKY_NODE:-}" ] && [ -x "$ROCKY_NODE" ]; then
    printf '%s\n' "$ROCKY_NODE"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  for candidate in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$HOME/.volta/bin/node" \
    "$HOME/.asdf/shims/node"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if [ -d "$HOME/.nvm/versions/node" ]; then
    for candidate in "$HOME"/.nvm/versions/node/*/bin/node; do
      if [ -x "$candidate" ]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done
  fi

  return 1
}

NODE_BIN="$(find_node || true)"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ -z "$NODE_BIN" ] || [ "$NODE_MAJOR" -lt 22 ]; then
  osascript -e 'display alert "Rocky requires Node.js 22 or newer" message "Install Node.js 22+ with Homebrew, Volta, asdf, or nvm. If Node is already installed, set ROCKY_NODE to its node binary and open Rocky from Terminal."' >/dev/null 2>&1 || true
  {
    echo "Rocky requires Node.js 22 or newer."
    echo "PATH=$PATH"
    echo "ROCKY_NODE=\${ROCKY_NODE:-}"
    echo "Detected NODE_BIN=$NODE_BIN"
    echo "Detected NODE_MAJOR=$NODE_MAJOR"
  } >> "$LOG_DIR/rocky.log"
  exit 1
fi

echo "Using Node.js at $NODE_BIN" >> "$LOG_DIR/rocky.log"

cd "$APP_DIR"
"$NODE_BIN" dist/src/cli.js serve --host "$API_HOST" --port "$API_PORT" --state-root "$STATE_ROOT" >> "$LOG_DIR/api.log" 2>&1 &
API_PID=$!
"$NODE_BIN" scripts/serve-web-dist.mjs --host "$API_HOST" --port "$WEB_PORT" --proxy-target "http://$API_HOST:$API_PORT" >> "$LOG_DIR/web.log" 2>&1 &
WEB_PID=$!

cleanup() {
  kill "$API_PID" "$WEB_PID" >/dev/null 2>&1 || true
}
trap cleanup INT TERM EXIT

sleep 2
open "$WEB_URL" >/dev/null 2>&1 || true
wait
`;
}

async function stageApp(options) {
  const arch = os.arch();
  const stageRoot = path.join(repoRoot, ".tmp", "macos-release", options.tag);
  const appRoot = path.join(stageRoot, "Rocky.app");
  const contentsRoot = path.join(appRoot, "Contents");
  const macosRoot = path.join(contentsRoot, "MacOS");
  const resourcesRoot = path.join(contentsRoot, "Resources");
  const payloadRoot = path.join(resourcesRoot, "app");

  assertChildPath(path.join(repoRoot, ".tmp"), stageRoot);
  assertChildPath(path.join(repoRoot, "releases"), options.outputDirectory);

  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(macosRoot, { recursive: true });
  await mkdir(payloadRoot, { recursive: true });

  await writeFile(path.join(contentsRoot, "Info.plist"), plist(options.tag), "utf8");
  await writeFile(path.join(macosRoot, "Rocky"), launcherScript(), "utf8");
  await chmod(path.join(macosRoot, "Rocky"), 0o755);

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

  await copyIfExists(path.join(repoRoot, "scripts", "serve-web-dist.mjs"), path.join(payloadRoot, "scripts", "serve-web-dist.mjs"));
  await copyIfExists(path.join(repoRoot, "package.json"), path.join(payloadRoot, "package.json"));
  await copyIfExists(path.join(repoRoot, "package-lock.json"), path.join(payloadRoot, "package-lock.json"));
  await copyIfExists(path.join(repoRoot, "README.md"), path.join(payloadRoot, "README.md"));
  await copyIfExists(path.join(repoRoot, "docs", "macos-install.md"), path.join(payloadRoot, "docs", "macos-install.md"));

  if (!options.skipNpmInstall) {
    await run("npm", ["ci", "--omit=dev", "--ignore-scripts"], { cwd: payloadRoot });
  }

  await validateApp(appRoot);
  return { appRoot, stageRoot, arch };
}

async function validateApp(appRoot) {
  const payloadRoot = path.join(appRoot, "Contents", "Resources", "app");
  await assertExists(path.join(appRoot, "Contents", "Info.plist"), "Info.plist");
  await assertExists(path.join(appRoot, "Contents", "MacOS", "Rocky"), "launcher");
  await assertExists(path.join(payloadRoot, "dist", "src", "cli.js"), "backend CLI");
  await assertExists(path.join(payloadRoot, "web", "dist", "index.html"), "built web UI");
  await assertExists(path.join(payloadRoot, "scripts", "serve-web-dist.mjs"), "web static server");
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
  await rm(pkgPath, { force: true });
  await rm(pkgRoot, { recursive: true, force: true });
  await rm(scriptsRoot, { recursive: true, force: true });
  await mkdir(path.join(pkgRoot, "Applications"), { recursive: true });
  await mkdir(scriptsRoot, { recursive: true });
  await cp(appRoot, path.join(pkgRoot, "Applications", "Rocky.app"), {
    recursive: true,
    force: true,
  });
  await writeFile(path.join(scriptsRoot, "preinstall"), installScript(tag), "utf8");
  await writeFile(path.join(scriptsRoot, "postinstall"), postinstallScript(tag), "utf8");
  await chmod(path.join(scriptsRoot, "preinstall"), 0o755);
  await chmod(path.join(scriptsRoot, "postinstall"), 0o755);

  await run("pkgbuild", [
    "--root",
    pkgRoot,
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
console.log("Note: artifacts are unsigned and not notarized for v0.1.1.");
