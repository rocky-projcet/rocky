import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

function plistValue(plist: string, key: string) {
  const match = plist.match(
    new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`)
  );
  return match?.[1];
}

const helpers = [
  {
    electronName: "Electron Helper",
    rockyName: "Rocky Helper",
    identifier: "works.earendil.rocky.helper",
  },
  {
    electronName: "Electron Helper (GPU)",
    rockyName: "Rocky Helper (GPU)",
    identifier: "works.earendil.rocky.helper.gpu",
  },
  {
    electronName: "Electron Helper (Plugin)",
    rockyName: "Rocky Helper (Plugin)",
    identifier: "works.earendil.rocky.helper.plugin",
  },
  {
    electronName: "Electron Helper (Renderer)",
    rockyName: "Rocky Helper (Renderer)",
    identifier: "works.earendil.rocky.helper.renderer",
  },
] as const;

function helperPlist(name: string, identifier: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${identifier}</string>
  <key>CFBundleName</key>
  <string>${name}</string>
  <key>LSEnvironment</key>
  <dict>
    <key>MallocNanoZone</key>
    <string>0</string>
  </dict>
</dict>
</plist>
`;
}

test("brands an Electron app bundle as Rocky", async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-macos-bundle-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const electronAppRoot = path.join(fixtureRoot, "Electron.app");
  const appRoot = path.join(fixtureRoot, "stage", "Rocky.app");
  const electronMacOSRoot = path.join(electronAppRoot, "Contents", "MacOS");
  const frameworksRoot = path.join(electronAppRoot, "Contents", "Frameworks");
  const iconSourcePath = path.join(fixtureRoot, "Rocky.icns");
  const iconBytes = Buffer.from("rocky-icon-fixture");

  await mkdir(electronMacOSRoot, { recursive: true });
  await writeFile(
    path.join(electronMacOSRoot, "Electron"),
    "electron executable",
    "utf8"
  );
  await writeFile(iconSourcePath, iconBytes);

  const supportsSymlinks = process.platform !== "win32";
  if (supportsSymlinks) {
    const frameworkRoot = path.join(
      frameworksRoot,
      "Electron Framework.framework"
    );
    await mkdir(path.join(frameworkRoot, "Versions", "A", "Resources"), {
      recursive: true,
    });
    await symlink("A", path.join(frameworkRoot, "Versions", "Current"));
    await symlink(
      "Versions/Current/Resources",
      path.join(frameworkRoot, "Resources")
    );
  }

  for (const helper of helpers) {
    const helperContents = path.join(
      frameworksRoot,
      `${helper.electronName}.app`,
      "Contents"
    );
    await mkdir(path.join(helperContents, "MacOS"), { recursive: true });
    await writeFile(
      path.join(helperContents, "MacOS", helper.electronName),
      `${helper.electronName} executable`,
      "utf8"
    );
    await writeFile(
      path.join(helperContents, "Info.plist"),
      helperPlist(
        helper.electronName,
        `com.github.Electron.${helper.electronName}`
      ),
      "utf8"
    );
  }

  const {
    brandMacOSAppBundle,
    copyMacOSAppBundle,
    validateMacOSAppBundle,
  } = await import(
    pathToFileURL(
      path.join(process.cwd(), "scripts", "macos-app-bundle.mjs")
    ).href
  );

  await copyMacOSAppBundle(electronAppRoot, appRoot);
  await brandMacOSAppBundle({
    appRoot,
    iconSourcePath,
    version: "v0.1.4",
  });
  await validateMacOSAppBundle(appRoot);

  const macosRoot = path.join(appRoot, "Contents", "MacOS");
  await access(path.join(macosRoot, "Rocky"));
  await assert.rejects(access(path.join(macosRoot, "Electron")), { code: "ENOENT" });
  assert.deepEqual(
    await readFile(path.join(appRoot, "Contents", "Resources", "Rocky.icns")),
    iconBytes
  );

  const plist = await readFile(path.join(appRoot, "Contents", "Info.plist"), "utf8");
  assert.equal(plistValue(plist, "CFBundleDisplayName"), "Rocky");
  assert.equal(plistValue(plist, "CFBundleName"), "Rocky");
  assert.equal(plistValue(plist, "CFBundleExecutable"), "Rocky");
  assert.equal(plistValue(plist, "CFBundleIconFile"), "Rocky.icns");
  assert.equal(plistValue(plist, "CFBundleIdentifier"), "works.earendil.rocky");
  assert.equal(plistValue(plist, "CFBundleShortVersionString"), "0.1.4");
  assert.equal(plistValue(plist, "CFBundleVersion"), "0.1.4");

  if (supportsSymlinks) {
    const copiedFrameworkRoot = path.join(
      appRoot,
      "Contents",
      "Frameworks",
      "Electron Framework.framework"
    );
    assert.equal(
      await readlink(path.join(copiedFrameworkRoot, "Versions", "Current")),
      "A"
    );
    assert.equal(
      await readlink(path.join(copiedFrameworkRoot, "Resources")),
      "Versions/Current/Resources"
    );
  }

  const copiedFrameworksRoot = path.join(appRoot, "Contents", "Frameworks");
  for (const helper of helpers) {
    const rockyHelperRoot = path.join(
      copiedFrameworksRoot,
      `${helper.rockyName}.app`
    );
    await access(
      path.join(rockyHelperRoot, "Contents", "MacOS", helper.rockyName)
    );
    await assert.rejects(
      access(path.join(copiedFrameworksRoot, `${helper.electronName}.app`)),
      { code: "ENOENT" }
    );
    await assert.rejects(
      access(path.join(rockyHelperRoot, "Contents", "MacOS", helper.electronName)),
      { code: "ENOENT" }
    );

    const helperPlistContents = await readFile(
      path.join(rockyHelperRoot, "Contents", "Info.plist"),
      "utf8"
    );
    assert.equal(
      plistValue(helperPlistContents, "CFBundleDisplayName"),
      helper.rockyName
    );
    assert.equal(plistValue(helperPlistContents, "CFBundleName"), helper.rockyName);
    assert.equal(
      plistValue(helperPlistContents, "CFBundleExecutable"),
      helper.rockyName
    );
    assert.equal(
      plistValue(helperPlistContents, "CFBundleIdentifier"),
      helper.identifier
    );
    const nestedDictionaryEnd = helperPlistContents.indexOf("</dict>");
    assert.ok(
      helperPlistContents.indexOf("<key>CFBundleDisplayName</key>") >
        nestedDictionaryEnd
    );
    assert.ok(
      helperPlistContents.indexOf("<key>CFBundleExecutable</key>") >
        nestedDictionaryEnd
    );
  }

  const unexpectedRockyHelperApp = path.join(
    copiedFrameworksRoot,
    "Rocky Helper (Utility).app"
  );
  await mkdir(unexpectedRockyHelperApp);
  await assert.rejects(
    validateMacOSAppBundle(appRoot),
    /unexpected Rocky helper bundle/u
  );
  await rm(unexpectedRockyHelperApp, { recursive: true });

  if (supportsSymlinks) {
    const absoluteLink = path.join(
      appRoot,
      "Contents",
      "Resources",
      "absolute-link"
    );
    await symlink("/tmp/rocky-invalid-absolute-link", absoluteLink);
    await assert.rejects(
      validateMacOSAppBundle(appRoot),
      /absolute symbolic link/u
    );
    await rm(absoluteLink);
  }

  const electronHelperApp = path.join(
    copiedFrameworksRoot,
    "Electron Helper.app"
  );
  await mkdir(electronHelperApp);
  await assert.rejects(validateMacOSAppBundle(appRoot), /Electron Helper\.app/u);
  await rm(electronHelperApp, { recursive: true });
  if (supportsSymlinks) {
    await symlink("Rocky Helper.app", electronHelperApp);
    await assert.rejects(validateMacOSAppBundle(appRoot), /Electron Helper\.app/u);
    await rm(electronHelperApp);
  }

  const electronHelperExecutable = path.join(
    copiedFrameworksRoot,
    "Rocky Helper.app",
    "Contents",
    "MacOS",
    "Electron Helper"
  );
  await writeFile(electronHelperExecutable, "leftover", "utf8");
  await assert.rejects(validateMacOSAppBundle(appRoot), /Electron Helper/u);
  await rm(electronHelperExecutable);
  if (supportsSymlinks) {
    await symlink("Rocky Helper", electronHelperExecutable);
    await assert.rejects(validateMacOSAppBundle(appRoot), /Electron Helper/u);
  }
});
