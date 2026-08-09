# Rocky macOS install/update

Release tag: `v0.1.3`

The v0.1.3 macOS distribution includes a zipped app bundle, optional DMG, and
an unsigned `.pkg` installer produced on macOS builders:

```text
rocky-v0.1.3-macos-<arch>.app.zip
rocky-v0.1.3-macos-<arch>.dmg
rocky-v0.1.3-macos-<arch>.pkg
```

The `.app.zip` remains the simplest preview artifact. The `.pkg` is the clearer
installer/update UX: users run the package, macOS shows installation progress,
and the payload is installed to `/Applications/Rocky.app`. The DMG is a
convenience wrapper created with macOS `hdiutil` when available.

The app bundle contains the Electron desktop runtime, compiled backend
JavaScript, built web assets, package metadata, and production npm dependencies.
It intentionally excludes TypeScript source, tests, local agent instructions,
and development configuration.

## Requirements

- macOS 13 Ventura or newer
- Codex CLI installed and authenticated before Codex-backed runs are used

## Install and run

Preferred installer/update flow:

1. Download `rocky-v0.1.3-macos-<arch>.pkg` from the GitHub Release.
2. Open the package and follow the macOS Installer prompts.
3. The package installs or replaces `/Applications/Rocky.app`.
4. Open `Rocky.app`.
5. If Gatekeeper blocks the unsigned package or app, use **System Settings >
   Privacy & Security > Open Anyway**.

Preview app-bundle flow:

1. Download `rocky-v0.1.3-macos-<arch>.app.zip` from the GitHub Release.
2. Unzip it.
3. Move `Rocky.app` to `/Applications` or another writable folder.
4. Open `Rocky.app`.
5. If Gatekeeper blocks the unsigned app, use **System Settings > Privacy &
   Security > Open Anyway**, or right-click `Rocky.app` and choose **Open**.

From the DMG artifact, open the DMG and copy/open `Rocky.app`.

When opened, Rocky starts a native Electron window. The backend API uses an
internal loopback port managed by the desktop app, and the built web UI loads
inside the app window instead of opening the default browser.

Logs are written under `~/Library/Logs/Rocky/`. Runtime state defaults to
`~/Library/Application Support/Rocky/agent-engine`.

## Update-safe path

For normal updates, run the newer `.pkg`. It replaces `/Applications/Rocky.app`
and leaves runtime state outside the app bundle, so sessions/tasks/state are not
deleted.

For the packaged `Rocky.app`, replacing the app bundle manually is still safe as
long as state stays under `~/Library/Application Support/Rocky/agent-engine`.

For early manual installs or extracted repository-style payloads that contain a
`.rocky-install` marker, use the helper from the new Rocky payload directory:

```sh
scripts/update-macos-manual.sh /path/to/existing/Rocky
```

The helper treats the target as an existing Rocky install and then:

1. Moves the previous install aside as a timestamped backup.
2. Copies the new app/runtime payload into the target path.
3. Restores local state/settings paths: `.runtime`, `.codex`, `.rocky-env.ps1`,
   `.env`, `.env.local`, and the `.tools` runtime tool cache.
4. Writes `.rocky-install` with the release tag.
5. Removes the backup only after the update completes.

If copying or migration fails, the helper restores the previous install from the
backup and writes recovery information under `.rocky-update-logs`.

## State preservation

The recommended Rocky state root is outside the app payload:

```text
~/Library/Application Support/Rocky/agent-engine
```

If you used an in-app `.runtime/state` during early manual installs, the update
helper preserves it.

## Build the release artifacts

From the repository root on macOS:

```sh
npm run release:macos
```

This runs the backend build, web build, stages an Electron-based `Rocky.app`,
installs production npm dependencies into the staged payload, validates the app
layout, and creates artifacts under:

```text
releases/v0.1.3/
```

Useful options:

```sh
npm run release:macos -- --tag v0.1.3
npm run release:macos -- --no-dmg
npm run release:macos -- --no-pkg
npm run release:macos -- --skip-build
```

On non-macOS builders, the script can still stage and zip `Rocky.app` when `zip`
is available, but DMG and PKG creation are skipped because `hdiutil` and
`pkgbuild` are macOS-only.

## Smoke validation

After building or downloading the artifact:

1. Install `rocky-v0.1.3-macos-<arch>.pkg`, unzip the app zip, or mount the DMG.
2. For an installed app, run the branding smoke below. For a staged app, replace
   `/Applications/Rocky.app` in the commands with that app's path.
3. Confirm the Rocky native window opens and shows the web UI.
4. Confirm logs exist under `~/Library/Logs/Rocky/` if startup fails.
5. For Codex-backed runs, authenticate Codex separately and run a minimal Rocky
   smoke from the UI or CLI.

### Manual branding smoke

The packaged app embeds `Contents/Resources/Rocky.icns` and runs
`Contents/MacOS/Rocky`. After installing `/Applications/Rocky.app`, verify its
metadata and bundled files:

```sh
app=/Applications/Rocky.app
plist="$app/Contents/Info.plist"

plutil -extract CFBundleDisplayName raw "$plist"
plutil -extract CFBundleName raw "$plist"
plutil -extract CFBundleExecutable raw "$plist"
plutil -extract CFBundleIconFile raw "$plist"
test -x "$app/Contents/MacOS/Rocky"
test -f "$app/Contents/Resources/Rocky.icns"
```

The four `plutil` commands must print `Rocky`, `Rocky`, `Rocky`, and
`Rocky.icns`, respectively. Launch that exact bundle and confirm the live main
process command is exactly its executable path:

```sh
open "$app"

pid=""
attempt=0
while [ -z "$pid" ] && [ "$attempt" -lt 50 ]; do
  pid=$(
    ps -axo pid=,command= |
      awk -v executable="$app/Contents/MacOS/Rocky" '
        {
          pid = $1
          sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "")
          if ($0 == executable) {
            print pid
            exit
          }
        }
      '
  )
  [ -n "$pid" ] || sleep 0.1
  attempt=$((attempt + 1))
done

test -n "$pid"
process_command=$(ps -p "$pid" -o command=)
test "$process_command" = "$app/Contents/MacOS/Rocky"
```

When the app is open, visually confirm all of the following:

1. The Dock shows Rocky with the Rocky icon.
2. Command-Tab identifies the running app as Rocky and shows the Rocky icon.
3. The macOS application menu (the leftmost menu-bar menu) is named Rocky.

## Signing and notarization decision

v0.1.3 macOS artifacts are unsigned and not notarized. The release intentionally
avoids paid Apple Developer ID credentials while the repository is still early.
Gatekeeper warnings are expected. A later release can add Developer ID signing,
notarization, stapling, and a stricter DMG install experience.

## Architecture support decision

The v0.1.3 artifact name includes the builder Node architecture (`arm64` or
`x64`). Rocky does not bundle a universal Node runtime in this release. Users
must install Node.js 22+ for their Mac architecture. The app payload is mostly
JavaScript, but the release should be smoke-tested on the architecture named in
the artifact before publication.

## Known limitations

- No Apple Developer ID signing or notarization.
- The `.pkg` installer is unsigned and uses macOS Installer UI, but it is not a
  fully automatic in-app updater.
- No automatic download/update channel is provided in `v0.1.3`.
- No silent/background update flow is provided.
- Rollback is best-effort command-line recovery, not a complete GUI rollback UX.
- No LaunchAgent/service registration; closing the app stops the backend API.
- Codex login is not automated by the installer.
