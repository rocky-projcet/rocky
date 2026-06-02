# Issue #107: macOS v0.1.3 release artifact validation

Date: 2026-06-03
Release tag: `v0.1.3`
Builder: macOS arm64 (`Darwin`, Node.js `v24.3.0`, npm `11.4.2`)
Source commit: `4951db5` (`[#103] Prepare v0.1.3 installer packaging`)

## Result

Generated and published the v0.1.3 macOS arm64 preview artifacts to the existing GitHub Release:

- `rocky-v0.1.3-macos-arm64.app.zip`
- `rocky-v0.1.3-macos-arm64.dmg`
- `rocky-v0.1.3-macos-arm64.pkg`
- `SHA256SUMS-macos-arm64.txt`

The existing Windows `SHA256SUMS.txt` asset was left unchanged. A separate macOS checksum manifest was added so already-published Windows release assets did not need to be replaced.

## Checksums

```text
01896ec08f4bff1d4e939ae18b48aefd185ba05299b7bd97a8d17cd032cde7be  rocky-v0.1.3-macos-arm64.app.zip
f7243ceaf5e6127ceac00563ccd77c84711c126495ffe9e5b5716e070633da92  rocky-v0.1.3-macos-arm64.dmg
51d7abaa6c93af2386aa0036cb903f20dab3981abf028a604409ce99a15dffc1  rocky-v0.1.3-macos-arm64.pkg
```

## Validation

- `npm run typecheck` passed.
- `npm test` passed: 297 tests.
- `npm run release:macos -- --tag v0.1.3` created the app zip, DMG, and PKG artifacts.
- App bundle metadata was verified:
  - `CFBundleShortVersionString`: `0.1.3`
  - `CFBundleVersion`: `0.1.3`
  - staged payload `package.json` version: `0.1.3`
  - archived app zip `Info.plist` and payload `package.json` version: `0.1.3`
- Payload boundary check found no repository source/test/agent/git paths outside the compiled app, built web assets, and production dependencies.
- `pkgutil --check-signature releases/v0.1.3/rocky-v0.1.3-macos-arm64.pkg` reported `Status: no signature`, which matches the documented unsigned v0.1.3 limitation.
- `pkgutil --payload-files releases/v0.1.3/rocky-v0.1.3-macos-arm64.pkg` confirmed the package installs `Applications/Rocky.app`.
- `hdiutil verify releases/v0.1.3/rocky-v0.1.3-macos-arm64.dmg` reported a valid checksum.
- A safe synthetic manual-update helper smoke verified that `scripts/update-macos-manual.sh` preserves `.runtime`, `.codex`, `.tools`, `.rocky-env.ps1`, `.env`, and `.env.local` while writing the `v0.1.3` marker.

## GitHub Release decision

Decision: add the macOS arm64 preview artifacts to GitHub Release `v0.1.3`.

Reasoning:

- The v0.1.3 packaging script produced all intended macOS artifacts on an arm64 macOS builder.
- Version metadata and checksums were verified before upload.
- The limitations are already documented: artifacts are unsigned/not notarized and require user-installed Node.js 22+.
- The release notes were updated to mention the macOS artifacts, validation, checksums, and limitations.

## Remaining limitations

- No x64 or universal macOS artifact was produced for v0.1.3.
- No Developer ID signing, notarization, or stapling was performed.
- No full GUI launch smoke was performed from `/Applications/Rocky.app` in this validation pass.
