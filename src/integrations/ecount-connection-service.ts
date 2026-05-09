export interface EcountConnectionTestInput {
  accountLabel?: string | null;
  comCode: string;
  userId: string;
  apiCertKey: string;
  zone?: string | null;
  lanType?: string | null;
}

export interface EcountConnectionTestResult {
  ok: boolean;
  status: "connected" | "failed";
  accountLabel: string | null;
  comCode: string;
  userId: string;
  zone: string | null;
  checkedAt: string;
  message: string;
  diagnostics?: {
    stage: "zone" | "login";
    detail: string;
  };
}

export interface EcountConnectionTester {
  testConnection(input: EcountConnectionTestInput): Promise<EcountConnectionTestResult>;
}

export interface EcountBasicProductRecord {
  code: string | null;
  name: string | null;
  spec: string | null;
  unit: string | null;
  raw: Record<string, unknown>;
}

export interface EcountBasicProductsLookupInput {
  limit?: number | null;
  offset?: number | null;
}

export interface EcountBasicProductsLookupResult {
  ok: boolean;
  status: "connected" | "failed";
  accountLabel: string | null;
  zone: string | null;
  checkedAt: string;
  api: "InventoryBasic/GetBasicProductsList";
  count: number;
  returnedCount: number;
  products: EcountBasicProductRecord[];
  message: string;
  diagnostics?: {
    stage: "zone" | "login" | "read";
    detail: string;
  };
}

export interface EcountLookupServiceLike {
  getBasicProductsList(
    input: EcountConnectionTestInput,
    options?: EcountBasicProductsLookupInput
  ): Promise<EcountBasicProductsLookupResult>;
}

export interface EcountConnectionServiceOptions {
  fetchImpl?: typeof fetch;
  now?: () => string;
}

function trimOptional(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function firstStringAt(value: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const entry = readPath(value, path);
    if (typeof entry === "string" && entry.trim()) {
      return entry.trim();
    }
  }
  return null;
}

function firstMessage(value: unknown): string | null {
  return firstStringAt(value, [
    ["message"],
    ["Message"],
    ["ERROR_DES"],
    ["Error", "Message"],
    ["Data", "Message"],
    ["Data", "Datas", "Message"],
    ["data", "message"],
  ]);
}

function firstDataCode(value: unknown): string | null {
  return firstStringAt(value, [
    ["Data", "Code"],
    ["Data", "Datas", "Code"],
    ["data", "code"],
    ["Code"],
  ]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstArrayAt(value: unknown, paths: string[][]): unknown[] | null {
  for (const path of paths) {
    const entry = readPath(value, path);
    if (Array.isArray(entry)) {
      return entry;
    }
  }
  return null;
}

function firstStringField(
  record: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function normalizeProductRecord(value: unknown): EcountBasicProductRecord | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    code: firstStringField(record, [
      "PROD_CD",
      "PROD_CODE",
      "ITEM_CD",
      "ITEM_CODE",
      "CODE",
    ]),
    name: firstStringField(record, [
      "PROD_DES",
      "PROD_NAME",
      "ITEM_DES",
      "ITEM_NAME",
      "NAME",
    ]),
    spec: firstStringField(record, [
      "SIZE_DES",
      "SIZE",
      "SPEC",
      "SPEC_DES",
    ]),
    unit: firstStringField(record, [
      "UNIT",
      "UNIT_CD",
      "UNIT_DES",
    ]),
    raw: record,
  };
}

function extractProductRows(payload: unknown): Record<string, unknown>[] {
  const directRows = firstArrayAt(payload, [
    ["Data", "Output"],
    ["Data", "Datas", "Output"],
    ["Data", "Result"],
    ["Data", "Datas", "Result"],
    ["Output"],
    ["Result"],
  ]);
  if (directRows) {
    return directRows
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }

  const output = asRecord(readPath(payload, ["Data", "Output"])) ??
    asRecord(readPath(payload, ["Data", "Datas"]));
  if (!output) {
    return [];
  }

  for (const value of Object.values(output)) {
    if (Array.isArray(value)) {
      return value
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    }
  }

  return [];
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text };
    }
  }

  if (!response.ok) {
    throw new Error(firstMessage(parsed) ?? `${response.status} ${response.statusText}`);
  }

  return parsed;
}

export class EcountConnectionService implements EcountConnectionTester {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => string;

