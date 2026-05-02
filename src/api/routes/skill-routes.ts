import type { FastifyPluginAsync, FastifyReply } from "fastify";

import {
  SkillTemplateStore,
  type SkillTemplateRunUploadInput,
} from "../../skills/skill-template-store.js";

export interface SkillRoutesOptions {
  stateRoot?: string;
  now?: () => string;
  idGenerator?: () => string;
  skillTemplateStore?: SkillTemplateStore;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function sendJson(reply: FastifyReply, statusCode: number, body: unknown): void {
  reply.status(statusCode).type("application/json").send(body);
}

function parseRunCreateBody(body: unknown): { templateKind?: string | null } {
  if (body === null || body === undefined) {
    return {};
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Skill template run requests require a JSON object body.");
  }

  const input = body as Record<string, unknown>;
  return {
    templateKind:
      typeof input.templateKind === "string" && input.templateKind.trim()
        ? input.templateKind.trim()
        : null,
  };
}

function parseUploadBody(body: unknown): SkillTemplateRunUploadInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Skill template upload requests require a JSON object body.");
  }

  const input = body as Record<string, unknown>;
  if (typeof input.fileName !== "string" || !input.fileName.trim()) {
    throw badRequest("Skill template uploads require a non-empty fileName.");
  }
  if (typeof input.contentBase64 !== "string") {
    throw badRequest("Skill template uploads require a base64-encoded content string.");
  }

  return {
    fieldId:
      typeof input.fieldId === "string" && input.fieldId.trim()
        ? input.fieldId.trim()
        : null,
    fileName: input.fileName.trim(),
    contentType:
      typeof input.contentType === "string" && input.contentType.trim()
        ? input.contentType.trim()
        : null,
    size:
      typeof input.size === "number" && Number.isFinite(input.size)
        ? input.size
        : null,
    contentBase64: input.contentBase64.trim(),
  };
}

export const registerSkillRoutes: FastifyPluginAsync<SkillRoutesOptions> = async (
  server,
  options
) => {
  const store =
    options.skillTemplateStore ??
    new SkillTemplateStore({
      stateRoot: options.stateRoot,
      now: options.now,
      idGenerator: options.idGenerator,
    });

  server.get("/skills", async (_request, reply) => {
    sendJson(reply, 200, await store.listSkills());
  });

  server.put("/skills/:skillId", async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Skill save requests require a JSON object body.");
    }
    const record = body as Record<string, unknown>;
    if (record.id !== skillId) {
      throw badRequest("Skill route id must match the skill template id.");
    }

    sendJson(reply, 200, await store.upsertSkill(body));
  });

  server.get("/skills/:skillId/files", async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    sendJson(reply, 200, await store.getSkillFiles(skillId));
  });

  server.delete("/skills/:skillId", async (request, reply) => {
    const { skillId } = request.params as { skillId: string };
    sendJson(reply, 200, await store.deleteSkill(skillId));
  });

  server.post("/skill-template-runs", async (request, reply) => {
    const input = parseRunCreateBody(request.body);
    sendJson(reply, 201, await store.createRun(input));
  });

  server.get("/skill-template-runs/:runId", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    sendJson(reply, 200, await store.getRun(runId));
  });

  server.post(
    "/skill-template-runs/:runId/uploads",
    {
      bodyLimit: Number.MAX_SAFE_INTEGER,
    },
    async (request, reply) => {
      const { runId } = request.params as { runId: string };
      const input = parseUploadBody(request.body);
      sendJson(reply, 201, await store.uploadRunFile(runId, input));
    }
  );
};
