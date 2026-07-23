# Inline Rocky App Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rocky 상단 크롬에서 Windows와 macOS의 검증된 앱 업데이트를 다운로드하고 설치 흐름을 자동 시작한다.

**Architecture:** 기존 Fastify `AppUpdateService`와 `/rocky/app-update` API를 플랫폼 공통 상태 머신으로 확장한다. React 데스크톱 크롬은 TanStack Query로 이 상태를 자동 확인/폴링하고, 상단 아이콘 팝오버에서 릴리스 내용과 실제 다운로드 진행률을 보여준다.

**Tech Stack:** Node.js 22, TypeScript, Fastify, Electron 42, React 19, TanStack Query, Base UI Popover, Tailwind CSS, Node test runner

## Global Constraints

- Windows installer 선택과 checksum 차단 동작을 회귀시키지 않는다.
- macOS asset 선택 순서는 `.pkg`, `.dmg`, `.app.zip`이다.
- checksum 검증 전에는 설치 파일을 열지 않는다.
- macOS state root와 runtime data를 삭제하거나 애플리케이션 bundle 안으로 이동하지 않는다.
- 업데이트 UI는 별도 설정 카드가 아니라 데스크톱 상단 크롬 팝오버다.
- 기존 `web/vite.config.ts` 사용자 변경은 수정하지 않는다.

---

### Task 1: Platform-neutral update state

**Files:**
- Modify: `src/installer/app-update-types.ts`
- Modify: `src/installer/app-update-service.ts`
- Test: `test/runtime/app-update-service.test.ts`

**Interfaces:**
- Produces: `AppUpdateAssetKind`, `AppUpdateDownloadProgress`, `AppUpdateRecord.releaseNotes`, `AppUpdateService.revealDownload()`
- Consumes: existing `AppUpdateRecord`, GitHub Release asset data, `spawn`

- [ ] **Step 1: Write failing macOS selection and installer tests**

```ts
test("AppUpdateService prefers a macOS pkg and exposes release notes", async () => {
  const service = new AppUpdateService({
    platform: "darwin",
    currentVersion: "0.1.3",
    fetchImpl: async () => response({
      tag_name: "v0.1.4",
      body: "Release notes",
      assets: [
        { name: "Rocky-v0.1.4.app.zip", browser_download_url: "https://example/app.zip" },
        { name: "Rocky-v0.1.4.pkg", browser_download_url: "https://example/app.pkg" },
      ],
    }),
  });
  const record = await service.checkForUpdates();
  assert.equal(record.installerAsset?.kind, "macos-pkg");
  assert.equal(record.releaseNotes, "Release notes");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run build --silent && node --test dist/test/runtime/app-update-service.test.js`

Expected: FAIL because macOS is unsupported and the asset kind/release notes fields do not exist.

- [ ] **Step 3: Add the minimal platform-neutral state and asset resolver**

```ts
export type AppUpdateAssetKind =
  | "windows-exe"
  | "macos-pkg"
  | "macos-dmg"
  | "macos-app-zip";

function selectInstallerAsset(platform: NodeJS.Platform, assets: GitHubReleaseAsset[]) {
  if (platform === "win32") return selectWindowsInstallerAsset(assets);
  if (platform === "darwin") {
    return [
      ["macos-pkg", /\.pkg$/iu],
      ["macos-dmg", /\.dmg$/iu],
      ["macos-app-zip", /\.app\.zip$/iu],
    ].flatMap(([kind, pattern]) =>
      assets.filter((asset) => pattern.test(asset.name)).map((asset) => ({ asset, kind }))
    )[0] ?? null;
  }
  return null;
}
```

- [ ] **Step 4: Stream downloads into progress state and implement platform launch/reveal**

