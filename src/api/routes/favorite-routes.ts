import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import type {
  FavoriteCreateInput,
  FavoriteServiceLike,
} from "../../favorites/favorite-types.js";
import { sendJson } from "../http/reply.js";

interface FavoriteRoutesOptions extends FastifyPluginOptions {
  favoriteService: FavoriteServiceLike;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function parseCreateBody(body: unknown): FavoriteCreateInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== "output-file" && kind !== "agent-message" && kind !== "task") {
    throw badRequest("kind는 output-file / agent-message / task 중 하나여야 합니다.");
  }
  const chatId = record.chatId;
  if (typeof chatId !== "string" || !chatId.trim()) {
    throw badRequest("chatId가 필요합니다.");
  }

  const result: FavoriteCreateInput = {
    kind,
    chatId: chatId.trim(),
  };

  if (record.runId !== undefined && record.runId !== null) {
    if (typeof record.runId !== "string") throw badRequest("runId는 문자열이어야 합니다.");
    result.runId = record.runId;
  }
  if (record.artifactId !== undefined && record.artifactId !== null) {
    if (typeof record.artifactId !== "string") {
      throw badRequest("artifactId는 문자열이어야 합니다.");
    }
    result.artifactId = record.artifactId;
  }
  if (record.messageId !== undefined && record.messageId !== null) {
    if (typeof record.messageId !== "string") {
      throw badRequest("messageId는 문자열이어야 합니다.");
    }
    result.messageId = record.messageId;
  }
  return result;
}

export const registerFavoriteRoutes: FastifyPluginAsync<
  FavoriteRoutesOptions
> = async (server, options) => {
  server.get("/favorites", async (_request, reply) => {
    sendJson(reply, 200, { favorites: await options.favoriteService.list() });
  });

  server.post("/favorites", async (request, reply) => {
    const input = parseCreateBody(request.body);
    sendJson(reply, 201, await options.favoriteService.add(input));
  });

  server.delete("/favorites/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!id || !id.trim()) {
      throw badRequest("id가 필요합니다.");
    }
    sendJson(reply, 200, await options.favoriteService.remove(id.trim()));
  });
};
