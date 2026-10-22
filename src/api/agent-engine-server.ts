import Fastify, { type FastifyInstance } from "fastify";

import { AgentRegistryService } from "../agents/agent-registry-service.js";

import type { AgentEngineServerOptions } from "./api-types.js";
import { registerApiErrorHandlers } from "./http/error-handler.js";
import { registerAgentRoutes } from "./routes/agent-routes.js";
import { registerSystemRoutes } from "./routes/system-routes.js";
import { SystemHardwareStatusService } from "../system/hardware-status-service.js";
import { AppUpdateService } from "../installer/app-update-service.js";
import { registerAppUpdateRoutes } from "./routes/app-update-routes.js";

const DESKTOP_CORS_ORIGINS = new Set(["file://", "null", "rocky://app"]);

function registerDesktopCors(server: FastifyInstance): void {
  if (process.env.ROCKY_DESKTOP_CORS !== "1") {
    return;
  }

  server.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin !== "string" || !DESKTOP_CORS_ORIGINS.has(origin)) {
      return;
    }

    reply.header("access-control-allow-origin", origin);
    reply.header(
      "access-control-allow-methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    reply.header(
      "access-control-allow-headers",
      "accept,content-type"
    );

    if (request.method === "OPTIONS") {
      reply.code(204).send();
    }
  });
}

export function createAgentEngineServer(
  options: AgentEngineServerOptions = {}
): FastifyInstance {
  const agentService =
    options.agentService ??
    new AgentRegistryService({
      stateRoot: options.stateRoot,
      manager: options.manager,
      now: options.now,
      idGenerator: options.idGenerator,
    });
  const hardwareStatusService =
    options.hardwareStatusService ??
    new SystemHardwareStatusService();
  const appUpdateService =
    options.appUpdateService ??
    new AppUpdateService({
      stateRoot: options.stateRoot,
      currentVersion: options.appVersion,
      now: options.now,
    });

  const server = Fastify({
    logger: false,
  });
  registerDesktopCors(server);

  server.register(registerAgentRoutes, {
    agentService,
    nativeFileOpener: options.nativeFileOpener,
    nativeFolderOpener: options.nativeFolderOpener,
  });
  server.register(registerSystemRoutes, {
    hardwareStatusService,
  });
  server.register(registerAppUpdateRoutes, {
    appUpdateService,
  });
  registerApiErrorHandlers(server);

  return server;
}
