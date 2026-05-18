---
name: mcp-on-demand
description: Enable or disable Codex MCP and plugin integrations only when needed for this repository. Use when a workflow needs Notion, GitHub, Google Drive, or explicitly requested legacy Linear access and the default state should remain disabled until explicitly turned on.
---

# MCP On Demand

## Goal

- Keep managed MCP and plugin integrations disabled by default.
- Enable only the providers needed for the current task.
- Return to the minimal disabled state after the task when the user wants it.
- Treat every config change as session-boundary work: Codex must restart before tool availability changes take effect.

## Managed Providers

- `notion`: project-local Notion MCP in `.codex/config.toml` and `.mcp.json`
- `linear`: legacy global Linear MCP in `~/.codex/config.toml`; enable only when the user explicitly asks for Linear
- `github`: global GitHub plugin in `~/.codex/config.toml`
- `google-drive`: global Google Drive plugin in `~/.codex/config.toml`

## Workflow

1. Check the current state first.
- Run `bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh status`

2. Enable only the providers required for the next task.
- Run `bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh enable notion`
- Run `bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh enable github`
- Run `bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh enable notion github`
- Run `bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh enable linear` only for explicit legacy Linear requests.
- Use the `linear` provider only when the user explicitly asks for Linear or provides a Linear URL/key.
- The script always disables all managed providers first, then re-enables only the requested set.

3. Stop and ask for a restart.
- MCP and plugin inventory is loaded when Codex starts.
- After `enable` or `disable-all`, tell the user to restart Codex before continuing with MCP-backed work.

4. Return to the minimal state when the user is done.
- Run `bash .agents/skills/mcp-on-demand/scripts/mcp-on-demand.sh disable-all`
- Tell the user another restart is required if they want the disabled state to take effect immediately.

## Notes

- Prefer the script over hand-editing the managed MCP blocks.
- If `$github`, `$roc-publish`, or `$bug-report` cannot access their provider because it is disabled, use this skill first and stop after the config change.
- Do not enable `$linear` for normal repository issue creation or publication; GitHub Issues are the primary tracker.
- If the provider is enabled but still unavailable, the next session may need a normal OAuth or app re-auth flow.
