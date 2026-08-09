# Issue #133 Dual Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an idempotent Windows dual-release workflow and make the Rocky desktop updater consume the public `rocky-projcet/rocky-release` repository without authentication.

**Architecture:** Keep the existing `AppUpdateService` as the desktop update boundary and change only its release source/authentication policy. Add a small, dependency-free TypeScript release coordinator with an injectable GitHub REST client, then invoke it from a Windows GitHub Actions workflow after the existing installer/source-free build.

**Tech Stack:** Node.js 22, TypeScript/NodeNext, built-in `fetch`, `node:test`, PowerShell, GitHub Actions REST API.

## Global Constraints

- The public distribution repository is exactly `rocky-projcet/rocky-release`.
- The desktop updater sends no GitHub `Authorization` header and does not read `ROCKY_GITHUB_TOKEN`, `GITHUB_TOKEN`, `GITHUB_PAT`, or `GH_TOKEN`.
- The workflow builds the Windows installer once and uploads only `Rocky-Setup-<tag>.exe` and `SHA256SUMS.txt`.
- Published tags and assets are immutable; matching retries resume and mismatches fail.
- Private publication uses `GITHUB_TOKEN`; public publication uses `PUBLIC_RELEASE_TOKEN` scoped to `rocky-projcet/rocky-release`.
- `v0.1.4` release notes must contain `Highlights`, `Windows Install`, `Validation`, `Checksums`, and `Known Limitations`.
- Do not include private source, development archives, credentials, or authorization headers in application artifacts or logs.

---

### Task 1: Refresh the issue branch and record the corrected design

**Files:**
- Create: `docs/superpowers/specs/2026-08-09-issue-133-dual-public-release-design.md`
- Create: `docs/superpowers/plans/2026-08-09-issue-133-dual-public-release.md`

- [ ] **Step 1: Rebase the issue branch onto the updated integration branch**

Run from the issue worktree:

```bash
git rebase develop
```

Expected: the branch contains the current `develop` commit and no conflict.

- [ ] **Step 2: Review the design and plan for the singular public repository name**

Run:

```bash
rg -n "rocky-releases|rocky-release" docs/superpowers/specs/2026-08-09-issue-133-dual-public-release-design.md docs/superpowers/plans/2026-08-09-issue-133-dual-public-release.md
```

Expected: only `rocky-projcet/rocky-release` appears for the public repository,
and no placeholder remains.

- [ ] **Step 3: Commit the approved design and plan**

```bash
git add docs/superpowers/specs/2026-08-09-issue-133-dual-public-release-design.md docs/superpowers/plans/2026-08-09-issue-133-dual-public-release.md
git commit -m "docs: plan dual public release workflow (#133)"
```

### Task 2: Switch the desktop updater to the public repository

**Files:**
- Modify: `src/installer/app-update-service.ts`
- Test: `test/runtime/app-update-service.test.ts`

**Interfaces:**
- `AppUpdateService` continues to implement `AppUpdateServiceLike`; no route or renderer API changes are required.
- `DEFAULT_REPO_FULL_NAME` becomes `rocky-projcet/rocky-release`.
- `githubRequestInit()` returns only the relevant `Accept` header.

- [ ] **Step 1: Write the failing public-update test**

Change the existing Windows discovery test to construct `AppUpdateService`
without a token, return a public release payload, and assert:

```ts
assert.deepEqual(fetches, [
  "https://api.github.com/repos/rocky-projcet/rocky-release/releases/latest",
]);
assert.equal(authorization, null);
```

Add a second test that sets `ROCKY_GITHUB_TOKEN` and `GITHUB_PAT` in the
service's base environment, checks and downloads an update, and still asserts
that every request has no `authorization` header.

- [ ] **Step 2: Run only the updater tests and verify they fail**

```bash
npm run build --silent && node --test dist/test/runtime/app-update-service.test.js
```

Expected: the old private repository URL and bearer token assertions fail.

- [ ] **Step 3: Implement the public unauthenticated policy**

In `AppUpdateService`:

1. Set the default repository constant to `rocky-projcet/rocky-release`.
2. Remove the `githubToken` option/property and all environment reads for
   GitHub credentials.
3. Remove conditional `Authorization` headers from release, checksum, and
   installer requests.
