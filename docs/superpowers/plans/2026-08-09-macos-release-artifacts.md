# macOS Release Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish unsigned arm64 and x64 macOS installers alongside the Windows installer and make the next Rocky patch release discoverable by the existing public-repository updater.

**Architecture:** Extend the pure release contract and dual-release CLI to require the Windows installer plus six architecture-specific macOS assets and one combined checksum manifest. Split the GitHub Actions workflow into Windows packaging, a macOS runner matrix, and one publication job that downloads all artifacts before preparing matching private/public releases. The existing `AppUpdateService` remains unchanged because it already selects `.pkg`/`.dmg`/`.app.zip` by macOS architecture.

**Tech Stack:** Node.js 22, TypeScript/NodeNext, `node:test`, Electron, macOS `pkgbuild`/`hdiutil`, PowerShell/Inno Setup, GitHub Actions artifact upload/download, GitHub REST release coordinator.

## Global Constraints

- The public distribution repository is exactly `rocky-projcet/rocky-release`.
- The first macOS-enabled release is `v0.1.5`; the published `v0.1.4` tag and assets remain immutable.
- macOS artifacts are unsigned and not notarized; release notes must mention Gatekeeper warnings.
- macOS runners are `macos-13` for x64 and `macos-14` for arm64.
- User-facing assets are `Rocky-Setup-<tag>.exe`, six architecture-specific macOS installers, and `SHA256SUMS.txt`; the Windows source-free app zip is validation-only and is not uploaded.
- The combined checksum manifest contains every user-facing installer asset, sorted by filename, and never includes itself.
- Existing updater API and unauthenticated public repository policy remain unchanged.
- Never force-move `v0.1.4` or mutate its published assets.
- Preserve the user-owned unstaged change in `web/vite.config.ts`; never stage it.
- Before any macOS packaging or installation command that needs host permission, request the required execution permission and do not claim installation verification without fresh evidence.

---

### Task 1: Extend release contracts for Windows plus macOS assets

**Files:**
- Modify: `src/release/release-contracts.ts`
- Test: `test/release/release-contracts.test.ts`
- Test: `test/release/github-release-coordinator.test.ts`

**Interfaces:**
- Preserve `expectedWindowsReleaseAssetNames(tag): { installer: string; checksums: string }` for existing callers.
- Add `expectedMacOSReleaseAssetNames(tag): string[]`, returning the six names in deterministic order: `rocky-<tag>-macos-arm64.app.zip`, `rocky-<tag>-macos-arm64.dmg`, `rocky-<tag>-macos-arm64.pkg`, `rocky-<tag>-macos-x64.app.zip`, `rocky-<tag>-macos-x64.dmg`, and `rocky-<tag>-macos-x64.pkg`.
- Add `expectedStableReleaseAssetNames(tag): string[]`, returning the Windows installer, checksum manifest, and six macOS files sorted by filename.
- Change `assertStableReleaseAssetNames(names, tag)` to require exactly the list from `expectedStableReleaseAssetNames`.
- Require the `macOS Install` release-note heading in `validateReleaseNotes` for new macOS-enabled releases.

- [ ] **Step 1: Add failing contract tests**

Add tests using `v0.1.5` fixtures that assert the six exact macOS names, the complete stable asset set, and rejection of a missing architecture asset or an unexpected source archive. Extend the release-note fixture with `## macOS Install`, and assert that removing that heading fails validation. Update coordinator fixtures so their expected asset list includes all eight user-facing assets.

- [ ] **Step 2: Run focused tests and verify the expected failures**

Run:

~~~bash
npm run build --silent && node --test dist/test/release/release-contracts.test.js dist/test/release/github-release-coordinator.test.js
~~~

Expected: the new macOS name exports and exact-set assertions fail before implementation.

- [ ] **Step 3: Implement the minimal contract changes**

Keep `parseReleaseTag`, version validation, and checksum generation unchanged. Build names only from the normalized leading-`v` tag, return the complete stable list sorted, and keep error messages free of credentials and local absolute paths.

- [ ] **Step 4: Run focused tests and verify they pass**

~~~bash
npm run build --silent && node --test dist/test/release/release-contracts.test.js dist/test/release/github-release-coordinator.test.js
~~~

Expected: all contract and coordinator tests pass with the eight-asset fixture set.

- [ ] **Step 5: Commit the contract change**

~~~bash
git add src/release/release-contracts.ts test/release/release-contracts.test.ts test/release/github-release-coordinator.test.ts
git commit -m "feat: define macOS release asset contract"
~~~

### Task 2: Generalize the dual-release CLI and release notes

**Files:**
- Modify: `scripts/dual-github-release.ts`
- Create: `docs/releases/v0.1.5.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/release/release-contracts.test.ts`

**Interfaces:**
- `scripts/dual-github-release.ts` continues to accept `--tag` and `--output-directory`, and still reads `GITHUB_TOKEN` and `PUBLIC_RELEASE_TOKEN` only at the publication boundary.
- The CLI must require the Windows installer, six macOS assets, and the Windows source-free zip before any GitHub mutation.
- `SHA256SUMS.txt` is generated from the seven installer files (one Windows plus six macOS), written deterministically, and passed as the eighth release asset.

