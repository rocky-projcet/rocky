---
name: rocky-web-ui-dev
description: >
  Build the Rocky WEB UI in this repository using the selected frontend stack
  (React 19.2.x, Vite, React Router 7, TanStack Query, EventSource SSE, Tailwind CSS,
  Vitest, and Playwright). Use when implementing WEB UI work,
  frontend scaffolding, route shells, API and SSE clients, or browser-side
  run and session consoles.
---

# Rocky WEB UI Dev

## Goal

- Keep WEB UI work aligned with the existing Node/TypeScript control-plane backend.
- Use a simple SPA architecture over the repository's HTTP/SSE API instead of introducing SSR or RSC complexity.
- Preserve a clean split between frontend concerns and backend runtime/session logic.

## Stack

- `react@19.2.x`
- `react-dom@19.2.x`
- `vite`
- `react-router`
- `@tanstack/react-query`
- browser `EventSource` for SSE
- `tailwindcss`
- `vitest`
- `playwright`

## Repository Rules

1. Build a browser SPA, not a server-rendered React app.
- Prefer `web/` or `apps/web/` as the frontend root.
- Do not introduce Next.js, Remix SSR mode, React Server Components, or server actions for this project phase.

2. Treat the existing HTTP API as the source of truth.
- Session and run execution flow must talk to the backend over HTTP/SSE only.
- Do not call the CLI from the browser layer.
- If a required browser flow is blocked by missing endpoints, add or update a backend issue instead of inventing client-side workarounds.

3. Keep the client thin.
- Use React Router for route structure.
- Use TanStack Query for fetch/cache/invalidation.
- Use local component state for transient UI interactions.
- Add a global state library only when route state and query state are no longer enough.

4. Keep streaming simple.
- Use `EventSource` for `text/event-stream` run updates.
- Normalize reconnect, terminal event handling, and teardown in one reusable client utility or hook.

## Initial Route Shape

- `/agents`
- `/agents/:agentId`
- `/agents/:agentId/sessions/:sessionId`
- `/runs/:runId`

Keep `Tasks`, `Skills`, `Automations`, and `Ops` as future routes unless the current issue explicitly adds them.

## UI Direction

- The UI should feel like an operations console, not a generic chat clone.
- Focused work surfaces should minimize redundant route chrome. When transcript and workspace density matter, let the working screen own its header instead of repeating shell-level route cards.
- Session screens should prioritize transcript plus shared workspace. Keep run diagnostics compact in the session view and use a dedicated inspector route for full logs, warnings, stderr, and results.
- Use compact, high-signal actions in dense operational views. Prefer icon-only secondary actions, small chips, and title/action rows over oversized text buttons.
- In lists and headers, show only state that changes operator decisions. Avoid redundant idle badges; emphasize running, archived, or error states when they materially affect the next action.
- Korean shell copy should be short, natural, and resistant to awkward intra-word wrapping. Avoid decorative labels that repeat the product name without adding meaning.
- Prefer a bold but structured layout with a stable nav frame, dense status summaries, and deliberate hierarchy.
- For global status panels such as Codex account or usage summaries, keep the surface text-first and compact. Prefer one small settings/account action over duplicating the same destination in the primary left navigation.

## Validation

- Run frontend unit tests with `vitest`.
- Run browser flow checks with `playwright` when the web app exists.
- Keep backend validation on the existing repository commands:
  - `npm test`

## Notes

- Stay on the latest stable React 19 patch line for this repo's SPA work.
- Avoid RSC-only packages and Vite RSC plugins in this project phase.
- If UI implementation depends on new agent/session/run endpoints, add or update the backend change before hard-coding API assumptions.
