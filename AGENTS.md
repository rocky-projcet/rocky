# AGENTS Index

This file is a compact index plus repo-wide defaults. Detailed workflows live in the referenced skills.

## Local Skills

- `rocky-dev` -> `.agents/skills/rocky-dev/SKILL.md`
- `rocky-electron-desktop-chrome` -> `.agents/skills/rocky-electron-desktop-chrome/SKILL.md`
- `rocky-release` -> `.agents/skills/rocky-release/SKILL.md`
- `rocky-service-run` -> `.agents/skills/rocky-service-run/SKILL.md`
- `rocky-web-ui-dev` -> `.agents/skills/rocky-web-ui-dev/SKILL.md`
- `karpathy-guidelines` -> `.agents/skills/karpathy-guidelines/SKILL.md`
- `requirement-understanding` -> `.agents/skills/requirement-understanding/SKILL.md`
- `rocky-runtime-probe` -> `.agents/skills/rocky-runtime-probe/SKILL.md`
- `ecount-oapi` -> `.agents/skills/ecount-oapi/SKILL.md`
- `mcp-on-demand` -> `.agents/skills/mcp-on-demand/SKILL.md`
- `pi-agent-delegate` -> `.agents/skills/pi-agent-delegate/SKILL.md`
- `git-safe-operations` -> `.agents/skills/git-safe-operations/SKILL.md`
- `grill-me` -> `.agents/skills/grill-me/SKILL.md`
- `grill-with-docs` -> `.agents/skills/grill-with-docs/SKILL.md`
- `handoff` -> `.agents/skills/handoff/SKILL.md`
- `improve-codebase-architecture` -> `.agents/skills/improve-codebase-architecture/SKILL.md`
- `linear` -> `.agents/skills/linear/SKILL.md` (legacy; explicit use only)
- `github` -> `.agents/skills/github/SKILL.md`
- `roc-publish` -> `.agents/skills/roc-publish/SKILL.md`
- `roc-finish-current-work` -> `.agents/skills/roc-finish-current-work/SKILL.md`
- `to-issues` -> `.agents/skills/to-issues/SKILL.md`
- `to-prd` -> `.agents/skills/to-prd/SKILL.md`

## Skill Decisions

| Skill | Decision | Note |
| --- | --- | --- |
| `bug-report` | Remove | Notion bug tracker workflow is no longer part of the repo-local skill set. |
| `ecount-oapi` | Keep | Specialized ECOUNT Open API troubleshooting remains available. |
| `github` | Keep | Primary issue and PR workflow. |
| `git-safe-operations` | Keep | Safe branch, staging, commit, and push workflow. |
| `grill-me` | Add | Imported planning interview workflow for stress-testing designs. |
| `grill-with-docs` | Add | Imported planning interview workflow that keeps CONTEXT and ADR language aligned. |
| `handoff` | Add | Imported conversation handoff workflow for agent continuity. |
| `improve-codebase-architecture` | Add | Imported architecture deepening workflow for refactoring and testability scans. |
| `karpathy-guidelines` | Keep | Repo-wide coding discipline. |
| `linear` | Keep | Legacy guardrail for explicit Linear-only requests. |
| `mcp-on-demand` | Keep | Provider toggle workflow for explicitly requested integrations. |
| `notion-api-publisher` | Remove | Direct Notion document publishing is no longer part of the repo-local skill set. |
| `pi-agent-delegate` | Add | Delegates primary user work to Pi agent and keeps Codex focused on result verification. |
| `requirement-understanding` | Keep | Requirement interpretation workflow. |
| `roc-finish-current-work` | Keep | End-to-end issue/PR completion workflow. |
| `roc-publish` | Keep | GitHub Issue and PR publication workflow. |
| `rocky-dev` | Keep | Runtime and backend development workflow. |
| `rocky-electron-desktop-chrome` | Add | Captures the Electron titlebar, native menu, preload bridge, and desktop chrome verification workflow. |
| `rocky-release` | Keep | Release preparation and validation workflow. |
| `rocky-runtime-probe` | Keep | Runtime flag and model capability verification. |
| `rocky-service-run` | Keep | Local backend and web service run workflow. |
| `rocky-web-ui-dev` | Keep | Web UI development workflow. |
| `to-issues` | Add | Imported workflow for breaking plans into independently grabbable issues. |
| `to-prd` | Add | Imported workflow for turning conversation context into PRDs. |

## Issue Tracking Defaults

- GitHub Issues are the primary tracker for repository implementation work.
- Do not create or update Linear issues unless the user explicitly asks for Linear or provides a Linear URL/key.
- When creating GitHub Issues, match existing repository labels and milestone conventions.
- For code publication, prefer GitHub Issue -> branch -> commit/push -> GitHub PR -> GitHub Issue update.

## Coding Defaults

- Apply `karpathy-guidelines` for implementation, review, and refactor work: state assumptions when needed, keep scope minimal, touch only requested code, and verify with relevant checks.
- For Pi-first delegation requests, use `pi-agent-delegate`: ask Pi agent to do the primary work, then verify the completed result before reporting.
