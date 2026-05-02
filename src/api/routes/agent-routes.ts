import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import type { AgentServiceLike, SessionServiceLike } from "../api-types.js";
import {
  AgentLocalSkillService,
  type AgentLocalSkillFileInput,
} from "../../agents/agent-local-skill-service.js";
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
import { sendJson } from "../http/reply.js";
import {
  buildWorkspaceDirectoryRecord,
  buildWorkspaceFilePreviewRecord,
  openWorkspaceFileInPowerPoint,
  sendWorkspaceFileDownload,
  sendWorkspaceFilePreview,
  writeWorkspaceUploadFile,
} from "../http/workspace.js";
import type { NativeFileOpener } from "../http/native-open.js";

const AGENT_SKILL_INSTALL_BODY_LIMIT_BYTES = 100 * 1024 * 1024;

interface AgentRoutesOptions extends FastifyPluginOptions {
  agentService: AgentServiceLike;
  sessionService: SessionServiceLike;
  nativeFileOpener?: NativeFileOpener;
  agentLocalSkillService?: AgentLocalSkillService;
}

function isRuntimeKind(value: unknown): value is RuntimeKind {
  return value === "codex-cli" || value === "claude-code" || value === "ollama";
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

  if (typeof value !== "string" || !value.trim()) {
    throw badRequest("ollamaLaunchTarget must be codex or claude when provided.");
  }

  const normalized = normalizeRuntimeOllamaLaunchTarget(value.trim());
  if (!normalized) {
    throw badRequest("ollamaLaunchTarget must be codex or claude when provided.");
  }

  return normalized;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function conflict(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 409,
  });
}

function parseCreateAgentBody(body: unknown): {
  id?: string;
  name: string;
  description?: string;
  color?: string | null;
  defaultRuntime?: RuntimeKind;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }

  const input = body as Record<string, unknown>;
  const name = input.name;
  if (typeof name !== "string" || !name.trim()) {
    throw badRequest("A non-empty agent name is required.");
  }

  const parsed: {
    id?: string;
    name: string;
    description?: string;
    color?: string | null;
    defaultRuntime?: RuntimeKind;
  } = {
    name: name.trim(),
  };

  if ("id" in input) {
    if (typeof input.id !== "string" || !input.id.trim()) {
      throw badRequest("Agent id must be a non-empty string when provided.");
    }

    parsed.id = input.id.trim();
  }

  if ("description" in input) {
    if (input.description === null || input.description === undefined) {
      parsed.description = "";
    } else if (typeof input.description === "string") {
      parsed.description = input.description;
    } else {
      throw badRequest("Agent description must be a string when provided.");
    }
  }

  if ("color" in input) {
    if (input.color === null || input.color === undefined) {
      parsed.color = null;
    } else if (typeof input.color === "string") {
      parsed.color = input.color;
    } else {
      throw badRequest("Agent color must be a string when provided.");
    }
  }

  if ("defaultRuntime" in input) {
    if (isRuntimeKind(input.defaultRuntime)) {
      parsed.defaultRuntime = input.defaultRuntime;
    } else {
      throw badRequest("defaultRuntime must be codex-cli, claude-code, or ollama.");
    }
  }

  return parsed;
}

function parseWorkspaceQuery(
  query: unknown,
  options: { required: boolean }
): string | undefined {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    if (options.required) {
      throw badRequest("Workspace file requests require a non-empty path query.");
    }

    return undefined;
  }

  const value = (query as Record<string, unknown>).path;
  if (value === undefined || value === null || value === "") {
    if (options.required) {
      throw badRequest("Workspace file requests require a non-empty path query.");
    }

    return undefined;
  }

  if (typeof value !== "string") {
    throw badRequest("Workspace path query must be a string.");
  }

  if (!value.trim()) {
    if (options.required) {
      throw badRequest("Workspace file requests require a non-empty path query.");
    }

    return undefined;
  }

  return value.trim();
}

function parseWorkspaceUploadBody(body: unknown): {
  filename: string;
  contentBase64: string;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Workspace uploads require a JSON object body.");
  }

  const input = body as Record<string, unknown>;
  if (typeof input.filename !== "string" || !input.filename.trim()) {
    throw badRequest("Workspace uploads require a non-empty filename.");
  }

  if (typeof input.contentBase64 !== "string") {
    throw badRequest("Workspace uploads require a base64-encoded content string.");
  }

  return {
    filename: input.filename.trim(),
    contentBase64: input.contentBase64.trim(),
  };
}

