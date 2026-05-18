---
name: roc-finish-current-work
description: Create one GitHub Issue for the current Rocky local work, publish or merge it as a PR against develop, sync the GitHub Issue, then restore local develop to origin/develop. Use when the user wants the current commits turned into a single tracked GitHub issue/PR and may also want the PR merged in the same turn.
---

# ROC Finish Current Work

## Goal

- Turn the current Rocky-project local work into one GitHub Issue and one PR.
- Keep the publication scope explicit and preserve the current HEAD before touching `develop`.
- End with local `develop` reset to `origin/develop` after the issue branch and PR are safely created or merged.
- When this skill is explicitly invoked, carry the work through to an open PR by default, or through merge when the user explicitly asked for merge, without conversational confirmation between intermediate publish steps.
- When merge was part of the request, end with the PR merged, the GitHub Issue updated or closed, and local `develop` updated to the merged tip.
- Do not create or update Linear issues unless the user explicitly asks for Linear.

## When To Use

- The user wants "issue + PR + local develop latest" handled in one turn.
- The user wants "issue + PR + merge + local develop latest" handled in one turn.
- The current work should be grouped into one publication scope.
- The user is okay with local `develop` being moved back to `origin/develop` after the work is preserved on an issue branch.

## Workflow

1. Inspect the current scope first.
- Run `git status --short --branch`, `git diff --stat`, and `git log --oneline --decorate -N`.
- If the current work is mixed or uncommitted in unrelated ways, stop and ask before publishing.

2. Ensure provider access exists.
- If GitHub connector access is unavailable, use `mcp-on-demand` and stop after enabling it.
- Before GitHub publish or merge steps, confirm `.env` contains `GITHUB_PAT`; if it is missing, stop and ask the user to configure it.

3. Treat explicit skill invocation as authorization to continue.
- Do not stop after issue creation, branch creation, push, or PR creation just to ask whether to continue.
- Carry the workflow through to an open PR unless the user explicitly asked for merge, in which case continue through merge as well.
- If a tool-level approval prompt is unavoidable, request it immediately through the tool instead of asking in chat first.

4. Create or resolve the GitHub Issue.
- Create one GitHub Issue that summarizes the full local change set.
- Include sections for summary, scope, validation, and any notable follow-up.
- If an existing GitHub Issue was named, fetch it first and use it as the publication target.
- Before creating or updating the issue, resolve labels and milestone from existing repository patterns.
- For v0.1.1 work, attach the `v0.1.1` milestone when it exists.
- Apply existing labels such as `type:*`, `area:*`, and `priority:*`; leave `area:*` unset when no existing area label fits.
- Follow the existing release issue title style, for example `v0.1.1: concise Korean summary`, when the issue belongs to a release milestone.
- Use a branch name like `codex/123-short-topic` when the issue number exists; shorten only if needed for shell safety.

5. Preserve the current HEAD on the issue branch before modifying `develop`.
- Always invoke repo-local scripts with `bash`; do not rely on execute bits.
- If the current branch is not already the intended issue branch, run `bash .agents/skills/roc-finish-current-work/scripts/capture_head_on_issue_branch.sh <issue-branch>`.
- If `git switch` or `git switch -c` fails with `.git/index.lock` or `.git/refs/...lock` under the sandbox, rerun the same command with escalation instead of changing the workflow.
- This step must happen before any reset of `develop`.

6. Publish the branch and open the PR.
- Try `git fetch origin develop` first.
- If fetch fails with `Repository not found`, another auth error, or a private-origin credential failure and `.env` contains `GITHUB_PAT`, run `bash .agents/skills/roc-finish-current-work/scripts/fetch_remote_ref_with_pat.sh origin develop`.
- Push the issue branch with `git push --set-upstream origin <issue-branch>` first.
- If push fails with `Repository not found`, another auth error, or a private-origin credential failure and `.env` contains `GITHUB_PAT`, run `bash scripts/push-github-current-branch.sh`.
- Open or update a PR targeting `develop` through GitHub REST with `.env` `GITHUB_PAT`.
- Search for an existing PR for the issue branch before creating a new one.
- Use a PR title like `[#123] concise summary`.
- Include summary, why, validation, and GitHub Issue link in the PR body.
- Use `Closes #123` only when the PR fully resolves the issue; otherwise use `Related to #123`.
- When using ad hoc REST or GraphQL fallbacks from the shell, prefer a quoting-stable form such as `node --input-type=module <<'EOF'` over a long `node -e` one-liner.
- If a GitHub REST call fails with `ENOTFOUND api.github.com` or another host-resolution error, treat it as a sandbox network problem, not a PAT or payload problem, and rerun the exact same command with escalation first.
- If REST fallback fails with DNS lookup, host resolution, or other sandboxed network errors, rerun the same request with escalation instead of changing the workflow.

7. Sync the GitHub Issue after the PR exists.
- Ensure the GitHub Issue records the branch name, commit, PR URL, and validation result.
- Prefer a short issue comment when the connector or REST fallback can create one.
- Keep labels and milestone aligned with the repository's issue taxonomy; change assignees or state only when the user asked or the workflow clearly calls for it.

