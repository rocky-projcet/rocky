#!/usr/bin/env node

import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { AgentRegistryService } from "./agents/agent-registry-service.js";
import { SessionService } from "./sessions/session-service.js";
import { createDefaultRuntimeRegistry } from "./runtime/runtime-registry.js";
import { handleAgentCommand } from "./cli/agent-commands.js";
import { printUsage, isCliResource } from "./cli/cli-helpers.js";
import { handleRunCommand } from "./cli/run-commands.js";
import { handleServeCommand } from "./cli/serve-command.js";
import { handleSessionCommand } from "./cli/session-commands.js";
import { loadDotenvFile } from "./cli/dotenv.js";

import type { AgentRegistryServiceOptions } from "./agents/agent-types.js";
import type { CliDependencies, CliOptionValues } from "./cli/cli-types.js";

export async function runAgentCli(
  argv: string[] = process.argv.slice(2),
  dependencies: CliDependencies = {}
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const { values: parsedValues, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "state-root": { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      id: { type: "string" },
      name: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      prompt: { type: "string" },
      stream: { type: "boolean" },
      "workspace-root": { type: "string" },
      "runtime-home": { type: "string" },
      runtime: { type: "string" },
      sandbox: { type: "string" },
      approval: { type: "string" },
      "model-profile": { type: "string" },
      status: { type: "string" },
      uv: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const values = parsedValues as CliOptionValues;

  if (values.help || positionals.length === 0) {
    printUsage(values.help ? stdout : stderr);
    return values.help ? 0 : 1;
  }

  const [resource, command, targetId] = positionals;
  if (!isCliResource(resource)) {
    stderr.write(`Unknown resource: ${resource}\n`);
    printUsage(stderr);
    return 1;
  }

  const service =
    dependencies.service ??
    new AgentRegistryService({
      stateRoot: values["state-root"],
      manager: dependencies.manager,
      now: dependencies.now,
      idGenerator: dependencies.idGenerator,
    });
  const sessionService =
    dependencies.sessionService ??
    new SessionService({
      stateRoot: values["state-root"],
      runtimeRegistry: createDefaultRuntimeRegistry(process.env),
      manager: dependencies.manager as AgentRegistryServiceOptions["manager"],
      now: dependencies.now,
      idGenerator: dependencies.idGenerator,
    });
  const context = {
    values,
    stdout,
    stderr,
    service,
    sessionService,
    dependencies,
  };

  if (resource === "serve") {
    return handleServeCommand(context);
  }

  if (resource === "session") {
    return handleSessionCommand(command, targetId, context);
  }

  if (resource === "run") {
    return handleRunCommand(command, targetId, context);
  }

  return handleAgentCommand(command, targetId, context);
}

export async function main(
  argv: string[] = process.argv.slice(2),
  dependencies: CliDependencies = {}
): Promise<void> {
  loadDotenvFile();
  const exitCode = await runAgentCli(argv, dependencies);
  process.exitCode = exitCode;
}

const isEntryPoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
