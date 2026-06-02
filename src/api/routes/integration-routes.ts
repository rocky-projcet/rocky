import type { FastifyPluginAsync, FastifyReply } from "fastify";

import {
  EcountConnectionService,
  type EcountLookupServiceLike,
  type EcountConnectionTester,
  type EcountConnectionTestInput,
  type EcountConnectionTestResult,
  type EcountDatasetQueryInput,
  type EcountDatasetQueryResult,
  listEcountIntegrationCapabilities,
  normalizeEcountDatasetId,
} from "../../integrations/ecount-connection-service.js";
import {
  EcountSettingsService,
  type EcountConnectionSettingsInput,
  type EcountSettingsServiceLike,
  type EcountWebLoginSettingsInput,
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

function notFound(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 404,
  });
}

function sendJson(reply: FastifyReply, statusCode: number, body: unknown): void {
  reply.status(statusCode).type("application/json").send(body);
}

function requireIntegrationProvider(value: unknown): "ecount" {
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest("Integration provider is required.");
  }
  const provider = value.trim().toLowerCase();
  if (provider !== "ecount") {
    throw notFound(`Unsupported integration provider: ${value}`);
  }
  return "ecount";
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

function parseEcountWebLoginSettingsBody(body: unknown): EcountWebLoginSettingsInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("ECOUNT web login settings requests require a JSON object body.");
  }

  const input = body as Record<string, unknown>;
  return {
    accountLabel: optionalString(input, "accountLabel"),
    comCode: optionalString(input, "comCode"),
    userId: requiredString(input, "userId"),
    password: requiredString(input, "password"),
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
  filters?: Record<string, unknown> | null;
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
    filters: parseIntegrationFilters(record),
  };
}

function parseObjectBody(input: unknown, message: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw badRequest(message);
  }
  return input as Record<string, unknown>;
}

function parseFilterRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("Integration query filters must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

const INTEGRATION_FILTER_KEYS = [
  "baseDate",
  "date",
  "fromDate",
  "toDate",
  "startDate",
  "endDate",
  "warehouseCode",
  "warehouseCodes",
  "productCode",
  "productCodes",
  "productType",
  "productTypes",
  "fromProductCode",
  "toProductCode",
  "customerCode",
  "customerCodes",
  "period",
  "page",
  "pageCurrent",
  "pageSize",
  "commaFlag",
  "zeroFlag",
  "balanceFlag",
  "deleteFlag",
  "safeFlag",
  "deleteLocationFlag",
  "includeZero",
  "includeUnmanagedProducts",
  "includeInactiveProducts",
  "includeInactiveWarehouses",
];

function parseIntegrationFilters(record: Record<string, unknown>): Record<string, unknown> | null {
  const filters = parseFilterRecord(record.filters) ?? {};
  for (const key of INTEGRATION_FILTER_KEYS) {
    const value = record[key];
    if (value === null || value === undefined || value === "") {
      continue;
    }
    filters[key] = value;
  }
  return Object.keys(filters).length > 0 ? filters : null;
}

function parseDatasetId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest("Integration query requires dataset.");
  }
  return normalizeEcountDatasetId(value.trim());
}

function parseDatasetIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const datasets = value.map((entry) => parseDatasetId(entry));
  return [...new Set(datasets)];
}

function parseIntegrationQueryBody(body: unknown): {
  datasets: string[];
  options: Omit<EcountDatasetQueryInput, "dataset">;
} {
  const record = parseObjectBody(
    body,
    "Integration query requests require a JSON object body."
  );
  const datasets = parseDatasetIds(record.datasets);
  if (datasets.length === 0) {
    datasets.push(parseDatasetId(record.dataset));
  }

  return {
    datasets,
    options: {
      limit: parsePositiveLimit(record.limit),
      offset: parseNonNegativeOffset(record.offset),
      filters: parseIntegrationFilters(record),
    },
  };
}

function parseIntegrationDatasetQuery(
  dataset: unknown,
  query: unknown
): EcountDatasetQueryInput {
  const record =
    query && typeof query === "object" && !Array.isArray(query)
      ? query as Record<string, unknown>
      : {};
  return {
    dataset: parseDatasetId(dataset),
    limit: parsePositiveLimit(record.limit),
    offset: parseNonNegativeOffset(record.offset),
    filters: parseIntegrationFilters(record),
  };
}

function unsupportedEcountQueryResult(
  query: EcountDatasetQueryInput,
  now?: () => string
): EcountDatasetQueryResult {
  return {
    ok: false,
    provider: "ecount",
    dataset: normalizeEcountDatasetId(String(query.dataset)),
    title: `ECOUNT ERP ${query.dataset} 조회`,
    status: "unsupported",
    accountLabel: null,
    zone: null,
    checkedAt: now?.() ?? new Date().toISOString(),
    api: null,
    count: 0,
    returnedCount: 0,
    records: [],
    message: `ECOUNT ${query.dataset} lookup is not supported by the current read-only backend.`,
    diagnostics: {
      stage: "capability",
      detail: "This ECOUNT lookup service does not implement the standard queryDataset method.",
    },
  };
}

