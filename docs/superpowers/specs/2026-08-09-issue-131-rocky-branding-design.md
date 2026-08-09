# Issue 131 Rocky macOS Branding Design

## Goal

Package and run the macOS desktop application as Rocky rather than Electron, while preserving the existing Rocky identity on Windows and producing an installable artifact for manual verification.

## Considered approaches

1. **Rebrand the existing staged Electron bundle.** Copy `Electron.app`, rename its executable to `Rocky`, replace the bundle metadata, install a Rocky `.icns`, and validate the resulting bundle. This is the recommended approach because it keeps the current release pipeline and dependency surface intact.
2. **Adopt Electron Packager or Electron Builder.** Let a packaging framework rewrite bundle metadata and icons. This would eventually provide broader packaging features, but it adds a new packaging dependency and changes more of the release pipeline than issue 131 requires.
3. **Set only runtime names in Electron main.** Continue using `app.setName("Rocky")` and window titles without changing the bundle. This cannot satisfy Dock, app-switcher, executable, or icon requirements because macOS reads those values from the bundle.

## Design

The macOS release script will remain the packaging boundary. It will stage `Electron.app` as `Rocky.app`, preserve the Electron runtime's relative framework symlinks, rename `Contents/MacOS/Electron` to `Contents/MacOS/Rocky`, and write an `Info.plist` whose display name, bundle name, executable, and icon file all reference Rocky. The four Electron helper bundles, their executables, and their bundle metadata will likewise be renamed to Rocky so Chromium subprocesses resolve their packaged resources correctly and do not expose Electron in Activity Monitor. A committed `assets/macos/Rocky.icns` will be generated from the same canonical `web/public/android-chrome-512x512.png` source used by the Windows icon pipeline. Keeping the compiled icon in the repository makes package assembly deterministic and allows bundle validation without requiring icon-generation tools at package time.

The Electron main process will continue setting the application name before creating menus and windows. Windows keeps its current `assets/windows/rocky.ico` resolution and AppUserModelID behavior; no Windows packaging layout changes are introduced.

## Validation

Automated tests will exercise the macOS packaging helper against a temporary bundle and assert observable output: runtime symlinks remain relative, the main and helper executables are renamed, their plist metadata names Rocky, `Info.plist` references the Rocky icon, and no Electron-named app or executable remains. The package script's built-in validation will enforce the same invariants on a real staged application.

For manual verification, the implementation will build the v0.1.4 macOS app, DMG, and PKG, install the PKG into `/Applications/Rocky.app`, launch the installed application, and inspect bundle metadata and the running executable. The user can then confirm the Dock, app switcher, application menu, and displayed icon visually. Existing TypeScript, Electron, and Windows-related tests must continue to pass.

## Error handling and scope

Packaging fails before artifact creation if the Rocky icon, renamed executable, metadata, or application payload is missing. The change does not add signing, notarization, universal binaries, auto-update behavior, or a new packaging framework.
