import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

test("brands an Electron app bundle as Rocky", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-macos-bundle-"));
  const appRoot = path.join(fixtureRoot, "Electron.app");
  const macosRoot = path.join(appRoot, "Contents", "MacOS");
  const iconSourcePath = path.join(fixtureRoot, "Rocky.icns");
  const iconBytes = Buffer.from("rocky-icon-fixture");

  await mkdir(macosRoot, { recursive: true });
  await writeFile(path.join(macosRoot, "Electron"), "electron executable", "utf8");
  await writeFile(iconSourcePath, iconBytes);

  const { brandMacOSAppBundle, validateMacOSAppBundle } = await import(
    pathToFileURL(
      path.join(process.cwd(), "scripts", "macos-app-bundle.mjs")
    ).href
  );

  await brandMacOSAppBundle({
    appRoot,
    iconSourcePath,
    version: "v0.1.4",
  });
  await validateMacOSAppBundle(appRoot);

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
});
