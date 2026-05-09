import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getConnectorAdapter, listSupportedProviders } from "./adapters.js";
import type { ConnectorOAuthConfig } from "./connector-runner.js";
import {
  type ChromiumChannel,
  type ConnectorDiagnosticsRecord,
  type ConnectorLoginMode,
  type ConnectorOAuthCallbackInput,
  type ConnectorOAuthCallbackResult,
  type ConnectorProvider,
  type ConnectorServiceLike,
  type ConnectorStartLoginInput,
  type ConnectorState,
  type ConnectorStatus,
} from "./connector-types.js";

export interface ConnectorServiceOptions {
  stateRoot?: string;
  now?: () => string;
  openExternalUrl?: (url: string) => Promise<unknown>;
  baseEnv?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface PendingOAuthSession {
  provider: ConnectorProvider;
  config: Extract<ConnectorOAuthConfig, { supported: true }>;
  credentials: OAuthCredentials;
  state: string;
  codeVerifier: string | null;
  createdAt: string;
}

const DIAGNOSTICS_TTL_MS = 60_000;
const LEGACY_STORAGE_FILE = "storage.json";
const OAUTH_TOKEN_FILE = "oauth-token.json";

export class ConnectorService implements ConnectorServiceLike {
  private readonly stateRoot: string;
  private readonly now: () => string;
  private readonly openExternalUrl: ((url: string) => Promise<unknown>) | null;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly hydratePromise: Promise<void>;
  private states: Record<ConnectorProvider, ConnectorState>;
  private pendingOAuth = new Map<string, PendingOAuthSession>();
  private cachedDiagnostics: ConnectorDiagnosticsRecord | null = null;
  private diagnosticsCheckedAt = 0;

  constructor(options: ConnectorServiceOptions = {}) {
    this.stateRoot = options.stateRoot ?? path.resolve(".runtime", "agent-engine");
    this.now = options.now ?? (() => new Date().toISOString());
    this.openExternalUrl = options.openExternalUrl ?? null;
    this.baseEnv = options.baseEnv ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.states = listSupportedProviders().reduce(
      (acc, provider) => {
        acc[provider] = buildIdleState(provider, this.now());
        return acc;
      },
      {} as Record<ConnectorProvider, ConnectorState>,
    );
    this.hydratePromise = this.hydrateFromDisk();
  }

  async getState(provider: ConnectorProvider): Promise<ConnectorState> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    return { ...this.states[provider] };
  }

  async startLogin(
    provider: ConnectorProvider,
    input: ConnectorStartLoginInput = {},
  ): Promise<ConnectorState> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    const adapter = getConnectorAdapter(provider);
    const oauth = adapter.oauth;

    if (oauth.supported === false) {
      this.transition(provider, {
        status: "failed",
        message: "공식 OAuth 연결을 지원하지 않습니다.",
        accountLabel: null,
        connectedAt: null,
        loginUrl: null,
        loginMode: null,
        lastError: oauth.unavailableReason,
      });
      return { ...this.states[provider] };
    }

    const credentials = this.resolveOAuthCredentials(
      provider,
      oauth,
      input.redirectBaseUrl ?? null,
    );
    if (credentials.ok === false) {
      this.transition(provider, {
        status: "failed",
        message: `${adapter.label} OAuth 앱 설정이 필요합니다.`,
        accountLabel: null,
        connectedAt: null,
        loginUrl: null,
        loginMode: null,
        lastError: credentials.message,
      });
      return { ...this.states[provider] };
    }

    const state = randomUrlSafe(32);
    const codeVerifier = oauth.pkce ? randomUrlSafe(64) : null;
    const loginUrl = buildAuthorizationUrl({
      config: oauth,
      credentials: credentials.value,
      state,
      codeChallenge: codeVerifier ? pkceChallenge(codeVerifier) : null,
    });

    this.pendingOAuth.set(state, {
      provider,
      config: oauth,
      credentials: credentials.value,
      state,
      codeVerifier,
      createdAt: this.now(),
    });

    let openError: string | null = this.openExternalUrl
      ? null
      : "기본 브라우저 자동 열기를 사용할 수 없는 환경입니다.";
    if (this.openExternalUrl) {
      try {
        await this.openExternalUrl(loginUrl);
      } catch (error) {
        openError = error instanceof Error ? error.message : String(error);
      }
    }

    this.transition(provider, {
      status: "connecting",
      message: openError
        ? `${adapter.label} OAuth 승인 페이지를 아래 버튼으로 열어 주세요.`
        : `${adapter.label} OAuth 승인 페이지를 일반 브라우저에서 열었습니다.`,
      accountLabel: null,
      connectedAt: null,
      loginUrl,
      loginMode: "oauth",
      lastError: openError,
    });

