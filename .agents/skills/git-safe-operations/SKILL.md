---
name: git-safe-operations
description: Prepare local git state for publication in this repository. Use when inspecting the worktree, syncing or rebasing with develop, creating or switching branches, staging intended files, committing, or pushing without handling GitHub Issue or PR metadata directly.
---

# Git Safe Operations

## Goal

- Keep local git work narrow, explicit, and reversible.
- Own only branch, staging, commit, and push operations.
- Hand off GitHub Issue tracking and pull request work to `$github`.
- Do not use Linear unless the user explicitly asks for legacy Linear handling.

## Workflow

1. Inspect first.
- Start with `git status --short --branch`.
- Use `git diff --stat` and `git diff --cached --stat` before staging or committing.
- Read targeted diffs when the scope is not obvious.
- If the worktree is mixed, isolate the exact paths that belong in scope.
- Remove or ignore transient leftovers such as `.DS_Store`, scratch brainstorm docs, and accidental index entries before switching branches or publishing.

2. Branch deliberately.
- In this repository, treat `develop` as the integration base branch for publication work.
- When preparing a publish branch, start from updated `origin/develop` rather than from the current local topic branch unless the user explicitly asked to keep the current branch.
- If work starts from the integration branch, prefer an issue-based branch name when one exists.
- In this repository, prefer a GitHub Issue branch name such as `codex/123-short-topic` when the issue already exists.
- If scoped work already exists on another branch, move only the intended commits or restage the scoped diff onto the fresh issue branch.
- Do not rename, recreate, or reset a user branch unless explicitly asked.

3. Sync or rebase safely.
- If the worktree is dirty and the user asks to update/rebase, preserve local work first with `git stash push -u -m <clear-temp-name>`.
- Fetch `develop` with `git fetch origin develop` first. If GitHub returns `Repository not found` or permission errors and `.env` has `GITHUB_PAT`, use `.agents/skills/roc-finish-current-work/scripts/fetch_remote_ref_with_pat.sh origin develop`.
- On `develop`, prefer `git rebase origin/develop` or `git merge --ff-only origin/develop`; do not reset local commits unless explicitly requested.
- After syncing, restore the temporary stash with `git stash pop`. If conflicts occur, resolve them by keeping both intended local work and the new upstream behavior when compatible.
- `git stash pop` leaves the stash in place when conflicts occur. Drop only the temporary stash you created after the conflict is resolved, validation passes, and the restored diff is present in the worktree.
- If `git stash pop` stages paths but the original work was unstaged, use `git restore --staged .` after marking conflict resolutions so the worktree returns to the user's prior style.

4. Stage and commit safely.
- Stage only the intended files.
- Exclude transient files such as `__pycache__/`, `*.pyc`, editor leftovers, and unrelated local config.
- If the user says only "commit", choose a concise message that matches the actual diff.
- Include a GitHub Issue reference such as `#123` in the commit message only when it clarifies traceability.
- If `git commit` fails because `user.name` or `user.email` is missing, reuse the most recent local author from `git log -5 --format='%an <%ae>'` and set it with repository-local `git config`.
- Do not amend, rebase, or force-push unless explicitly requested.

5. Push safely.
- If the remote is already authenticated in the local environment, use a normal `git push`.
- If the repository uses the optional GitHub token helper, use `scripts/push-github-current-branch.sh`.
- If a plain `git fetch` fails for permission reasons but `.env` `GITHUB_PAT` exists, it is acceptable to run authenticated `git fetch origin develop` with the same token-header pattern used for push.
- If sandboxed network access blocks the push, rerun the same command with escalation rather than changing remotes or credentials.

6. Hand off after push.
- After the branch is pushed, use `$github` for PR creation or PR state inspection.
- If the branch maps to a GitHub Issue, use `$github` to attach the PR URL or leave a short progress note.

7. Report the outcome.
- For commits, report the short hash and commit message.
- For pushes, report the branch name and remote.
- Mention if the worktree is still dirty after the operation.

## Quick Commands

```bash
git status --short --branch
git diff --stat
git diff --cached --stat
git branch --show-current
git log -5 --format='%an <%ae>'
git fetch origin develop
bash .agents/skills/roc-finish-current-work/scripts/fetch_remote_ref_with_pat.sh origin develop
git switch develop
git rebase origin/develop
git merge --ff-only origin/develop
bash scripts/push-github-current-branch.sh
```

## Resources

- `scripts/push-github-current-branch.sh`: Push the current branch to `origin` using `.env` `GITHUB_PAT`.
- `.agents/skills/roc-finish-current-work/scripts/fetch_remote_ref_with_pat.sh`: Fetch a remote ref using `.env` `GITHUB_PAT` when normal GitHub fetch is unauthenticated.
