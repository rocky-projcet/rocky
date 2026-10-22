---
name: rocky-dev
description: Build and validate the Rocky backend in this repository. Use when implementing the v2 thin agent harness (model layer, agent loop, tools, Rocky orchestration, stores), agent registry and workspace code, the Fastify API, editing this repo's TypeScript/Node build-test workflow, updating repository guidance, or running the Node test checks for this codebase.
---

# Rocky Dev

## Goal

- Keep this repository focused on the Rocky backend platform and its desktop/web shell.
- Build the v2 engine as a thin, self-owned agent harness: Rocky calls model APIs directly and runs its own tool loop. Do not reintroduce a CLI agent (Codex CLI, Claude Code, etc.) as the execution engine.
- Use a small, repeatable validation loop while the platform is being rebuilt.

## Current Repository Baseline

- Treat `develop` as the integration base branch. Do not use `main` as the active baseline for new work.
- This is a `Node >=22` + TypeScript repo compiled with `tsc` and `moduleResolution: NodeNext`.
- Keep `.js` import specifiers in TypeScript source files so the emitted `dist/` tree runs under Node without post-processing.
- The v2 reset (M0) removed the Codex CLI / Claude Code / Ollama CLI runtimes, sessions, runs, scheduled tasks, skills, connectors, integrations, messenger, and favorites. What remains: agent registry and managed workspaces (`src/agents`), the Fastify API for agents/workspace/system/app-update (`src/api`), the CLI `serve`/`agent` commands, installer/release/system services, and Electron.
- The engine design, milestones (M1–M7), and domain language live in `docs/v2/engine-design.md` and `CONTEXT.md`. Read them before adding engine code.
- Workspaces are folder-based analysis spaces; Git repositories are optional and should not be assumed by default.
- The repository test loop runs compiled JavaScript from `dist/` with the built-in `node:test` runner, not `ts-node`, Vitest, or Jest.
- Existing local skills cover Git safety separately; use this skill for product-development flow, not for generic Git work.

## Development Workflow

1. Read the current repository guidance before changing architecture-heavy code.
- Start with `README.md`, `CONTEXT.md`, and `docs/v2/engine-design.md`.
- Use the v2 domain terms (Rocky, agent, duty, trust level, decision, knowledge, connection, tool) in code, docs, and UI copy.

2. Preserve engine boundaries (see `docs/v2/engine-design.md` §2).
- Provider wire formats and authentication stay in the model layer (`src/llm/`); the agent loop (`src/harness/`) depends only on the provider-neutral interface.
- Tools declare a risk level, and the harness decides allow / ask / deny before execution. Do not encode permissions as prompt text.
- Rocky-owned session files are the model context; do not depend on provider-side conversation state.
- Never read or store Claude.ai subscription credentials; Claude models connect through API keys only.

3. Follow the repository's TypeScript conventions.
- Add new code under `src/` and tests under `test/agents`, `test/api`, or `test/runtime` (add a new `test/<area>` folder and extend the `npm test` globs when a new area needs it).
- When tests depend on non-TypeScript assets, update the build script so those assets are copied into `dist/` before `node --test` runs.
- Prefer the built-in Node test runner APIs (`node:test`, `node:assert/strict`) over adding a second test framework.
- Test the agent loop with a fake model provider that emits scripted events; keep live provider calls out of the default test run.

4. Validate in layers.
- Run `npm run typecheck` for fast TypeScript sanity.
- Run `npm test` for unit and HTTP route coverage.
- Run `npm run web:typecheck` and `npm run web:build` when a change touches API shapes the web app consumes.
- `tsconfig.json` is currently not strict, so passing typecheck is necessary but not sufficient; keep behavior changes covered by tests.

5. Keep repository guidance in sync with implementation.
- Update `README.md` when you add a new recurring developer check or change the repository layout.
- Update `CONTEXT.md` when domain language changes, and record hard-to-reverse decisions as ADRs under `docs/adr/`.

## Quick Commands

```bash
npm test
npm run typecheck
npm run web:typecheck
git fetch origin develop
git switch develop
git merge --ff-only origin/develop
git switch -c feature/<topic>
```

## Notes

- Keep generated or transient runtime state under `.runtime/` and out of commits.
- For manual live checks against real providers, prefer state roots under `.runtime/` instead of `/tmp`.
- The Windows installer and update scripts still install and preserve the Codex CLI from v1; treat that as pending cleanup, not as an engine dependency.