async function queryEcountDataset(
  service: EcountLookupServiceLike,
  input: EcountConnectionTestInput,
  query: EcountDatasetQueryInput,
  now?: () => string
): Promise<EcountDatasetQueryResult> {
  if (service.queryDataset) {
    return service.queryDataset(input, query);
  }
  if (normalizeEcountDatasetId(String(query.dataset)) === "products") {
    const result = await service.getBasicProductsList(input, {
      limit: query.limit,
      offset: query.offset,
    });
    return {
      ok: result.ok,
      provider: "ecount",
      dataset: "products",
      title: "ECOUNT ERP 품목 조회",
      status: result.ok ? "ready" : "failed",
      accountLabel: result.accountLabel,
      zone: result.zone,
      checkedAt: result.checkedAt,
      api: result.api,
      count: result.count,
      returnedCount: result.returnedCount,
      records: result.products.map((product) => ({
        code: product.code,
        name: product.name,
        spec: product.spec,
        unit: product.unit,
        raw: product.raw,
      })),
      message: result.message,
      diagnostics: result.diagnostics,
    };
  }
  return unsupportedEcountQueryResult(query, now);
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

  server.get("/integrations/:provider/settings", async (request, reply) => {
    requireIntegrationProvider((request.params as { provider?: string }).provider);
    sendJson(reply, 200, await ecountSettingsService.getPublicSettings());
  });

  server.put("/integrations/:provider/settings", async (request, reply) => {
    requireIntegrationProvider((request.params as { provider?: string }).provider);
    const input = parseEcountConnectionSettingsBody(request.body);
    sendJson(reply, 200, await ecountSettingsService.saveSettings(input));
  });

  server.delete("/integrations/:provider/settings", async (request, reply) => {
    requireIntegrationProvider((request.params as { provider?: string }).provider);
    sendJson(reply, 200, await ecountSettingsService.deleteSettings());
  });

  server.put("/integrations/:provider/web-login", async (request, reply) => {
    requireIntegrationProvider((request.params as { provider?: string }).provider);
    const input = parseEcountWebLoginSettingsBody(request.body);
    sendJson(reply, 200, await ecountSettingsService.saveWebLogin(input));
  });

  server.delete("/integrations/:provider/web-login", async (request, reply) => {
    requireIntegrationProvider((request.params as { provider?: string }).provider);
    sendJson(reply, 200, await ecountSettingsService.deleteWebLogin());
  });

  server.post("/integrations/:provider/test", async (request, reply) => {
    requireIntegrationProvider((request.params as { provider?: string }).provider);
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

  server.get("/integrations/:provider/capabilities", async (request, reply) => {
    requireIntegrationProvider((request.params as { provider?: string }).provider);
    sendJson(reply, 200, {
      provider: "ecount",
      capabilities: ecountLookupService.listCapabilities
        ? ecountLookupService.listCapabilities()
        : listEcountIntegrationCapabilities(),
    });
  });

  server.post("/integrations/:provider/query", async (request, reply) => {
    requireIntegrationProvider((request.params as { provider?: string }).provider);
    const input = await ecountSettingsService.getConnectionInput();
    if (!input) {
      throw badRequest("ECOUNT connection settings are not configured.");
    }
    const query = parseIntegrationQueryBody(request.body);
    const results = await Promise.all(
      query.datasets.map((dataset) =>
        queryEcountDataset(
          ecountLookupService,
          input,
          {
            ...query.options,
            dataset,
          },
          options.now
        )
      )
    );

    if (results.length === 1) {
      sendJson(reply, 200, results[0]);
      return;
    }

    sendJson(reply, 200, {
      provider: "ecount",
      status: results.some((result) => result.status === "failed")
        ? "partial"
        : results.some((result) => result.status === "unsupported")
          ? "partial"
          : "ready",
      checkedAt: options.now?.() ?? new Date().toISOString(),
      results,
    });
  });

  server.get("/integrations/:provider/datasets/:dataset", async (request, reply) => {
    requireIntegrationProvider((request.params as { provider?: string }).provider);
    const input = await ecountSettingsService.getConnectionInput();
    if (!input) {
      throw badRequest("ECOUNT connection settings are not configured.");
    }
    const query = parseIntegrationDatasetQuery(
      (request.params as { dataset?: string }).dataset,
      request.query
    );
    sendJson(
      reply,
      200,
      await queryEcountDataset(ecountLookupService, input, query, options.now)
    );
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
