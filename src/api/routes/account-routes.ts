import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import type { ClaudeAccountServiceLike } from "../../account/claude-account-types.js";
import type { ClaudeStatusServiceLike } from "../../account/claude-status-types.js";
import type { CodexAccountServiceLike } from "../../account/codex-account-types.js";
import type { CodexStatusServiceLike } from "../../account/codex-status-types.js";
import type { HardwareStatusServiceLike } from "../../system/hardware-status-types.js";
import { sendJson } from "../http/reply.js";

interface AccountRoutesOptions extends FastifyPluginOptions {
  codexAccountService: CodexAccountServiceLike;
  codexStatusService: CodexStatusServiceLike;
  claudeAccountService: ClaudeAccountServiceLike;
  claudeStatusService: ClaudeStatusServiceLike;
  hardwareStatusService: HardwareStatusServiceLike;
  now?: () => string;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function parseTaskRequestTitleBody(body: unknown): {
  prompt: string;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }

  const prompt = (body as Record<string, unknown>).prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw badRequest("A non-empty prompt is required.");
  }

  return {
    prompt: prompt.trim(),
  };
}

function parseAgentSuggestionBody(body: unknown): {
  title: string;
  description: string;
  triggerLabel: string;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }

  const record = body as Record<string, unknown>;
  const title = record.title;
  if (typeof title !== "string" || !title.trim()) {
    throw badRequest("A non-empty title is required.");
  }

  const description = typeof record.description === "string" ? record.description : "";
  const triggerLabel =
    typeof record.triggerLabel === "string" ? record.triggerLabel : "";

  return {
    title: title.trim(),
    description: description.trim(),
    triggerLabel: triggerLabel.trim(),
  };
}

function parseApiKeyBody(body: unknown): {
  apiKey: string;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }

  const apiKey = (body as Record<string, unknown>).apiKey;
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw badRequest("A non-empty apiKey is required.");
  }

  return {
    apiKey: apiKey.trim(),
  };
}

export const registerAccountRoutes: FastifyPluginAsync<
  AccountRoutesOptions
> = async (server, options) => {
  const now = options.now ?? (() => new Date().toISOString());

  server.get("/account", async (_request, reply) => {
    sendJson(reply, 200, await options.codexAccountService.getState());
  });

  server.get("/account/providers", async (_request, reply) => {
    const providers = await Promise.all([
      options.codexAccountService.getState(),
      options.claudeAccountService.getState(),
    ]);
    sendJson(reply, 200, {
      providers,
      updatedAt: now(),
    });
  });

  server.get("/account/providers/status", async (_request, reply) => {
    const providers = await Promise.all([
      options.codexStatusService.getStatus(),
      options.claudeStatusService.getStatus(),
    ]);
    sendJson(reply, 200, {
      providers,
      updatedAt: now(),
    });
  });

  server.get("/settings/hardware", async (_request, reply) => {
    sendJson(reply, 200, await options.hardwareStatusService.getStatus());
  });

  server.get("/codex-status", async (_request, reply) => {
    sendJson(reply, 200, await options.codexStatusService.getStatus());
  });

  server.get("/claude/account", async (_request, reply) => {
    sendJson(reply, 200, await options.claudeAccountService.getState());
  });

  server.get("/claude-status", async (_request, reply) => {
    sendJson(reply, 200, await options.claudeStatusService.getStatus());
  });

  server.post("/account/login/device", async (_request, reply) => {
    sendJson(reply, 202, await options.codexAccountService.startDeviceAuth());
  });

  server.post("/account/login", async (_request, reply) => {
    sendJson(reply, 202, await options.codexAccountService.startLogin());
  });

  server.post("/account/login/api-key", async (request, reply) => {
    const { apiKey } = parseApiKeyBody(request.body);
    sendJson(reply, 200, await options.codexAccountService.loginWithApiKey(apiKey));
  });

  server.post("/account/logout", async (_request, reply) => {
    sendJson(reply, 200, await options.codexAccountService.logout());
  });

  server.post("/account/update", async (_request, reply) => {
    sendJson(reply, 202, await options.codexAccountService.startUpdate());
  });

  server.post("/claude/account/login", async (_request, reply) => {
    sendJson(reply, 202, await options.claudeAccountService.startBrowserLogin("claudeai"));
  });

  server.post("/claude/account/login/console", async (_request, reply) => {
    sendJson(reply, 202, await options.claudeAccountService.startBrowserLogin("console"));
  });

  server.post("/claude/account/logout", async (_request, reply) => {
    sendJson(reply, 200, await options.claudeAccountService.logout());
  });

  server.post("/claude/account/update", async (_request, reply) => {
    sendJson(reply, 202, await options.claudeAccountService.startUpdate());
  });

  server.post("/account/task-request-title", async (request, reply) => {
    const { prompt } = parseTaskRequestTitleBody(request.body);
    sendJson(
      reply,
      200,
      await options.codexAccountService.summarizeTaskRequestTitle(prompt)
    );
  });

  server.post("/account/agent-suggestion", async (request, reply) => {
    const input = parseAgentSuggestionBody(request.body);
    sendJson(
      reply,
      200,
      await options.codexAccountService.suggestAgentForSkill(input)
    );
  });
};