    return { ...this.states[provider] };
  }

  async handleOAuthCallback(
    provider: ConnectorProvider,
    input: ConnectorOAuthCallbackInput,
  ): Promise<ConnectorOAuthCallbackResult> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    const adapter = getConnectorAdapter(provider);

    if (input.error) {
      const message = input.errorDescription ?? input.error;
      this.transition(provider, {
        status: "failed",
        message: "OAuth 승인이 취소되었거나 실패했습니다.",
        loginUrl: null,
        loginMode: null,
        lastError: message,
      });
      return {
        ok: false,
        provider,
        title: "OAuth 승인 실패",
        message,
        state: { ...this.states[provider] },
      };
    }

    if (!input.state || !input.code) {
      const message = "OAuth callback에 code 또는 state가 없습니다.";
      this.transition(provider, {
        status: "failed",
        message: "OAuth callback을 처리하지 못했습니다.",
        loginUrl: null,
        loginMode: null,
        lastError: message,
      });
      return {
        ok: false,
        provider,
        title: "OAuth callback 오류",
        message,
        state: { ...this.states[provider] },
      };
    }

    const pending = this.pendingOAuth.get(input.state);
    if (!pending || pending.provider !== provider) {
      const message = "OAuth state가 일치하지 않거나 만료되었습니다. 다시 시도해 주세요.";
      this.transition(provider, {
        status: "failed",
        message: "OAuth state 검증에 실패했습니다.",
        loginUrl: null,
        loginMode: null,
        lastError: message,
      });
      return {
        ok: false,
        provider,
        title: "OAuth state 오류",
        message,
        state: { ...this.states[provider] },
      };
    }

    this.pendingOAuth.delete(input.state);

    try {
      const tokenPayload = await this.exchangeOAuthCode(pending, input.code);
      const accountLabel =
        (await this.fetchAccountLabel(pending.config, tokenPayload)) ??
        `${adapter.label} 계정`;
      const connectedAt = this.now();
      await this.persistOAuthToken(provider, {
        provider,
        accountLabel,
        connectedAt,
        tokenPayload,
        scopes: pending.config.scopes,
      });
      this.transition(provider, {
        status: "connected",
        message: "OAuth 연동이 완료되었습니다.",
        accountLabel,
        connectedAt,
        loginUrl: null,
        loginMode: "oauth",
        lastError: null,
      });
      return {
        ok: true,
        provider,
        title: "OAuth 연동 완료",
        message: `${accountLabel} 연결을 확인했습니다. 이 창은 닫아도 됩니다.`,
        state: { ...this.states[provider] },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.transition(provider, {
        status: "failed",
        message: "OAuth 토큰 교환에 실패했습니다.",
        loginUrl: null,
        loginMode: null,
        lastError: message,
      });
      return {
        ok: false,
        provider,
        title: "OAuth 토큰 교환 실패",
        message,
        state: { ...this.states[provider] },
      };
    }
  }

  async cancelLogin(provider: ConnectorProvider): Promise<ConnectorState> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    for (const [state, pending] of this.pendingOAuth.entries()) {
      if (pending.provider === provider) {
        this.pendingOAuth.delete(state);
      }
    }
    if (this.states[provider].status === "connecting") {
      this.transition(provider, {
        status: "idle",
        message: "연동을 취소했어요.",
        loginUrl: null,
        loginMode: null,
        lastError: null,
      });
    }
    return { ...this.states[provider] };
  }

  async disconnect(provider: ConnectorProvider): Promise<ConnectorState> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    await this.removeStorage(provider);
    this.transition(provider, {
      status: "idle",
      message: "연결이 해제되었습니다.",
      accountLabel: null,
      connectedAt: null,
      loginUrl: null,
      loginMode: null,
      lastError: null,
    });
    return { ...this.states[provider] };
  }

  async getDiagnostics(): Promise<ConnectorDiagnosticsRecord> {
    const now = Date.now();
    if (
      this.cachedDiagnostics &&
      now - this.diagnosticsCheckedAt < DIAGNOSTICS_TTL_MS
    ) {
      return { ...this.cachedDiagnostics };
    }
    const record: ConnectorDiagnosticsRecord = {
      available: true,
      channel: null,
      message: "공식 OAuth 로그인 사용",
      checkedAt: this.now(),
    };
    this.cachedDiagnostics = record;
    this.diagnosticsCheckedAt = now;
    return { ...record };
  }

  private async removeStorage(provider: ConnectorProvider): Promise<void> {
    const dir = this.providerDir(provider);
    await rm(dir, { recursive: true, force: true });
  }

  private async hydrateFromDisk(): Promise<void> {
    for (const provider of listSupportedProviders()) {
      const oauthPath = path.join(this.providerDir(provider), OAUTH_TOKEN_FILE);
      try {
        const raw = await readFile(oauthPath, "utf8");
        const stored = parseStoredOAuthConnection(raw, provider);
        if (stored) {
          this.transition(provider, {
            status: "connected",
            message: "이전 OAuth 연동 상태가 복원되었습니다.",
            accountLabel: stored.accountLabel,
            connectedAt: stored.connectedAt,
            loginUrl: null,
            loginMode: "oauth",
            lastError: null,
          });
          continue;
        }
      } catch {
        // No stored OAuth token for this provider.
      }

      const storagePath = path.join(this.providerDir(provider), LEGACY_STORAGE_FILE);
      try {
        const raw = await readFile(storagePath, "utf8");
        if (raw.trim()) {
          this.transition(provider, {
            status: "connected",
            message: "이전 세션이 복원되었습니다.",
            loginUrl: null,
            loginMode: "managed-browser",
            lastError: null,
          });
        }
      } catch {
        // No stored session for this provider.
      }
    }
  }

  private async ensureHydrated(): Promise<void> {
    await this.hydratePromise;
  }

  private providerDir(provider: ConnectorProvider): string {
    return path.join(this.stateRoot, "connectors", provider);
  }

  private resolveOAuthCredentials(
    provider: ConnectorProvider,
    config: Extract<ConnectorOAuthConfig, { supported: true }>,
    redirectBaseUrl: string | null,
  ):
    | { ok: true; value: OAuthCredentials }
    | { ok: false; message: string } {
    const prefix = `ROCKY_CONNECTOR_${config.envPrefix}`;
    const clientId =
      readEnv(this.baseEnv, `${prefix}_CLIENT_ID`) ??
      readEnv(this.baseEnv, `${prefix}_CLIENT_KEY`);
    const clientSecret = readEnv(this.baseEnv, `${prefix}_CLIENT_SECRET`);
    const redirectUri =
      readEnv(this.baseEnv, `${prefix}_REDIRECT_URI`) ??
      buildRedirectUri(
        readEnv(this.baseEnv, "ROCKY_CONNECTOR_OAUTH_BASE_URL") ??
          redirectBaseUrl ??
          "http://127.0.0.1:3000",
        provider,
      );

    const missing: string[] = [];
    if (!clientId) missing.push(`${prefix}_CLIENT_ID`);
    if (!clientSecret) missing.push(`${prefix}_CLIENT_SECRET`);
    if (!redirectUri) missing.push(`${prefix}_REDIRECT_URI`);
    if (missing.length > 0) {
      return {
        ok: false,
        message: `누락된 환경변수: ${missing.join(", ")}`,
      };
    }

    return {
      ok: true,
      value: {
        clientId,
        clientSecret,
        redirectUri,
      },
    };
  }

  private async exchangeOAuthCode(
    pending: PendingOAuthSession,
    code: string,
  ): Promise<Record<string, unknown>> {
    const { config, credentials } = pending;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: credentials.redirectUri,
    });
    const clientIdParam = config.tokenClientIdParam ?? "client_id";
    const clientSecretParam = config.tokenClientSecretParam ?? "client_secret";
    body.set(clientIdParam, credentials.clientId);
    if (config.tokenAuth !== "basic") {
      body.set(clientSecretParam, credentials.clientSecret);
    }
    if (pending.codeVerifier) {
      body.set("code_verifier", pending.codeVerifier);
    }
    if (config.includeStateInToken) {
      body.set("state", pending.state);
    }
    for (const [key, value] of Object.entries(config.extraTokenParams ?? {})) {
      body.set(key, value);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };
    if (config.tokenAuth === "basic") {
      headers.Authorization = `Basic ${Buffer.from(
        `${credentials.clientId}:${credentials.clientSecret}`,
      ).toString("base64")}`;
    }

    const response = await this.fetchImpl(config.tokenUrl, {
      method: "POST",
      headers,
      body,
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(formatOAuthError(payload, response.status));
    }
    if (!readToken(payload)) {
      throw new Error("OAuth token 응답에 access_token 또는 id_token이 없습니다.");
    }
    return payload;
  }

  private async fetchAccountLabel(
    config: Extract<ConnectorOAuthConfig, { supported: true }>,
    tokenPayload: Record<string, unknown>,
  ): Promise<string | null> {
    if (!config.userInfo) return null;
    const accessToken = readAccessToken(tokenPayload);
    if (!accessToken) return null;

    const url = new URL(config.userInfo.url);
    for (const [key, value] of Object.entries(config.userInfo.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if ((config.userInfo.request ?? "bearer") === "query-access-token") {
      url.searchParams.set("access_token", accessToken);
    } else {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    try {
      const response = await this.fetchImpl(url, { headers });
      const payload = await readJsonResponse(response);
      if (!response.ok) return null;
      return readStringPath(payload, config.userInfo.labelPath ?? []);
    } catch {
      return null;
    }
  }

  private async persistOAuthToken(
    provider: ConnectorProvider,
    payload: {
      provider: ConnectorProvider;
      accountLabel: string;
      connectedAt: string;
      tokenPayload: Record<string, unknown>;
      scopes: string[];
    },
  ): Promise<void> {
    const dir = this.providerDir(provider);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(dir, OAUTH_TOKEN_FILE),
      `${JSON.stringify(payload, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  }

  private transition(
    provider: ConnectorProvider,
    patch: Partial<Omit<ConnectorState, "provider" | "updatedAt">> & {
      status: ConnectorStatus;
    },
  ): void {
    const prev = this.states[provider];
    this.states[provider] = {
      ...prev,
      ...patch,
      provider,
      updatedAt: this.now(),
    };
  }

  private assertSupported(provider: ConnectorProvider): void {
    if (!listSupportedProviders().includes(provider)) {
      throw Object.assign(new Error(`지원하지 않는 커넥터입니다: ${provider}`), {
        statusCode: 400,
      });
    }
  }
}

function buildIdleState(provider: ConnectorProvider, now: string): ConnectorState {
  return {
    provider,
    status: "idle",
    message: "연동되지 않음",
    accountLabel: null,
    connectedAt: null,
    loginUrl: null,
    loginMode: null,
    lastError: null,
    updatedAt: now,
  };
}

function buildAuthorizationUrl(input: {
  config: Extract<ConnectorOAuthConfig, { supported: true }>;
  credentials: OAuthCredentials;
  state: string;
  codeChallenge: string | null;
}): string {
  const url = new URL(input.config.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    input.config.authClientIdParam ?? "client_id",
    input.credentials.clientId,
  );
  url.searchParams.set("redirect_uri", input.credentials.redirectUri);
  url.searchParams.set("state", input.state);
  if (input.config.scopes.length > 0) {
    url.searchParams.set(
      "scope",
      input.config.scopes.join(input.config.scopeSeparator ?? " "),
    );
  }
  if (input.codeChallenge) {
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [key, value] of Object.entries(input.config.extraAuthParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function buildRedirectUri(baseUrl: string, provider: ConnectorProvider): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/connectors/${encodeURIComponent(provider)}/oauth/callback`;
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function randomUrlSafe(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function formatOAuthError(payload: Record<string, unknown>, status: number): string {
  const error = payload.error;
  const description =
    typeof payload.error_description === "string"
      ? payload.error_description
      : typeof payload.error_message === "string"
        ? payload.error_message
        : typeof payload.message === "string"
          ? payload.message
          : null;
  if (description) return description;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const nested = (error as { message?: unknown }).message;
    if (typeof nested === "string") return nested;
  }
  return `OAuth token endpoint returned HTTP ${status}`;
}

function readToken(payload: Record<string, unknown>): string | null {
  return readAccessToken(payload) ?? readString(payload.id_token);
}

function readAccessToken(payload: Record<string, unknown>): string | null {
  return readString(payload.access_token);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readStringPath(payload: unknown, pathSegments: string[]): string | null {
  let current = payload;
  for (const segment of pathSegments) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return readString(current);
}

function parseStoredOAuthConnection(
  raw: string,
  provider: ConnectorProvider,
): { accountLabel: string; connectedAt: string } | null {
  try {
    const parsed = JSON.parse(raw) as {
      provider?: unknown;
      accountLabel?: unknown;
      connectedAt?: unknown;
    };
    if (
      parsed.provider !== provider ||
      typeof parsed.accountLabel !== "string" ||
      typeof parsed.connectedAt !== "string"
    ) {
      return null;
    }
    return {
      accountLabel: parsed.accountLabel,
      connectedAt: parsed.connectedAt,
    };
  } catch {
    return null;
  }
}

// Re-export channel type for callers that need to inspect diagnostics.
export type { ChromiumChannel, ConnectorLoginMode };
