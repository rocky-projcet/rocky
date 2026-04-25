import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import { sendJson } from "../http/reply.js";

import type {
  RockyCoreSettingsUpdateInput,
  RockyAttachmentInput,
  RockyChatServiceLike,
} from "../../rocky-chat/rocky-chat-types.js";
import type {
  RuntimeKind,
  RuntimeOllamaLaunchTarget,
  RuntimeReasoningEffort,
  RuntimeServiceTier,
} from "../../runtime/runtime-types.js";
import {
  normalizeRuntimeOllamaLaunchTarget,
  normalizeRuntimeServiceTier,
} from "../../runtime/runtime-types.js";

interface RockyChatRoutesOptions extends FastifyPluginOptions {
  rockyChatService: RockyChatServiceLike;
}

const ROCKY_CHAT_BODY_LIMIT = Number.MAX_SAFE_INTEGER;

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function isRuntimeKind(value: unknown): value is RuntimeKind {
  return value === "codex-cli" || value === "claude-code" || value === "ollama";
}

function parseReasoningEffort(
  value: unknown
): RuntimeReasoningEffort | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw badRequest("defaultReasoningEffort must be a string or null.");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (
    trimmed === "low" ||
    trimmed === "medium" ||
    trimmed === "high" ||
    trimmed === "xhigh" ||
    trimmed === "max"
  ) {
    return trimmed;
  }

  throw badRequest(
    "defaultReasoningEffort must be low, medium, high, xhigh, max, or null."
  );
}

function parseServiceTier(value: unknown): RuntimeServiceTier | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw badRequest("defaultServiceTier must be a string or null.");
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === "default" || trimmed === "flex") {
    return null;
  }

  const normalized = normalizeRuntimeServiceTier(trimmed);
  if (!normalized) {
    throw badRequest("defaultServiceTier must be fast or null.");
  }
  return normalized;
}

function parseOllamaLaunchTarget(
  value: unknown
): RuntimeOllamaLaunchTarget | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw badRequest("defaultOllamaLaunchTarget must be a string or null.");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = normalizeRuntimeOllamaLaunchTarget(trimmed);
  if (!normalized) {
    throw badRequest("defaultOllamaLaunchTarget must be codex, claude, or null.");
  }
  return normalized;
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
      contentBase64:
        typeof record.contentBase64 === "string" && record.contentBase64.trim()
          ? record.contentBase64.trim()
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
  const attachments = parseAttachments(input.attachments);
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message && attachments.length === 0) {
    throw badRequest("message or attachments are required.");
  }

  return {
    message,
    attachments,
  };
}

function parseCoreSettingsPatchBody(body: unknown): RockyCoreSettingsUpdateInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Rocky Core settings requests require a JSON object body.");
  }

  const input = body as Record<string, unknown>;
  const parsed: RockyCoreSettingsUpdateInput = {};

  if ("defaultRuntimeKind" in input) {
    if (!isRuntimeKind(input.defaultRuntimeKind)) {
      throw badRequest(
        "defaultRuntimeKind must be codex-cli, claude-code, or ollama."
      );
    }
    parsed.defaultRuntimeKind = input.defaultRuntimeKind;
  }

  if ("defaultModel" in input) {
    if (input.defaultModel === null || input.defaultModel === undefined) {
      parsed.defaultModel = null;
    } else if (typeof input.defaultModel === "string") {
      const trimmed = input.defaultModel.trim();
      parsed.defaultModel = trimmed.length > 0 ? trimmed : null;
    } else {
      throw badRequest("defaultModel must be a string or null.");
    }
  }

  if ("defaultReasoningEffort" in input) {
    parsed.defaultReasoningEffort = parseReasoningEffort(
      input.defaultReasoningEffort
    );
  }

  if ("defaultServiceTier" in input) {
    parsed.defaultServiceTier = parseServiceTier(input.defaultServiceTier);
  }

  if ("defaultOllamaLaunchTarget" in input) {
    parsed.defaultOllamaLaunchTarget = parseOllamaLaunchTarget(
      input.defaultOllamaLaunchTarget
    );
  }

  if (Object.keys(parsed).length === 0) {
    throw badRequest("Rocky Core settings requests must include a change.");
  }

  return parsed;
}

export const registerRockyChatRoutes: FastifyPluginAsync<
  RockyChatRoutesOptions
> = async (server, options) => {
  server.get("/rocky/abilities", async (_request, reply) => {
    sendJson(reply, 200, await options.rockyChatService.listAbilityCards());
  });

  server.post<{ Params: { abilityId: string } }>(
    "/rocky/abilities/:abilityId/guide",
    async (request, reply) => {
      const chat = await options.rockyChatService.startAbilityGuide(
        request.params.abilityId
      );
      sendJson(reply, 201, chat);
    }
  );

  server.get("/rocky/core", async (_request, reply) => {
    sendJson(reply, 200, await options.rockyChatService.getCoreManagement());
  });

  server.patch("/rocky/core/settings", async (request, reply) => {
    const updated = await options.rockyChatService.updateCoreSettings(
      parseCoreSettingsPatchBody(request.body)
    );
    sendJson(reply, 200, updated);
  });

  server.post("/rocky/core/skills/sync", async (_request, reply) => {
    sendJson(reply, 200, await options.rockyChatService.syncCoreSkills());
  });

  server.get("/rocky/chats", async (_request, reply) => {
    const chats = await options.rockyChatService.listChats();
    sendJson(reply, 200, chats);
  });

  server.post(
    "/rocky/chats",
    {
      // Rocky home can send uploaded files as base64 attachment payloads.
      // Practical limits are still constrained by process memory and transport.
      bodyLimit: ROCKY_CHAT_BODY_LIMIT,
    },
    async (request, reply) => {
      const chat = await options.rockyChatService.createChat(
        parseMessageBody(request.body)
      );
      sendJson(reply, 201, chat);
    }
  );

  server.get<{ Params: { chatId: string } }>(
    "/rocky/chats/:chatId",
    async (request, reply) => {
      const chat = await options.rockyChatService.getChat(request.params.chatId);
      sendJson(reply, 200, chat);
    }
  );

  server.post<{ Params: { chatId: string } }>(
    "/rocky/chats/:chatId/messages",
    {
      // Follow-up turns can include new uploaded files as base64 attachments.
      bodyLimit: ROCKY_CHAT_BODY_LIMIT,
    },
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
