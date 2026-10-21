import process from "node:process";

import type { AgentUpdatePatch } from "../agents/agent-types.js";
import type { CliResource, OutputWriter } from "./cli-types.js";

const USAGE = `Usage:
  node dist/src/cli.js serve [options]
  node dist/src/cli.js agent create [options]
  node dist/src/cli.js agent list [options]
  node dist/src/cli.js agent update <agent-id> [options]

Options:
  --state-root <path>       Control-plane state root. Defaults to .runtime/agent-engine.
  --host <value>            HTTP bind host for serve. Defaults to 127.0.0.1.
  --port <value>            HTTP bind port for serve. Defaults to 3000.
  --id <value>              Explicit agent id for create.
  --name <value>            Agent display name.
  --description <value>     Agent description.
  --workspace-root <path>   Managed workspace path only. External overrides are rejected.
  --runtime-home <path>     Managed runtime-home path only. External overrides are rejected.
  --sandbox <value>         Sandbox policy. Defaults to workspace-write.
  --approval <value>        Approval policy. Defaults to on-request.
  --model-profile <value>   Model/profile policy for the agent.
  --status <value>          Agent status. Defaults to active.
  --uv                      Bootstrap a .venv using uv if one is not already present.
  --help                    Show this help.
`;

export function printUsage(output: OutputWriter = process.stderr): void {
  output.write(USAGE);
}

export function writeJson(output: OutputWriter, value: unknown): void {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeJsonLine(output: OutputWriter, value: unknown): void {
  output.write(`${JSON.stringify(value)}\n`);
}

export function compactObject<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as Partial<T>;
}

export function usageError(stderr: OutputWriter, message: string): number {
  stderr.write(`${message}\n`);
  printUsage(stderr);
  return 1;
}

export function unknownCommandError(
  stderr: OutputWriter,
  command: string | undefined
): number {
  return usageError(stderr, `Unknown command: ${command}`);
}

export function compactAgentUpdatePatch(
  value: AgentUpdatePatch
): Partial<AgentUpdatePatch> {
  return compactObject<AgentUpdatePatch>(value);
}

export function isCliResource(value: string | undefined): value is CliResource {
  return value === "serve" || value === "agent";
}
