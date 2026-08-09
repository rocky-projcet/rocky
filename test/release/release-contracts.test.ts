import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReleaseVersion,
  assertStableReleaseAssetNames,
  createSha256Sums,
  expectedMacOSReleaseAssetNames,
  expectedStableReleaseAssetNames,
  expectedWindowsReleaseAssetNames,
  parseReleaseTag,
  validateReleaseNotes,
} from "../../src/release/release-contracts.js";

const RELEASE_NOTES = `# Rocky v0.1.5

## Highlights

Public update delivery.

## Windows Install

Run Rocky-Setup-v0.1.5.exe.

## macOS Install

Use the matching arm64 or x64 PKG, DMG, or app zip. These artifacts are unsigned.

## Validation

Typecheck and tests passed.

## Checksums

See SHA256SUMS.txt.

## Known Limitations

This unsigned preview may trigger SmartScreen.
`;

test("release contracts parse a leading-v semver tag", () => {
  assert.deepEqual(parseReleaseTag("v0.1.5"), {
    tag: "v0.1.5",
    version: "0.1.5",
  });
  assert.throws(() => parseReleaseTag("0.1.4"), /leading v semver tag/u);
  assert.throws(() => parseReleaseTag("v0.1"), /leading v semver tag/u);
});

test("release contracts reject a tag and package version mismatch", () => {
  assert.doesNotThrow(() => assertReleaseVersion("v0.1.5", "0.1.5"));
  assert.throws(
    () => assertReleaseVersion("v0.1.5", "0.1.3"),
    /does not match package version 0[.]1[.]3/u
  );
});

test("release contracts require all user-facing release note sections", () => {
  assert.doesNotThrow(() => validateReleaseNotes(RELEASE_NOTES, "v0.1.5"));
  assert.throws(
    () => validateReleaseNotes(RELEASE_NOTES.replace("## Checksums", ""), "v0.1.4"),
    /missing required section.*Checksums/u
  );
  assert.throws(
    () => validateReleaseNotes(RELEASE_NOTES.replace("## macOS Install", ""), "v0.1.5"),
    /missing required section.*macOS Install/u
  );
});

test("release contracts create deterministic sha256 lines sorted by asset name", () => {
  assert.equal(
    createSha256Sums([
      { name: "SHA256SUMS.txt", bytes: new TextEncoder().encode("manifest") },
      { name: "Rocky-Setup-v0.1.5.exe", bytes: new TextEncoder().encode("installer") },
    ]),
    [
      "9c0d294c05fc1d88d698034609bb81c0c69196327594e4c69d2915c80fd9850c  Rocky-Setup-v0.1.5.exe",
      "05b3abf2579a5eb66403cd78be557fd860633a1fe2103c7642030defe32c657f  SHA256SUMS.txt",
    ].join("\n") + "\n"
  );
});

test("release contracts define the stable Windows and macOS release assets", () => {
  const assets = expectedWindowsReleaseAssetNames("v0.1.5");
  const macAssets = expectedMacOSReleaseAssetNames("v0.1.5");
  assert.deepEqual(assets, {
    installer: "Rocky-Setup-v0.1.5.exe",
    checksums: "SHA256SUMS.txt",
  });
  assert.deepEqual(macAssets, [
    "rocky-v0.1.5-macos-arm64.app.zip",
    "rocky-v0.1.5-macos-arm64.dmg",
    "rocky-v0.1.5-macos-arm64.pkg",
    "rocky-v0.1.5-macos-x64.app.zip",
    "rocky-v0.1.5-macos-x64.dmg",
    "rocky-v0.1.5-macos-x64.pkg",
  ]);
  const stable = expectedStableReleaseAssetNames("v0.1.5");
  assert.equal(stable.length, 8);
  assert.doesNotThrow(() => assertStableReleaseAssetNames(stable, "v0.1.5"));
  assert.throws(
    () =>
      assertStableReleaseAssetNames(
        [assets.installer, assets.checksums, ...macAssets.slice(0, -1)],
        "v0.1.5"
      ),
    /unexpected stable release assets/u
  );
  assert.throws(
    () =>
      assertStableReleaseAssetNames(
        [...stable, "rocky-v0.1.5-windows-app.zip"],
        "v0.1.5"
      ),
    /unexpected stable release assets/u
  );
});
