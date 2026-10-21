import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";

import type { AgentServiceLike } from "../api-types.js";
import { sendJson } from "../http/reply.js";
import {
  buildWorkspaceDirectoryRecord,
  buildWorkspaceFilePreviewRecord,
  deleteWorkspacePath,
  openWorkspaceFileInPowerPoint,
  openWorkspaceFolder,
  searchWorkspaceEntries,
  sendWorkspaceFileDownload,
  sendWorkspaceFilePreview,
  writeWorkspaceUploadFile,
} from "../http/workspace.js";
import type { NativeFileOpener, NativeFolderOpener } from "../http/native-open.js";

interface AgentRoutesOptions extends FastifyPluginOptions {
  agentService: AgentServiceLike;
  nativeFileOpener?: NativeFileOpener;
  nativeFolderOpener?: NativeFolderOpener;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function parseCreateAgentBody(body: unknown): {
  id?: string;
  name: string;
  description?: string;
  soul?: string | null;
  color?: string | null;
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
    soul?: string | null;
    color?: string | null;
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

  if ("soul" in input) {
    if (input.soul === null || input.soul === undefined) {
      parsed.soul = null;
    } else if (typeof input.soul === "string") {
      parsed.soul = input.soul;
    } else {
      throw badRequest("Agent soul must be a string when provided.");
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

function parseWorkspaceSearchQuery(query: unknown): {
  query: string;
  path?: string;
} {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    throw badRequest("Workspace search requests require a non-empty query.");
  }

  const input = query as Record<string, unknown>;
  const searchQuery = input.query;
  if (typeof searchQuery !== "string" || !searchQuery.trim()) {
    throw badRequest("Workspace search requests require a non-empty query.");
  }

  const parsed: {
    query: string;
    path?: string;
  } = {
    query: searchQuery.trim(),
  };

  if (input.path !== undefined && input.path !== null && input.path !== "") {
    if (typeof input.path !== "string" || !input.path.trim()) {
      throw badRequest("Workspace search path must be a string when provided.");
    }

    parsed.path = input.path.trim();
  }

  return parsed;
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

function parseUpdateAgentBody(body: unknown): {
  name?: string;
  description?: string;
  soul?: string | null;
  lifecycle?: "active" | "archived";
  color?: string | null;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }

  const input = body as Record<string, unknown>;
  const parsed: {
    name?: string;
    description?: string;
    soul?: string | null;
    lifecycle?: "active" | "archived";
    color?: string | null;
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

  if ("soul" in input) {
    if (input.soul === null || input.soul === undefined) {
      parsed.soul = null;
    } else if (typeof input.soul === "string") {
      parsed.soul = input.soul;
    } else {
      throw badRequest("Agent soul must be a string when provided.");
    }
  }

  if ("lifecycle" in input) {
    if (input.lifecycle === "active" || input.lifecycle === "archived") {
      parsed.lifecycle = input.lifecycle;
    } else {
      throw badRequest("Agent lifecycle must be active or archived.");
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

  if (
    !("name" in parsed) &&
    !("description" in parsed) &&
    !("lifecycle" in parsed) &&
    !("color" in parsed)
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

export const registerAgentRoutes: FastifyPluginAsync<AgentRoutesOptions> = async (
  server,
  options
) => {
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
    sendJson(reply, 200, await options.agentService.updateAgent(agentId, input));
  });

  server.delete("/agents/:agentId", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    await options.agentService.deleteAgent(agentId);
    reply.status(204).send();
  });

  server.get("/agents/:agentId/workspace", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await options.agentService.getAgent(agentId);
    const requestedPath = parseWorkspaceQuery(request.query, {
      required: false,
    });

    sendJson(reply, 200, await buildWorkspaceDirectoryRecord(agent, requestedPath));
  });

  server.delete("/agents/:agentId/workspace", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await options.agentService.getAgent(agentId);
    const requestedPath = parseWorkspaceQuery(request.query, {
      required: true,
    });

    sendJson(reply, 200, await deleteWorkspacePath(agent, requestedPath!));
  });

  server.get("/agents/:agentId/workspace/search", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await options.agentService.getAgent(agentId);
    const search = parseWorkspaceSearchQuery(request.query);

    sendJson(
      reply,
      200,
      await searchWorkspaceEntries({
        agent,
        query: search.query,
        requestedPath: search.path,
      })
    );
  });

  server.post("/agents/:agentId/workspace/open-native", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await options.agentService.getAgent(agentId);
    const requestedPath = parseWorkspaceQuery(request.query, {
      required: false,
    });

    sendJson(
      reply,
      200,
      await openWorkspaceFolder(agent, requestedPath, options.nativeFolderOpener)
    );
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
};