4. Update the 404 error to say that no public GitHub Release was found rather
   than suggesting a token for private repositories.

- [ ] **Step 4: Run the focused updater tests and verify they pass**

```bash
npm run build --silent && node --test dist/test/runtime/app-update-service.test.js
```

Expected: all updater tests pass and the request capture contains no
authorization header.

- [ ] **Step 5: Commit the updater change**

```bash
git add src/installer/app-update-service.ts test/runtime/app-update-service.test.ts
git commit -m "feat: use public release repository for app updates (#133)"
```

### Task 3: Add release contract and checksum validation

**Files:**
- Create: `src/release/release-contracts.ts`
- Create: `test/release/release-contracts.test.ts`
- Create: `scripts/dual-github-release.ts`
- Modify: `package.json`

**Interfaces:**
- `parseReleaseTag(tag: string): { tag: string; version: string }` accepts only
  leading-`v` semver tags.
- `assertReleaseVersion(tag: string, packageVersion: string): void` throws on
  mismatch.
- `validateReleaseNotes(markdown: string, tag: string): void` requires the five
  release-note headings.
- `createSha256Sums(entries: Array<{ name: string; bytes: Uint8Array }>): string`
  returns deterministic lowercase SHA-256 lines sorted by asset name.
- `scripts/dual-github-release.ts` is the executable entry point and consumes
  `--tag`, `--output-directory`, and the Actions credential environment.

- [ ] **Step 1: Write failing contract tests**

Cover valid/invalid tags, package-version mismatch, missing release-note
headings, deterministic checksum output, and rejection of an unexpected asset
set. Use concrete `v0.1.4` fixtures.

- [ ] **Step 2: Run the focused contract tests and verify they fail**

```bash
npm run build --silent && node --test dist/test/release/release-contracts.test.js
```

Expected: the imported contract functions are missing or return incorrect
results.

- [ ] **Step 3: Implement the minimal pure validators and checksum helper**

Use `node:crypto` and `node:fs/promises`; do not add a release dependency.
Keep validation errors actionable and free of token/path contents.

- [ ] **Step 4: Add the CLI script and npm entry point**

Add:

```json
"release:dual": "npm run build --silent && node dist/scripts/dual-github-release.js"
```

The script reads the exact tag and package version, validates
`docs/releases/<tag>.md`, checks for `Rocky-Setup-<tag>.exe`, creates or
updates `SHA256SUMS.txt`, and then delegates GitHub operations to the
coordinator from Task 4.

- [ ] **Step 5: Run the focused tests and commit**

```bash
npm run build --silent && node --test dist/test/release/release-contracts.test.js
git add src/release/release-contracts.ts test/release/release-contracts.test.ts scripts/dual-github-release.ts package.json
git commit -m "feat: validate dual release contracts (#133)"
```

### Task 4: Implement idempotent dual-release coordination

**Files:**
- Create: `src/release/github-release-coordinator.ts`
- Create: `test/release/github-release-coordinator.test.ts`
- Modify: `scripts/dual-github-release.ts`

**Interfaces:**
- `GitHubReleaseClient` exposes `findByTag`, `createDraft`, `listAssets`,
  `uploadAsset`, `updateRelease`, and `publishRelease`.
- `DualReleaseCoordinator.publish(input)` returns a summary containing private
  and public release ids, published states, and verified asset metadata.
- The coordinator receives separate clients/tokens for private and public
  repositories; it never logs token values.

- [ ] **Step 1: Write failing fake-client tests**

Cover these transitions independently:

1. Missing releases create drafts in both repositories.
2. Existing matching drafts resume without duplicate uploads.
3. Existing matching published private release is accepted and public work
   continues.
4. Existing asset with matching name, size, and SHA-256 is skipped.
5. Existing asset with a different size or digest fails without replacement.
6. Private release publishes before public release.
7. Missing public token fails before a public mutation.
8. Release-note or tag mismatch fails before any publication.

- [ ] **Step 2: Run the coordinator tests and verify they fail**

```bash
npm run build --silent && node --test dist/test/release/github-release-coordinator.test.js
```

Expected: the coordinator is missing or the fake-client call order is not
implemented.

- [ ] **Step 3: Implement the REST client and coordinator**

