import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import { sendJson } from "../http/reply.js";

import type {
  RockyAttachmentInput,
  RockyChatServiceLike,
} from "../../rocky-chat/rocky-chat-types.js";

interface RockyChatRoutesOptions extends FastifyPluginOptions {
  rockyChatService: RockyChatServiceLike;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function parseAttachments(value: unknown): RockyAttachmentInput[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw badRequest("attachments must be an array when provided.");
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw badRequest("attachment entries must be objects.");
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string" || !record.name.trim()) {
      throw badRequest("attachment name is required.");
    }

    return {
      name: record.name.trim(),
      contentType:
        typeof record.contentType === "string" && record.contentType.trim()
          ? record.contentType.trim()
          : null,
      size:
        typeof record.size === "number" && Number.isFinite(record.size)
          ? record.size
          : null,
    };
  });
}

function parseMessageBody(body: unknown): {
  message: string;
  attachments: RockyAttachmentInput[];
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Rocky chat requests require a JSON object body.");
  }

  const input = body as Record<string, unknown>;
  if (typeof input.message !== "string" || !input.message.trim()) {
    throw badRequest("message is required.");
  }

  return {
    message: input.message.trim(),
    attachments: parseAttachments(input.attachments),
  };
}

export const registerRockyChatRoutes: FastifyPluginAsync<
  RockyChatRoutesOptions
> = async (server, options) => {
  server.get("/rocky/chats", async (_request, reply) => {
    const chats = await options.rockyChatService.listChats();
    sendJson(reply, 200, chats);
  });

  server.post("/rocky/chats", async (request, reply) => {
    const chat = await options.rockyChatService.createChat(
      parseMessageBody(request.body)
    );
    sendJson(reply, 201, chat);
  });

  server.get<{ Params: { chatId: string } }>(
    "/rocky/chats/:chatId",
    async (request, reply) => {
      const chat = await options.rockyChatService.getChat(request.params.chatId);
      sendJson(reply, 200, chat);
    }
  );

  server.post<{ Params: { chatId: string } }>(
    "/rocky/chats/:chatId/messages",
    async (request, reply) => {
      const chat = await options.rockyChatService.addMessage(
        request.params.chatId,
        parseMessageBody(request.body)
      );
      sendJson(reply, 201, chat);
    }
  );

  server.delete<{ Params: { chatId: string } }>(
    "/rocky/chats/:chatId",
    async (request, reply) => {
      await options.rockyChatService.deleteChat(request.params.chatId);
      reply.status(204).send();
    }
  );
};
