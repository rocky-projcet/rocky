# AGENTS Index

This file is a compact index plus repo-wide defaults. Detailed workflows live in the referenced skills.

## Local Skills

- `rocky-dev` -> `.agents/skills/rocky-dev/SKILL.md`
- `rocky-release` -> `.agents/skills/rocky-release/SKILL.md`
- `rocky-service-run` -> `.agents/skills/rocky-service-run/SKILL.md`
- `rocky-web-ui-dev` -> `.agents/skills/rocky-web-ui-dev/SKILL.md`
- `karpathy-guidelines` -> `.agents/skills/karpathy-guidelines/SKILL.md`
- `requirement-understanding` -> `.agents/skills/requirement-understanding/SKILL.md`
- `rocky-runtime-probe` -> `.agents/skills/rocky-runtime-probe/SKILL.md`
- `ecount-oapi` -> `.agents/skills/ecount-oapi/SKILL.md`
- `mcp-on-demand` -> `.agents/skills/mcp-on-demand/SKILL.md`
- `git-safe-operations` -> `.agents/skills/git-safe-operations/SKILL.md`
- `linear` -> `.agents/skills/linear/SKILL.md` (legacy; explicit use only)
- `github` -> `.agents/skills/github/SKILL.md`
- `roc-publish` -> `.agents/skills/roc-publish/SKILL.md`
- `roc-finish-current-work` -> `.agents/skills/roc-finish-current-work/SKILL.md`

## Skill Decisions

| Skill | Decision | Note |
| --- | --- | --- |
| `bug-report` | Remove | Notion bug tracker workflow is no longer part of the repo-local skill set. |
| `ecount-oapi` | Keep | Specialized ECOUNT Open API troubleshooting remains available. |
| `github` | Keep | Primary issue and PR workflow. |
| `git-safe-operations` | Keep | Safe branch, staging, commit, and push workflow. |
| `karpathy-guidelines` | Keep | Repo-wide coding discipline. |
| `linear` | Keep | Legacy guardrail for explicit Linear-only requests. |
| `mcp-on-demand` | Keep | Provider toggle workflow for explicitly requested integrations. |
| `notion-api-publisher` | Remove | Direct Notion document publishing is no longer part of the repo-local skill set. |
| `requirement-understanding` | Keep | Requirement interpretation workflow. |
| `roc-finish-current-work` | Keep | End-to-end issue/PR completion workflow. |
| `roc-publish` | Keep | GitHub Issue and PR publication workflow. |
| `rocky-dev` | Keep | Runtime and backend development workflow. |
| `rocky-release` | Keep | Release preparation and validation workflow. |
| `rocky-runtime-probe` | Keep | Runtime flag and model capability verification. |
| `rocky-service-run` | Keep | Local backend and web service run workflow. |
| `rocky-web-ui-dev` | Keep | Web UI development workflow. |

## Issue Tracking Defaults

- GitHub Issues are the primary tracker for repository implementation work.
- Do not create or update Linear issues unless the user explicitly asks for Linear or provides a Linear URL/key.
- When creating GitHub Issues, match existing repository labels and milestone conventions.
- For code publication, prefer GitHub Issue -> branch -> commit/push -> GitHub PR -> GitHub Issue update.

## Coding Defaults

- Apply `karpathy-guidelines` for implementation, review, and refactor work: state assumptions when needed, keep scope minimal, touch only requested code, and verify with relevant checks.
