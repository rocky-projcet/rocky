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
- Run `npm.cmd run typecheck`.
- Run `npm.cmd --prefix web run typecheck`.
- Run `npm.cmd run electron:build`; on Windows, rerun outside the sandbox if Vite/esbuild hits `Access is denied`.
- Run `npm.cmd test`.
- Run Electron smokes that exercise the real shell, especially menu popup, navigation, and first-window rendering.
- Inspect a screenshot when layout or titlebar placement changed; BrowserWindow captures should show `data-desktop-chrome` at the top of the renderer viewport and no unexpected scrollbars.

## Common Mistakes

- Treating `titleBarStyle` as enough: the renderer still needs drag/no-drag regions.
- Removing the application menu entirely: this can break native accelerators and popup menu reuse.
- Wiring menu labels as ordinary buttons without IPC: they may look correct but click with no native response.
- Verifying only the web dev server: Electron titlebar, menu, preload, and navigation behavior require a real Electron process.
- Launching multiple Electron smokes in parallel: they can contend for build output, state roots, or visible app processes.
