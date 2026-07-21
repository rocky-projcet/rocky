import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import { sendJson } from "../http/reply.js";

import type { AppUpdateServiceLike } from "../../installer/app-update-types.js";

interface AppUpdateRoutesOptions extends FastifyPluginOptions {
  appUpdateService: AppUpdateServiceLike;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function parseInstallBody(body: unknown): { confirmedRestartRisk: boolean } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("App update install requests require a JSON object body.");
  }

  const confirmedRestartRisk = (body as Record<string, unknown>)
    .confirmedRestartRisk;
  if (confirmedRestartRisk !== true) {
    throw badRequest("confirmedRestartRisk must be true before running installer.");
  }

  return {
    confirmedRestartRisk,
  };
}

export const registerAppUpdateRoutes: FastifyPluginAsync<
  AppUpdateRoutesOptions
> = async (server, options) => {
  server.get("/rocky/app-update", async (_request, reply) => {
    sendJson(reply, 200, options.appUpdateService.getState());
  });

  server.post("/rocky/app-update/check", async (_request, reply) => {
    sendJson(reply, 200, await options.appUpdateService.checkForUpdates());
  });

  server.post("/rocky/app-update/download", async (_request, reply) => {
    const record = await options.appUpdateService.downloadInstaller();
    sendJson(reply, record.status === "downloaded" ? 202 : 200, record);
  });

  server.post("/rocky/app-update/install", async (request, reply) => {
    const input = parseInstallBody(request.body);
    const record = await options.appUpdateService.startInstaller(input);
    sendJson(reply, record.status === "install-started" ? 202 : 409, record);
  });
};
