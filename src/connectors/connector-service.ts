import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  getConnectorAdapter,
  getConnectorCapabilities,
  isConnectorProviderAvailable,
  listSupportedProviders,
} from "./adapters.js";
import {
  publishBrowserDraft,
  type ConnectorBrowserDraftPublisher,
} from "./browser-draft-publisher.js";
import {
  readBrowserFollowerList,
  readBrowserProfile,
  type ConnectorBrowserFollowerListReader,
  type ConnectorBrowserProfileReader,
} from "./browser-profile-reader.js";
import {
  detectChromium,
  startHeadedLogin,
  type ConnectorAdapter,
  type ConnectorOAuthConfig,
  type ConnectorRunnerEvent,
  type ConnectorRunnerSession,
} from "./connector-runner.js";
import {
  type ChromiumChannel,
  type ConnectorAccountKind,
  type ConnectorBlockerCode,
  type ConnectorDiagnosticsRecord,
  type ConnectorExecuteCapabilityInput,
  type ConnectorExecuteCapabilityResult,
  type ConnectorReadFollowerListResult,
  type ConnectorLoginMode,
  type ConnectorOAuthCallbackInput,
  type ConnectorOAuthCallbackResult,
  type ConnectorProfileRecord,
  type ConnectorPublishDraftInput,
  type ConnectorPublishDraftResult,
  type ConnectorReadProfileResult,
  type ConnectorProvider,
  type ConnectorServiceLike,
  type ConnectorStartLoginInput,
  type ConnectorState,
  type ConnectorStatus,
  type ConnectorBrowserAccessRecord,
  type ConnectorCapabilityRecord,
  type ConnectorReadinessBlockerRecord,
  type ConnectorReadinessRecord,
} from "./connector-types.js";

export interface ConnectorServiceOptions {
  stateRoot?: string;
  now?: () => string;
  openExternalUrl?: (url: string) => Promise<unknown>;
  detectBrowser?: ConnectorBrowserDetector;
  startBrowserLogin?: ConnectorBrowserLoginStarter;
  publishBrowserDraft?: ConnectorBrowserDraftPublisher;
  readBrowserProfile?: ConnectorBrowserProfileReader;
  readBrowserFollowerList?: ConnectorBrowserFollowerListReader;
  baseEnv?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

export type ConnectorBrowserDetector = () => Promise<{
  available: boolean;
  channel: ChromiumChannel | null;
  message: string;
}>;

export type ConnectorBrowserLoginStarter = typeof startHeadedLogin;

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
const BROWSER_SESSION_FILE = "browser-session.json";
const BROWSER_PROFILE_DIR = "browser-profile";
const CONNECTOR_SECRET_KEY_FILE = "connector-secrets.key";

interface EncryptedConnectorPayload {
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface StoredOAuthTokenSecret {
  tokenPayload: Record<string, unknown>;
}

interface StoredBrowserSessionSecret {
  storageStateJson: string;
  browserProfileDir: string | null;
  browserDebuggingPort: number | null;
}

export class ConnectorService implements ConnectorServiceLike {
  private readonly stateRoot: string;
  private readonly now: () => string;
  private readonly openExternalUrl: ((url: string) => Promise<unknown>) | null;
  private readonly detectBrowser: ConnectorBrowserDetector;
  private readonly startBrowserLogin: ConnectorBrowserLoginStarter;
  private readonly publishBrowserDraft: ConnectorBrowserDraftPublisher;
  private readonly readBrowserProfile: ConnectorBrowserProfileReader;
  private readonly readBrowserFollowerList: ConnectorBrowserFollowerListReader;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly hydratePromise: Promise<void>;
  private states: Record<ConnectorProvider, ConnectorState>;
  private pendingOAuth = new Map<string, PendingOAuthSession>();
  private activeBrowserSessions = new Map<ConnectorProvider, ConnectorRunnerSession>();
  private cachedDiagnostics: ConnectorDiagnosticsRecord | null = null;
  private diagnosticsCheckedAt = 0;

  constructor(options: ConnectorServiceOptions = {}) {
    this.stateRoot = options.stateRoot ?? path.resolve(".runtime", "agent-engine");
    this.now = options.now ?? (() => new Date().toISOString());
    this.openExternalUrl = options.openExternalUrl ?? null;
    this.detectBrowser = options.detectBrowser ?? detectChromium;
    this.startBrowserLogin = options.startBrowserLogin ?? startHeadedLogin;
    this.publishBrowserDraft = options.publishBrowserDraft ?? publishBrowserDraft;
    this.readBrowserProfile = options.readBrowserProfile ?? readBrowserProfile;
    this.readBrowserFollowerList =
      options.readBrowserFollowerList ?? readBrowserFollowerList;
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

  private decorateState(provider: ConnectorProvider): ConnectorState {
    return decorateConnectorState(provider, this.states[provider], this.baseEnv);
  }

  async getState(provider: ConnectorProvider): Promise<ConnectorState> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    return this.decorateState(provider);
  }

  async startLogin(
    provider: ConnectorProvider,
    input: ConnectorStartLoginInput = {},
  ): Promise<ConnectorState> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    if (!isConnectorProviderAvailable(provider)) {
      this.transition(provider, buildPlannedStatePatch(provider));
      return this.decorateState(provider);
    }
    const adapter = getConnectorAdapter(provider);
    const oauth = adapter.oauth;

    if (adapter.browserLogin?.supported === true) {
      return this.startCustomBrowserLogin(
        provider,
        adapter,
        "브라우저 세션 기반 연동을 사용합니다.",
      );
    }

    if (oauth.supported === false) {
      return this.startCustomBrowserLogin(provider, adapter, oauth.unavailableReason);
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
        failureKind: "authentication",
      });
      return this.decorateState(provider);
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

    return this.decorateState(provider);
  }