8. Merge when the user explicitly asks for it.
- If the PR is draft, mark it ready first.
- If merge was explicitly requested and no PR exists yet, continue directly from PR creation into the merge path in the same run.
- Use GitHub REST with `.env` `GITHUB_PAT` for merge and ready-for-review handling.
- Before merging through REST, fetch the PR resource and confirm `draft`, `mergeable`, `mergeable_state`, `base.ref`, the current PR title, and the expected head SHA.
- If the read, ready-for-review, or merge request hits `ENOTFOUND api.github.com` or another host-resolution error, rerun the exact same REST or GraphQL command with escalation before questioning credentials or rewriting the command.
- If GitHub commit status or check-run endpoints return `403 Resource not accessible by personal access token`, do not block solely on that; rely on the PR resource fields (`mergeable`, `mergeable_state`, `draft`, head SHA) and report that detailed check status could not be fetched with the current PAT.
- If the REST `ready_for_review` endpoint returns `404` even though the PR is readable, fall back to GitHub GraphQL `markPullRequestReadyForReview` with the PR node id.
- Confirm the expected PR head SHA before merging when the PR changed during the turn.
- When the PR is one logical change and the user did not ask for another strategy, prefer `squash` merge and use the current PR title as the default squash commit title.
- If the merge endpoint returns `405`, `409`, or a head SHA mismatch, refetch the PR resource once. If the PR is already merged, continue with post-merge sync; otherwise report the blocker instead of retrying blindly.
- After merge, capture the returned merge commit SHA, close the GitHub Issue with a completed reason when the PR fully resolved it and automation did not already close it, and leave a short note with the merged PR URL and merge SHA when comments are available.

9. Restore local develop only after publication is safe.
- Confirm the issue branch exists locally and the PR URL is created.
- If merge was requested, confirm the merge completed before claiming the workflow is done.
- If merge was requested, fetch `origin develop` again after the merge so the local reset targets the merged tip. If plain fetch still fails auth, reuse the PAT-backed fetch helper.
- Run `bash .agents/skills/roc-finish-current-work/scripts/reset_local_develop.sh origin/develop`.
- End on `develop` unless the user explicitly wants to stay on the issue branch.

## Guardrails

- Never reset local `develop` before the issue branch exists at the publication HEAD.
- Never publish unrelated local commits under the same issue just because they are nearby.
- If the current branch is already the intended GitHub Issue branch, keep using it instead of creating another branch.
- If push or PR creation fails, do not touch local `develop`.
- Do not call repo-local helper scripts directly; use `bash <script>` so missing execute bits do not block the workflow.
- If sandboxed git writes fail on `.git/index.lock` or `.git/refs/...lock`, rerun the same branch or reset command with escalation instead of inventing a new git path.
- Do not assume plain `git fetch origin develop` works for a private remote; use the PAT-backed fetch helper when the error points to auth.
- Do not assume plain `git push --set-upstream` works for a private remote; use `bash scripts/push-github-current-branch.sh` when the error points to auth.
- Do not stop to ask whether to continue to the next publish step when this skill was explicitly invoked; only stop for mixed scope, unsafe ambiguity, a real external approval gate, or a merge blocker.
- Do not stop after PR creation to ask whether to merge when the user already asked for merge; move directly into the merge path.
- Do not spend time attempting GitHub connector PR or merge operations in this repository; use the PAT-backed git and GitHub REST/GraphQL path from the start.
- Do not treat `ENOTFOUND api.github.com` from a GitHub REST heredoc as a bad PAT, bad repo, or bad PR body by default; it is usually the sandbox blocking network access, so rerun the same command with escalation first.
- If REST fallback fails with DNS, `ENOTFOUND`, or similar sandbox network errors, rerun the same request with escalation instead of inventing a new API path.
- If draft-to-ready fails through REST but PR reads still work, switch to GraphQL `markPullRequestReadyForReview` instead of retrying the same REST endpoint.
- If commit status or check-run endpoints fail with `403 Resource not accessible by personal access token`, use PR mergeability fields for the go/no-go decision and mention the missing check visibility in the report.
- Do not derive the squash merge title from a stale local commit message when the PR title has been refined; default to the current PR title.
- If the merge API reports the PR is already merged or closed, verify the merged state and continue with GitHub Issue/local sync instead of failing the workflow.
- If merge is blocked, leave the PR open, report the blocker, and do not say the workflow is complete.

## Default Command Sequence

- `git status --short --branch`
- `git diff --stat`
- `git log --oneline --decorate -N`
- GitHub Issue create or fetch
- `bash .agents/skills/roc-finish-current-work/scripts/capture_head_on_issue_branch.sh <issue-branch>`
- `git fetch origin develop`
- `bash .agents/skills/roc-finish-current-work/scripts/fetch_remote_ref_with_pat.sh origin develop`
- `git push --set-upstream origin <issue-branch>`
- `bash scripts/push-github-current-branch.sh`
- GitHub REST PR lookup/create/update with `.env` `GITHUB_PAT`
- If the REST call returns `ENOTFOUND api.github.com`, rerun the exact same command with escalation
- Optional GitHub REST PR lookup for `mergeable`, `mergeable_state`, and head SHA
- GitHub Issue comment and state update when needed
- Optional GitHub REST ready-for-review or GraphQL fallback, then merge
- Optional GitHub REST merge retry after PR refetch when `405`, `409`, or head SHA mismatch occurs
- Optional post-merge `bash .agents/skills/roc-finish-current-work/scripts/fetch_remote_ref_with_pat.sh origin develop`
- `bash .agents/skills/roc-finish-current-work/scripts/reset_local_develop.sh origin/develop`

## Output

- GitHub Issue number and URL
- Branch name
- PR URL and draft, review, or merged state
- Merge commit SHA when merged
- Validation used
- Final local branch and whether `develop` now matches `origin/develop`
