# Rocky macOS install

Release tag: `v0.1.1`

The v0.1.1 macOS distribution format is a zipped app bundle, with an optional
DMG produced on macOS builders:

```text
rocky-v0.1.1-macos-<arch>.app.zip
rocky-v0.1.1-macos-<arch>.dmg
```

The `.app.zip` is the primary GitHub Release artifact because it can be attached
directly to a release and does not require Apple Developer ID credentials. The
DMG is a convenience wrapper created with macOS `hdiutil` when available.

The app bundle contains compiled backend JavaScript, built web assets, the small
static web server script, package metadata, and production npm dependencies. It
intentionally excludes TypeScript source, tests, local agent instructions, and
development configuration.

## Requirements

- macOS 12 or newer
- Node.js 22 or newer available as `node`
- Codex CLI installed and authenticated before Codex-backed runs are used

## Install and run

From the zipped app artifact:

1. Download `rocky-v0.1.1-macos-<arch>.app.zip` from the GitHub Release.
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

Advanced environment overrides before launching from a shell:

```sh
ROCKY_NODE=/opt/homebrew/bin/node \
ROCKY_API_PORT=3000 \
ROCKY_WEB_PORT=4173 \
ROCKY_STATE_ROOT="$HOME/Library/Application Support/Rocky/agent-engine" \
open Rocky.app
```

## Build the release artifacts

From the repository root on macOS:

```sh
npm run release:macos
```

This runs the backend build, web build, stages `Rocky.app`, installs production
npm dependencies into the staged payload, validates the app layout, and creates
artifacts under:

```text
releases/v0.1.1/
```

Useful options:

```sh
npm run release:macos -- --tag v0.1.1
npm run release:macos -- --no-dmg
npm run release:macos -- --skip-build
```

On non-macOS builders, the script can still stage and zip `Rocky.app` when `zip`
is available, but DMG creation is skipped because `hdiutil` is macOS-only.

## Smoke validation

After building or downloading the artifact:

1. Unzip `rocky-v0.1.1-macos-<arch>.app.zip` or mount the DMG.
2. Open `Rocky.app`.
3. Confirm the browser opens `http://127.0.0.1:4173`.
4. Confirm the API responds:

   ```sh
   curl http://127.0.0.1:3000/agents
   ```

5. Confirm logs exist under `~/Library/Logs/Rocky/` if startup fails.
6. For Codex-backed runs, authenticate Codex separately and run a minimal Rocky
   smoke from the UI or CLI.

## Signing and notarization decision

v0.1.1 macOS artifacts are unsigned and not notarized. The release intentionally
avoids paid Apple Developer ID credentials while the repository is still early.
Gatekeeper warnings are expected. A later release can add Developer ID signing,
notarization, stapling, and a stricter DMG install experience.

## Architecture support decision

The v0.1.1 artifact name includes the builder Node architecture (`arm64` or
`x64`). Rocky does not bundle a universal Node runtime in this release. Users
must install Node.js 22+ for their Mac architecture. The app payload is mostly
JavaScript, but the release should be smoke-tested on the architecture named in
the artifact before publication.

## Known limitations

- No bundled Node.js runtime.
- No Apple Developer ID signing or notarization.
- No LaunchAgent/service registration; closing the app stops the API and web UI.
- No custom macOS app icon yet.
- Codex login is not automated by the installer.