  private async startCustomBrowserLogin(
    provider: ConnectorProvider,
    adapter: ConnectorAdapter,
    unavailableReason: string,
  ): Promise<ConnectorState> {
    if (adapter.browserLogin?.supported !== true) {
      this.transition(provider, {
        status: "failed",
        message: "공식 OAuth 연결을 지원하지 않습니다.",
        accountLabel: null,
        connectedAt: null,
        loginUrl: null,
        loginMode: null,
        lastError:
          adapter.browserLogin?.unavailableReason ??
          unavailableReason,
      });
      return this.decorateState(provider);
    }

    await this.cancelActiveBrowserSession(provider);
    const diagnostics = await this.detectBrowser();
    if (!diagnostics.available || !diagnostics.channel) {
      this.transition(provider, {
        status: "failed",
        message: "커스텀 브라우저 로그인을 시작하지 못했습니다.",
        accountLabel: null,
        connectedAt: null,
        loginUrl: null,
        loginMode: null,
        lastError: diagnostics.message,
      });
      return this.decorateState(provider);
    }

    this.transition(provider, {
      status: "connecting",
      message: `${adapter.label} 커스텀 로그인 창을 열었습니다. 로그인 완료가 감지되면 연결됩니다.`,
      accountLabel: null,
      connectedAt: null,
      loginUrl: null,
      loginMode: "custom-browser",
      lastError: null,
    });

    try {
      const browserProfileDir = this.browserProfileDir(provider);
      await mkdir(browserProfileDir, { recursive: true, mode: 0o700 });
      const session = await this.startBrowserLogin({
        adapter,
        channel: diagnostics.channel,
        userDataDir: browserProfileDir,
        onEvent: (event) => {
          void this.handleBrowserLoginEvent(provider, event);
        },
      });
      if (
        this.states[provider].status === "connecting" &&
        this.states[provider].loginMode === "custom-browser"
      ) {
        this.activeBrowserSessions.set(provider, session);
      } else {
        await session.cancel();
      }
    } catch (error) {
      this.transition(provider, {
        status: "failed",
        message: "커스텀 브라우저 로그인을 시작하지 못했습니다.",
        accountLabel: null,
        connectedAt: null,
        loginUrl: null,
        loginMode: null,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }

    return this.decorateState(provider);
  }

  async handleOAuthCallback(
    provider: ConnectorProvider,
    input: ConnectorOAuthCallbackInput,
  ): Promise<ConnectorOAuthCallbackResult> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    const adapter = getConnectorAdapter(provider);
    if (!isConnectorProviderAvailable(provider)) {
      this.transition(provider, buildPlannedStatePatch(provider));
      return {
        ok: false,
        provider,
        title: "연동 준비 중",
        message: `${adapter.label} 연동은 준비 중입니다.`,
        state: this.decorateState(provider),
      };
    }

    if (input.error) {
      const message =
        sanitizeConnectorPublicText(input.errorDescription ?? input.error) ??
        "OAuth authorization failed.";
      this.transition(provider, {
        status: "failed",
        message: "OAuth 승인이 취소되었거나 실패했습니다.",
        loginUrl: null,
        loginMode: null,
        lastError: message,
        failureKind: "authentication",
      });
      return {
        ok: false,
        provider,
        title: "OAuth 승인 실패",
        message,
        state: this.decorateState(provider),
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
        failureKind: "authentication",
      });
      return {
        ok: false,
        provider,
        title: "OAuth callback 오류",
        message,
        state: this.decorateState(provider),
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
        failureKind: "authentication",
      });
      return {
        ok: false,
        provider,
        title: "OAuth state 오류",
        message,
        state: this.decorateState(provider),
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
        state: this.decorateState(provider),
      };
    } catch (error) {
      const message =
        sanitizeConnectorPublicText(
          error instanceof Error ? error.message : String(error),
        ) ?? "OAuth token exchange failed.";
      this.transition(provider, {
        status: "failed",
        message: "OAuth 토큰 교환에 실패했습니다.",
        loginUrl: null,
        loginMode: null,
        lastError: message,
        failureKind: "authentication",
      });
      return {
        ok: false,
        provider,
        title: "OAuth 토큰 교환 실패",
        message,
        state: this.decorateState(provider),
      };
    }
  }

  async publishDraft(
    provider: ConnectorProvider,
    input: ConnectorPublishDraftInput,
  ): Promise<ConnectorPublishDraftResult> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    if (!isConnectorProviderAvailable(provider)) {
      return {
        ok: false,
        provider,
        status: "failed",
        accountLabel: null,
        url: null,
        message: `${getConnectorAdapter(provider).label} 연동은 준비 중입니다.`,
        checkedAt: this.now(),
      };
    }

    if (provider !== "tistory") {
      return {
        ok: false,
        provider,
        status: "failed",
        accountLabel: this.states[provider].accountLabel,
        url: null,
        message: "현재 커스텀 브라우저 발행은 Tistory만 지원합니다.",
        checkedAt: this.now(),
      };
    }

    const draft = normalizePublishDraftInput(input);
    if (draft.visibility !== "draft") {
      return {
        ok: false,
        provider,
        status: "failed",
        accountLabel: this.states[provider].accountLabel,
        url: null,
        message: "Tistory 자동 공개 발행은 아직 지원하지 않습니다. 임시저장만 지원합니다.",
        checkedAt: this.now(),
      };
    }

    const session = await this.readStoredBrowserSession(provider);
    if (!session) {
      return {
        ok: false,
        provider,
        status: "failed",
        accountLabel: null,
        url: null,
        message: "Tistory 커스텀 브라우저 계정 연결이 필요합니다.",
        checkedAt: this.now(),
      };
    }

    const diagnostics = await this.detectBrowser();
    if (!diagnostics.available || !diagnostics.channel) {
      return {
        ok: false,
        provider,
        status: "failed",
        accountLabel: session.accountLabel,
        url: null,
        message: sanitizeConnectorPublicText(diagnostics.message) ?? "",
        checkedAt: this.now(),
      };
    }

    try {
      const result = await this.publishBrowserDraft({
        provider,
        accountLabel: session.accountLabel,
        storageStateJson: session.storageStateJson,
        browserProfileDir: session.browserProfileDir,
        browserDebuggingPort: session.browserDebuggingPort,
        draft,
        channel: diagnostics.channel,
        now: this.now,
      });
      if (!result.ok && isInvalidBrowserSessionMessage(result.message)) {
        await this.removeStorage(provider);
        this.transition(provider, {
          status: "failed",
          message: "커스텀 브라우저 계정 연동을 다시 진행해 주세요.",
          accountLabel: null,
          connectedAt: null,
          loginUrl: null,
          loginMode: null,
          lastError: result.message,
          failureKind: "authentication",
        });
      }
      return sanitizeConnectorPublishDraftResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isInvalidBrowserSessionMessage(message)) {
        await this.removeStorage(provider);
        this.transition(provider, {
          status: "failed",
          message: "커스텀 브라우저 계정 연동을 다시 진행해 주세요.",
          accountLabel: null,
          connectedAt: null,
          loginUrl: null,
          loginMode: null,
          lastError: message,
          failureKind: "authentication",
        });
      }
      return {
        ok: false,
        provider,
        status: "failed",
        accountLabel: session.accountLabel,
        url: null,
        message: sanitizeConnectorPublicText(message) ?? "",
        checkedAt: this.now(),
      };
    }
  }

  async executeCapability(
    provider: ConnectorProvider,
    input: ConnectorExecuteCapabilityInput,
  ): Promise<ConnectorExecuteCapabilityResult> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    const adapter = getConnectorAdapter(provider);
    const capabilityId = input.capabilityId.trim();
    if (!isConnectorProviderAvailable(provider)) {
      return {
        ok: false,
        provider,
        capabilityId,
        action: null,
        status: "unsupported",
        resultType: "none",
        accountLabel: null,
        profile: null,
        followers: null,
        draft: null,
        message: `${adapter.label} 연동은 준비 중입니다.`,
        checkedAt: this.now(),
      };
    }
    const readiness = buildConnectorReadiness(
      provider,
      this.states[provider],
      this.baseEnv,
    );
    const capability = getConnectorExecutionCapabilities(provider, readiness).find(
      (record) => record.id === capabilityId,
    );
    const checkedAt = this.now();

    if (!capability) {
      return {
        ok: false,
        provider,
        capabilityId,
        action: null,
        status: "unsupported",
        resultType: "none",
        accountLabel: this.states[provider].accountLabel,
        profile: null,
        followers: null,
        draft: null,
        message: `${adapter.label}에서 지원하지 않는 capability입니다: ${capabilityId}`,
        checkedAt,
      };
    }

    if (capability.status === "blocked") {
      return {
        ok: false,
        provider,
        capabilityId,
        action: capability.action,
        status: "failed",
        resultType: "none",
        accountLabel:
          readInstagramAccountLabel(this.baseEnv) ??
          this.states[provider].accountLabel,
        profile: null,
        followers: null,
        draft: null,
        setupMode: capability.setupMode,
        blockerCodes: capability.blockerCodes ?? [],
        setupSteps:
          capability.setupSteps ??
          (capability.blockers ?? []).map((blocker) => blocker.nextAction),
        message: formatCapabilityBlockers(capability),
        checkedAt,
      };
    }

    if (capability.status === "planned") {
      return {
        ok: false,
        provider,
        capabilityId,
        action: capability.action,
        status: "unsupported",
        resultType: "none",
        accountLabel:
          readInstagramAccountLabel(this.baseEnv) ??
          this.states[provider].accountLabel,
        profile: null,
        followers: null,
        draft: null,
        setupMode: capability.setupMode,
        blockerCodes: capability.blockerCodes ?? [],
        setupSteps:
          capability.setupSteps ??
          (capability.blockers ?? []).map((blocker) => blocker.nextAction),
        message: formatCapabilityBlockers(capability),
        checkedAt,
      };
    }

    if (
      capability.id === "instagram.account.read" ||
      capability.id === "instagram.automation.prepare"
    ) {
      return {
        ok: true,
        provider,
        capabilityId,
        action: capability.action,
        status: "completed",
        resultType: "none",
        accountLabel:
          readInstagramAccountLabel(this.baseEnv) ??
          this.states[provider].accountLabel,
        profile: null,
        followers: null,
        draft: null,
        setupMode: readiness.setupMode,
        blockerCodes: readiness.blockers.map((blocker) => blocker.code),
        setupSteps: readiness.blockers.map((blocker) => blocker.nextAction),
        message:
          `${capability.id} Instagram Graph API readiness is available; ` +
          `accountKind=${readiness.accountKind ?? "unknown"}.`,
        checkedAt,
      };
    }

    if (capability.requiresApproval || capability.action === "write") {
      const setupSteps =
        capability.setupSteps ??
        (capability.blockers ?? []).map((blocker) => blocker.nextAction);
      return {
        ok: false,
        provider,
        capabilityId,
        action: capability.action,
        status: "requires-approval",
        resultType: "none",
        accountLabel: this.states[provider].accountLabel,
        profile: null,
        followers: null,
        draft: null,
        setupMode: capability.setupMode,
        blockerCodes: capability.blockerCodes ?? [],
        setupSteps,
        message:
          `${capability.label} capability requires preview and explicit user approval before execution.`,
        checkedAt,
      };
    }

    if (/\.account\.read$/u.test(capability.id)) {
      const state = this.decorateState(provider);
      const ok = state.status === "connected";
      return {
        ok,
        provider,
        capabilityId,
        action: capability.action,
        status: ok ? "completed" : "failed",
        resultType: "none",
        accountLabel: state.accountLabel,
        profile: null,
        followers: null,
        draft: null,
        message: ok
          ? `${adapter.label} connected account is available for automation.`
          : `${adapter.label} account connection is required before automation.`,
        checkedAt,
      };
    }

    if (capability.id === "threads.automation.prepare") {
      const result = await this.readProfile(provider);
      return {
        ok: result.ok,
        provider,
        capabilityId,
        action: capability.action,
        status: result.ok ? "completed" : "failed",
        resultType: "profile",
        accountLabel: result.accountLabel,
        profile: result.profile,
        followers: null,
        draft: null,
        message: result.ok
          ? "Threads automation readiness validated with the connected account."
          : result.message,
        checkedAt: result.checkedAt,
      };
    }

    if (/\.(?:account|profile)\.read$/u.test(capability.id)) {
      const result = await this.readProfile(provider);
      return {
        ok: result.ok,
        provider,
        capabilityId,
        action: capability.action,
        status: result.ok ? "completed" : "failed",
        resultType: "profile",
        accountLabel: result.accountLabel,
        profile: result.profile,
        followers: null,
        draft: null,
        message: result.message,
        checkedAt: result.checkedAt,
      };
    }

    if (capability.id === "threads.followers.read") {
      const limit = readPositiveInteger(input.args?.limit);
      const result = await this.readFollowerList(provider, {
        limit,
      });
      return {
        ok: result.ok,
        provider,
        capabilityId,
        action: capability.action,
        status: result.ok ? "completed" : "failed",
        resultType: "followers",
        accountLabel: result.accountLabel,
        profile: null,
        followers: result.followers,
        draft: null,
        message: result.message,
        checkedAt: result.checkedAt,
      };
    }

    return {
      ok: false,
      provider,
      capabilityId,
      action: capability.action,
      status: "unsupported",
      resultType: "none",
      accountLabel: this.states[provider].accountLabel,
      profile: null,
      followers: null,
      draft: null,
      message: `${capability.label} capability 실행 핸들러가 아직 준비되지 않았습니다.`,
      checkedAt,
    };
  }

  private async prepareInstagramAutomation(
    capabilityId: string,
    action: ConnectorCapabilityRecord["action"],
  ): Promise<ConnectorExecuteCapabilityResult> {
    const provider: ConnectorProvider = "instagram";
    const adapter = getConnectorAdapter(provider);
    const checkedAt = this.now();
    const state = this.states[provider];
    const base = {
      provider,
      capabilityId,
      action,
      resultType: "none" as const,
      profile: null,
      followers: null,
      draft: null,
      checkedAt,
    };

    if (state.status !== "connected") {
      return {
        ...base,
        ok: false,
        status: "failed",
        accountLabel: state.accountLabel,
        message: `${adapter.label} account connection is required before automation can run.`,
      };
    }

    const session = await this.readStoredBrowserSession(provider);
    if (!session || !hasInstagramSessionCookie(session.storageStateJson)) {
      await this.removeStorage(provider);
      this.transition(provider, {
        status: "failed",
        message: "Instagram browser session is missing or expired. Reconnect the account.",
        accountLabel: null,
        connectedAt: null,
        loginUrl: null,
        loginMode: null,
        lastError: "Instagram browser session is missing or expired.",
        failureKind: "authentication",
      });
      return {
        ...base,
        ok: false,
        status: "failed",
        accountLabel: state.accountLabel,
        message: "Instagram browser session is missing or expired. Reconnect the account.",
      };
    }

    const diagnostics = await this.detectBrowser().catch((error) => ({
      available: false,
      channel: null,
      message: error instanceof Error ? error.message : String(error),
    }));
    if (!diagnostics.available || !diagnostics.channel) {
      return {
        ...base,
        ok: false,
        status: "failed",
        accountLabel: session.accountLabel,
        message:
          sanitizeConnectorPublicText(
            `Instagram browser automation is unavailable: ${diagnostics.message}`,
          ) ?? "Instagram browser automation is unavailable.",
      };
    }

    const readiness = buildConnectorReadiness(provider, state, this.baseEnv);
    const availableCapabilities = getConnectorExecutionCapabilities(
      provider,
      readiness,
    )
      .filter((record) => record.status === undefined || record.status === "available")
      .map((record) => record.id)
      .sort();
    return {
      ...base,
      ok: true,
      status: "completed",
      accountLabel: session.accountLabel,
      message:
        `Instagram automation readiness verified for ${session.accountLabel}. ` +
        `loginMode=custom-browser; browser=${diagnostics.channel}; ` +
        `capabilities=${availableCapabilities.join(", ")}`,
    };
  }

  async readProfile(provider: ConnectorProvider): Promise<ConnectorReadProfileResult> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    const adapter = getConnectorAdapter(provider);
    const checkedAt = this.now();
    if (!isConnectorProviderAvailable(provider)) {
      return {
        ok: false,
        provider,
        status: "failed",
        accountLabel: null,
        profile: null,
        message: `${adapter.label} 연동은 준비 중입니다.`,
        checkedAt,
      };
    }

    const oauth = adapter.oauth;
    if (oauth.supported === true && oauth.userInfo) {
      const oauthSession = await this.readStoredOAuthToken(provider);
      if (oauthSession) {
        const payload = await this.fetchOAuthUserInfo(oauth, oauthSession.tokenPayload);
        if (payload) {
          return {
            ok: true,
            provider,
            status: "profile-read",
            accountLabel: oauthSession.accountLabel,
            profile: profileFromOAuthPayload(provider, payload, oauthSession.accountLabel),
            message: `${adapter.label} OAuth 프로필을 조회했습니다.`,
            checkedAt,
          };
        }
      }
    }

    const session = await this.readStoredBrowserSession(provider);
    if (!session) {
      return {
        ok: false,
        provider,
        status: "failed",
        accountLabel: this.states[provider].accountLabel,
        profile: null,
        message: `${adapter.label} 연결 세션이 필요합니다.`,
        checkedAt,
      };
    }

    const diagnostics = await this.detectBrowser();
    if (!diagnostics.available || !diagnostics.channel) {
      return {
        ok: false,
        provider,
        status: "failed",
        accountLabel: session.accountLabel,
        profile: null,
        message: sanitizeConnectorPublicText(diagnostics.message) ?? "",
        checkedAt: this.now(),
      };
    }

    try {
      const result = await this.readBrowserProfile({
        provider,
        accountLabel: session.accountLabel,
        storageStateJson: session.storageStateJson,
        browserProfileDir: session.browserProfileDir,
        browserDebuggingPort: session.browserDebuggingPort,
        channel: diagnostics.channel,
        now: this.now,
      });
      if (!result.ok && isInvalidBrowserSessionMessage(result.message)) {
        await this.removeStorage(provider);
        this.transition(provider, {
          status: "failed",
          message: "커스텀 브라우저 계정 연동을 다시 진행해 주세요.",
          accountLabel: null,
          connectedAt: null,
          loginUrl: null,
          loginMode: null,
          lastError: result.message,
          failureKind: "authentication",
        });
      }
      return sanitizeConnectorReadProfileResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isInvalidBrowserSessionMessage(message)) {
        await this.removeStorage(provider);
        this.transition(provider, {
          status: "failed",
          message: "커스텀 브라우저 계정 연동을 다시 진행해 주세요.",
          accountLabel: null,
          connectedAt: null,
          loginUrl: null,
          loginMode: null,
          lastError: message,
          failureKind: "authentication",
        });
      }
      return {
        ok: false,
        provider,
        status: "failed",
        accountLabel: session.accountLabel,
        profile: null,
        message: sanitizeConnectorPublicText(message) ?? "",
        checkedAt: this.now(),
      };
    }
  }

  async readFollowerList(
    provider: ConnectorProvider,
    input: { limit?: number | null } = {},
  ): Promise<ConnectorReadFollowerListResult> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    const adapter = getConnectorAdapter(provider);
    const checkedAt = this.now();
    if (!isConnectorProviderAvailable(provider)) {
      return {
        ok: false,
        provider,
        status: "failed",
        accountLabel: null,
        followers: null,
        message: `${adapter.label} 연동은 준비 중입니다.`,
        checkedAt,
      };
    }
    const session = await this.readStoredBrowserSession(provider);
    if (!session) {
      return {
        ok: false,
        provider,
        status: "failed",
        accountLabel: this.states[provider].accountLabel,
        followers: null,
        message: `${adapter.label} 연결 세션이 필요합니다.`,
        checkedAt,
      };
    }

    const diagnostics = await this.detectBrowser();
    if (!diagnostics.available || !diagnostics.channel) {
      return {
        ok: false,
        provider,
        status: "failed",
        accountLabel: session.accountLabel,
        followers: null,
        message: sanitizeConnectorPublicText(diagnostics.message) ?? "",
        checkedAt: this.now(),
      };
    }

    try {
      const result = await this.readBrowserFollowerList({
        provider,
        accountLabel: session.accountLabel,
        storageStateJson: session.storageStateJson,
        browserProfileDir: session.browserProfileDir,
        browserDebuggingPort: session.browserDebuggingPort,
        channel: diagnostics.channel,
        limit: input.limit,
        now: this.now,
      });
      if (!result.ok && isInvalidBrowserSessionMessage(result.message)) {
        await this.removeStorage(provider);
        this.transition(provider, {
          status: "failed",
          message: "커스텀 브라우저 계정 연동을 다시 진행해 주세요.",
          accountLabel: null,
          connectedAt: null,
          loginUrl: null,
          loginMode: null,
          lastError: result.message,
          failureKind: "authentication",
        });
      }
      return sanitizeConnectorReadFollowerListResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isInvalidBrowserSessionMessage(message)) {
        await this.removeStorage(provider);
        this.transition(provider, {
          status: "failed",
          message: "커스텀 브라우저 계정 연동을 다시 진행해 주세요.",
          accountLabel: null,
          connectedAt: null,
          loginUrl: null,
          loginMode: null,
          lastError: message,
          failureKind: "authentication",
        });
      }
      return {
        ok: false,
        provider,
        status: "failed",
        accountLabel: session.accountLabel,
        followers: null,
        message: sanitizeConnectorPublicText(message) ?? "",
        checkedAt: this.now(),
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
    await this.cancelActiveBrowserSession(provider);
    if (this.states[provider].status === "connecting") {
      this.transition(provider, {
        status: "idle",
        message: "연동을 취소했어요.",
        loginUrl: null,
        loginMode: null,
        lastError: null,
      });
    }
    return this.decorateState(provider);
  }

  async disconnect(provider: ConnectorProvider): Promise<ConnectorState> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    await this.cancelActiveBrowserSession(provider);
    await this.removeStorage(provider);
    if (!isConnectorProviderAvailable(provider)) {
      this.transition(provider, buildPlannedStatePatch(provider));
      return this.decorateState(provider);
    }
    this.transition(provider, {
      status: "idle",
      message: "연결이 해제되었습니다.",
      accountLabel: null,
      connectedAt: null,
      loginUrl: null,
      loginMode: null,
      lastError: null,
    });
    return this.decorateState(provider);
  }

  async getDiagnostics(): Promise<ConnectorDiagnosticsRecord> {
    const now = Date.now();
    if (
      this.cachedDiagnostics &&
      now - this.diagnosticsCheckedAt < DIAGNOSTICS_TTL_MS
    ) {
      return { ...this.cachedDiagnostics };
    }
    const browserDiagnostics = await this.detectBrowser().catch((error) => ({
      available: false,
      channel: null,
      message: error instanceof Error ? error.message : String(error),
    }));
    const record: ConnectorDiagnosticsRecord = {
      available: true,
      channel: browserDiagnostics.channel,
      message: browserDiagnostics.available
        ? `공식 OAuth 및 커스텀 브라우저 로그인 사용 (${browserDiagnostics.message})`
        : `공식 OAuth 사용 가능, 커스텀 브라우저 로그인 준비 필요: ${browserDiagnostics.message}`,
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

  private async cancelActiveBrowserSession(
    provider: ConnectorProvider,
  ): Promise<void> {
    const session = this.activeBrowserSessions.get(provider);
    if (!session) return;
    this.activeBrowserSessions.delete(provider);
    try {
      await session.cancel();
    } catch {
      // The browser may already be closed.
    }
  }

  private async readStoredBrowserSession(
    provider: ConnectorProvider,
  ): Promise<{
    accountLabel: string;
    connectedAt: string;
    storageStateJson: string;
    browserProfileDir: string | null;
    browserDebuggingPort: number | null;
  } | null> {
    const browserSessionPath = path.join(
      this.providerDir(provider),
      BROWSER_SESSION_FILE,
    );
    try {
      const raw = await readFile(browserSessionPath, "utf8");
      return await this.parseStoredBrowserSession(raw, provider);
    } catch {
      return null;
    }
  }

  private async readStoredOAuthToken(
    provider: ConnectorProvider,
  ): Promise<{
    accountLabel: string;
    connectedAt: string;
    tokenPayload: Record<string, unknown>;
    scopes: string[];
  } | null> {
    const tokenPath = path.join(this.providerDir(provider), OAUTH_TOKEN_FILE);
    try {
      const raw = await readFile(tokenPath, "utf8");
      return await this.parseStoredOAuthToken(raw, provider);
    } catch {
      return null;
    }
  }

  private async handleBrowserLoginEvent(
    provider: ConnectorProvider,
    event: ConnectorRunnerEvent,
  ): Promise<void> {
    this.activeBrowserSessions.delete(provider);
    const current = this.states[provider];
    if (
      current.status !== "connecting" ||
      current.loginMode !== "custom-browser"
    ) {
      return;
    }

    if (event.kind === "failed") {
      this.transition(provider, {
        status: "failed",
        message: "커스텀 브라우저 로그인에 실패했습니다.",
        loginUrl: null,
        loginMode: null,
        lastError: event.message,
        failureKind: "authentication",
      });
      return;
    }

    const connectedAt = this.now();
    try {
      await this.persistBrowserSession(provider, {
        provider,
        accountLabel: event.accountLabel,
        connectedAt,
        storageStateJson: event.storageStateJson,
        browserProfileDir: event.browserProfileDir ?? this.browserProfileDir(provider),
        browserDebuggingPort: event.browserDebuggingPort ?? null,
      });
      this.transition(provider, {
        status: "connected",
        message: "커스텀 브라우저 계정 연동이 완료되었습니다.",
        accountLabel: event.accountLabel,
        connectedAt,
        loginUrl: null,
        loginMode: "custom-browser",
        lastError: null,
      });
    } catch (error) {
      this.transition(provider, {
        status: "failed",
        message: "커스텀 브라우저 세션을 저장하지 못했습니다.",
        loginUrl: null,
        loginMode: null,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async hydrateFromDisk(): Promise<void> {
    for (const provider of listSupportedProviders()) {
      if (!isConnectorProviderAvailable(provider)) {
        continue;
      }
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

      const browserSessionPath = path.join(
        this.providerDir(provider),
        BROWSER_SESSION_FILE,
      );
      try {
        const raw = await readFile(browserSessionPath, "utf8");
        const stored = parseStoredBrowserConnectionMetadata(raw, provider);
        if (stored) {
          this.transition(provider, {
            status: "connected",
            message: "이전 커스텀 브라우저 계정 연동 상태가 복원되었습니다.",
            accountLabel: stored.accountLabel,
            connectedAt: stored.connectedAt,
            loginUrl: null,
            loginMode: "custom-browser",
            lastError: null,
          });
          continue;
        }
      } catch {
        // No stored custom browser session for this provider.
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

  private browserProfileDir(provider: ConnectorProvider): string {
    return path.join(this.providerDir(provider), BROWSER_PROFILE_DIR);
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
    const payload = await this.fetchOAuthUserInfo(config, tokenPayload);
    if (!payload) return null;
    return readStringPath(payload, config.userInfo?.labelPath ?? []);
  }

  private async fetchOAuthUserInfo(
    config: Extract<ConnectorOAuthConfig, { supported: true }>,
    tokenPayload: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
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
      return payload;
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
    const stored = {
      version: 2,
      provider: payload.provider,
      accountLabel: payload.accountLabel,
      connectedAt: payload.connectedAt,
      scopes: payload.scopes,
      secret: await this.encryptConnectorSecret<StoredOAuthTokenSecret>({
        tokenPayload: payload.tokenPayload,
      }),
    };
    await writeFile(
      path.join(dir, OAUTH_TOKEN_FILE),
      `${JSON.stringify(stored, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  }

  private async persistBrowserSession(
    provider: ConnectorProvider,
    payload: {
      provider: ConnectorProvider;
      accountLabel: string;
      connectedAt: string;
      storageStateJson: string;
      browserProfileDir: string | null;
      browserDebuggingPort: number | null;
    },
  ): Promise<void> {
    const dir = this.providerDir(provider);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const stored = {
      version: 2,
      provider: payload.provider,
      accountLabel: payload.accountLabel,
      connectedAt: payload.connectedAt,
      secret: await this.encryptConnectorSecret<StoredBrowserSessionSecret>({
        storageStateJson: payload.storageStateJson,
        browserProfileDir: payload.browserProfileDir,
        browserDebuggingPort: payload.browserDebuggingPort,
      }),
    };
    await writeFile(
      path.join(dir, BROWSER_SESSION_FILE),
      `${JSON.stringify(stored, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  }

  private async parseStoredOAuthToken(
    raw: string,
    provider: ConnectorProvider,
  ): Promise<{
    accountLabel: string;
    connectedAt: string;
    tokenPayload: Record<string, unknown>;
    scopes: string[];
  } | null> {
    const parsed = parseStoredJson(raw);
    if (!parsed) return null;
    if (isEncryptedStoredConnectorRecord(parsed, provider)) {
      const secret = await this.decryptConnectorSecret<StoredOAuthTokenSecret>(
        parsed.secret,
      );
      if (
        !secret.tokenPayload ||
        typeof secret.tokenPayload !== "object" ||
        Array.isArray(secret.tokenPayload)
      ) {
        return null;
      }
      return {
        accountLabel: parsed.accountLabel,
        connectedAt: parsed.connectedAt,
        tokenPayload: secret.tokenPayload,
        scopes: Array.isArray(parsed.scopes)
          ? parsed.scopes.filter((scope): scope is string => typeof scope === "string")
          : [],
      };
    }
    return parseLegacyStoredOAuthToken(parsed, provider);
  }

  private async parseStoredBrowserSession(
    raw: string,
    provider: ConnectorProvider,
  ): Promise<{
    accountLabel: string;
    connectedAt: string;
    storageStateJson: string;
    browserProfileDir: string | null;
    browserDebuggingPort: number | null;
  } | null> {
    const parsed = parseStoredJson(raw);
    if (!parsed) return null;
    if (isEncryptedStoredConnectorRecord(parsed, provider)) {
      const secret =
        await this.decryptConnectorSecret<StoredBrowserSessionSecret>(
          parsed.secret,
        );
      if (typeof secret.storageStateJson !== "string") {
        return null;
      }
      return {
        accountLabel: parsed.accountLabel,
        connectedAt: parsed.connectedAt,
        storageStateJson: secret.storageStateJson,
        browserProfileDir: readOptionalString(secret.browserProfileDir),
        browserDebuggingPort: readPort(secret.browserDebuggingPort),
      };
    }
    return parseLegacyStoredBrowserConnection(parsed, provider);
  }

  private async encryptConnectorSecret<T>(secret: T): Promise<EncryptedConnectorPayload> {
    const key = await this.readOrCreateConnectorSecretKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(secret), "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return {
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }

  private async decryptConnectorSecret<T>(
    payload: EncryptedConnectorPayload,
  ): Promise<T> {
    const key = await this.readOrCreateConnectorSecretKey();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(payload.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as T;
  }

  private async readOrCreateConnectorSecretKey(): Promise<Buffer> {
    const dir = path.join(this.stateRoot, "connectors");
    const keyPath = path.join(dir, CONNECTOR_SECRET_KEY_FILE);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      return Buffer.from((await readFile(keyPath, "utf8")).trim(), "base64");
    } catch {
      const key = randomBytes(32);
      await writeFile(keyPath, key.toString("base64"), {
        encoding: "utf8",
        mode: 0o600,
      });
      return key;
    }
  }

  private transition(
    provider: ConnectorProvider,
    patch: Partial<Omit<ConnectorState, "provider" | "updatedAt">> & {
      status: ConnectorStatus;
    },
  ): void {
    const prev = this.states[provider];
    const failureKind =
      patch.status === "failed"
        ? patch.failureKind ?? prev.failureKind ?? "platform"
        : null;
    this.states[provider] = {
      ...prev,
      ...patch,
      provider,
      failureKind,
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
  if (!isConnectorProviderAvailable(provider)) {
    return {
      provider,
      ...buildPlannedStatePatch(provider),
      browserAccess: buildBrowserAccess(provider, "planned", null),
      capabilities: [],
      readiness: emptyConnectorReadiness(),
      updatedAt: now,
    };
  }

  return {
    provider,
    status: "idle",
    message: "연동되지 않음",
    accountLabel: null,
    connectedAt: null,
    loginUrl: null,
    loginMode: null,
    lastError: null,
    failureKind: null,
    browserAccess: buildBrowserAccess(provider, "idle", null),
    capabilities: [],
    readiness: emptyConnectorReadiness(),
    updatedAt: now,
  };
}

function buildPlannedStatePatch(
  provider: ConnectorProvider,
): Omit<
  ConnectorState,
  "provider" | "updatedAt" | "browserAccess" | "capabilities" | "readiness"
> {
  const adapter = getConnectorAdapter(provider);
  return {
    status: "planned",
    message: `${adapter.label} 연동은 준비 중입니다.`,
    accountLabel: null,
    connectedAt: null,
    loginUrl: null,
    loginMode: null,
    lastError: null,
    failureKind: null,
  };
}

function decorateConnectorState(
  provider: ConnectorProvider,
  state: ConnectorState,
  baseEnv: NodeJS.ProcessEnv,
): ConnectorState {
  const readiness = buildConnectorReadiness(provider, state, baseEnv);
  const graphConnected =
    provider === "instagram" &&
    readiness.setupMode === "graph-api" &&
    readiness.blockers.length === 0 &&
    state.status !== "connected";
  const decoratedState = graphConnected
    ? {
        ...state,
        status: "connected" as const,
        message: "Instagram Graph API account settings are available.",
        accountLabel: readInstagramAccountLabel(baseEnv),
        loginMode: "oauth" as const,
        lastError: null,
        failureKind: null,
      }
    : state;
  return {
    ...decoratedState,
    message: sanitizeConnectorPublicText(decoratedState.message) ?? "",
    lastError: sanitizeConnectorPublicText(decoratedState.lastError),
    browserAccess: buildBrowserAccess(
      provider,
      decoratedState.status,
      decoratedState.loginMode,
      readiness,
    ),
    capabilities: getConnectorExecutionCapabilities(provider, readiness),
    readiness,
  };
}

function emptyConnectorReadiness(): ConnectorReadinessRecord {
  return {
    setupMode: null,
    accountKind: null,
    browserSessionPurpose: null,
    blockers: [],
  };
}

function buildConnectorReadiness(
  provider: ConnectorProvider,
  _state: ConnectorState,
  baseEnv: NodeJS.ProcessEnv,
): ConnectorReadinessRecord {
  if (provider !== "instagram") {
    return emptyConnectorReadiness();
  }
  return buildInstagramGraphReadiness(baseEnv);
}

function buildInstagramGraphReadiness(
  baseEnv: NodeJS.ProcessEnv,
): ConnectorReadinessRecord {
  const accountKind = readInstagramAccountKind(
    readEnvAny(baseEnv, [
      "ROCKY_INSTAGRAM_ACCOUNT_KIND",
      "ROCKY_CONNECTOR_INSTAGRAM_ACCOUNT_KIND",
      "INSTAGRAM_ACCOUNT_KIND",
    ]),
  );
  const permissions = readPermissionSet(
    readEnvAny(baseEnv, [
      "ROCKY_INSTAGRAM_PERMISSIONS",
      "ROCKY_CONNECTOR_INSTAGRAM_GRAPH_PERMISSIONS",
      "ROCKY_CONNECTOR_INSTAGRAM_PERMISSIONS",
      "INSTAGRAM_GRAPH_PERMISSIONS",
      "INSTAGRAM_PERMISSIONS",
    ]),
  );
  const hasAccessToken = Boolean(
    readEnvAny(baseEnv, [
      "ROCKY_INSTAGRAM_ACCESS_TOKEN",
      "ROCKY_CONNECTOR_INSTAGRAM_GRAPH_ACCESS_TOKEN",
      "ROCKY_CONNECTOR_INSTAGRAM_ACCESS_TOKEN",
      "INSTAGRAM_GRAPH_ACCESS_TOKEN",
      "INSTAGRAM_ACCESS_TOKEN",
    ]),
  );
  const hasBusinessAccountId = Boolean(
    readEnvAny(baseEnv, [
      "ROCKY_INSTAGRAM_BUSINESS_ACCOUNT_ID",
      "ROCKY_CONNECTOR_INSTAGRAM_BUSINESS_ACCOUNT_ID",
      "ROCKY_CONNECTOR_INSTAGRAM_ACCOUNT_ID",
      "INSTAGRAM_BUSINESS_ACCOUNT_ID",
      "INSTAGRAM_ACCOUNT_ID",
    ]),
  );
  const hasFacebookPage = Boolean(
    readEnvAny(baseEnv, [
      "ROCKY_INSTAGRAM_FACEBOOK_PAGE_ID",
      "ROCKY_CONNECTOR_INSTAGRAM_FACEBOOK_PAGE_ID",
      "INSTAGRAM_FACEBOOK_PAGE_ID",
    ]),
  );
  const hasMetaBusiness = Boolean(
    readEnvAny(baseEnv, [
      "ROCKY_INSTAGRAM_META_BUSINESS_ID",
      "ROCKY_CONNECTOR_INSTAGRAM_META_BUSINESS_ID",
      "INSTAGRAM_META_BUSINESS_ID",
    ]),
  );
  const hasMetaApp = Boolean(
    readEnvAny(baseEnv, [
      "ROCKY_INSTAGRAM_META_APP_ID",
      "ROCKY_CONNECTOR_INSTAGRAM_META_APP_ID",
      "INSTAGRAM_META_APP_ID",
      "INSTAGRAM_CLIENT_ID",
    ]),
  );

  const blockers: ConnectorReadinessBlockerRecord[] = [];
  if (
    accountKind === "unknown" ||
    accountKind === "personal"
  ) {
    blockers.push(
      readinessBlocker(
        "professional_account_required",
        "Instagram Graph API execution requires a Professional Business or Creator account.",
        "Switch the Instagram account to Business or Creator before enabling execution capabilities.",
      ),
    );
  }
  if (!hasFacebookPage) {
    blockers.push(
      readinessBlocker(
        "facebook_page_required",
        "A connected Facebook Page is required for Instagram Graph API access.",
        "Connect the Instagram Professional account to a Facebook Page in Meta settings.",
      ),
    );
  }
  if (!hasMetaBusiness) {
    blockers.push(
      readinessBlocker(
        "meta_business_setup_required",
        "Meta Business setup has not been confirmed.",
        "Add the Instagram account and Page to Meta Business, then expose the business id to Rocky.",
      ),
    );
  }
  if (!hasMetaApp) {
    blockers.push(
      readinessBlocker(
        "meta_app_required",
        "A Meta app id is required before Rocky can verify Graph API readiness.",
        "Create or connect a Meta app and provide its app id through the Rocky Instagram connector environment.",
      ),
    );
  }
  if (!hasAccessToken) {
    blockers.push(
      readinessBlocker(
        "access_token_missing",
        "No Instagram Graph API access token is configured.",
        "Generate a Graph API token with the required Instagram permissions and connect it to Rocky.",
      ),
    );
  }
  if (!hasBusinessAccountId) {
    blockers.push(
      readinessBlocker(
        "instagram_business_account_id_missing",
        "No Instagram Business Account ID is configured.",
        "Resolve the Instagram Business Account ID from the connected Page and provide it to Rocky.",
      ),
    );
  }
  const missingPermissions = hasAccessToken
    ? missingInstagramBasePermissions(permissions)
    : [];
  if (missingPermissions.length > 0) {
    blockers.push(
      readinessBlocker(
        "permission_missing",
        `Missing required Instagram Graph API permissions: ${missingPermissions.join(", ")}.`,
        "Grant the missing permissions to the token, then refresh the Rocky connector environment.",
      ),
    );
  }

  return {
    setupMode: "graph-api",
    accountKind,
    browserSessionPurpose: "readiness_check",
    blockers,
  };
}

function readinessBlocker(
  code: ConnectorBlockerCode,
  message: string,
  nextAction: string,
): ConnectorReadinessBlockerRecord {
  return { code, message, nextAction };
}

function readInstagramAccountKind(value: string | null): ConnectorAccountKind {
  if (
    value === "personal" ||
    value === "professional_business" ||
    value === "professional_creator"
  ) {
    return value;
  }
  return "unknown";
}

function readPermissionSet(raw: string | null): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[,\s]+/u)
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

function missingInstagramBasePermissions(permissions: Set<string>): string[] {
  return ["instagram_basic", "pages_show_list"].filter(
    (permission) => !permissions.has(permission),
  );
}

function getConnectorExecutionCapabilities(
  provider: ConnectorProvider,
  readiness?: ConnectorReadinessRecord,
): ConnectorCapabilityRecord[] {
  const resolvedReadiness =
    readiness ??
    (provider === "instagram"
      ? buildInstagramGraphReadiness({})
      : emptyConnectorReadiness());
  const byId = new Map<string, ConnectorCapabilityRecord>();
  const baseCapabilities =
    provider === "instagram"
      ? getInstagramGraphApiCapabilities(resolvedReadiness)
      : getConnectorCapabilities(provider);
  for (const capability of [
    ...baseCapabilities,
    ...getConnectorSkillBridgeCapabilities(provider, resolvedReadiness),
  ]) {
    byId.set(capability.id, capability);
  }
  return [...byId.values()];
}

function getInstagramGraphApiCapabilities(
  readiness: ConnectorReadinessRecord,
): ConnectorCapabilityRecord[] {
  const graphBlockers = readiness.blockers;
  const graphStatus = graphBlockers.length === 0 ? "available" : "blocked";
  return [
    instagramCapability({
      id: "instagram.account.read",
      label: "Account read",
      description:
        "Verify the configured Instagram Business Account ID and Graph API account readiness.",
      action: "read",
      requiresApproval: false,
      status: graphStatus,
      blockers: graphBlockers,
    }),
    instagramCapability({
      id: "instagram.media.prepare",
      label: "Media preparation",
      description:
        "Prepare Instagram media work only after Graph API account and token readiness are confirmed.",
      action: "write",
      requiresApproval: true,
      status: graphStatus,
      blockers: graphBlockers,
    }),
    instagramCapability({
      id: "instagram.media.publish",
      label: "Media publish",
      description:
        "Publish approved Instagram media through the Graph API after preview and explicit approval.",
      action: "write",
      requiresApproval: true,
      status: graphStatus,
      blockers: graphBlockers,
    }),
    instagramCapability({
      id: "instagram.media.status.read",
      label: "Media status read",
      description:
        "Read Instagram media publishing status through the Graph API.",
      action: "read",
      requiresApproval: false,
      status: graphStatus,
      blockers: graphBlockers,
    }),
    instagramCapability({
      id: "instagram.insights.read",
      label: "Insights read",
      description:
        "Read Instagram account and media insights through approved Graph API permissions.",
      action: "read",
      requiresApproval: false,
      status: graphStatus,
      blockers: graphBlockers,
    }),
  ];
}

function instagramCapability(input: {
  id: string;
  label: string;
  description: string;
  action: ConnectorCapabilityRecord["action"];
  requiresApproval: boolean;
  status: NonNullable<ConnectorCapabilityRecord["status"]>;
  blockers: ConnectorReadinessBlockerRecord[];
}): ConnectorCapabilityRecord {
  return {
    id: input.id,
    provider: "instagram",
    label: input.label,
    description: input.description,
    action: input.action,
    requiresBrowser: false,
    requiresConnectedAccount: true,
    requiresApproval: input.requiresApproval,
    status: input.status,
    source: "backend",
    setupMode: "graph-api",
    blockerCodes: input.blockers.map((blocker) => blocker.code),
    blockers: input.blockers,
  };
}

function formatCapabilityBlockers(capability: ConnectorCapabilityRecord): string {
  const blockers = capability.blockers ?? [];
  if (blockers.length === 0) {
    return capability.status === "planned"
      ? `${capability.label} is planned and is not executable yet.`
      : `${capability.label} is not executable in the current connector state.`;
  }
  const message = blockers
    .map((blocker) => `${blocker.code}: ${blocker.nextAction}`)
    .join(" ");
  return capability.provider === "instagram"
    ? `Instagram Graph API setup blocked. ${message}`
    : message;
}

function getConnectorSkillBridgeCapabilities(
  provider: ConnectorProvider,
  readiness: ConnectorReadinessRecord = emptyConnectorReadiness(),
): ConnectorCapabilityRecord[] {
  if (provider === "threads") {
    return [
      {
        id: "threads.automation.prepare",
        provider,
        label: "Automation readiness check",
        description:
          "Validate the connected Threads account and expose safe profile metadata before AI automation runs.",
        action: "read",
        requiresBrowser: true,
        requiresConnectedAccount: true,
        requiresApproval: false,
        status: "available",
        source: "backend",
      },
      {
        id: "threads.profile.read",
        provider,
        label: "프로필 조회",
        description: "Rocky가 보관한 Threads 브라우저 세션으로 현재 계정 프로필을 읽습니다.",
        action: "read",
        requiresBrowser: true,
        requiresConnectedAccount: true,
        requiresApproval: false,
        status: "available",
        source: "backend",
      },
      {
        id: "threads.followers.read",
        provider,
        label: "팔로워 목록 조회",
        description: "Rocky가 보관한 Threads 브라우저 세션으로 팔로워 화면의 이름 목록을 읽습니다.",
        action: "read",
        requiresBrowser: true,
        requiresConnectedAccount: true,
        requiresApproval: false,
        status: "available",
        source: "backend",
      },
    ];
  }

  if (provider === "facebook") {
    return [
      {
        id: "facebook.profile.read",
        provider,
        label: "Facebook profile read",
        description:
          "Rocky reads the current Facebook account profile from the connected browser session.",
        action: "read",
        requiresBrowser: true,
        requiresConnectedAccount: true,
        requiresApproval: false,
        status: "available",
        source: "backend",
      },
    ];
  }

  if (provider === "instagram") {
    const graphBlockers = readiness.blockers;
    const graphStatus = graphBlockers.length === 0 ? "available" : "blocked";
    return [
      instagramCapability({
        id: "instagram.automation.prepare",
        label: "Instagram Graph API readiness",
        description:
          "Check whether Instagram native capabilities can run through Graph API credentials.",
        action: "read",
        requiresApproval: false,
        status: graphStatus,
        blockers: graphBlockers,
      }),
    ];
  }

  return [];
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(1, Math.trunc(value));
}

function hasInstagramSessionCookie(storageStateJson: string): boolean {
  try {
    const parsed = JSON.parse(storageStateJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    const cookies = (parsed as { cookies?: unknown }).cookies;
    if (!Array.isArray(cookies)) {
      return false;
    }
    return cookies.some((cookie) => {
      if (!cookie || typeof cookie !== "object" || Array.isArray(cookie)) {
        return false;
      }
      const record = cookie as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "";
      const value = typeof record.value === "string" ? record.value : "";
      const domain = typeof record.domain === "string" ? record.domain : "";
      return (
        name === "sessionid" &&
        value.length > 0 &&
        (!domain || domain.includes("instagram"))
      );
    });
  } catch {
    return false;
  }
}

function buildBrowserAccess(
  provider: ConnectorProvider,
  status: ConnectorStatus,
  loginMode: ConnectorLoginMode | null,
  readiness: ConnectorReadinessRecord = emptyConnectorReadiness(),
): ConnectorBrowserAccessRecord {
  const adapter = getConnectorAdapter(provider);
  if (!isConnectorProviderAvailable(provider)) {
    return {
      status: "unavailable",
      policy: null,
      readAllowed: false,
      writeAllowedAfterApproval: false,
      message: `${adapter.label} 연동은 준비 중입니다.`,
    };
  }

  if (provider === "instagram") {
    if (readiness.blockers.length === 0) {
      return {
        status: "not-applicable",
        policy: null,
        readAllowed: true,
        writeAllowedAfterApproval: true,
        message: "Instagram Graph API credentials are used for native capabilities.",
      };
    }

    if (status === "connected" && loginMode === "custom-browser") {
      return {
        status: "granted",
        policy: "persistent",
        readAllowed: true,
        writeAllowedAfterApproval: false,
        message:
          "Instagram browser login is available only for manual assist and readiness checks; Graph API credentials are required for execution.",
      };
    }

    if (status === "failed") {
      return {
        status: "unavailable",
        policy: "persistent",
        readAllowed: false,
        writeAllowedAfterApproval: false,
        message:
          "Reconnect the Instagram browser check if manual assist is needed; it is not used as a Graph API execution credential.",
      };
    }

    return {
      status: "needs-login",
      policy: "persistent",
      readAllowed: false,
      writeAllowedAfterApproval: false,
      message:
        readiness.blockers.length > 0
          ? "Graph API setup is blocked; browser login can only assist manual readiness checks."
          : "Graph API setup is ready; browser login remains limited to manual assist and readiness checks.",
    };
  }

  if (adapter.browserLogin?.supported !== true) {
    return {
      status: "not-applicable",
      policy: null,
      readAllowed: true,
      writeAllowedAfterApproval: false,
      message: "브라우저 화면 권한이 필요하지 않은 연동입니다.",
    };
  }

  if (status === "connected" && loginMode === "custom-browser") {
    return {
      status: "granted",
      policy: "persistent",
      readAllowed: true,
      writeAllowedAfterApproval: true,
      message: "지속 브라우저 화면 권한이 허용되어 있습니다.",
    };
  }

  if (status === "failed") {
    return {
      status: "unavailable",
      policy: "persistent",
      readAllowed: false,
      writeAllowedAfterApproval: false,
      message: "브라우저 연동을 다시 연결해야 합니다.",
    };
  }

  return {
    status: "needs-login",
    policy: "persistent",
    readAllowed: false,
    writeAllowedAfterApproval: false,
    message: "브라우저 연동 로그인이 필요합니다.",
  };
}

function isInvalidBrowserSessionMessage(message: string): boolean {
  return (
    /로그인 세션이 (?:유효하지|만료)|관리 가능한 블로그를 찾지 못했습니다/u.test(
      message,
    ) || /login session expired|reconnect the account integration/iu.test(message)
  );
}

function sanitizeConnectorPublicText(value: string | null): string | null {
  if (value === null) return null;
  return value
    .replace(
      /([?&](?:access_token|refresh_token|id_token|auth_token|session_id|SESSION_ID|api_cert_key|API_CERT_KEY)=)[^&\s]+/giu,
      "$1[redacted]",
    )
    .replace(
      /("(?:(?:access|refresh|id|auth)_token|sessionid|session_id|storageStateJson|cookies?|localStorage|sessionStorage)"\s*:\s*)("[^"]*"|[^,}\]]+)/giu,
      '$1"[redacted]"',
    )
    .replace(/"value"\s*:\s*"[^"]*"/giu, '"value":"[redacted]"')
    .replace(
      /\b(sessionid|auth_token|access_token|refresh_token|id_token)\s*=\s*[^;\s]+/giu,
      "$1=[redacted]",
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu, "$1 [redacted]")
    .replace(/\bCookie\s*:\s*[^\r\n]+/giu, "Cookie: [redacted]")
    .replace(
      /(?:[A-Za-z]:)?[\\/][^\s"'<>]*connectors[\\/][^\s"'<>]+[\\/]browser-profile[^\s"'<>]*/giu,
      "[redacted connector browser profile path]",
    )
    .replace(
      /\bstorageStateJson\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "storageStateJson=[redacted]",
    );
}

function sanitizeConnectorPublishDraftResult(
  result: ConnectorPublishDraftResult,
): ConnectorPublishDraftResult {
  return {
    ...result,
    url: sanitizeConnectorPublicText(result.url),
    message: sanitizeConnectorPublicText(result.message) ?? "",
  };
}

function sanitizeConnectorReadProfileResult(
  result: ConnectorReadProfileResult,
): ConnectorReadProfileResult {
  return {
    ...result,
    message: sanitizeConnectorPublicText(result.message) ?? "",
  };
}

function sanitizeConnectorReadFollowerListResult(
  result: ConnectorReadFollowerListResult,
): ConnectorReadFollowerListResult {
  return {
    ...result,
    message: sanitizeConnectorPublicText(result.message) ?? "",
  };
}

function normalizePublishDraftInput(
  input: ConnectorPublishDraftInput,
): Required<ConnectorPublishDraftInput> {
  const title = input.title.trim();
  const contentMarkdown = input.contentMarkdown.trim();
  if (!title) {
    throw Object.assign(new Error("Tistory 발행 제목이 필요합니다."), {
      statusCode: 400,
    });
  }
  if (!contentMarkdown) {
    throw Object.assign(new Error("Tistory 발행 본문이 필요합니다."), {
      statusCode: 400,
    });
  }

  return {
    title,
    contentMarkdown,
    tags: (input.tags ?? [])
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0),
    visibility: input.visibility ?? "draft",
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

function readEnvAny(env: NodeJS.ProcessEnv, keys: string[]): string | null {
  for (const key of keys) {
    const value = readEnv(env, key);
    if (value) {
      return value;
    }
  }
  return null;
}

function readInstagramAccountLabel(env: NodeJS.ProcessEnv): string | null {
  const explicitLabel = readEnvAny(env, [
    "ROCKY_INSTAGRAM_ACCOUNT_LABEL",
    "ROCKY_CONNECTOR_INSTAGRAM_ACCOUNT_LABEL",
    "INSTAGRAM_ACCOUNT_LABEL",
  ]);
  if (explicitLabel) {
    return explicitLabel;
  }
  const accountId = readEnvAny(env, [
    "ROCKY_INSTAGRAM_BUSINESS_ACCOUNT_ID",
    "ROCKY_CONNECTOR_INSTAGRAM_BUSINESS_ACCOUNT_ID",
    "ROCKY_CONNECTOR_INSTAGRAM_ACCOUNT_ID",
    "INSTAGRAM_BUSINESS_ACCOUNT_ID",
    "INSTAGRAM_ACCOUNT_ID",
  ]);
  return accountId ? `Instagram Graph account ${accountId}` : null;
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

function profileFromOAuthPayload(
  provider: ConnectorProvider,
  payload: Record<string, unknown>,
  accountLabel: string,
): ConnectorProfileRecord {
  const username =
    readString(payload.username) ??
    readStringPath(payload, ["data", "username"]) ??
    readStringPath(payload, ["data", "user", "display_name"]);
  const displayName =
    readString(payload.name) ??
    readString(payload.display_name) ??
    readStringPath(payload, ["data", "user", "display_name"]) ??
    username ??
    accountLabel;
  const id =
    readString(payload.id) ??
    readString(payload.open_id) ??
    readStringPath(payload, ["data", "user", "open_id"]);

  return {
    id,
    username,
    displayName,
    bio: readString(payload.biography) ?? readString(payload.bio),
    followersText: null,
    url:
      provider === "threads" && username
        ? `https://www.threads.net/@${username.replace(/^@/u, "")}`
        : null,
    rawText: null,
  };
}

function parseStoredJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isEncryptedStoredConnectorRecord(
  parsed: Record<string, unknown>,
  provider: ConnectorProvider,
): parsed is {
  provider: ConnectorProvider;
  accountLabel: string;
  connectedAt: string;
  scopes?: unknown;
  secret: EncryptedConnectorPayload;
} {
  return (
    parsed.version === 2 &&
    parsed.provider === provider &&
    typeof parsed.accountLabel === "string" &&
    typeof parsed.connectedAt === "string" &&
    isEncryptedConnectorPayload(parsed.secret)
  );
}

function isEncryptedConnectorPayload(value: unknown): value is EncryptedConnectorPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.algorithm === "aes-256-gcm" &&
    typeof record.iv === "string" &&
    typeof record.authTag === "string" &&
    typeof record.ciphertext === "string"
  );
}

function parseLegacyStoredOAuthToken(
  parsed: Record<string, unknown>,
  provider: ConnectorProvider,
): {
  accountLabel: string;
  connectedAt: string;
  tokenPayload: Record<string, unknown>;
  scopes: string[];
} | null {
  if (
    parsed.provider !== provider ||
    typeof parsed.accountLabel !== "string" ||
    typeof parsed.connectedAt !== "string" ||
    !parsed.tokenPayload ||
    typeof parsed.tokenPayload !== "object" ||
    Array.isArray(parsed.tokenPayload)
  ) {
    return null;
  }
  return {
    accountLabel: parsed.accountLabel,
    connectedAt: parsed.connectedAt,
    tokenPayload: parsed.tokenPayload as Record<string, unknown>,
    scopes: Array.isArray(parsed.scopes)
      ? parsed.scopes.filter((scope): scope is string => typeof scope === "string")
      : [],
  };
}

function parseStoredOAuthConnection(
  raw: string,
  provider: ConnectorProvider,
): { accountLabel: string; connectedAt: string } | null {
  const parsed = parseStoredJson(raw);
  if (
    !parsed ||
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
}

function parseStoredBrowserConnectionMetadata(
  raw: string,
  provider: ConnectorProvider,
): { accountLabel: string; connectedAt: string } | null {
  const parsed = parseStoredJson(raw);
  if (
    !parsed ||
    parsed.provider !== provider ||
    typeof parsed.accountLabel !== "string" ||
    typeof parsed.connectedAt !== "string"
  ) {
    return null;
  }
  if (parsed.version === 2 && !isEncryptedConnectorPayload(parsed.secret)) {
    return null;
  }
  return {
    accountLabel: parsed.accountLabel,
    connectedAt: parsed.connectedAt,
  };
}

function parseLegacyStoredBrowserConnection(
  parsed: Record<string, unknown>,
  provider: ConnectorProvider,
): {
  accountLabel: string;
  connectedAt: string;
  storageStateJson: string;
  browserProfileDir: string | null;
  browserDebuggingPort: number | null;
} | null {
  if (
    parsed.provider !== provider ||
    typeof parsed.accountLabel !== "string" ||
    typeof parsed.connectedAt !== "string" ||
    typeof parsed.storageStateJson !== "string"
  ) {
    return null;
  }
  return {
    accountLabel: parsed.accountLabel,
    connectedAt: parsed.connectedAt,
    storageStateJson: parsed.storageStateJson,
    browserProfileDir: readOptionalString(parsed.browserProfileDir),
    browserDebuggingPort: readPort(parsed.browserDebuggingPort),
  };
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readPort(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 65_535
    ? value
    : null;
}

// Re-export channel type for callers that need to inspect diagnostics.
export type { ChromiumChannel, ConnectorLoginMode };
