# AGENTS Index

This file is a compact index plus repo-wide defaults. Detailed workflows live in the referenced skills.

## Local Skills

- `rocky-dev` -> `.agents/skills/rocky-dev/SKILL.md`
- `rocky-service-run` -> `.agents/skills/rocky-service-run/SKILL.md`
- `rocky-web-ui-dev` -> `.agents/skills/rocky-web-ui-dev/SKILL.md`
- `karpathy-guidelines` -> `.agents/skills/karpathy-guidelines/SKILL.md`
- `requirement-understanding` -> `.agents/skills/requirement-understanding/SKILL.md`
- `rocky-runtime-probe` -> `.agents/skills/rocky-runtime-probe/SKILL.md`
- `mcp-on-demand` -> `.agents/skills/mcp-on-demand/SKILL.md`
- `git-safe-operations` -> `.agents/skills/git-safe-operations/SKILL.md`
- `linear` -> `.agents/skills/linear/SKILL.md` (legacy; explicit use only)
- `github` -> `.agents/skills/github/SKILL.md`
- `roc-publish` -> `.agents/skills/roc-publish/SKILL.md`
- `roc-finish-current-work` -> `.agents/skills/roc-finish-current-work/SKILL.md`
- `bug-report` -> `.agents/skills/bug-report/SKILL.md`
- `notion-api-publisher` -> `.agents/skills/notion-api-publisher/SKILL.md`

## Issue Tracking Defaults

- GitHub Issues are the primary tracker for repository implementation work.
- Do not create or update Linear issues unless the user explicitly asks for Linear or provides a Linear URL/key.
- When creating GitHub Issues, match existing repository labels and milestone conventions.
- For code publication, prefer GitHub Issue -> branch -> commit/push -> GitHub PR -> GitHub Issue update.

## Notion Defaults

- Workspace/teamspace: `pixel berry`
- Default databases: `작업 트래커`, `문서 허브`
- New ad-hoc implementation work: create one tracker entry and one related hub document
- If the user provides an existing Notion link, treat that page as the source of truth
- Prefer `notion-api-publisher` for document-hub capture when the goal is direct publish without MCP context

## Coding Defaults

- Apply `karpathy-guidelines` for implementation, review, and refactor work: state assumptions when needed, keep scope minimal, touch only requested code, and verify with relevant checks.
