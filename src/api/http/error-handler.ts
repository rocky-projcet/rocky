import { URL } from "node:url";

import type { FastifyInstance } from "fastify";

import { sendJson } from "./reply.js";

function resolveErrorStatus(error: unknown): number {
  if (!(error instanceof Error)) {
    return 500;
  }

  if (/^Unknown agent: /.test(error.message)) {
    return 404;
  }

  if (
    /requires /.test(error.message) ||
    /A non-empty prompt is required/.test(error.message)
  ) {
    return 400;
  }

  if (/already exists/.test(error.message)) {
    return 409;
  }

  return 500;
}

export function registerApiErrorHandlers(server: FastifyInstance): void {
  server.setNotFoundHandler((request, reply) => {
    const pathname = new URL(request.raw.url ?? "/", "http://127.0.0.1").pathname;
    sendJson(reply, 404, {
      error: `No route for ${request.method} ${pathname}`,
    });
  });

  server.setErrorHandler((error, _request, reply) => {
    const explicitStatus =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? ((error as { statusCode: number }).statusCode ?? 500)
        : null;
    const statusCode =
      explicitStatus && explicitStatus >= 400
        ? explicitStatus
        : resolveErrorStatus(error);

    sendJson(reply, statusCode, {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
