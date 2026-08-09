---
name: rocky-electron-desktop-chrome
description: "Use when modifying Rocky's Electron desktop shell chrome: BrowserWindow titlebar styles, native application menus, preload IPC bridges, web desktop chrome, back/forward controls, or Windows/macOS Electron UI smoke checks."
---

# Rocky Electron Desktop Chrome

## Overview

Keep Rocky's desktop shell native-feeling without splitting product UI into a second app. Treat these changes as cross-boundary work across Electron main, preload, renderer chrome, and real Electron verification.

## Scope Check

Use this skill for:
- Native titlebar or menu behavior in `electron/main.ts` or `electron/menu.ts`.
- Preload APIs in `electron/preload.ts` and matching browser guards in `web/src/shared/lib/desktop-api.ts`.
- Renderer chrome such as `web/src/shared/components/desktop-chrome.tsx`, sidebar offsets, back/forward controls, and menu buttons.
- Windows/macOS differences around titlebar overlay, hidden menu bars, native window controls, and app menu accelerators.

For pure web page layout, use `rocky-web-ui-dev`. For backend/runtime behavior, use `rocky-dev`.

## Workflow

1. Inspect both sides of the boundary before editing.
- Main/preload: `electron/main.ts`, `electron/preload.ts`, `electron/menu.ts`.
- Renderer: `web/src/shared/components/desktop-chrome.tsx`, `app-shell.tsx`, `site-header.tsx`, and `web/src/shared/lib/desktop-api.ts`.
- Tests/smokes: `test/electron`, `test/web`, and `.tmp/electron-*-smoke.mjs` when present.

2. Preserve native behavior in the main process.
- Keep a real Electron application menu when accelerators or native popup menus are needed, even if the visible menu bar is hidden.
- Hide the default visible menu bar with `autoHideMenuBar: true` and `window.setMenuBarVisibility(false)` when the renderer supplies the visible menu labels.
- For top-attached custom chrome, use `titleBarStyle` plus `titleBarOverlay`; prefer `hidden` on Windows and `hiddenInset` on macOS unless the current code has a different established pattern.
- Validate IPC payloads in the main process before calling native APIs such as `Menu.popup()`.

3. Make renderer chrome drag-aware.
- Put `[-webkit-app-region:drag]` on the custom titlebar container only.
- Put `[-webkit-app-region:no-drag]` on every interactive child: menu buttons, sidebar toggle, back/forward buttons, search inputs, dropdowns, and icons that open actions.
- Reserve space for native window controls on Windows, usually with right padding on the titlebar row.
- Keep the titlebar height synchronized with `titleBarOverlay.height`; a mismatch causes awkward hit targets and visual drift.

4. Keep the preload bridge narrow.
- Expose only desktop-specific capabilities needed by the renderer, such as API base URL, navigation state/actions, and application menu popup requests.
- Mirror every preload API with a defensive resolver in `web/src/shared/lib/desktop-api.ts` so browser/dev-server mode degrades cleanly.
- Add or update web tests for complete bridge detection and partial-bridge rejection.

5. Verify in layers.
- On Windows, run `npm.cmd run typecheck`, `npm.cmd --prefix web run typecheck`, `npm.cmd run electron:build`, and `npm.cmd test`; on macOS, use the same commands without `.cmd`.
- On Windows, rerun the Electron build outside the sandbox if Vite/esbuild hits `Access is denied`.
- When the macOS artifact-first release fast path governs this smoke, its one final full suite satisfies this checklist's full-suite requirement; do not run `npm test` again after the release fast path.
- Run Electron smokes that exercise the real shell, especially menu popup, navigation, and first-window rendering.
- Inspect a screenshot when layout or titlebar placement changed; BrowserWindow captures should show `data-desktop-chrome` at the top of the renderer viewport and no unexpected scrollbars.

6. Smoke a freshly installed macOS app deterministically.
- Use the artifact-first release checks before this smoke. Require `/Applications/Rocky.app/Contents/Info.plist` values `CFBundleDisplayName=Rocky`, `CFBundleName=Rocky`, `CFBundleExecutable=Rocky`, and `CFBundleIconFile=Rocky.icns`; require `/Applications/Rocky.app/Contents/Resources/Rocky.icns` to exist.
- Require exactly these four helper bundles and matching executables: `Rocky Helper.app`, `Rocky Helper (GPU).app`, `Rocky Helper (Plugin).app`, and `Rocky Helper (Renderer).app`. Confirm no Electron-named app or executable remains.
- Confirm every symlink inside `/Applications/Rocky.app` is relative; reject an absolute link rather than assuming the copied framework is intact.
- Before launch, obtain a clean baseline: if Rocky may be open for unrelated use, ask the user to quit it or approve a clean test window; do not quit or kill a user-opened instance. Snapshot the PIDs whose command is exactly `/Applications/Rocky.app/Contents/MacOS/Rocky`, then launch only the fixed installed bundle with `open /Applications/Rocky.app`. Poll for a bounded time and require an exact-command PID absent from the pre-launch snapshot. An existing exact-match PID is not launch evidence. Fail after the bound; do not use a broad `pgrep`, bundle-name substring, arguments-containing command, or helper-process match as proof that the main app launched.
- Attempt unsupported Dock or Command-Tab automation no more than once. If it is unavailable or unreliable, leave Rocky open and ask the user to accept the Dock, Command-Tab, menu, and icon appearance; do not retry automation or relaunch solely for that visual check.

## Common Mistakes

- Treating `titleBarStyle` as enough: the renderer still needs drag/no-drag regions.
- Removing the application menu entirely: this can break native accelerators and popup menu reuse.
- Wiring menu labels as ordinary buttons without IPC: they may look correct but click with no native response.
- Verifying only the web dev server: Electron titlebar, menu, preload, and navigation behavior require a real Electron process.
- Launching multiple Electron smokes in parallel: they can contend for build output, state roots, or visible app processes.
