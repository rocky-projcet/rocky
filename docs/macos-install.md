# Rocky macOS install/update

Release tag: `v0.1.2`

The v0.1.2 macOS distribution includes a zipped app bundle, optional DMG, and
an unsigned `.pkg` installer produced on macOS builders:

```text
rocky-v0.1.2-macos-<arch>.app.zip
rocky-v0.1.2-macos-<arch>.dmg
rocky-v0.1.2-macos-<arch>.pkg
```

The `.app.zip` remains the simplest preview artifact. The `.pkg` is the clearer
installer/update UX: users run the package, macOS shows installation progress,
and the payload is installed to `/Applications/Rocky.app`. The DMG is a
convenience wrapper created with macOS `hdiutil` when available.

The app bundle contains compiled backend JavaScript, built web assets, the small
static web server script, package metadata, and production npm dependencies. It
intentionally excludes TypeScript source, tests, local agent instructions, and
development configuration.

## Requirements

- macOS 12 or newer
- Node.js 22 or newer installed through Homebrew, Volta, asdf, nvm, or available as `node`
- Codex CLI installed and authenticated before Codex-backed runs are used

## Install and run

Preferred installer/update flow:

1. Download `rocky-v0.1.2-macos-<arch>.pkg` from the GitHub Release.
2. Open the package and follow the macOS Installer prompts.
3. The package installs or replaces `/Applications/Rocky.app`.
4. Open `Rocky.app`.
5. If Gatekeeper blocks the unsigned package or app, use **System Settings >
   Privacy & Security > Open Anyway**.

Preview app-bundle flow:

1. Download `rocky-v0.1.2-macos-<arch>.app.zip` from the GitHub Release.
2. Unzip it.
3. Move `Rocky.app` to `/Applications` or another writable folder.
4. Open `Rocky.app`.
5. If Gatekeeper blocks the unsigned app, use **System Settings > Privacy &
   Security > Open Anyway**, or right-click `Rocky.app` and choose **Open**.

From the DMG artifact, open the DMG and copy/open `Rocky.app`.

When opened, Rocky starts:

- API: `http://127.0.0.1:3000`
- Web UI: `http://127.0.0.1:4173`

Logs are written under `~/Library/Logs/Rocky/`. Runtime state defaults to
`~/Library/Application Support/Rocky/agent-engine`.

Rocky tries to find Node.js in standard GUI-safe locations, including Homebrew, Volta, asdf, and nvm installs. If the app still shows the Node.js requirement alert, launch it once from Terminal with an explicit Node path:

```sh
ROCKY_NODE="$(command -v node)" \
ROCKY_API_PORT=3000 \
ROCKY_WEB_PORT=4173 \
ROCKY_STATE_ROOT="$HOME/Library/Application Support/Rocky/agent-engine" \
/Applications/Rocky.app/Contents/MacOS/Rocky
```

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

This runs the backend build, web build, stages `Rocky.app`, installs production
npm dependencies into the staged payload, validates the app layout, and creates
artifacts under:

```text
releases/v0.1.2/
```

Useful options:

```sh
npm run release:macos -- --tag v0.1.2
npm run release:macos -- --no-dmg
npm run release:macos -- --no-pkg
npm run release:macos -- --skip-build
```

On non-macOS builders, the script can still stage and zip `Rocky.app` when `zip`
is available, but DMG and PKG creation are skipped because `hdiutil` and
`pkgbuild` are macOS-only.

## Smoke validation

After building or downloading the artifact:

1. Install `rocky-v0.1.2-macos-<arch>.pkg`, unzip the app zip, or mount the DMG.
2. Open `/Applications/Rocky.app` or the staged `Rocky.app`.
3. Confirm the browser opens `http://127.0.0.1:4173`.
4. Confirm the API responds:

   ```sh
   curl http://127.0.0.1:3000/agents
   ```

5. Confirm logs exist under `~/Library/Logs/Rocky/` if startup fails.
6. For Codex-backed runs, authenticate Codex separately and run a minimal Rocky
   smoke from the UI or CLI.

## Signing and notarization decision

v0.1.2 macOS artifacts are unsigned and not notarized. The release intentionally
avoids paid Apple Developer ID credentials while the repository is still early.
Gatekeeper warnings are expected. A later release can add Developer ID signing,
notarization, stapling, and a stricter DMG install experience.

## Architecture support decision

The v0.1.2 artifact name includes the builder Node architecture (`arm64` or
`x64`). Rocky does not bundle a universal Node runtime in this release. Users
must install Node.js 22+ for their Mac architecture. The app payload is mostly
JavaScript, but the release should be smoke-tested on the architecture named in
the artifact before publication.

## Known limitations

- No bundled Node.js runtime.
- No Apple Developer ID signing or notarization.
- The `.pkg` installer is unsigned and uses macOS Installer UI, but it is not a
  fully automatic in-app updater.
- No automatic download/update channel is provided in `v0.1.2`.
- No silent/background update flow is provided.
- Rollback is best-effort command-line recovery, not a complete GUI rollback UX.
- No LaunchAgent/service registration; closing the app stops the API and web UI.
- No custom macOS app icon yet.
- Codex login is not automated by the installer.
