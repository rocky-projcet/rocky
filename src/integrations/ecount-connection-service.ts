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
