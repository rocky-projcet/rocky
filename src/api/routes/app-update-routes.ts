import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import type { RockyAppUpdateServiceLike } from "../../installer/app-update-types.js";
import { sendJson } from "../http/reply.js";

interface AppUpdateRoutesOptions extends FastifyPluginOptions {
  appUpdateService: RockyAppUpdateServiceLike;
}

export const registerAppUpdateRoutes: FastifyPluginAsync<
  AppUpdateRoutesOptions
> = async (server, options) => {
  server.get("/app/update", async (_request, reply) => {
    sendJson(reply, 200, await options.appUpdateService.getState());
  });

  server.post("/app/update/check", async (_request, reply) => {
    sendJson(reply, 202, await options.appUpdateService.checkForUpdate());
  });

  server.post("/app/update/download", async (_request, reply) => {
    sendJson(reply, 202, await options.appUpdateService.downloadUpdate());
  });

  server.post("/app/update/install", async (_request, reply) => {
    sendJson(reply, 202, await options.appUpdateService.openInstaller());
  });

  server.post("/app/update/open-folder", async (_request, reply) => {
    sendJson(reply, 202, await options.appUpdateService.openDownloadFolder());
  });
};
