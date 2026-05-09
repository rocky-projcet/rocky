import type { FastifyPluginAsync, FastifyReply } from "fastify";

import {
  EcountConnectionService,
  type EcountLookupServiceLike,
  type EcountConnectionTester,
  type EcountConnectionTestInput,
  type EcountConnectionTestResult,
} from "../../integrations/ecount-connection-service.js";
import {
  EcountSettingsService,
  type EcountConnectionSettingsInput,
  type EcountSettingsServiceLike,
} from "../../integrations/ecount-settings-service.js";

export interface IntegrationRoutesOptions {
  stateRoot?: string;
  now?: () => string;
  ecountConnectionTester?: EcountConnectionTester;
  ecountLookupService?: EcountLookupServiceLike;
  ecountSettingsService?: EcountSettingsServiceLike;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function sendJson(reply: FastifyReply, statusCode: number, body: unknown): void {
  reply.status(statusCode).type("application/json").send(body);
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`ECOUNT connection test requires ${key}.`);
  }
  return value.trim();
}

function optionalString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw badRequest(`ECOUNT connection test ${key} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function maskConnectionValue(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 2)}${"*".repeat(Math.min(value.length - 4, 8))}${value.slice(-2)}`;
}

function sanitizeEcountConnectionResult(
  result: EcountConnectionTestResult
): EcountConnectionTestResult {
  return {
    ...result,
    comCode: maskConnectionValue(result.comCode),
    userId: maskConnectionValue(result.userId),
  };
}

function parseEcountConnectionSettingsBody(body: unknown): EcountConnectionSettingsInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("ECOUNT connection test requests require a JSON object body.");
  }

  const input = body as Record<string, unknown>;
  return {
    accountLabel: optionalString(input, "accountLabel"),
    comCode: requiredString(input, "comCode"),
    userId: requiredString(input, "userId"),
    apiCertKey: requiredString(input, "apiCertKey"),
    zone: optionalString(input, "zone"),
    lanType: optionalString(input, "lanType"),
  };
}

function parseOptionalEcountConnectionTestBody(body: unknown): EcountConnectionTestInput | null {
  if (body === null || body === undefined) {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("ECOUNT connection test requests require a JSON object body.");
  }

  const input = body as Record<string, unknown>;
  const hasInlineCredential = ["comCode", "userId", "apiCertKey"].some(
    (key) => input[key] !== undefined && input[key] !== null
  );
  if (!hasInlineCredential) {
    return null;
  }
  return parseEcountConnectionSettingsBody(body);
}

function parsePositiveLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(parsed)) {
    throw badRequest("ECOUNT lookup limit must be a number.");
  }
  const limit = Math.floor(parsed);
  if (limit < 1 || limit > 1000) {
    throw badRequest("ECOUNT lookup limit must be between 1 and 1000.");
  }
  return limit;
}

function parseNonNegativeOffset(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  if (!Number.isFinite(parsed)) {
    throw badRequest("ECOUNT lookup offset must be a number.");
  }
  const offset = Math.floor(parsed);
  if (offset < 0) {
    throw badRequest("ECOUNT lookup offset must be zero or greater.");
  }
  return offset;
}

function parseEcountProductsLookupOptions(input: unknown): {
  limit?: number | null;
  offset?: number | null;
} {
  if (input === null || input === undefined) {
    return {};
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw badRequest("ECOUNT product lookup requests require a JSON object body.");
  }
  const record = input as Record<string, unknown>;
  return {
    limit: parsePositiveLimit(record.limit),
    offset: parseNonNegativeOffset(record.offset),
  };
}

export const registerIntegrationRoutes: FastifyPluginAsync<IntegrationRoutesOptions> = async (
  server,
  options
) => {
  const ecountConnectionTester =
    options.ecountConnectionTester ??
    new EcountConnectionService({
      now: options.now,
    });
  const ecountLookupService =
    options.ecountLookupService ??
    (ecountConnectionTester instanceof EcountConnectionService
      ? ecountConnectionTester
      : new EcountConnectionService({
          now: options.now,
        }));
  const ecountSettingsService =
    options.ecountSettingsService ??
    new EcountSettingsService({
      stateRoot: options.stateRoot,
      now: options.now,
    });

  server.get("/integrations/ecount/settings", async (_request, reply) => {
    sendJson(reply, 200, await ecountSettingsService.getPublicSettings());
  });

  server.put("/integrations/ecount/settings", async (request, reply) => {
    const input = parseEcountConnectionSettingsBody(request.body);
    sendJson(reply, 200, await ecountSettingsService.saveSettings(input));
  });

  server.delete("/integrations/ecount/settings", async (_request, reply) => {
    sendJson(reply, 200, await ecountSettingsService.deleteSettings());
  });

  server.post("/integrations/ecount/test", async (request, reply) => {
    const inlineInput = parseOptionalEcountConnectionTestBody(request.body);
    const storedInput = inlineInput
      ? null
      : await ecountSettingsService.getConnectionInput();
    const input = inlineInput ?? storedInput;
    if (!input) {
      throw badRequest("ECOUNT connection settings are not configured.");
    }

    const result = await ecountConnectionTester.testConnection(input);
    if (result.ok) {
      if (inlineInput) {
        await ecountSettingsService.saveSettings({
          ...inlineInput,
          accountLabel: (result.accountLabel ?? inlineInput.accountLabel) || null,
          zone: result.zone,
          checkedAt: result.checkedAt,
        });
      } else {
        await ecountSettingsService.updateLastCheck({
          zone: result.zone,
          checkedAt: result.checkedAt,
        });
      }
    }
    sendJson(reply, 200, sanitizeEcountConnectionResult(result));
  });

  server.post("/integrations/ecount/products", async (request, reply) => {
    const input = await ecountSettingsService.getConnectionInput();
    if (!input) {
      throw badRequest("ECOUNT connection settings are not configured.");
    }

    sendJson(
      reply,
      200,
      await ecountLookupService.getBasicProductsList(
        input,
        parseEcountProductsLookupOptions(request.body)
      )
    );
  });

  server.get("/integrations/ecount/products", async (request, reply) => {
    const input = await ecountSettingsService.getConnectionInput();
    if (!input) {
      throw badRequest("ECOUNT connection settings are not configured.");
    }

    sendJson(
      reply,
      200,
      await ecountLookupService.getBasicProductsList(
        input,
        parseEcountProductsLookupOptions(request.query)
      )
    );
  });
};