- [ ] **Step 1: Write the failing CLI/notes contract test cases**

Extend the release fixture to `v0.1.5`, add `## macOS Install` with the exact filenames and unsigned warning, and assert missing macOS headings are rejected. Add a pure test-level list of expected asset names that the CLI must check before invoking a client; do not add network calls to the test suite.

- [ ] **Step 2: Run the focused tests and verify they fail**

~~~bash
npm run build --silent && node --test dist/test/release/release-contracts.test.js
~~~

Expected: the current Windows-only release contract rejects or omits the macOS requirements.

- [ ] **Step 3: Update the CLI to collect all artifacts**

Use `expectedWindowsReleaseAssetNames`, `expectedMacOSReleaseAssetNames`, and the checksum name to read files from `releases/<tag>`. Keep the Windows source-free zip existence check as validation-only. Build one `ReleaseAssetInput` per user-facing installer, calculate each SHA-256 once, write the combined manifest only when absent or byte-identical, and call `assertStableReleaseAssetNames` before creating either release draft.

- [ ] **Step 4: Add v0.1.5 package metadata and release notes**

Change the root package version and both lockfile version fields from `0.1.4` to `0.1.5`. Create `docs/releases/v0.1.5.md` with these headings and concrete content:

~~~markdown
## Highlights
## Windows Install
## macOS Install
## Validation
## Checksums
## Known Limitations
~~~

Name the arm64/x64 PKG, DMG, and app zip assets, state that macOS artifacts are unsigned/not notarized, and state that Gatekeeper may warn. Do not edit `docs/releases/v0.1.4.md`.

- [ ] **Step 5: Run focused tests and commit the CLI/version change**

~~~bash
npm run build --silent && node --test dist/test/release/release-contracts.test.js
git add scripts/dual-github-release.ts docs/releases/v0.1.5.md package.json package-lock.json src/release/release-contracts.ts test/release/release-contracts.test.ts
git commit -m "feat: publish macOS release assets"
~~~

### Task 3: Split GitHub Actions into package matrix and publication stages

**Files:**
- Modify: `.github/workflows/release-dual.yml`

**Interfaces:**
- The workflow keeps tag triggers and `workflow_dispatch` with required `release_tag` input.
- `RELEASE_TAG` resolves to the dispatch input for manual runs and `github.ref_name` for tag runs.
- Jobs are named `windows-package`, `macos-package`, and `publish`; `publish` needs both packaging jobs.
- Artifact names are `rocky-release-windows-<tag>`, `rocky-release-macos-x64-<tag>`, and `rocky-release-macos-arm64-<tag>`.

- [ ] **Step 1: Write a static workflow assertion checklist**

Before editing, record checks for the resolved-tag concurrency key, `windows-latest`, `macos-13`, `macos-14`, `actions/upload-artifact@v4`, `actions/download-artifact@v4`, `PUBLIC_RELEASE_TOKEN`, and the absence of a direct `release:dual` call from a packaging matrix job.

- [ ] **Step 2: Implement the Windows packaging job**

Retain Node 22, Inno Setup, root/web dependency installation, root typecheck, full `npm test`, and one `npm run release:windows:installer -- -Tag $env:RELEASE_TAG`. Upload `releases/${RELEASE_TAG}` as the Windows Actions artifact. The job does not publish a GitHub Release.

- [ ] **Step 3: Implement the macOS packaging matrix**

Run the matrix on `macos-13` and `macos-14`, install root and web dependencies, build the TypeScript and web payload, run the focused `macos-app-bundle` and `macos-release-contracts` tests, and run:

~~~bash
npm run release:macos -- --tag "$RELEASE_TAG" --skip-build
~~~

Upload only the generated `releases/${RELEASE_TAG}` files. The runner architecture from `os.arch()` determines whether the names contain `x64` or `arm64`.

- [ ] **Step 4: Implement the publication job**

Run on `ubuntu-latest`, check out the resolved tag, install Node 22 and root dependencies, download all three artifact groups into `releases/${RELEASE_TAG}` with `merge-multiple: true`, print only filenames/sizes for diagnostics, and invoke:

~~~bash
npm run release:dual -- --tag "$RELEASE_TAG"
~~~

Pass `GITHUB_TOKEN` and `PUBLIC_RELEASE_TOKEN` as environment variables only to this step. Do not echo their values.

- [ ] **Step 5: Run static workflow checks and commit**

~~~bash
rg -n "windows-package|macos-package|publish|macos-13|macos-14|upload-artifact|download-artifact|PUBLIC_RELEASE_TOKEN|RELEASE_TAG" .github/workflows/release-dual.yml
git diff --check
git add .github/workflows/release-dual.yml
git commit -m "ci: package Windows and macOS release matrix"
~~~

Expected: only the publication job runs `release:dual`, and the concurrency group uses the resolved release tag.

