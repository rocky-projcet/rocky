---
name: github
description: Coordinate GitHub Issues and pull request work for this repository. Use when creating or updating repo issues, turning work into issue-linked PRs, checking review comments, debugging PR state, or summarizing GitHub issue/PR status. GitHub Issues are the primary tracker for Rocky repository work.
---

# GitHub

## Goal

- Use GitHub Issues as the primary tracker for Rocky repository implementation work.
- Turn pushed repository work into a GitHub pull request linked to the matching GitHub Issue.
- Prefer connector-based GitHub operations and use local git only for branch context.
- Do not create or sync Linear issues unless the user explicitly asks for Linear.

## Workflow

0. Ensure GitHub access is active.
- If GitHub connector tools are unavailable because the plugin is disabled, run `bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh enable github`.
- Tell the user to restart Codex, then stop there for this turn.

1. Resolve repository and tracking target.
- Resolve the repository from the user request, local git remote, or existing GitHub URL.
- If the user names a GitHub issue such as `#123`, fetch it before writing.
- If the user asks to register new work and no issue exists, create a GitHub Issue from the actual requirement or diff summary before opening a PR.
- If the user names a `ROC-*` key or Linear URL, use `$linear` only after confirming they want legacy Linear context.

2. Resolve issue metadata.
- Before creating or updating a GitHub Issue, inspect recent matching issues plus repository labels and milestones.
- Apply the active release milestone when the work is clearly targeted to that release, for example `v0.1.1`.
- Match existing repository label taxonomy instead of inventing labels. Prefer `type:*`, `area:*` when there is a clear match, and `priority:*`.
- If no `area:*` label fits, leave area unset instead of applying a misleading area.
- For repository issues titled for a release, follow the existing title style such as `v0.1.1: concise Korean summary`.
- Use `_update_issue` for milestone and full label set updates, and `_add_issue_labels` only when labels should be added without replacing the current set.
- If the connector cannot list labels or milestones, use GitHub REST with `.env` `GITHUB_PAT`; rerun with escalation when sandboxed network access blocks the request.

3. Confirm publish inputs.
- Resolve the current branch, base branch, and matching GitHub Issue or agreed summary.
- In this repository, default the PR base branch to `develop` unless the user explicitly asked for another base.
- If the branch is not pushed yet, hand off to `$git-safe-operations` first.

4. Build issue and PR metadata.
- For new issues, use a concise title, release prefix when applicable, labels, milestone, and a body with summary, acceptance criteria, scope notes, and validation expectations when known.
- For PR titles, prefer `[#123] concise summary` when a GitHub Issue exists.
- Write a PR body that covers what changed, why, validation, and the GitHub Issue URL or `Closes #123` reference when the PR fully resolves the issue.
- Use `Related to #123` instead of `Closes #123` when the PR is partial or exploratory.
- Keep the PR as draft by default unless the user explicitly wants it ready for review or the change is a tiny follow-up the user asked to merge immediately.

5. Open or update the GitHub item.
- Prefer GitHub connector tools for repository lookup, issue creation/update, PR search, PR creation, comments, and metadata reads.
- Search for an existing PR for the current branch before creating a new one.
- If connector access is blocked and `gh` is installed and authenticated, use CLI fallback.
- If connector access is blocked and `gh` is unavailable, fall back to GitHub REST calls with `.env` `GITHUB_PAT`.
- If a draft PR must be marked ready and REST is unavailable, use the GitHub GraphQL `markPullRequestReadyForReview` mutation with the PR node id.

6. Sync back to GitHub Issues.
- Add or update issue comments with the branch, PR URL, validation result, and known blockers when the issue does not already contain that context.
- If checks or reviews are blocking merge, summarize those blockers clearly for the follow-up issue update.
- After merge, close the GitHub Issue with a completed reason only when the PR fully resolves it and automation did not already close it.

7. Handle review and status requests.
- For review feedback, inspect unresolved comments first.
- For CI questions, inspect the current PR status and failing checks before proposing changes.
- Keep summaries focused on merge blockers, requested actions, and current draft or review state.

8. Report the outcome.
- Return the repository, GitHub Issue number/URL when relevant, labels, milestone, branch, PR number, URL, draft or ready state, and any known blockers.
- If the user asked to merge, confirm mergeability first and report the merge commit SHA after completion.

## Quick Tool Paths

- Issue create/read/update: `_create_issue`, `_fetch_issue`, `_fetch_issue_comments`, `_update_issue`
- Issue labels: `_add_issue_labels`, `_remove_issue_label`; use `_update_issue(labels=...)` only when replacing the full label set intentionally.
- Issue milestones: `_update_issue(milestone=...)`; use GitHub REST to list milestone numbers when connector tools do not expose them.
- PR lookup: `_fetch_pr`, `_get_pr_info`, `_list_pr_changed_filenames`
- PR creation/update: `_create_pull_request`, `_update_pull_request`
- Comments and reviews: `_add_comment_to_issue`, `_update_issue_comment`, `_fetch_pr_comments`, `_list_pull_request_review_threads`
- Diff and review context: `_fetch_pr_file_patch`, `_get_pr_diff`
- Repo lookup: `_list_repositories`, `_list_installations`, `_list_repositories_by_installation`