function parseSkillUpsertBody(body: unknown): {
  replace?: boolean;
  files: AgentLocalSkillFileInput[];
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Skill install requests require a JSON object body.");
  }

  const input = body as Record<string, unknown>;
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw badRequest("Skill install requests require a non-empty files array.");
  }

  const files = input.files.map((entry): AgentLocalSkillFileInput => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw badRequest("Skill file entries must be JSON objects.");
    }
    const file = entry as Record<string, unknown>;
    if (typeof file.path !== "string" || !file.path.trim()) {
      throw badRequest("Skill file entries require a non-empty path.");
    }
    if (typeof file.content !== "string") {
      throw badRequest("Skill file entries require content.");
    }
    if (
      file.encoding !== undefined &&
      file.encoding !== "utf8" &&
      file.encoding !== "base64"
    ) {
      throw badRequest("Skill file encoding must be utf8 or base64.");
    }

    return {
      path: file.path.trim(),
      content: file.content,
      encoding: file.encoding as AgentLocalSkillFileInput["encoding"],
    };
  });

  if (
    input.replace !== undefined &&
    typeof input.replace !== "boolean"
  ) {
    throw badRequest("replace must be a boolean when provided.");
  }

  return {
    replace: input.replace as boolean | undefined,
    files,
  };
}

function parseUpdateAgentBody(body: unknown): {
  name?: string;
  description?: string;
  lifecycle?: "active" | "archived";
  stopRunningSessions?: boolean;
  color?: string | null;
  defaultRuntime?: RuntimeKind;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }

  const input = body as Record<string, unknown>;
  const parsed: {
    name?: string;
    description?: string;
    lifecycle?: "active" | "archived";
    stopRunningSessions?: boolean;
    color?: string | null;
    defaultRuntime?: RuntimeKind;
  } = {};

  if ("name" in input) {
    if (typeof input.name !== "string" || !input.name.trim()) {
      throw badRequest("Agent name must be a non-empty string when provided.");
    }

    parsed.name = input.name.trim();
  }

  if ("description" in input) {
    if (input.description === null || input.description === undefined) {
      parsed.description = "";
    } else if (typeof input.description === "string") {
      parsed.description = input.description;
    } else {
      throw badRequest("Agent description must be a string when provided.");
    }
  }

  if ("lifecycle" in input) {
    if (input.lifecycle === "active" || input.lifecycle === "archived") {
      parsed.lifecycle = input.lifecycle;
    } else {
      throw badRequest("Agent lifecycle must be active or archived.");
    }
  }

  if ("stopRunningSessions" in input) {
    if (typeof input.stopRunningSessions !== "boolean") {
      throw badRequest("stopRunningSessions must be a boolean when provided.");
    }

    parsed.stopRunningSessions = input.stopRunningSessions;
  }

  if ("color" in input) {
    if (input.color === null || input.color === undefined) {
      parsed.color = null;
    } else if (typeof input.color === "string") {
      parsed.color = input.color;
    } else {
      throw badRequest("Agent color must be a string when provided.");
    }
  }

  if ("defaultRuntime" in input) {
    if (isRuntimeKind(input.defaultRuntime)) {
      parsed.defaultRuntime = input.defaultRuntime;
    } else {
      throw badRequest("defaultRuntime must be codex-cli, claude-code, or ollama.");
    }
  }

  if (
    !("name" in parsed) &&
    !("description" in parsed) &&
    !("lifecycle" in parsed) &&
    !("color" in parsed) &&
    !("defaultRuntime" in parsed)
  ) {
    throw badRequest("Agent update requests must include a supported change.");
  }

  return parsed;
}

function parseIncludeArchivedQuery(query: unknown): boolean {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return false;
  }

  const value = (query as Record<string, unknown>).includeArchived;
  if (value === undefined) {
    return false;
  }

  if (typeof value !== "string") {
    throw badRequest("includeArchived must be a boolean query string.");
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  throw badRequest("includeArchived must be true or false when provided.");
}

function parseSessionKindsQuery(query: unknown): Array<"task-request" | "single-task"> {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return ["task-request"];
  }

  const value = (query as Record<string, unknown>).kinds;
  if (value === undefined) {
    return ["task-request"];
  }

  if (typeof value !== "string") {
    throw badRequest("kinds must be a comma-separated string.");
  }

  const kinds = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (kinds.length === 0) {
    return ["task-request"];
  }

  for (const kind of kinds) {
    if (kind !== "task-request" && kind !== "single-task") {
      throw badRequest("kinds entries must be task-request or single-task.");
    }
  }

  return kinds as Array<"task-request" | "single-task">;
}

