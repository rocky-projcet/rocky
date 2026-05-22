---
name: pi-agent-delegate
description: Delegate user work to the local Pi coding agent and have Codex verify only the completed result. Use by default for implementation, repository changes, analysis, command execution, debugging, document generation, and other user requests where Pi can perform the primary work, especially when the user wants Codex to act as a verifier rather than the main worker.
---

# Pi Agent Delegate

## Overview

Use Pi as the primary worker. Codex should pass the user's request to Pi, wait for Pi to finish, then independently verify the resulting files, command output, or answer before responding to the user.

Higher-priority system, safety, automation, and tool-use instructions still apply. Do not delegate secrets, passwords, OAuth tokens, or requests the user explicitly asked Codex to handle directly.

## Workflow

1. Restate the latest user request as a delegation prompt for Pi. Include the current working directory, constraints from the conversation, and the expected final shape of the answer.
2. Ask Pi to perform the primary work end to end. Tell Pi to make needed edits, run appropriate checks, and return a concise summary with changed files and verification commands.
3. Run Pi through `scripts/run-pi-delegate.cmd` to avoid PowerShell execution-policy issues:

```powershell
$promptPath = Join-Path (Get-Location) ".pi-agent\delegation\request.md"
New-Item -ItemType Directory -Force -Path (Split-Path $promptPath) | Out-Null
Set-Content -Path $promptPath -Value $delegationPrompt -Encoding utf8
& "<skill-dir>\scripts\run-pi-delegate.cmd" -PromptFile $promptPath -Cwd (Get-Location)
```

4. Treat Pi's response as a completed proposal, not as proof. Verify independently:
   - inspect changed files and diffs when files changed;
   - run focused tests, builds, linters, smoke checks, or command replays when available;
   - check that the result matches the newest user request;
   - check that no secrets or local auth files are exposed.
5. If verification fails, delegate a concise repair request back to Pi with the failure details. Prefer one repair loop; use a second only when the failure is small and clear.
6. Only make direct Codex edits when Pi cannot run, the fix is trivial, or higher-priority instructions require direct action. State that in the final answer.

## Delegation Prompt Shape

Use this shape and fill it with the real request:

```text
You are Pi agent running in this working directory:
<absolute cwd>

Complete the user's latest request end to end:
<user request>

Conversation constraints to preserve:
<relevant constraints>

Do the primary work yourself. Make needed file edits, run appropriate verification, and return only:
- concise summary of what you changed or concluded;
- files changed, if any;
- commands/checks you ran and their results;
- any remaining blocker.
```

## Verification Standard

Codex's role after Pi returns is reviewer and tester. Do not redo Pi's full implementation unless verification shows a defect. Prefer high-signal checks over broad churn.

For final responses, mention that Pi handled the primary work and Codex verified it. Include verification commands and any unresolved risk. Keep token or auth file paths private unless the user specifically asks for setup details.

## Script

Use `scripts/run-pi-delegate.cmd` to avoid quoting and execution-policy problems. The runner looks for `pi-codex.cmd`, `pi.cmd`, or `pi` on `PATH`; the `.cmd` wrapper calls `run-pi-delegate.ps1` with `-ExecutionPolicy Bypass`.
