import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function releaseContracts() {
  return import(
    pathToFileURL(
      path.join(process.cwd(), "scripts", "macos-release-contracts.mjs")
    ).href
  );
}

function componentPlist({
  rootRelativeBundlePath = "Applications/Rocky.app",
  bundleIsRelocatable = false,
  childBundles = "",
} = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<array>
  <dict>
    <key>BundleIsRelocatable</key>
    <${bundleIsRelocatable}/>
${childBundles}
    <key>RootRelativeBundlePath</key>
    <string>${rootRelativeBundlePath}</string>
  </dict>
</array>
</plist>
`;
}

test("release note names the requested tag", async () => {
  const { unsignedArtifactsNote } = await releaseContracts();

  assert.equal(
    unsignedArtifactsNote("v9.8.7"),
    "Note: artifacts are unsigned and not notarized for v9.8.7."
  );
});

test("accepts the fixed Rocky PKG component location", async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-pkg-plist-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const plistPath = path.join(fixtureRoot, "components.plist");
  await writeFile(plistPath, componentPlist(), "utf8");
  const { validatePkgComponentPlist } = await releaseContracts();

  await validatePkgComponentPlist(plistPath);
});

test("accepts pkgbuild ChildBundles beneath the Rocky app component", async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-pkg-plist-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const plistPath = path.join(fixtureRoot, "components.plist");
  const childBundles = `    <key>ChildBundles</key>
    <array>
      <dict>
        <key>BundleHasStrictIdentifier</key>
        <true/>
        <key>RootRelativeBundlePath</key>
        <string>Applications/Rocky.app/Contents/Frameworks/Rocky Helper (GPU).app</string>
      </dict>
      <dict>
        <key>BundleOverwriteAction</key>
        <string></string>
        <key>RootRelativeBundlePath</key>
        <string>Applications/Rocky.app/Contents/Frameworks/Electron Framework.framework</string>
      </dict>
    </array>`;
  await writeFile(plistPath, componentPlist({ childBundles }), "utf8");
  const { validatePkgComponentPlist } = await releaseContracts();

  await validatePkgComponentPlist(plistPath);
});

test("rejects a relocatable Rocky PKG component", async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-pkg-plist-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const plistPath = path.join(fixtureRoot, "components.plist");
  await writeFile(
    plistPath,
    componentPlist({ bundleIsRelocatable: true }),
    "utf8"
  );
  const { validatePkgComponentPlist } = await releaseContracts();

  await assert.rejects(
    validatePkgComponentPlist(plistPath),
    /BundleIsRelocatable must be false/u
  );
});

test("rejects a Rocky PKG component outside Applications", async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-pkg-plist-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const plistPath = path.join(fixtureRoot, "components.plist");
  await writeFile(
    plistPath,
    componentPlist({ rootRelativeBundlePath: "Rocky.app" }),
    "utf8"
  );
  const { validatePkgComponentPlist } = await releaseContracts();

  await assert.rejects(
    validatePkgComponentPlist(plistPath),
    /RootRelativeBundlePath must be Applications\/Rocky\.app/u
  );
});