function parseStopRunningSessionsQuery(query: unknown): boolean {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return false;
  }

  const value = (query as Record<string, unknown>).stopRunningSessions;
  if (value === undefined) {
    return false;
  }

  if (typeof value !== "string") {
    throw badRequest("stopRunningSessions must be a boolean query string.");
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  throw badRequest("stopRunningSessions must be true or false when provided.");
}

async function stopRunningSessionsIfRequested(
  sessionService: SessionServiceLike,
  agentId: string,
  action: "archive" | "delete",
  stopRunningSessions: boolean
): Promise<void> {
  const sessions = await sessionService.listAgentSessions(agentId, {
    includeArchived: true,
  });
  const runningSessions = sessions.filter((session) => session.status === "running");
  if (runningSessions.length === 0) {
    return;
  }

  if (!stopRunningSessions) {
    throw conflict(
      `Cannot ${action} an agent with running sessions until they are stopped: ${agentId}`
    );
  }

  await sessionService.stopAgentRuns(agentId);
}

export const registerAgentRoutes: FastifyPluginAsync<AgentRoutesOptions> = async (
  server,
  options
) => {
  const agentLocalSkillService =
    options.agentLocalSkillService ?? new AgentLocalSkillService();

  server.post("/agents", async (request, reply) => {
    const created = await options.agentService.createAgent(
      parseCreateAgentBody(request.body)
    );
    sendJson(reply, 201, created);
  });

  server.get("/agents", async (request, reply) => {
    const includeArchived = parseIncludeArchivedQuery(request.query);
    const agents = await options.agentService.listAgents();
    sendJson(
      reply,
      200,
      includeArchived ? agents : agents.filter((agent) => agent.lifecycle !== "archived")
    );
  });

  server.get("/agents/:agentId", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    sendJson(reply, 200, await options.agentService.getAgent(agentId));
  });

  server.patch("/agents/:agentId", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const input = parseUpdateAgentBody(request.body);
    if (input.lifecycle === "archived") {
      await stopRunningSessionsIfRequested(
        options.sessionService,
        agentId,
        "archive",
        input.stopRunningSessions ?? false
      );
    }

    const { stopRunningSessions: _stopRunningSessions, ...persistedPatch } = input;
    sendJson(reply, 200, await options.agentService.updateAgent(agentId, persistedPatch));
  });

  server.delete("/agents/:agentId", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    await stopRunningSessionsIfRequested(
      options.sessionService,
      agentId,
      "delete",
      parseStopRunningSessionsQuery(request.query)
    );
    await options.agentService.deleteAgent(agentId);
    reply.status(204).send();
  });

  server.get("/agents/:agentId/skills", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await options.agentService.getAgent(agentId);
    sendJson(reply, 200, await agentLocalSkillService.listAgentLocalSkills(agent));
  });

  server.put(
    "/agents/:agentId/skills/:skillId",
    {
      bodyLimit: AGENT_SKILL_INSTALL_BODY_LIMIT_BYTES,
    },
    async (request, reply) => {
      const { agentId, skillId } = request.params as {
        agentId: string;
        skillId: string;
      };
      const agent = await options.agentService.getAgent(agentId);
      const input = parseSkillUpsertBody(request.body);
      sendJson(
        reply,
        200,
        await agentLocalSkillService.upsertAgentLocalSkill(
          agent,
          skillId,
          input.files,
          {
            replace: input.replace,
          }
        )
      );
    }
  );

  server.delete("/agents/:agentId/skills/:skillId", async (request, reply) => {
    const { agentId, skillId } = request.params as {
      agentId: string;
      skillId: string;
    };
    const agent = await options.agentService.getAgent(agentId);
    sendJson(
      reply,
      200,
      await agentLocalSkillService.deleteAgentLocalSkill(agent, skillId)
    );
  });

  server.get("/agents/:agentId/workspace", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await options.agentService.getAgent(agentId);
    const requestedPath = parseWorkspaceQuery(request.query, {
      required: false,
    });

    sendJson(reply, 200, await buildWorkspaceDirectoryRecord(agent, requestedPath));
  });

  server.get("/agents/:agentId/workspace/file", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await options.agentService.getAgent(agentId);
    const requestedPath = parseWorkspaceQuery(request.query, {
      required: true,
    });

    sendJson(reply, 200, await buildWorkspaceFilePreviewRecord(agent, requestedPath!));
  });

  server.post(
    "/agents/:agentId/workspace/file",
    {
      // Keep this effectively unbounded at the app layer.
      // Practical limits are still constrained by process memory and transport.
      bodyLimit: Number.MAX_SAFE_INTEGER,
    },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      const agent = await options.agentService.getAgent(agentId);
      const upload = parseWorkspaceUploadBody(request.body);

      sendJson(reply, 201, await writeWorkspaceUploadFile({ agent, ...upload }));
    }
  );

  server.get("/agents/:agentId/workspace/file/content", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await options.agentService.getAgent(agentId);
    const requestedPath = parseWorkspaceQuery(request.query, {
      required: true,
    });

    await sendWorkspaceFileDownload(reply, agent, requestedPath!);
  });

  server.get("/agents/:agentId/workspace/file/preview", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await options.agentService.getAgent(agentId);
    const requestedPath = parseWorkspaceQuery(request.query, {
      required: true,
    });

    await sendWorkspaceFilePreview(reply, agent, requestedPath!);
  });

  server.post("/agents/:agentId/workspace/file/open-native", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await options.agentService.getAgent(agentId);
    const requestedPath = parseWorkspaceQuery(request.query, {
      required: true,
    });

    sendJson(
      reply,
      200,
      await openWorkspaceFileInPowerPoint(
        agent,
        requestedPath!,
        options.nativeFileOpener
      )
    );
  });

  server.get("/agents/:agentId/sessions", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    sendJson(
      reply,
      200,
      await options.sessionService.listAgentSessions(agentId, {
        includeArchived: parseIncludeArchivedQuery(request.query),
        kinds: parseSessionKindsQuery(request.query),
      })
    );
  });

  server.post("/agents/:agentId/sessions", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    let authProfileId: string | null | undefined;
    let runtimeKind: RuntimeKind | undefined;
    let ollamaLaunchTarget: RuntimeOllamaLaunchTarget | null | undefined;
    let model: string | null | undefined;
    let reasoningEffort: RuntimeReasoningEffort | null | undefined;
    let serviceTier: RuntimeServiceTier | null | undefined;
    if ("authProfileId" in body) {
      if (body.authProfileId === null || body.authProfileId === undefined) {
        authProfileId = null;
      } else if (
        typeof body.authProfileId === "string" &&
        body.authProfileId.trim()
      ) {
        authProfileId = body.authProfileId.trim();
      } else {
        throw badRequest("authProfileId must be a non-empty string when provided.");
      }
    }

    if ("runtimeKind" in body) {
      if (body.runtimeKind === null || body.runtimeKind === undefined) {
        runtimeKind = undefined;
      } else if (isRuntimeKind(body.runtimeKind)) {
        runtimeKind = body.runtimeKind;
      } else {
        throw badRequest("runtimeKind must be codex-cli, claude-code, or ollama when provided.");
      }
    }

    if ("ollamaLaunchTarget" in body) {
      ollamaLaunchTarget = parseOllamaLaunchTarget(body.ollamaLaunchTarget);
    }

    if ("model" in body) {
      if (body.model === null || body.model === undefined) {
        model = null;
      } else if (typeof body.model === "string" && body.model.trim()) {
        model = body.model.trim();
      } else {
        throw badRequest("model must be a non-empty string when provided.");
      }
    }

    if ("reasoningEffort" in body) {
      if (body.reasoningEffort === null || body.reasoningEffort === undefined) {
        reasoningEffort = null;
      } else if (
        typeof body.reasoningEffort === "string" &&
        body.reasoningEffort.trim()
      ) {
        reasoningEffort = body.reasoningEffort.trim() as RuntimeReasoningEffort;
      } else {
        throw badRequest("reasoningEffort must be a non-empty string when provided.");
      }
    }

    if ("serviceTier" in body) {
      if (body.serviceTier === null || body.serviceTier === undefined) {
        serviceTier = null;
      } else if (
        typeof body.serviceTier === "string" &&
        body.serviceTier.trim()
      ) {
        const trimmedServiceTier = body.serviceTier.trim();
        if (trimmedServiceTier === "default" || trimmedServiceTier === "flex") {
          serviceTier = null;
        } else {
          const normalizedServiceTier = normalizeRuntimeServiceTier(trimmedServiceTier);
          if (!normalizedServiceTier) {
            throw badRequest("serviceTier must be fast when provided.");
          }
          serviceTier = normalizedServiceTier;
        }
      } else {
        throw badRequest("serviceTier must be a non-empty string when provided.");
      }
    }

    const created = await options.sessionService.createSession({
      agentId,
      title:
        typeof body.title === "string" ? body.title : body.title === null ? null : null,
      runtimeKind,
      ollamaLaunchTarget,
      authProfileId,
      model,
      reasoningEffort,
      serviceTier,
    });
    sendJson(reply, 201, created);
  });
};