```ts
this.setState({
  status: "downloading",
  downloadProgress: { bytesReceived: 0, totalBytes, percent: 0 },
});

const command = this.platform === "darwin" ? "/usr/bin/open" : download.path;
const args = this.platform === "darwin" ? [download.path] : [];
this.spawn(command, args, spawnOptions);
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `npm run build --silent && node --test dist/test/runtime/app-update-service.test.js`

Expected: all app update service tests pass.

### Task 2: API and browser client transitions

**Files:**
- Modify: `src/api/routes/app-update-routes.ts`
- Modify: `web/src/shared/lib/agent-engine-client.ts`
- Modify: `web/src/domains/rocky/hooks.ts`
- Test: `test/api/app-update-routes.test.ts`

**Interfaces:**
- Consumes: `AppUpdateServiceLike.revealDownload()`
- Produces: `POST /rocky/app-update/reveal`, `revealRockyAppUpdateInstaller()`, polling update query

- [ ] **Step 1: Write a failing API test for macOS install and reveal**

```ts
const revealed = await fetch(`${baseUrl}/rocky/app-update/reveal`, { method: "POST" });
assert.equal(revealed.status, 202);
assert.equal(spawned.at(-1)?.command, "/usr/bin/open");
assert.deepEqual(spawned.at(-1)?.args.slice(0, 1), ["-R"]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run build --silent && node --test dist/test/api/app-update-routes.test.js`

Expected: FAIL with HTTP 404 for the reveal endpoint.

- [ ] **Step 3: Add reveal route, client method, mutation, and progress polling**

```ts
server.post("/rocky/app-update/reveal", async (_request, reply) => {
  const record = await options.appUpdateService.revealDownload();
  sendJson(reply, record.lastError ? 409 : 202, record);
});

refetchInterval: (query) =>
  query.state.data?.status === "downloading" ? 250 : false,
```

- [ ] **Step 4: Run API tests and verify GREEN**

Run: `npm run build --silent && node --test dist/test/api/app-update-routes.test.js`

Expected: all app update route tests pass.

### Task 3: Inline update presentation rules

**Files:**
- Modify: `web/src/domains/rocky/lib/app-update.ts`
- Test: `test/web/app-update-ui.test.ts`

**Interfaces:**
- Produces: platform-neutral `canInstallAppUpdate`, status/action labels, progress and manual-recovery predicates
- Consumes: extended `AppUpdateRecord`

- [ ] **Step 1: Write failing macOS/downloading/recovery tests**

```ts
assert.equal(
  appUpdateStatusLabel(buildRecord({
    platform: "darwin",
    status: "downloading",
    downloadProgress: { bytesReceived: 50, totalBytes: 100, percent: 50 },
  })),
  "다운로드 50%"
);
assert.equal(canInstallAppUpdate(verifiedMacRecord), true);
assert.equal(shouldOfferManualInstall(failedMacRecord), true);
```

- [ ] **Step 2: Run focused web state tests and verify RED**

Run: `npm run build --silent && node --test dist/test/web/app-update-ui.test.js`

Expected: FAIL because the new state and predicates are missing.

- [ ] **Step 3: Implement minimal pure presentation helpers**

```ts
export function canInstallAppUpdate(record: AppUpdateRecord): boolean {
  return record.supported &&
    (record.platform === "win32" || record.platform === "darwin") &&
    record.status === "downloaded" &&
    record.download?.verified === true;
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm run build --silent && node --test dist/test/web/app-update-ui.test.js`

Expected: all app update UI state tests pass.

### Task 4: Desktop chrome popover

**Files:**
- Create: `web/src/shared/components/desktop-update-control.tsx`
- Modify: `web/src/shared/components/desktop-chrome.tsx`
- Modify: `web/src/domains/rocky/pages/rocky-agent-page.tsx`

**Interfaces:**
- Consumes: update query/mutations and pure presentation helpers
- Produces: top-chrome update icon, status dot, release popover, progress bar, automatic installer launch

- [ ] **Step 1: Add the update control with automatic check**

```tsx
useEffect(() => {
  if (record?.status === "idle" && !checkMutation.isPending) {
    void checkMutation.mutateAsync();
  }
}, [record?.status, checkMutation.isPending]);
```

- [ ] **Step 2: Add update CTA that downloads then starts the installer**

```tsx
const downloaded = await downloadMutation.mutateAsync();
if (downloaded.status === "downloaded" && downloaded.download?.verified) {
  await installMutation.mutateAsync();
}
```

- [ ] **Step 3: Mount the control at the right edge and apply platform spacing**

```tsx
const isMac = resolveDesktopBridge(globalThis)?.platform === "darwin";
<div className={cn("flex h-9 ...", isMac ? "pl-[84px] pr-1" : "px-1 pr-[140px]")}>
  <SidebarTrigger />
  <DesktopHistoryControls />
  <nav>...</nav>
  <DesktopUpdateControl className="ml-auto" />
</div>
```

- [ ] **Step 4: Remove the old service-page update card**

Delete `AppUpdatePanel` and its updater-only imports from `rocky-agent-page.tsx`.

- [ ] **Step 5: Run web typecheck**

Run: `npm --prefix web run typecheck`

Expected: exit 0 with no TypeScript diagnostics.

### Task 5: Full verification

**Files:**
- Verify only

**Interfaces:**
- Consumes: all prior tasks
- Produces: evidence that the implementation works across service, web, and Electron boundaries

- [ ] **Step 1: Run repository typecheck**

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 2: Run complete tests**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Build the web and Electron application**

Run: `npm run electron:build`

Expected: exit 0 and `web/dist/index.html` plus `dist/electron/main.js` exist.

- [ ] **Step 4: Launch and inspect the real macOS Electron app**

Run: `npm run electron:dev`

Expected: macOS traffic lights do not overlap the sidebar trigger; existing back/forward icons and menus remain; the update icon appears at the far right; the popover displays release/error state and remains usable.

- [ ] **Step 5: Review the final diff**

Run: `git status --short --branch && git diff --stat && git diff -- web/vite.config.ts`

Expected: updater implementation and plan/spec files are scoped; `web/vite.config.ts` still contains only the user's pre-existing change.