  constructor(options: EcountConnectionServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async testConnection(
    input: EcountConnectionTestInput
  ): Promise<EcountConnectionTestResult> {
    const checkedAt = this.now();
    const accountLabel = trimOptional(input.accountLabel);
    const comCode = input.comCode.trim();
    const userId = input.userId.trim();
    const apiCertKey = input.apiCertKey.trim();
    const lanType = trimOptional(input.lanType) ?? "ko-KR";

    try {
      const zone = await this.resolveZone(comCode, trimOptional(input.zone));
      const sessionId = await this.login({
        comCode,
        userId,
        apiCertKey,
        zone,
        lanType,
      });

      return {
        ok: true,
        status: "connected",
        accountLabel,
        comCode,
        userId,
        zone,
        checkedAt,
        message: sessionId
          ? "ECOUNT login succeeded and a session was issued."
          : "ECOUNT login succeeded.",
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown ECOUNT error.";
      return {
        ok: false,
        status: "failed",
        accountLabel,
        comCode,
        userId,
        zone: trimOptional(input.zone),
        checkedAt,
        message: "ECOUNT connection test failed.",
        diagnostics: {
          stage: detail.toLowerCase().includes("zone") ? "zone" : "login",
          detail,
        },
      };
    }
  }

  async getBasicProductsList(
    input: EcountConnectionTestInput,
    options: EcountBasicProductsLookupInput = {}
  ): Promise<EcountBasicProductsLookupResult> {
    const checkedAt = this.now();
    const accountLabel = trimOptional(input.accountLabel);
    const comCode = input.comCode.trim();
    const userId = input.userId.trim();
    const apiCertKey = input.apiCertKey.trim();
    const lanType = trimOptional(input.lanType) ?? "ko-KR";
    const limit =
      typeof options.limit === "number" && Number.isFinite(options.limit)
        ? Math.max(1, Math.floor(options.limit))
        : null;
    const offset =
      typeof options.offset === "number" && Number.isFinite(options.offset)
        ? Math.max(0, Math.floor(options.offset))
        : 0;
    let stage: "zone" | "login" | "read" = "zone";
    let zone = trimOptional(input.zone);

    try {
      zone = await this.resolveZone(comCode, zone);
      stage = "login";
      const sessionId = await this.login({
        comCode,
        userId,
        apiCertKey,
        zone,
        lanType,
      });
      stage = "read";
      const payload = await postJson(
        this.fetchImpl,
        `https://sboapi${zone}.ecount.com/OAPI/V2/InventoryBasic/GetBasicProductsList?session_Id=${encodeURIComponent(sessionId ?? "")}`,
        {}
      );
      const code = firstDataCode(payload);
      if (code && code !== "00") {
        throw new Error(firstMessage(payload) ?? `ECOUNT read returned code ${code}.`);
      }

      const rows = extractProductRows(payload);
      const products = rows
        .map((row) => normalizeProductRecord(row))
        .filter((row): row is EcountBasicProductRecord => Boolean(row));
      const offsetProducts = offset > 0 ? products.slice(offset) : products;
      const limitedProducts = limit ? offsetProducts.slice(0, limit) : offsetProducts;

      return {
        ok: true,
        status: "connected",
        accountLabel,
        zone,
        checkedAt,
        api: "InventoryBasic/GetBasicProductsList",
        count: products.length,
        returnedCount: limitedProducts.length,
        products: limitedProducts,
        message: `ECOUNT product lookup returned ${products.length} product(s).`,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown ECOUNT error.";
      return {
        ok: false,
        status: "failed",
        accountLabel,
        zone,
        checkedAt,
        api: "InventoryBasic/GetBasicProductsList",
        count: 0,
        returnedCount: 0,
        products: [],
        message: "ECOUNT product lookup failed.",
        diagnostics: {
          stage,
          detail,
        },
      };
    }
  }

  private async resolveZone(comCode: string, zone: string | null): Promise<string> {
    if (zone) {
      return zone;
    }

    const payload = await postJson(this.fetchImpl, "https://sboapi.ecount.com/OAPI/V2/Zone", {
      COM_CODE: comCode,
    });
    const resolvedZone = firstStringAt(payload, [
      ["Data", "Datas", "ZONE"],
      ["Data", "ZONE"],
      ["data", "ZONE"],
      ["ZONE"],
    ]);
    if (!resolvedZone) {
      throw new Error(firstMessage(payload) ?? "ECOUNT zone lookup did not return ZONE.");
    }
    return resolvedZone;
  }

  private async login(input: {
    comCode: string;
    userId: string;
    apiCertKey: string;
    zone: string;
    lanType: string;
  }): Promise<string | null> {
    const payload = await postJson(
      this.fetchImpl,
      `https://sboapi${input.zone}.ecount.com/OAPI/V2/OAPILogin`,
      {
        COM_CODE: input.comCode,
        USER_ID: input.userId,
        API_CERT_KEY: input.apiCertKey,
        LAN_TYPE: input.lanType,
        ZONE: input.zone,
        ISTEST: "Y",
      }
    );
    const sessionId = firstStringAt(payload, [
      ["Data", "Datas", "SESSION_ID"],
      ["Data", "SESSION_ID"],
      ["data", "SESSION_ID"],
      ["SESSION_ID"],
    ]);
    if (!sessionId) {
      throw new Error(firstMessage(payload) ?? "ECOUNT login did not return SESSION_ID.");
    }
    return sessionId;
  }
}
