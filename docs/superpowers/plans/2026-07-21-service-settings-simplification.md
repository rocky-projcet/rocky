# Service Settings Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the Rocky service page to the Rocky Windows updater and the complete Rocky Core default model settings form.

**Architecture:** Keep the existing updater panel and settings form in `RockyAgentPage`, but remove management-only rendering and the queries, mutations, handlers, helpers, imports, and derived state that supported it. The page should load and fail only on data required for default model settings; updater state remains independently managed by `AppUpdatePanel`.

**Tech Stack:** React 19.2, TypeScript 5.9, TanStack Query, React Router 7, Tailwind CSS, Playwright 1.59, Vite 7.

## Global Constraints

- Keep Rocky Windows update status and actions.
- Keep runtime, model, reasoning effort, service tier, and conditional Ollama launch target controls.
- Remove the Rocky Core summary, workspace browser, session management, and skill synchronization surfaces.
- Do not modify `src/installer/app-update-service.ts` or `test/runtime/app-update-service.test.ts`; they contain unrelated existing work.
- Do not add a new component abstraction or backend endpoint.

---

### Task 1: Simplify The Rocky Service Page

**Files:**
- Modify: `web/tests/debug-mode.spec.ts`
- Modify: `web/tests/app-update-navigation.spec.ts`
- Modify: `web/src/domains/rocky/pages/rocky-agent-page.tsx`

**Interfaces:**
- Consumes: `useRockyCoreManagementQuery`, `useRuntimesQuery`, `useUpdateRockyCoreSettingsMutation`, and the existing app-update hooks.
- Produces: the existing `RockyAgentPage` route component with exactly two visible settings sections: `Rocky Windows 업데이트` and `기본 모델`.

- [ ] **Step 1: Stabilize service navigation tests and write the failing service-page assertions**

Add this setup to both `web/tests/debug-mode.spec.ts` and `web/tests/app-update-navigation.spec.ts` so the first-run product tour cannot intercept navigation under test:

```ts
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("rocky.product-tour.v2.state", "completed");
  });
});
```

Replace the obsolete debug-mode flow in `web/tests/debug-mode.spec.ts` with a direct service-page test and assertions for the retained and removed sections:

```ts
test("service page only exposes updater and default model settings", async ({ page }) => {
  await page.goto("/admin/rocky");

  await expect(
    page.getByRole("heading", { name: "Rocky Windows 업데이트" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "기본 모델" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rocky Core" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "워크스페이스" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "세션" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "스킬" })).toHaveCount(0);
});
```

- [ ] **Step 2: Run the focused test and verify the RED state**

Run:

```powershell
npm.cmd --prefix web run test:e2e -- debug-mode.spec.ts
```

Expected: FAIL only on the absence assertions because the current page still renders the `Rocky Core`, `워크스페이스`, `세션`, and `스킬` headings. The updater and default model assertions must already pass.

- [ ] **Step 3: Remove management-only dependencies and state**

In `web/src/domains/rocky/pages/rocky-agent-page.tsx`:

- Remove the direct `@tanstack/react-query` import because `useMutation`, `useQuery`, and `useQueryClient` are all management-only on this page.
- Remove `Link`, `Activity`, `Bot`, `CheckCircle2`, `FolderKanban`, and `Trash2` imports.
- Remove `AgentWorkspaceBrowserPanel`, `rockyQueryKeys`, `useRockyChatsQuery`, `useSyncRockyCoreSkillsMutation`, `ROCKY_CORE_AGENT_SPEC`, and `agentEngineClient` imports.
- Delete `SESSION_QUERY_KEY`, `formatDateTime`, and `statusLabel`.
- Remove `queryClient`, chat/session queries, skill sync and session deletion mutations, `coreAgent`, session/chat arrays, `latestSession`, and `latestChat`.
- Delete `handleSyncSkills` and all health/running-session derived values.

Leave all state and effects used by the default model form unchanged.

- [ ] **Step 4: Make updater confirmation independent of session data**

Change `AppUpdatePanel` from a component that accepts `runningSessionCount` to a zero-argument component:

```ts
function AppUpdatePanel() {
```

Update the install confirmation description so it no longer reports an unavailable session count:

```tsx
description="설치 프로그램 실행 후 Rocky가 재시작될 수 있으며 진행 중인 작업이 중단될 수 있습니다. .runtime, .codex, .tools, .env 파일은 보존 대상입니다."
```

Keep its update query, mutations, actions, checksum display, release link, and confirmation flow unchanged.

- [ ] **Step 5: Reduce loading and error dependencies**

Make the page loading condition depend only on `managementQuery.isLoading`:

```tsx
  if (managementQuery.isLoading) {
```

Make the page error condition and message depend only on `managementQuery`:

```tsx
  if (managementQuery.isError) {
    const error =
      (managementQuery.error instanceof Error && managementQuery.error.message) ||
      "Rocky Core 상태를 불러오지 못했습니다.";
```

This prevents removed chat or session APIs from blocking the retained settings form.

- [ ] **Step 6: Render only the two retained sections**

Remove the summary `Card` and the workspace, session, and skill `<section>` blocks. Apply these exact JSX substitutions around the unchanged default model section.

Replace:

```tsx
      <div className="custom-scrollbar mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
          <AppUpdatePanel runningSessionCount={runningSessions.length} />
```

with:

```tsx
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-4">
          <AppUpdatePanel />
```

Change the updater section class from:

```tsx
<section className="rounded-lg border bg-card p-5 xl:col-span-2">
```

to:

```tsx
<section className="rounded-lg border bg-card p-5">
```

Make the same `xl:col-span-2` removal on the default model section. Delete all JSX after the default model section through the closing skill section, leaving only the closing tags for the grid, scroll container, and outer page section. Do not alter any field, option, save behavior, badge, or current-value summary inside the default model section.

- [ ] **Step 7: Run the focused Playwright tests and verify GREEN**

Run:

```powershell
npm.cmd --prefix web run test:e2e -- debug-mode.spec.ts app-update-navigation.spec.ts
```

Expected: 2 tests pass. The service navigation still reaches `/admin/rocky`, and the service page exposes only the retained settings headings.

- [ ] **Step 8: Run the web build**

Run:

```powershell
npm.cmd --prefix web run build
```

Expected: TypeScript and Vite complete with exit code 0 and no unused-import or JSX errors.

- [ ] **Step 9: Review scope and commit**

Run:

```powershell
git diff -- web/tests/debug-mode.spec.ts web/tests/app-update-navigation.spec.ts web/src/domains/rocky/pages/rocky-agent-page.tsx
git status --short
```

Confirm the two pre-existing updater backend files remain modified but unchanged by this task. Then stage and commit only the UI and test files:

```powershell
git add web/tests/debug-mode.spec.ts web/tests/app-update-navigation.spec.ts web/src/domains/rocky/pages/rocky-agent-page.tsx
git commit -m "refactor: simplify Rocky service settings"
```
