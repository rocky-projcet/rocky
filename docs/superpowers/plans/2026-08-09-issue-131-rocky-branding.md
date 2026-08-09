# Issue 131 Rocky macOS Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce, install, and launch a macOS Rocky bundle whose executable, metadata, menu identity, and icon no longer expose Electron.

**Architecture:** Keep the existing hand-written macOS release pipeline. Extract bundle-branding behavior into a small filesystem helper so tests can exercise a temporary bundle, then have the release script apply and validate that branding before creating ZIP, DMG, and PKG artifacts.

**Tech Stack:** Node.js ESM, TypeScript node:test, Electron 42, macOS `sips`/`iconutil`, `pkgbuild`, `hdiutil`.

## Global Constraints

- The visible product name is exactly `Rocky`.
- The macOS bundle identifier remains `works.earendil.rocky`.
- The canonical icon source remains `web/public/android-chrome-512x512.png`, matching Windows.
- Existing Windows executable, taskbar, and window icon behavior must remain unchanged.
- Signing, notarization, universal binaries, and packaging-framework migration are out of scope.

---

### Task 1: Test macOS bundle branding behavior

**Files:**
- Create: `test/electron/macos-app-bundle.test.ts`
- Create: `scripts/macos-app-bundle.mjs`

**Interfaces:**
- Consumes: a temporary Electron-style `.app`, version, and Rocky `.icns` path.
- Produces: `brandMacOSAppBundle({ appRoot, iconSourcePath, version })` and `validateMacOSAppBundle(appRoot)`.

- [ ] **Step 1: Write the failing test**

Create a temporary `Electron.app` layout with `Contents/MacOS/Electron` and a fake icon. Dynamically import `scripts/macos-app-bundle.mjs`, run `brandMacOSAppBundle`, and assert literal observable results: `Contents/MacOS/Rocky` exists, `Electron` does not, `Contents/Resources/Rocky.icns` matches the fixture bytes, and parsed `Info.plist` fields name Rocky.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build --silent && node --test dist/test/electron/macos-app-bundle.test.js`

Expected: FAIL because `scripts/macos-app-bundle.mjs` or its exports do not exist.

- [ ] **Step 3: Write minimal implementation**

Implement the helper with filesystem operations and a deterministic plist renderer. Rename the executable, copy the icon, write `Info.plist`, and validate the final files and required literal metadata.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build --silent && node --test dist/test/electron/macos-app-bundle.test.js`

Expected: PASS.

### Task 2: Integrate branding with the macOS release pipeline

**Files:**
- Modify: `scripts/package-macos-release.mjs`
- Create: `assets/macos/Rocky.icns`

**Interfaces:**
- Consumes: `brandMacOSAppBundle` and `validateMacOSAppBundle` from Task 1.
- Produces: a staged `Rocky.app` with `Contents/MacOS/Rocky`, `Contents/Resources/Rocky.icns`, and Rocky bundle metadata.

- [ ] **Step 1: Generate the deterministic macOS icon**

Use `sips` to render the canonical 512px PNG into the standard iconset sizes and `iconutil -c icns` to create `assets/macos/Rocky.icns`. Do not alter the source image.

- [ ] **Step 2: Replace inline bundle metadata logic**

Import the Task 1 helper. After copying `Electron.app`, call `brandMacOSAppBundle({ appRoot, iconSourcePath: path.join(repoRoot, "assets", "macos", "Rocky.icns"), version: options.tag })`. Replace the old Electron executable assertion with `validateMacOSAppBundle(appRoot)`.

- [ ] **Step 3: Run the focused and existing Electron tests**

Run: `npm run build --silent && node --test dist/test/electron/*.test.js`

Expected: all Electron tests PASS, including the existing Windows icon test.

### Task 3: Document the manual branding smoke

**Files:**
- Modify: `docs/macos-install.md`

**Interfaces:**
- Consumes: installed `/Applications/Rocky.app` from Task 4.
- Produces: repeatable metadata, process, menu, Dock, app-switcher, and icon checks.

- [ ] **Step 1: Replace the outdated icon limitation**

Document that the package now embeds `Rocky.icns` and names its executable `Rocky`.

- [ ] **Step 2: Add exact manual smoke commands**

Include `plutil` checks for `CFBundleDisplayName`, `CFBundleName`, `CFBundleExecutable`, and `CFBundleIconFile`; executable/resource existence checks; `open -a Rocky`; and visual confirmation of Dock, Command-Tab, and the application menu.

- [ ] **Step 3: Check documentation and diff hygiene**

Run: `git diff --check`

Expected: no output and exit code 0.

### Task 4: Verify, package, install, and launch v0.1.4

**Files:**
- Generated (ignored): `.tmp/macos-release/v0.1.4/Rocky.app`
- Generated (ignored): `releases/v0.1.4/rocky-v0.1.4-macos-arm64.app.zip`
- Generated (ignored): `releases/v0.1.4/rocky-v0.1.4-macos-arm64.dmg`
- Generated (ignored): `releases/v0.1.4/rocky-v0.1.4-macos-arm64.pkg`
- Installed: `/Applications/Rocky.app`

**Interfaces:**
- Consumes: the completed release pipeline and local macOS packaging tools.
- Produces: an installed, running Rocky application ready for user visual inspection.

- [ ] **Step 1: Run repository validation**

Run: `npm run typecheck && npm --prefix web run typecheck && npm run electron:build && npm test`

Expected: all commands exit 0 and all tests pass.

- [ ] **Step 2: Build release artifacts**

Run: `npm run release:macos -- --tag v0.1.4`

Expected: ZIP, DMG, and PKG paths are printed and the staged bundle passes its metadata validation.

- [ ] **Step 3: Inspect the package before installation**

Use `plutil -p`, `test -x`, and `test -f` against the staged application. Confirm the Rocky executable and icon exist and the Electron executable does not.

- [ ] **Step 4: Install the package**

Run the generated PKG with the macOS installer and confirm `/Applications/Rocky.app` contains the same metadata and resources.

- [ ] **Step 5: Launch and smoke the installed app**

Run `open -a Rocky`, confirm the running bundle executable is `Rocky`, and leave the app open for the user's Dock, Command-Tab, application-menu, and icon inspection.

- [ ] **Step 6: Review final scope**

Run `git status --short`, `git diff --stat`, and `git diff --check`; confirm only issue 131 source, tests, asset, and docs are changed.
