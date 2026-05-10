import { createAgentEngineServer } from "../api/agent-engine-server.js";
import type { CliContext } from "./cli-types.js";
import { writeJson } from "./cli-helpers.js";

export async function handleServeCommand(context: CliContext): Promise<number> {
  const host = context.values.host ?? "127.0.0.1";
  const port = context.values.port ? Number(context.values.port) : 3000;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    context.stderr.write("serve requires --port to be an integer between 0 and 65535\n");
    return 1;
  }
  const internalHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  process.env.AGENT_ENGINE_INTERNAL_BASE_URL =
    process.env.AGENT_ENGINE_INTERNAL_BASE_URL ??
    `http://${internalHost}:${port}`;

  const server = createAgentEngineServer({
    stateRoot: context.values["state-root"],
    manager: context.dependencies.manager,
    now: context.dependencies.now,
    idGenerator: context.dependencies.idGenerator,
    agentService: context.service,
    sessionService: context.sessionService,
  });

  await server.listen({
    port,
    host,
  });

  const address = server.server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;
  writeJson(context.stdout, {
    host,
    port: resolvedPort,
    stateRoot: context.values["state-root"] ?? null,
  });
  return 0;
}