### Task 4: Verify macOS packaging contracts and real artifacts on Apple Silicon

**Files:**
- Modify only files required by a focused packaging failure.
- Generated (ignored): `.tmp/macos-release/v0.1.5/`
- Generated (ignored): `releases/v0.1.5/`

**Interfaces:**
- The existing `scripts/package-macos-release.mjs` remains the packaging entry point.
- The acceptance checklist is Rocky bundle metadata, all four Rocky helper bundle names/executables, relative symlinks, `/Applications/Rocky.app` as the fixed PKG path, and the exact `Rocky` main executable.

- [ ] **Step 1: Run focused macOS contract tests before packaging**

Request execution permission for macOS packaging tools if required, then run:

~~~bash
npm run build --silent
node --test dist/test/electron/macos-app-bundle.test.js dist/test/electron/macos-release-contracts.test.js
~~~

Expected: focused tests pass before any user-facing artifact is built.

- [ ] **Step 2: Build arm64 artifacts locally**

On the current Apple Silicon host, run:

~~~bash
npm run release:macos -- --tag v0.1.5
~~~

Inspect the staged `Rocky.app` tree and the `pkg-components.plist` generated by `pkgbuild --analyze`. Confirm the main and helper bundle metadata, relative symlinks, fixed install location, and absence of Electron-named executables. Confirm the output directory contains the arm64 PKG, DMG, and app zip.

- [ ] **Step 3: Validate source-free and checksum inputs**

Confirm the Windows job's source-free zip is present only as a validation input, confirm every macOS artifact is non-empty, and confirm `SHA256SUMS.txt` includes all seven installer filenames exactly once after the publication preparation step.

- [ ] **Step 4: Run the one final local full suite**

After focused packaging checks pass and no further packaging changes are needed, run exactly once:

~~~bash
npm run typecheck
npm test
~~~

Expected: typecheck and all test suites pass. Do not rerun the full suite after the final artifact build unless a packaged-content change requires it.

### Task 5: Verify cross-architecture updater selection and prepare publication

**Files:**
- Test: `test/runtime/app-update-service.test.ts`
- Test: `test/web/app-update-ui.test.ts` only if a user-facing macOS asset label needs adjustment.

**Interfaces:**
- `AppUpdateService` remains unchanged; tests use its existing `platform`, `arch`, `currentVersion`, and injected `fetchImpl` options.

- [ ] **Step 1: Add public-release fixture coverage for both architectures**

Use a v0.1.5 release payload containing both macOS PKGs, DMGs, app zips, the Windows installer, and `SHA256SUMS.txt`. Assert that a simulated `platform: "darwin", arch: "arm64"` service selects `rocky-v0.1.5-macos-arm64.pkg`, while `arch: "x64"` selects the x64 PKG, exposes the release notes, and retains the digest/checksum source. Keep the existing Windows selection assertion.

- [ ] **Step 2: Run focused updater tests**

~~~bash
npm run build --silent && node --test dist/test/runtime/app-update-service.test.js
~~~

Expected: arm64, x64, and Windows selection tests pass without adding authorization headers or environment token reads.

- [ ] **Step 3: Commit updater regression coverage**

~~~bash
git add test/runtime/app-update-service.test.ts
git commit -m "test: cover architecture-specific macOS updates"
~~~

### Task 6: Final verification, publication branch, and release handoff

**Files:**
- Modify only files required by failed verification.

- [ ] **Step 1: Inspect the final diff and preserve unrelated work**

~~~bash
git status --short --branch
git diff --stat
git diff --cached --stat
git diff --check
~~~

Expected: `web/vite.config.ts` remains the only unrelated local modification and is not staged; generated `.tmp` and release payload files are ignored.

- [ ] **Step 2: Run the final local verification commands**

~~~bash
npm run typecheck
npm test
~~~

Expected: exit code 0 with no failed tests.

- [ ] **Step 3: Create the next release tag only after the implementation is pushed**

Confirm `package.json` is `0.1.5`, the release notes are `docs/releases/v0.1.5.md`, and the release workflow source is on the remote branch. Then create and push the annotated tag `v0.1.5`; do not touch `v0.1.4`.

- [ ] **Step 4: Verify the Actions run and public release**

The successful workflow must show Windows checks/installer, both macOS matrix packages, publication success, and eight public assets. Verify anonymously through the public API that `v0.1.5` contains the Windows installer, six macOS installers, and `SHA256SUMS.txt` with matching digests.

- [ ] **Step 5: Verify the updater against the public release**

Run the app update service with simulated darwin arm64/x64 and win32 inputs against the public `v0.1.5` release. The expected statuses are `update-available`, `latestVersion: "0.1.5"`, and the architecture-specific installer names. A macOS app process already open for unrelated use must not be killed; any installed-app smoke requires explicit permission before writing `/Applications/Rocky.app`.

- [ ] **Step 6: Report the result**

Report the implementation commits, workflow URL, public release URL, artifact list, checksum verification, and the unsigned/notarized limitation. Call out any remaining `web/vite.config.ts` user modification without including it in the feature commits.

