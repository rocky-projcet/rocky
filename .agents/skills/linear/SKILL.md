---
name: linear
description: Work with legacy Linear records only when the user explicitly asks for Linear, provides a Linear URL, or references a `ROC-*` key. Do not use Linear for normal Rocky repository issue creation, publication, or PR sync; GitHub Issues are the primary tracker.
---

# Linear Legacy

## Goal

- Treat Linear as a legacy, opt-in tracker.
- Do not create Linear issues for new Rocky implementation work unless the user explicitly asks for Linear.
- Use GitHub Issues for normal repository issue tracking, branch/PR linkage, and completion notes.
- Keep any requested Linear read or write narrow and clearly tied to the user-provided Linear target.

## Workflow

0. Confirm explicit Linear intent.
- Continue only when the user names Linear, provides a Linear URL, or references a `ROC-*` Linear key.
- If the user asks for "an issue", "repo issue", "publication issue", or "tracking issue" without saying Linear, use `$github` and GitHub Issues instead.
- Do not enable Linear MCP just because `$roc-publish`, `$roc-finish-current-work`, or `$github` is in use.

1. Ensure Linear access only when needed.
- If the user explicitly requested Linear and tools are unavailable because the MCP is disabled, run `bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh enable linear`.
- Tell the user to restart Codex, then stop there for this turn.

2. Resolve the target first.
- Use a concrete issue identifier such as `ROC-5` or a Linear URL when possible.
- Do not create a new Linear issue from a diff summary unless the user explicitly requested a Linear issue.
- For projects, milestones, labels, or users, resolve the exact target by name, slug, or id before writing.
- If the target is ambiguous, list or fetch candidates first instead of guessing.

3. Read before write.
- For issue work, start with `get_issue` and `list_comments` when comment history matters.
- For project work, start with `get_project`; include milestones or resources only when needed.
- Use `list_issues`, `list_projects`, `list_milestones`, `list_issue_statuses`, and `list_users` to narrow the target when the user gives a partial name.

4. Sync code context when explicitly requested.
- Capture the change summary, intended validation, and any known blockers in the issue description or comments.
- If the Linear issue already exposes `gitBranchName`, use it only when the user wants to continue that legacy branch flow.
- Keep Linear notes factual; do not make Linear the source of truth for new GitHub Issue work.

5. Update only the fields that matter.
- Use `save_issue` for title, description, links, labels, and state updates that are directly related to the requested workflow.
- Use `save_comment` for short progress notes that say what changed, how it was verified, and what remains.
- Add the PR URL or review URL only when the user asked to sync the legacy Linear record.
- Use `create_document` or `update_document` only when the user explicitly wants long-form notes in Linear.
- Do not change assignee, priority, due date, or status unless the user asked for it or the workflow clearly requires it.

6. Report the outcome clearly.
- Return the exact Linear issue, project, milestone, or document identifiers that were read or changed.
- For write actions, mention the fields updated and whether a comment or document was created.
- If no Linear action was taken because the request should use GitHub Issues, say so briefly and continue with `$github`.

## Quick Tool Paths

- Issue read/update: `get_issue`, `list_comments`, `save_issue`, `save_comment`
- Project read/update: `get_project`, `list_projects`, `save_project`
- Milestones: `get_milestone`, `list_milestones`, `save_milestone`
- Documents: `create_document`, `get_document`, `update_document`
- Directory lookup: `list_users`, `list_issue_labels`, `list_issue_statuses`, `list_teams`
