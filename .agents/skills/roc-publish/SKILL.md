---
name: roc-publish
description: Publish current Rocky repository work through the GitHub Issue and GitHub PR flow. Use when creating or updating a repo issue from local changes, pushing a scoped branch, opening or updating the matching PR, linking the PR back to the GitHub Issue, or closing the issue after merge when automation is not confirmed.
---

# ROC Publish

## Goal

- Turn the current local change set into one GitHub Issue and matching GitHub PR.
- Keep the publication flow explicit: scope -> GitHub Issue -> fresh branch from the integration base -> commit/push -> PR -> GitHub Issue update.
- Do not publish directly from an arbitrary current branch unless the user explicitly wants to keep that branch.
- Do not create or update Linear issues unless the user explicitly asks for Linear.
- Do not assume GitHub auto-closes the issue on PR merge unless that automation is visibly working.

## When To Use

- The user wants to register current changes as a GitHub Issue and create a PR.
- The user explicitly wants to continue an existing GitHub Issue branch or PR and sync it back to the issue.
- The user wants to finish the cycle after merge and close the matching GitHub Issue.

## Workflow

0. Ensure MCP access is active.
- If GitHub access is unavailable because the provider is disabled, run `bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh enable github`.
- Tell the user to restart Codex, then stop there for this turn.

1. Scope the worktree first.
- Start with `$git-safe-operations` style inspection: `git status --short --branch`, `git diff --stat`, and targeted diffs.
- If the current branch already contains multiple local commits, identify the exact commit range or file set that belongs in the new publication scope.
- Split unrelated files out of scope before creating the issue.
- In this repository, local files such as `.codex/` should usually stay out of the PR unless the user explicitly wants repo-local Codex config tracked.

2. Resolve the integration base before branching.
- In this repository, treat `develop` as the default integration base branch for ongoing product work.
- Do not infer the PR base from the current local topic branch.
- Refresh the base first with `git fetch origin develop` and prepare to branch from `origin/develop`.

3. Resolve or create the GitHub Issue.
- If the user already named an issue such as `#123` or a GitHub issue URL, read it first with `$github`.
- If no issue exists, create a GitHub Issue from the actual diff summary.
- Before creating or updating the issue, resolve labels and milestone from existing repository patterns.
- For v0.1.1 work, attach the `v0.1.1` milestone when it exists.
- Apply existing labels such as `type:*`, `area:*`, and `priority:*`; leave `area:*` unset when no existing area label fits.
- Follow the existing release issue title style, for example `v0.1.1: concise Korean summary`, when the issue belongs to a release milestone.
- Capture included files, intentionally excluded files, validation status, and known blockers in the issue description or a short comment.
- Prefer a branch name like `codex/123-short-topic` when the issue number exists.
- If the issue is created only as a planning artifact and no branch is needed yet, stop after reporting the issue URL.

4. Prepare and push a fresh branch.
- Use `$git-safe-operations` to create a fresh issue branch from the integration base, not from the current working branch.
- If the scoped work already lives on another local branch, transplant only the related commits or restage the scoped diff onto the fresh GitHub Issue branch.
- Reuse the current branch only when the user explicitly asked to publish that exact branch or when it is already the intended issue branch.
- Stage only the intended files.
- Commit with a terse message that matches the diff; include `#123` only when it improves traceability.
- Push with the repository helper if `.env` `GITHUB_PAT` is the available auth path.

5. Open or update the PR.
- Use `$github` after the branch is on the remote.
- Prefer draft PRs by default for multi-commit or review-oriented work. For tiny follow-up fixes the user wants merged immediately, a ready PR is acceptable.
- Use `develop` as the default PR base branch for this repository unless the user explicitly asked for another base.
- Align the PR title with the issue, for example `[#123] concise summary`.
- Include four body sections: summary, why, validation, and GitHub Issue link.
- Use `Closes #123` only when the PR fully resolves the issue; otherwise use `Related to #123`.
- Search for an existing PR for the branch before creating a new one.
- If the GitHub connector is unavailable and `gh` is not installed, fall back to GitHub REST or GraphQL calls using `.env` `GITHUB_PAT`.

6. Sync the GitHub Issue after PR creation.
- Ensure the issue records the branch name, commit, PR URL, and validation result, either in the body or a short comment.
- If connector issue-comment creation is unavailable for normal issues, use GitHub REST with `.env` `GITHUB_PAT` as the fallback.
- Keep labels and milestone aligned with the repository's issue taxonomy; change assignees or state only when the user asked or the workflow clearly calls for it.

7. Close the loop after merge.
- Do not assume merge will automatically close the GitHub Issue.
- Check whether the GitHub Issue actually closed after merge.
- If it did not and the PR fully resolved the issue, close it with a completed reason and leave a brief completion note with the merged PR URL or commit.

## Default Sequence

- `$github` to resolve or create the GitHub Issue
- `$git-safe-operations` to branch from `develop`, transplant or restage the scoped work, commit, and push
- `$github` to open or update the PR
- `$github` to update the issue and, after merge, close it if needed

## Repository Notes

- GitHub Issues are the primary tracker for Rocky repository implementation work.
- Linear `ROC-*` issues are legacy context and should be used only when explicitly requested.
- A linked PR alone is not proof that merge will auto-complete the issue, especially when the PR target is `develop` and the repository default branch differs.
- The repository's GitHub default branch may still be `main`, but active integration work currently lands on `develop`. Prefer actual team flow over default-branch assumptions.
