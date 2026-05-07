import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import { listSupportedProviders } from "../../connectors/adapters.js";
import type {
  ConnectorProvider,
  ConnectorServiceLike,
} from "../../connectors/connector-types.js";
import { sendJson } from "../http/reply.js";

interface ConnectorRoutesOptions extends FastifyPluginOptions {
  connectorService: ConnectorServiceLike;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function parseProvider(raw: string): ConnectorProvider {
  if (!listSupportedProviders().includes(raw as ConnectorProvider)) {
    throw badRequest(`지원하지 않는 커넥터입니다: ${raw}`);
  }
  return raw as ConnectorProvider;
}

export const registerConnectorRoutes: FastifyPluginAsync<
  ConnectorRoutesOptions
> = async (server, options) => {
  server.get("/connectors/diagnostics", async (_request, reply) => {
    sendJson(reply, 200, await options.connectorService.getDiagnostics());
  });

  server.get("/connectors/:provider/state", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    sendJson(reply, 200, await options.connectorService.getState(parsed));
  });

  server.post("/connectors/:provider/login", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    sendJson(reply, 202, await options.connectorService.startLogin(parsed));
  });

  server.post("/connectors/:provider/cancel", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    sendJson(reply, 200, await options.connectorService.cancelLogin(parsed));
  });

  server.post("/connectors/:provider/disconnect", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const parsed = parseProvider(provider);
    sendJson(reply, 200, await options.connectorService.disconnect(parsed));
  });
};
