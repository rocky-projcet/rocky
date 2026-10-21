import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import type { HardwareStatusServiceLike } from "../../system/hardware-status-types.js";
import { sendJson } from "../http/reply.js";

interface SystemRoutesOptions extends FastifyPluginOptions {
  hardwareStatusService: HardwareStatusServiceLike;
}

export const registerSystemRoutes: FastifyPluginAsync<
  SystemRoutesOptions
> = async (server, options) => {
  server.get("/settings/hardware", async (_request, reply) => {
    sendJson(reply, 200, await options.hardwareStatusService.getStatus());
  });
};
