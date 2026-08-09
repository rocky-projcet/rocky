# macOS Release Artifacts Design

## Context

Rocky v0.1.4 currently publishes Windows artifacts to both the private repository
and the public `rocky-projcet/rocky-release` repository. The application updater
already reads public releases and can select macOS `.pkg`, `.dmg`, or `.app.zip`
assets by host architecture, and the repository already contains macOS bundle and
installer packaging scripts. The missing integration is building those artifacts
on macOS runners and publishing them with the Windows release assets.

The existing v0.1.4 tag and release are published and immutable. The first release
that contains macOS assets will therefore use the next patch version, `v0.1.5`,
unless a release owner explicitly chooses a different version.

## Goals

- Build unsigned, non-notarized macOS artifacts on both Apple Silicon and Intel
  GitHub-hosted runners.
- Publish macOS artifacts to the same private and public GitHub Releases as the
  Windows installer.
- Keep the public release usable by the existing macOS updater, including
  architecture-aware asset selection and SHA-256 verification.
- Preserve the current Windows packaging and update flow.
- Run typecheck, the full test suite, macOS bundle/PKG contract checks, and a
  source-free payload validation before publication.
- Clearly document the unsigned/notarized limitation and Gatekeeper warning.

## Non-goals

- Apple Developer code signing or notarization.
- A universal binary that combines arm64 and x64 Electron runtimes.
- Changing the public repository or updater protocol.
- Reusing or moving the already-published `v0.1.4` tag.

## Artifact and release contract

Each macOS runner produces all three installer forms from the existing packaging
script:

- `rocky-v<tag>-macos-arm64.pkg`
- `rocky-v<tag>-macos-arm64.dmg`
- `rocky-v<tag>-macos-arm64.app.zip`
- `rocky-v<tag>-macos-x64.pkg`
- `rocky-v<tag>-macos-x64.dmg`
- `rocky-v<tag>-macos-x64.app.zip`

The Windows installer remains `Rocky-Setup-v<tag>.exe`. A single deterministic
`SHA256SUMS.txt` lists every user-facing installer asset, sorted by name. Source
payload archives are not uploaded as user-facing release assets unless they are
the explicitly supported macOS `.app.zip` installers above.

The release contract will accept exactly the Windows installer plus checksum and
the six macOS files for a dual-architecture release. The existing GitHub release
coordinator will continue to prepare matching private/public drafts, validate
asset size and digest, and publish both only after all assets are present.

## Workflow and data flow

The release workflow will be split into packaging and publication stages:

1. A Windows packaging job checks out the requested tag, installs root and web
   dependencies, runs typecheck and the full test suite, builds the Windows
   installer, and uploads its release directory as an Actions artifact.
2. A macOS packaging matrix runs on `macos-13` (Intel/x64) and `macos-14`
   (Apple Silicon/arm64). Each runner installs root and web dependencies, builds
   the Electron/web payload, runs focused macOS packaging contracts, creates the
   `.pkg`, `.dmg`, and `.app.zip`, validates bundle metadata and relative
   symlinks, and uploads only its release artifacts.
3. A publication job downloads all Windows and macOS artifacts into one release
   directory, generates/verifies the combined checksum manifest, and invokes the
   existing dual-release coordinator with `GITHUB_TOKEN` and
   `PUBLIC_RELEASE_TOKEN`.

The workflow remains manually dispatchable with an explicit release tag. A
concurrency key will use the resolved release tag rather than the branch name so
manual dispatches cannot accidentally share a branch-based lock.

## Updater behavior

No updater API changes are required. On macOS, the existing selector chooses a
`.pkg` first, then `.dmg`, then `.app.zip`, and scores filenames for the current
architecture while allowing universal assets if they are ever added. The public
release will therefore expose an update for both `arm64` and `x64` hosts. The
download path will continue to verify the GitHub asset digest or the combined
`SHA256SUMS.txt` before making an installer available.

## Error handling and safety

- Missing artifacts, unexpected filenames, architecture mismatches, malformed
  PKG component metadata, absolute app-bundle symlinks, or checksum mismatches
  fail the workflow before either release is published.
- Existing published releases are never mutated to add missing assets. A
  published release with the wrong asset set fails closed; a new patch version is
  required.
- The macOS installer keeps the fixed `/Applications/Rocky.app` destination and
  does not remove per-user state under `~/Library/Application Support/Rocky`.
- Release notes explicitly state that artifacts are unsigned and not notarized and
  that Gatekeeper may warn before installation.

## Verification checklist

- Focused release-contract and macOS bundle tests pass.
- Final full typecheck and test suite pass once against the final tree.
- Both macOS matrix jobs produce the expected three files and combined release
  publication succeeds for private and public repositories.
- Public release assets and `SHA256SUMS.txt` are retrievable anonymously.
- A Windows updater check still selects the `.exe` asset.
- Simulated arm64 and x64 macOS updater checks select their matching `.pkg` asset
  from the public release and expose the expected SHA-256 digest.
- A freshly installed macOS PKG verification confirms Rocky bundle metadata,
  helper bundle names, relative symlinks, `/Applications/Rocky.app`, and the
  exact main-process executable command.

