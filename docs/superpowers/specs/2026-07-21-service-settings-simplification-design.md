# Service Settings Simplification Design

## Goal

Simplify the Rocky service page so it contains only the Rocky Windows update controls and the Rocky Core default model settings.

## Scope

Keep:

- Rocky Windows update status and actions.
- The full default model settings form, including runtime, model, reasoning effort, service tier, and the Ollama launch target when applicable.

Remove:

- The Rocky Core summary card and its counters.
- Workspace browsing.
- Core session status, navigation, and deletion controls.
- Workspace skill status and synchronization controls.

The existing updater backend changes in `src/installer/app-update-service.ts` and `test/runtime/app-update-service.test.ts` are outside this UI change and must remain untouched.

## Implementation

Use a surgical removal in `web/src/domains/rocky/pages/rocky-agent-page.tsx`:

1. Retain `AppUpdatePanel` and the complete default model form.
2. Remove the unused summary and management sections from the rendered page.
3. Remove queries, mutations, state, handlers, helpers, imports, and derived data that become unused because those sections no longer exist.
4. Keep the management query required to read and save Rocky Core default settings.
5. Render the two retained sections as a simple vertical settings surface within the existing scroll container.

No new component abstraction or backend endpoint is needed.

## Data And Errors

- The update panel continues to use the existing app-update query and mutations and preserves its current confirmation and error handling.
- The default model form continues to use the existing runtime catalog and Rocky Core settings mutation.
- Page loading and error states depend only on data required by the two retained sections. Removed chat and session data must no longer block the page.

## Verification

Update the Playwright coverage so the service page verifies:

- `Rocky Windows 업데이트` is visible.
- `기본 모델` is visible.
- `Rocky Core`, `워크스페이스`, `세션`, and `스킬` management headings are absent.
- The existing service navigation still opens `/admin/rocky` with the updater in view.

Run the focused Playwright specifications and the web TypeScript/Vite build. Review the final diff to confirm the unrelated updater backend work is unchanged.
