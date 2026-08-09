# Issue #133: Private/Public GitHub Release Design

Date: 2026-08-09

## Goal

Publish one verified Windows installer build to matching Releases in the
private source repository and the public `rocky-projcet/rocky-release`
repository. Installed Rocky desktop applications must discover updates from
the public repository without a GitHub token.

The first release using this flow is `v0.1.4`.

## Product behavior

- `rocky-projcet/rocky` remains the private source and build repository.
- `rocky-projcet/rocky-release` is the public binary distribution repository.
- A tag push matching `v*` runs validation and builds the Windows installer
  once.
- The workflow publishes `Rocky-Setup-<tag>.exe` and `SHA256SUMS.txt` with
  identical bytes and release notes to both repositories.
- Existing matching draft steps are resumed. Existing published tags/assets
  are never replaced. Any metadata, size, or digest mismatch fails the run.
- The private Release is published before the public Release. The public
  Release is the stable update source consumed by installed applications.
- The desktop `/rocky/app-update` backend uses
  `rocky-projcet/rocky-release/releases/latest` for check, download, checksum,
  and installer flows. It sends no `Authorization` header and does not read
  `ROCKY_GITHUB_TOKEN`, `GITHUB_TOKEN`, `GITHUB_PAT`, or `GH_TOKEN`.

## Architecture

### Desktop updater

`AppUpdateService` remains the single implementation used by the desktop
backend's `/rocky/app-update` routes. Its default repository becomes a public
constant. The existing checksum verification, restart confirmation, preserved
state roots, Windows installer execution, and macOS update behavior remain
unchanged. Only the release source and authentication policy change.

### Release coordinator

A small TypeScript coordinator under `src/release/` owns release state
transitions and depends on an injectable GitHub REST client. A compiled CLI
under `scripts/` supplies repository names, tag, release notes, local assets,
and the two credentials from the Actions environment.

The coordinator performs these operations for each repository:

1. Find the release for the tag or create a draft release.
2. Verify the tag, title, notes, and prerelease/draft policy.
3. Upload missing installer/checksum assets.
4. Accept an existing asset only when its name, size, and SHA-256 digest match.
5. Publish the private release, then the public release.

The public repository's existing default branch is used as the target for a
new public tag. No private source archive or development fallback archive is
uploaded.

### GitHub Actions

`.github/workflows/release-dual.yml` runs on `v*` tag pushes on
`windows-latest`. It checks out the exact tag, installs Node dependencies and
Inno Setup, runs typecheck and tests, builds the Windows installer once, runs
the existing source-free payload validation, creates `SHA256SUMS.txt`, and
invokes the coordinator.

The private publication uses the workflow `GITHUB_TOKEN`. The public
publication uses `PUBLIC_RELEASE_TOKEN`, scoped only to
`rocky-projcet/rocky-release` with Contents read/write permission. The public
token is never passed to the desktop app or stored in a release artifact.

## Release notes and assets

Each tag requires `docs/releases/<tag>.md` with these sections:

- `Highlights`
- `Windows Install`
- `Validation`
- `Checksums`
- `Known Limitations`

`Known Limitations` for `v0.1.4` states that the Windows installer is an
unsigned preview and SmartScreen may warn. Only `Rocky-Setup-<tag>.exe` and
`SHA256SUMS.txt` are uploaded as stable Windows assets.

## Security and failure rules

- No application request includes a GitHub authorization header.
- A missing `PUBLIC_RELEASE_TOKEN` blocks publication with an actionable
  error before the public repository is changed.
- A tag/package version mismatch, missing release notes, source/dev payload,
  unexpected existing release metadata, or digest mismatch fails the run.
- A retry may resume completed draft or published steps, but never replaces a
  published tag or asset.
- Logs contain repository names, tags, and asset metadata only; credentials,
  raw authorization headers, and private source paths are not logged.

## Validation

- Unit tests cover updater public URLs and no-auth requests.
- Unit tests cover release-note/tag/asset validation and every coordinator
  retry/mismatch transition using a fake GitHub client.
- Workflow syntax and shell inputs are reviewed statically.
- `npm run typecheck` and `npm test` run on the branch.
- The Windows runner performs the installer build and source-free payload
  check. Actual `v0.1.4` publication additionally requires the configured
  `PUBLIC_RELEASE_TOKEN` and an explicit release run.

## Non-goals

- Windows code signing.
- Moving source development or Issues to the public repository.
- Replacing already published releases or tags.
- Adding a CDN or a second update backend.