Use built-in `fetch` with GitHub REST endpoints. Use `GITHUB_TOKEN` only for
`rocky-projcet/rocky` and `PUBLIC_RELEASE_TOKEN` only for
`rocky-projcet/rocky-release`. Treat an existing published release as complete
only after verifying its immutable metadata and assets. Upload only the two
allowed stable assets.

- [ ] **Step 4: Run coordinator and contract tests**

```bash
npm run build --silent && node --test dist/test/release/release-contracts.test.js dist/test/release/github-release-coordinator.test.js
```

Expected: all fake-client state and call-order tests pass.

- [ ] **Step 5: Commit the coordinator**

```bash
git add src/release/github-release-coordinator.ts test/release/github-release-coordinator.test.ts scripts/dual-github-release.ts
git commit -m "feat: coordinate idempotent dual GitHub releases (#133)"
```

### Task 5: Add the Windows tag workflow and v0.1.4 notes

**Files:**
- Create: `.github/workflows/release-dual.yml`
- Create: `docs/releases/v0.1.4.md`
- Modify: `scripts/dual-github-release.ts`

- [ ] **Step 1: Write the v0.1.4 release notes fixture**

Include exactly these user-facing sections:

```markdown
## Highlights
## Windows Install
## Validation
## Checksums
## Known Limitations
```

State that the installer is unsigned and Windows SmartScreen may warn.

- [ ] **Step 2: Add the tag-triggered Windows workflow**

The workflow must:

1. trigger only on `v*` tags;
2. use `windows-latest`;
3. grant `contents: write`;
4. install Node 22 and Inno Setup;
5. run `npm ci`, `npm run typecheck`, and `npm test`;
6. run `npm run release:windows:installer -- -Tag ${{ github.ref_name }}` once;
7. invoke `npm run release:dual -- --tag ${{ github.ref_name }}` with
   `GITHUB_TOKEN` and `PUBLIC_RELEASE_TOKEN` passed as environment secrets.

Do not print either secret or upload the source-free app zip as a release
asset.

- [ ] **Step 3: Run static workflow and notes checks**

```bash
rg -n "rocky-release|PUBLIC_RELEASE_TOKEN|GITHUB_TOKEN|v\\*|windows-latest|Rocky-Setup|SHA256SUMS" .github/workflows/release-dual.yml docs/releases/v0.1.4.md scripts/dual-github-release.ts
```

Expected: the workflow uses the singular public repository and both required
credentials only in the workflow/coordinator boundary.

- [ ] **Step 4: Commit the workflow and notes**

```bash
git add .github/workflows/release-dual.yml docs/releases/v0.1.4.md scripts/dual-github-release.ts
git commit -m "ci: publish Windows releases to public repository (#133)"
```

### Task 6: Complete verification and release handoff

**Files:**
- Modify only files required by failed checks from Tasks 2–5.

- [ ] **Step 1: Run the complete local checks**

```bash
npm run typecheck
npm test
```

Expected: typecheck exits 0 and the full node test suite reports zero
failures.

- [ ] **Step 2: Verify the desktop updater contract**

Run the focused updater tests again and inspect the generated build for the
old private default repository and authorization header code:

```bash
rg -n "rocky-projcet/rocky/releases/latest|ROCKY_GITHUB_TOKEN|GITHUB_PAT|GH_TOKEN|Authorization" src/installer dist/src/installer test/runtime/app-update-service.test.ts
```

Expected: no old default URL or updater token reads remain; unrelated
connector authorization code is outside the inspected updater files.

- [ ] **Step 3: Record Windows-only validation requirements**

The Windows runner must execute the installer build and source-free payload
checks. A local macOS environment cannot claim this step passed without the
workflow run output.

- [ ] **Step 4: Inspect the final diff and worktree**

```bash
git diff --check
git status --short --branch
git log --oneline --decorate -8
```

Expected: only #133 files are changed on the issue branch, no generated
release payload or credential file is staged, and all local checks have fresh
evidence.

- [ ] **Step 5: Push only after explicit publication approval**

The implementation branch may be pushed for review. Do not push a `v0.1.4`
tag or publish either Release until the `PUBLIC_RELEASE_TOKEN` secret and
release-owner approval are confirmed.
