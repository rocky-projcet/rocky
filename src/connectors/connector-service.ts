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
  chromeAssistPlannedResult,
  normalizeInstagramFeedScreenInput,
  screenInstagramFeedWithPlaywright,
  type InstagramFeedScreener,
} from "./instagram-feed-screener.js";
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
  type ConnectorEntitlementRecord,
  type ConnectorReadFollowerListResult,
  type ConnectorLoginMode,
  type ConnectorBrokerRedeemInput,
  type ConnectorBrokerRedeemResult,
  type ConnectorBrokerStartInput,
  type ConnectorBrokerStartResult,
  type ConnectorBrokerCallbackResult,
  type ConnectorOAuthCallbackInput,
  type ConnectorOAuthCallbackResult,
  type ConnectorOAuthSettingsInput,
  type ConnectorOAuthSettingsRecord,
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
  type ConnectorGraphDiscoveryCandidateRecord,
  type ConnectorGraphDiscoveryRecord,
  type ConnectorGraphConnectionRecord,
  type ConnectorTesterRequestInput,
  type ConnectorTesterRequestRecord,
  type ConnectorTesterRequestStatus,
  type ConnectorTokenMetadataRecord,
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
  screenInstagramFeed?: InstagramFeedScreener;
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

type PendingOAuthPurpose = "oauth-login" | "instagram-graph-discovery";

interface PendingOAuthSession {
  provider: ConnectorProvider;
  config: Extract<ConnectorOAuthConfig, { supported: true }>;
  credentials: OAuthCredentials;
  state: string;
  codeVerifier: string | null;
  createdAt: string;
  purpose: PendingOAuthPurpose;
}

interface PendingBrokerOAuthSession extends PendingOAuthSession {
  returnUrl: string;
}

interface BrokerHandoffSession {
  provider: ConnectorProvider;
  tokenPayload: Record<string, unknown>;
  createdAt: string;
}

const DIAGNOSTICS_TTL_MS = 60_000;
const LEGACY_STORAGE_FILE = "storage.json";
const OAUTH_TOKEN_FILE = "oauth-token.json";
const OAUTH_SETTINGS_FILE = "oauth-settings.json";
const BROWSER_SESSION_FILE = "browser-session.json";
const TESTER_REQUEST_FILE = "tester-request.json";
const BROWSER_PROFILE_DIR = "browser-profile";
const CONNECTOR_SECRET_KEY_FILE = "connector-secrets.key";
const INSTAGRAM_TOKEN_REFRESH_LEEWAY_MS = 7 * 24 * 60 * 60 * 1000;
const INSTAGRAM_BROKER_SESSION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_INSTAGRAM_OAUTH_BROKER_BASE_URL = "https://connect.blip.rocks";
const INSTAGRAM_GRAPH_OAUTH_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
];

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

interface StoredOAuthSettingsSecret {
  clientId: string;
  clientSecret: string;
}

interface StoredConnectorOAuthSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string | null;
  updatedAt: string;
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
  private readonly screenInstagramFeed: InstagramFeedScreener;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly hydratePromise: Promise<void>;
  private states: Record<ConnectorProvider, ConnectorState>;
  private oauthSettings = new Map<ConnectorProvider, StoredConnectorOAuthSettings>();
  private pendingOAuth = new Map<string, PendingOAuthSession>();
  private pendingBrokerOAuth = new Map<string, PendingBrokerOAuthSession>();
  private brokerHandoffs = new Map<string, BrokerHandoffSession>();
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
    this.screenInstagramFeed =
      options.screenInstagramFeed ?? screenInstagramFeedWithPlaywright;
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
    return decorateConnectorState(
      provider,
      this.states[provider],
      this.baseEnv,
      this.oauthSettings.get(provider) ?? null,
      this.now(),
    );
  }

  async getState(provider: ConnectorProvider): Promise<ConnectorState> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    await this.refreshInstagramOAuthTokenIfNeeded(provider);
    return this.decorateState(provider);
  }

  async getOAuthSettings(
    provider: ConnectorProvider,
  ): Promise<ConnectorOAuthSettingsRecord> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    this.assertOAuthSettingsSupported(provider);
    return this.buildPublicOAuthSettings(provider);
  }

  async saveOAuthSettings(
    provider: ConnectorProvider,
    input: ConnectorOAuthSettingsInput,
  ): Promise<ConnectorOAuthSettingsRecord> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    this.assertOAuthSettingsSupported(provider);
    const settings = normalizeOAuthSettingsInput(input, this.now());
    await this.persistOAuthSettings(provider, settings);
    this.oauthSettings.set(provider, settings);
    return this.buildPublicOAuthSettings(provider);
  }

  async deleteOAuthSettings(
    provider: ConnectorProvider,
  ): Promise<ConnectorOAuthSettingsRecord> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    this.assertOAuthSettingsSupported(provider);
    this.oauthSettings.delete(provider);
    await rm(path.join(this.providerDir(provider), OAUTH_SETTINGS_FILE), {
      force: true,
    });
    return this.buildPublicOAuthSettings(provider);
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
      purpose: "oauth-login",
    });

    const shouldOpenExternal = input.openExternal !== false;
    let openError: string | null =
      shouldOpenExternal && !this.openExternalUrl
        ? "기본 브라우저 자동 열기를 사용할 수 없는 환경입니다."
        : null;
    if (shouldOpenExternal && this.openExternalUrl) {
      try {
        await this.openExternalUrl(loginUrl);
      } catch (error) {
        openError = error instanceof Error ? error.message : String(error);
      }
    }

    this.transition(provider, {
      status: "connecting",
      message:
        !shouldOpenExternal || openError
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

  async startGraphDiscovery(
    provider: ConnectorProvider,
    input: ConnectorStartLoginInput = {},
  ): Promise<ConnectorState> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    if (provider !== "instagram") {
      throw Object.assign(
        new Error("Graph discovery is only supported for Instagram."),
        { statusCode: 400 },
      );
    }
    if (!isConnectorProviderAvailable(provider)) {
      this.transition(provider, buildPlannedStatePatch(provider));
      return this.decorateState(provider);
    }

    const adapter = getConnectorAdapter(provider);
    const oauth = adapter.oauth;
    if (oauth.supported === false) {
      this.transition(provider, {
        status: "failed",
        message: "Instagram Graph discovery requires Meta OAuth support.",
        accountLabel: null,
        connectedAt: null,
        loginUrl: null,
        loginMode: null,
        lastError: oauth.unavailableReason,
        failureKind: "authentication",
        graphConnection: null,
        graphDiscovery: buildBlockedGraphDiscovery(
          this.now(),
          instagramDiscoverySetupBlockers(),
        ),
      });
      return this.decorateState(provider);
    }
    const discoveryOAuth: Extract<ConnectorOAuthConfig, { supported: true }> = {
      ...oauth,
      authorizationUrl: "https://www.instagram.com/oauth/authorize",
      tokenUrl: "https://api.instagram.com/oauth/access_token",
      scopes: INSTAGRAM_GRAPH_OAUTH_SCOPES,
      scopeSeparator: ",",
      extraAuthParams: {
        enable_fb_login: "0",
        force_authentication: "1",
      },
    };

    const brokerBaseUrl = this.resolveInstagramOAuthBrokerBaseUrl(
      provider,
      discoveryOAuth,
    );
    if (brokerBaseUrl) {
      return this.startBrokeredInstagramGraphDiscovery(
        provider,
        input,
        brokerBaseUrl,
      );
    }

    const credentials = this.resolveOAuthCredentials(
      provider,
      discoveryOAuth,
      input.redirectBaseUrl ?? null,
      {
        callbackPath: "graph/oauth/callback",
        redirectEnvKeys: [
          "ROCKY_CONNECTOR_INSTAGRAM_GRAPH_REDIRECT_URI",
          "ROCKY_CONNECTOR_INSTAGRAM_META_REDIRECT_URI",
          "ROCKY_INSTAGRAM_GRAPH_REDIRECT_URI",
        ],
        useGenericRedirectEnv: false,
      },
    );
    if (credentials.ok === false) {
      const blockers = instagramDiscoverySetupBlockers();
      this.transition(provider, {
        status: "failed",
        message: "Instagram Graph discovery needs user-owned Meta app credentials.",
        accountLabel: null,
        connectedAt: null,
        loginUrl: null,
        loginMode: null,
        lastError: credentials.message,
        failureKind: "authentication",
        graphConnection: null,
        graphDiscovery: buildBlockedGraphDiscovery(this.now(), blockers),
      });
      return this.decorateState(provider);
    }

    await this.cancelActiveBrowserSession(provider);
    const state = randomUrlSafe(32);
    const codeVerifier = discoveryOAuth.pkce ? randomUrlSafe(64) : null;
    const loginUrl = buildAuthorizationUrl({
      config: discoveryOAuth,
      credentials: credentials.value,
      state,
      codeChallenge: codeVerifier ? pkceChallenge(codeVerifier) : null,
    });

    this.pendingOAuth.set(state, {
      provider,
      config: discoveryOAuth,
      credentials: credentials.value,
      state,
      codeVerifier,
      createdAt: this.now(),
      purpose: "instagram-graph-discovery",
    });

    const shouldOpenExternal = input.openExternal !== false;
    let openError: string | null =
      shouldOpenExternal && !this.openExternalUrl
        ? "Default browser opening is unavailable in this environment."
        : null;
    if (shouldOpenExternal && this.openExternalUrl) {
      try {
        await this.openExternalUrl(loginUrl);
      } catch (error) {
        openError = error instanceof Error ? error.message : String(error);
      }
    }

    this.transition(provider, {
      status: "connecting",
      message: openError
        ? "Open the Instagram Graph discovery URL to authorize your Meta app."
        : shouldOpenExternal
          ? "Instagram Graph discovery opened in the default browser."
          : "Instagram Graph discovery URL is ready. Open it from this browser to authorize your Meta app.",
      accountLabel: null,
      connectedAt: null,
      loginUrl,
      loginMode: "oauth",
      lastError: openError,
      graphConnection: null,
      graphDiscovery: emptyGraphDiscovery(),
    });

    return this.decorateState(provider);
  }

  async requestTesterRegistration(
    provider: ConnectorProvider,
    input: ConnectorTesterRequestInput,
  ): Promise<ConnectorState> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    if (provider !== "instagram") {
      throw Object.assign(
        new Error("Tester registration requests are only supported for Instagram."),
        { statusCode: 400 },
      );
    }

    const existing = await this.readStoredTesterRequest(provider);
    const checkedAt = this.now();
    const status = normalizeTesterRequestStatus(input.status);
    const accountIdentifier = normalizeTesterAccountIdentifier(
      input.accountIdentifier,
    );
    const record = buildTesterRequestRecord({
      accountIdentifier,
      status,
      requestedAt: existing?.requestedAt ?? checkedAt,
      updatedAt: checkedAt,
      completedAt:
        status === "completed"
          ? existing?.completedAt ?? checkedAt
          : existing?.completedAt ?? null,
    });

    await this.persistTesterRequest(provider, record);
    const requestCompleted =
      status === "completed" && Boolean(this.states[provider].graphConnection);
    const blockers =
      requestCompleted
        ? []
        : instagramAppAccessBlockers(record);
    this.transition(provider, {
      status:
        this.states[provider].status === "connected" &&
        this.states[provider].graphConnection
          ? "connected"
          : "failed",
      message: testerRequestStateMessage(record),
      accountLabel: this.states[provider].accountLabel,
      connectedAt: this.states[provider].connectedAt,
      loginUrl: null,
      loginMode: this.states[provider].loginMode,
      lastError: null,
      failureKind: requestCompleted ? null : "authentication",
      graphConnection: this.states[provider].graphConnection ?? null,
      graphDiscovery:
        requestCompleted
          ? this.states[provider].graphDiscovery ?? null
          : buildBlockedGraphDiscovery(checkedAt, blockers),
      testerRequest: record,
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

    if (pending.purpose !== "oauth-login") {
      this.pendingOAuth.delete(input.state);
      const message =
        "OAuth state belongs to a dedicated connector flow. Start the correct flow again.";
      this.transition(provider, {
        status: "failed",
        message: "OAuth callback route did not match the pending connector flow.",
        loginUrl: null,
        loginMode: null,
        lastError: message,
        failureKind: "authentication",
      });
      return {
        ok: false,
        provider,
        title: "OAuth callback route mismatch",
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

  async handleGraphDiscoveryCallback(
    provider: ConnectorProvider,
    input: ConnectorOAuthCallbackInput,
  ): Promise<ConnectorOAuthCallbackResult> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    if (provider !== "instagram") {
      throw Object.assign(
        new Error("Graph discovery is only supported for Instagram."),
        { statusCode: 400 },
      );
    }

    if (input.error) {
      const message =
        sanitizeConnectorPublicText(input.errorDescription ?? input.error) ??
        "Instagram Graph authorization failed.";
      const blockers = instagramDiscoveryFailureBlockers(message);
      this.transition(provider, {
        status: "failed",
        message: "Instagram Graph authorization was cancelled or failed.",
        loginUrl: null,
        loginMode: null,
        lastError: message,
        failureKind: "authentication",
        graphConnection: null,
        graphDiscovery: buildBlockedGraphDiscovery(this.now(), blockers),
      });
      return {
        ok: false,
        provider,
        title: "Instagram Graph authorization failed",
        message,
        state: this.decorateState(provider),
      };
    }

    if (!input.state || !input.code) {
      const message = "Instagram Graph callback is missing code or state.";
      this.transition(provider, {
        status: "failed",
        message: "Instagram Graph callback could not be processed.",
        loginUrl: null,
        loginMode: null,
        lastError: message,
        failureKind: "authentication",
        graphConnection: null,
        graphDiscovery: buildBlockedGraphDiscovery(
          this.now(),
          instagramDiscoverySetupBlockers(),
        ),
      });
      return {
        ok: false,
        provider,
        title: "Instagram Graph callback error",
        message,
        state: this.decorateState(provider),
      };
    }

    const pending = this.pendingOAuth.get(input.state);
    if (
      !pending ||
      pending.provider !== provider ||
      pending.purpose !== "instagram-graph-discovery"
    ) {
      const message =
        "Instagram Graph discovery state is missing, expired, or belongs to another flow.";
      this.transition(provider, {
        status: "failed",
        message: "Instagram Graph discovery state verification failed.",
        loginUrl: null,
        loginMode: null,
        lastError: message,
        failureKind: "authentication",
        graphConnection: null,
        graphDiscovery: buildBlockedGraphDiscovery(
          this.now(),
          instagramDiscoverySetupBlockers(),
        ),
      });
      return {
        ok: false,
        provider,
        title: "Instagram Graph state error",
        message,
        state: this.decorateState(provider),
      };
    }

    this.pendingOAuth.delete(input.state);

    try {
      const tokenPayload = await this.exchangeInstagramOAuthCode(
        pending,
        input.code,
      );
      const accessToken = readAccessToken(tokenPayload);
      if (!accessToken) {
        throw new Error("Instagram Graph token response did not include an access token.");
      }
      const candidates = await this.discoverInstagramGraphAccounts(accessToken);
      const checkedAt = this.now();
      if (candidates.length === 0) {
        const blockers = instagramDiscoveryNoAccountBlockers();
        this.transition(provider, {
          status: "failed",
          message:
            "Instagram Graph discovery did not find a connected Professional Instagram account.",
          accountLabel: null,
          connectedAt: null,
          loginUrl: null,
          loginMode: null,
          lastError: blockers.map((blocker) => blocker.nextAction).join(" "),
          failureKind: "authentication",
          graphConnection: null,
          graphDiscovery: buildBlockedGraphDiscovery(checkedAt, blockers),
        });
        return {
          ok: false,
          provider,
          title: "Instagram Graph setup blocked",
          message:
            "No Instagram Business or Creator account was found for this login.",
          state: this.decorateState(provider),
        };
      }

      const grantedScopes = readGrantedScopes(tokenPayload, pending.config.scopes);
      const token = buildTokenMetadata(tokenPayload, checkedAt, checkedAt);
      const scopedCandidates = candidates.map((record) => ({
        ...record,
        grantedScopes,
      }));
      const candidate = scopedCandidates[0];
      const graphConnection = buildInstagramGraphConnection({
        candidate,
        grantedScopes,
        token,
        checkedAt,
      });
      const graphDiscovery = buildCandidateGraphDiscovery(
        checkedAt,
        scopedCandidates.length,
        candidate,
      );
      const testerRequest = await this.completeTesterRequestIfPresent(
        provider,
        checkedAt,
      );
      await this.persistOAuthToken(provider, {
        provider,
        accountLabel: candidate.instagramAccountLabel,
        connectedAt: checkedAt,
        tokenPayload,
        scopes: grantedScopes,
        graphConnection,
        graphDiscovery,
      });
      this.transition(provider, {
        status: "connected",
        message:
          candidates.length === 1
            ? "Instagram Graph discovery found one connection candidate."
            : "Instagram Graph discovery found multiple connection candidates.",
        accountLabel: candidate.instagramAccountLabel,
        connectedAt: checkedAt,
        loginUrl: null,
        loginMode: "oauth",
        lastError: null,
        graphConnection,
        graphDiscovery,
        testerRequest,
      });
      return {
        ok: true,
        provider,
        title: "Instagram Graph discovery complete",
        message:
          candidates.length === 1
            ? `${candidate.instagramAccountLabel} can be used as a Graph API connection candidate.`
            : `${candidates.length} Instagram Graph connection candidates were discovered.`,
        state: this.decorateState(provider),
      };
    } catch (error) {
      const message =
        sanitizeConnectorPublicText(
          error instanceof Error ? error.message : String(error),
        ) ?? "Instagram Graph discovery failed.";
      const blockers = instagramDiscoveryFailureBlockers(message);
      this.transition(provider, {
        status: "failed",
        message: "Instagram Graph discovery failed.",
        loginUrl: null,
        loginMode: null,
        lastError: message,
        failureKind: "authentication",
        graphConnection: null,
        graphDiscovery: buildBlockedGraphDiscovery(this.now(), blockers),
      });
      return {
        ok: false,
        provider,
        title: "Instagram Graph discovery failed",
        message,
        state: this.decorateState(provider),
      };
    }
  }

  private async startBrokeredInstagramGraphDiscovery(
    provider: ConnectorProvider,
    input: ConnectorStartLoginInput,
    brokerBaseUrl: string,
  ): Promise<ConnectorState> {
    const returnBaseUrl =
      readEnv(this.baseEnv, "ROCKY_CONNECTOR_OAUTH_CLIENT_BASE_URL") ??
      input.redirectBaseUrl ??
      readEnv(this.baseEnv, "ROCKY_CONNECTOR_OAUTH_BASE_URL") ??
      "http://127.0.0.1:4173";
    const returnUrl = buildPublicPath(
      returnBaseUrl,
      `/api/connectors/${encodeURIComponent(provider)}/graph/broker/callback`,
    );
    const response = await this.fetchImpl(
      buildPublicPath(brokerBaseUrl, "/api/oauth-broker/instagram/graph/start"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ returnUrl, brokerBaseUrl }),
      },
    );
    const payload = (await response.json()) as Partial<ConnectorBrokerStartResult>;
    if (!response.ok || !payload.ok || !payload.loginUrl) {
      const message =
        sanitizeConnectorPublicText(payload.message) ??
        "Instagram Graph OAuth broker could not start.";
      this.transition(provider, {
        status: "failed",
        message: "Instagram Graph OAuth broker start failed.",
        loginUrl: null,
        loginMode: null,
        lastError: message,
        failureKind: "authentication",
        graphConnection: null,
        graphDiscovery: buildBlockedGraphDiscovery(
          this.now(),
          instagramDiscoverySetupBlockers(),
        ),
      });
      return this.decorateState(provider);
    }

    const shouldOpenExternal = input.openExternal !== false;
    let openError: string | null = null;
    if (shouldOpenExternal && this.openExternalUrl) {
      try {
        await this.openExternalUrl(payload.loginUrl);
      } catch (error) {
        openError = error instanceof Error ? error.message : String(error);
      }
    }

    this.transition(provider, {
      status: "connecting",
      message: openError
        ? "Open the Instagram Graph broker URL to authorize your Meta app."
        : "Instagram Graph broker URL is ready. Open it from this browser to authorize your Meta app.",
      accountLabel: null,
      connectedAt: null,
      loginUrl: payload.loginUrl,
      loginMode: "oauth",
      lastError: openError,
      graphConnection: null,
      graphDiscovery: emptyGraphDiscovery(),
    });
    return this.decorateState(provider);
  }

  async startInstagramGraphOAuthBroker(
    input: ConnectorBrokerStartInput,
  ): Promise<ConnectorBrokerStartResult> {
    await this.ensureHydrated();
    const provider: ConnectorProvider = "instagram";
    this.pruneBrokerOAuthSessions();
    if (!input.returnUrl || typeof input.returnUrl !== "string") {
      return {
        ok: false,
        provider,
        loginUrl: null,
        message: "OAuth broker returnUrl is required.",
      };
    }
    if (!isAllowedInstagramBrokerReturnUrl(input.returnUrl)) {
      return {
        ok: false,
        provider,
        loginUrl: null,
        message:
          "OAuth broker returnUrl must be a loopback Rocky callback URL.",
      };
    }
    const oauth = getConnectorAdapter(provider).oauth;
    if (oauth.supported === false) {
      return {
        ok: false,
        provider,
        loginUrl: null,
        message: oauth.unavailableReason,
      };
    }
    const discoveryOAuth: Extract<ConnectorOAuthConfig, { supported: true }> = {
      ...oauth,
      authorizationUrl: "https://www.instagram.com/oauth/authorize",
      tokenUrl: "https://api.instagram.com/oauth/access_token",
      scopes: INSTAGRAM_GRAPH_OAUTH_SCOPES,
      scopeSeparator: ",",
      extraAuthParams: {
        enable_fb_login: "0",
        force_authentication: "1",
      },
    };
    const brokerBaseUrl =
      readEnv(this.baseEnv, "ROCKY_CONNECTOR_OAUTH_BROKER_BASE_URL") ??
      readEnv(this.baseEnv, "ROCKY_CONNECTOR_OAUTH_BASE_URL") ??
      input.brokerBaseUrl ??
      DEFAULT_INSTAGRAM_OAUTH_BROKER_BASE_URL;
    const redirectUri = readEnv(
      this.baseEnv,
      "ROCKY_CONNECTOR_INSTAGRAM_BROKER_REDIRECT_URI",
    ) ?? (brokerBaseUrl
      ? buildPublicPath(brokerBaseUrl, "/api/oauth-broker/instagram/graph/callback")
      : null);
    const credentials = this.resolveOAuthCredentials(
      provider,
      discoveryOAuth,
      null,
      {
        redirectEnvKeys: ["ROCKY_CONNECTOR_INSTAGRAM_BROKER_REDIRECT_URI"],
        useGenericRedirectEnv: false,
      },
    );
    if (credentials.ok === false || !redirectUri) {
      return {
        ok: false,
        provider,
        loginUrl: null,
        message: credentials.ok === false ? credentials.message : "OAuth broker redirect URI is unavailable.",
      };
    }
    const state = randomUrlSafe(32);
    const codeVerifier = discoveryOAuth.pkce ? randomUrlSafe(64) : null;
    const brokerCredentials = { ...credentials.value, redirectUri };
    const loginUrl = buildAuthorizationUrl({
      config: discoveryOAuth,
      credentials: brokerCredentials,
      state,
      codeChallenge: codeVerifier ? pkceChallenge(codeVerifier) : null,
    });
    this.pendingBrokerOAuth.set(state, {
      provider,
      config: discoveryOAuth,
      credentials: brokerCredentials,
      state,
      codeVerifier,
      createdAt: this.now(),
      purpose: "instagram-graph-discovery",
      returnUrl: input.returnUrl,
    });
    return {
      ok: true,
      provider,
      loginUrl,
      message: "Instagram Graph OAuth broker URL is ready.",
    };
  }

  async handleInstagramGraphOAuthBrokerCallback(
    input: ConnectorOAuthCallbackInput,
  ): Promise<ConnectorBrokerCallbackResult> {
    await this.ensureHydrated();
    const provider: ConnectorProvider = "instagram";
    if (input.error) {
      return {
        ok: false,
        provider,
        title: "Instagram Graph authorization failed",
        message: sanitizeConnectorPublicText(input.errorDescription ?? input.error) ?? "Instagram Graph authorization failed.",
        redirectUrl: null,
      };
    }
    if (!input.state || !input.code) {
      return {
        ok: false,
        provider,
        title: "Instagram Graph callback error",
        message: "Instagram Graph callback is missing code or state.",
        redirectUrl: null,
      };
    }
    this.pruneBrokerOAuthSessions();
    const pending = this.pendingBrokerOAuth.get(input.state);
    if (!pending) {
      return {
        ok: false,
        provider,
        title: "Instagram Graph broker state error",
        message: "Instagram Graph broker state is missing, expired, or belongs to another flow.",
        redirectUrl: null,
      };
    }
    this.pendingBrokerOAuth.delete(input.state);
    try {
      const tokenPayload = await this.exchangeInstagramOAuthCode(pending, input.code);
      const handoffCode = randomUrlSafe(32);
      this.brokerHandoffs.set(handoffCode, {
        provider,
        tokenPayload,
        createdAt: this.now(),
      });
      const redirectUrl = new URL(pending.returnUrl);
      redirectUrl.searchParams.set("handoff_code", handoffCode);
      return {
        ok: true,
        provider,
        title: "Instagram Graph broker handoff ready",
        message: "Return to Rocky to complete Instagram Graph connection.",
        redirectUrl: redirectUrl.toString(),
      };
    } catch (error) {
      return {
        ok: false,
        provider,
        title: "Instagram Graph broker failed",
        message: sanitizeConnectorPublicText(error instanceof Error ? error.message : String(error)) ?? "Instagram Graph broker failed.",
        redirectUrl: null,
      };
    }
  }

  async redeemInstagramGraphOAuthBroker(
    input: ConnectorBrokerRedeemInput,
  ): Promise<ConnectorBrokerRedeemResult> {
    await this.ensureHydrated();
    const provider: ConnectorProvider = "instagram";
    this.pruneBrokerOAuthSessions();
    const handoff = this.brokerHandoffs.get(input.handoffCode);
    if (!handoff || handoff.provider !== provider) {
      return {
        ok: false,
        provider,
        tokenPayload: null,
        message: "Instagram Graph broker handoff code is missing, expired, or already used.",
      };
    }
    this.brokerHandoffs.delete(input.handoffCode);
    return {
      ok: true,
      provider,
      tokenPayload: handoff.tokenPayload,
      message: "Instagram Graph broker handoff redeemed.",
    };
  }

  async handleGraphBrokerCallback(
    provider: ConnectorProvider,
    input: ConnectorBrokerRedeemInput,
  ): Promise<ConnectorOAuthCallbackResult> {
    await this.ensureHydrated();
    this.assertSupported(provider);
    if (provider !== "instagram") {
      throw Object.assign(new Error("Graph broker callback is only supported for Instagram."), { statusCode: 400 });
    }
    const brokerBaseUrl = this.resolveInstagramOAuthBrokerBaseUrl(provider);
    if (!brokerBaseUrl) {
      const message = "Instagram Graph OAuth broker base URL is not configured.";
      return {
        ok: false,
        provider,
        title: "Instagram Graph broker error",
        message,
        state: this.decorateState(provider),
      };
    }
    const response = await this.fetchImpl(
      buildPublicPath(brokerBaseUrl, "/api/oauth-broker/instagram/graph/redeem"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ handoffCode: input.handoffCode }),
      },
    );
    const payload = (await response.json()) as Partial<ConnectorBrokerRedeemResult>;
    if (!response.ok || !payload.ok || !payload.tokenPayload) {
      const message = sanitizeConnectorPublicText(payload.message) ?? "Instagram Graph broker handoff redeem failed.";
      this.transition(provider, {
        status: "failed",
        message: "Instagram Graph broker handoff redeem failed.",
        loginUrl: null,
        loginMode: null,
        lastError: message,
        failureKind: "authentication",
        graphConnection: null,
        graphDiscovery: buildBlockedGraphDiscovery(this.now(), instagramDiscoveryFailureBlockers(message)),
      });
      return {
        ok: false,
        provider,
        title: "Instagram Graph broker error",
        message,
        state: this.decorateState(provider),
      };
    }
    return this.completeInstagramGraphDiscovery(provider, payload.tokenPayload);
  }

  private async completeInstagramGraphDiscovery(
    provider: ConnectorProvider,
    tokenPayload: Record<string, unknown>,
  ): Promise<ConnectorOAuthCallbackResult> {
    const accessToken = readAccessToken(tokenPayload);
    if (!accessToken) {
      const message = "Instagram Graph token response did not include an access token.";
      return {
        ok: false,
        provider,
        title: "Instagram Graph discovery failed",
        message,
        state: this.decorateState(provider),
      };
    }
    const candidates = await this.discoverInstagramGraphAccounts(accessToken);
    const checkedAt = this.now();
    if (candidates.length === 0) {
      const blockers = instagramDiscoveryNoAccountBlockers();
      this.transition(provider, {
        status: "failed",
        message:
          "Instagram Graph discovery did not find a connected Professional Instagram account.",
        accountLabel: null,
        connectedAt: null,
        loginUrl: null,
        loginMode: null,
        lastError: blockers.map((blocker) => blocker.nextAction).join(" "),
        failureKind: "authentication",
        graphConnection: null,
        graphDiscovery: buildBlockedGraphDiscovery(checkedAt, blockers),
      });
      return {
        ok: false,
        provider,
        title: "Instagram Graph setup blocked",
        message: "No Instagram Business or Creator account was found for this login.",
        state: this.decorateState(provider),
      };
    }
    const grantedScopes = readGrantedScopes(tokenPayload, INSTAGRAM_GRAPH_OAUTH_SCOPES);
    const token = buildTokenMetadata(tokenPayload, checkedAt, checkedAt);
    const scopedCandidates = candidates.map((record) => ({ ...record, grantedScopes }));
    const candidate = scopedCandidates[0];
    const graphConnection = buildInstagramGraphConnection({
      candidate,
      grantedScopes,
      token,
      checkedAt,
    });
    const graphDiscovery = buildCandidateGraphDiscovery(
      checkedAt,
      scopedCandidates.length,
      candidate,
    );
    const testerRequest = await this.completeTesterRequestIfPresent(provider, checkedAt);
    await this.persistOAuthToken(provider, {
      provider,
      accountLabel: candidate.instagramAccountLabel,
      connectedAt: checkedAt,
      tokenPayload,
      scopes: grantedScopes,
      graphConnection,
      graphDiscovery,
    });
    this.transition(provider, {
      status: "connected",
      message:
        candidates.length === 1
          ? "Instagram Graph discovery found one connection candidate."
          : "Instagram Graph discovery found multiple connection candidates.",
      accountLabel: candidate.instagramAccountLabel,
      connectedAt: checkedAt,
      loginUrl: null,
      loginMode: "oauth",
      lastError: null,
      graphConnection,
      graphDiscovery,
      testerRequest,
    });
    return {
      ok: true,
      provider,
      title: "Instagram Graph discovery complete",
      message:
        candidates.length === 1
          ? `${candidate.instagramAccountLabel} can be used as a Graph API connection candidate.`
          : `${candidates.length} Instagram Graph connection candidates were discovered.`,
      state: this.decorateState(provider),
    };
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
    await this.refreshInstagramOAuthTokenIfNeeded(provider);
    const readiness = buildConnectorReadiness(
      provider,
      this.states[provider],
      this.baseEnv,
      this.oauthSettings.get(provider) ?? null,
      this.now(),
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
          readiness.accountLabel ??
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
          readiness.accountLabel ??
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
          readiness.accountLabel ??
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

    if (capability.id === "instagram.feed.screen") {
      return this.executeInstagramFeedScreen({
        capability,
        readiness,
        args: input.args ?? {},
      });
    }

    if (capability.id === "instagram.media.prepare") {
      return this.executeInstagramMediaPrepare({
        capability,
        readiness,
        args: input.args ?? {},
      });
    }

    if (capability.id === "instagram.media.publish") {
      return this.executeInstagramMediaPublish({
        capability,
        readiness,
        args: input.args ?? {},
      });
    }

    if (capability.id === "instagram.media.status.read") {
      return this.executeInstagramMediaStatusRead({
        capability,
        readiness,
        args: input.args ?? {},
      });
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
        accountLabel: readiness.accountLabel ?? this.states[provider].accountLabel,
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

  private async executeInstagramFeedScreen(input: {
    capability: ConnectorCapabilityRecord;
    readiness: ConnectorReadinessRecord;
    args: Record<string, unknown>;
  }): Promise<ConnectorExecuteCapabilityResult> {
    const base = this.instagramCapabilityResultBase(input.capability, input.readiness);
    const request = normalizeInstagramFeedScreenInput(input.args);
    if (request.ok === false) {
      return {
        ...base,
        ok: false,
        status: "failed",
        message: request.message,
      };
    }

    if (request.value.browserMode === "chrome-assist") {
      const result = chromeAssistPlannedResult(request.value, this.now());
      return {
        ...base,
        setupMode: "custom-browser",
        blockerCodes: [],
        setupSteps: input.capability.setupSteps ?? [],
        ok: false,
        status: "unsupported",
        message:
          "Chrome assist feed screening is represented separately from Instagram Graph API credentials, but is not executable in this Playwright MVP.",
        data: result as unknown as Record<string, unknown>,
      };
    }

    const result = await this.screenInstagramFeed({
      request: request.value,
      now: this.now,
    });
    return {
      ...base,
      setupMode: "custom-browser",
      blockerCodes: [],
      setupSteps: input.capability.setupSteps ?? [],
      ok: result.status === "completed" || result.status === "partial",
      status: result.status === "failed" ? "failed" : "completed",
      message:
        result.status === "partial"
          ? "Instagram feed screening completed with partial per-handle/post failures."
          : result.status === "completed"
            ? "Instagram feed screening completed."
            : "Instagram feed screening failed for all requested handles.",
      data: result as unknown as Record<string, unknown>,
    };
  }

  private async executeInstagramMediaPrepare(input: {
    capability: ConnectorCapabilityRecord;
    readiness: ConnectorReadinessRecord;
    args: Record<string, unknown>;
  }): Promise<ConnectorExecuteCapabilityResult> {
    const base = this.instagramCapabilityResultBase(input.capability, input.readiness);
    if (!hasExplicitConnectorApproval(input.args)) {
      return this.instagramApprovalRequiredResult(input.capability, input.readiness);
    }

    const execution = await this.resolveInstagramGraphExecution(input.readiness);
    if (execution.ok === false) {
      return { ...base, ...execution.result };
    }

    const media = readInstagramMediaPrepareArgs(input.args);
    if (media.ok === false) {
      return {
        ...base,
        ok: false,
        status: "failed",
        message: media.message,
      };
    }

    const body = new URLSearchParams({
      access_token: execution.accessToken,
    });
    if (media.caption) {
      body.set("caption", media.caption);
    }
    if (media.kind === "image") {
      body.set("image_url", media.url);
    } else {
      body.set("video_url", media.url);
      if (media.mediaType) {
        body.set("media_type", media.mediaType);
      }
    }

    const response = await this.fetchImpl(
      instagramGraphUrl(execution.instagramUserId, "media"),
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      return {
        ...base,
        ok: false,
        status: "failed",
        message:
          sanitizeConnectorPublicText(formatOAuthError(payload, response.status)) ??
          "Instagram media container creation failed.",
        data: sanitizeGraphPayload(payload),
      };
    }

    const creationId = readString(payload.id);
    return {
      ...base,
      ok: true,
      status: "completed",
      resultType: "media-container",
      message: creationId
        ? `Instagram media container prepared: ${creationId}.`
        : "Instagram media container prepared.",
      data: sanitizeGraphPayload(payload),
    };
  }

  private async executeInstagramMediaPublish(input: {
    capability: ConnectorCapabilityRecord;
    readiness: ConnectorReadinessRecord;
    args: Record<string, unknown>;
  }): Promise<ConnectorExecuteCapabilityResult> {
    const base = this.instagramCapabilityResultBase(input.capability, input.readiness);
    if (!hasExplicitConnectorApproval(input.args)) {
      return this.instagramApprovalRequiredResult(input.capability, input.readiness);
    }

    const execution = await this.resolveInstagramGraphExecution(input.readiness);
    if (execution.ok === false) {
      return { ...base, ...execution.result };
    }

    const creationId = readConnectorArgString(input.args, [
      "creationId",
      "creation_id",
      "containerId",
      "container_id",
      "id",
    ]);
    if (!creationId) {
      return {
        ...base,
        ok: false,
        status: "failed",
        message: "Instagram media.publish requires a prepared creation_id.",
      };
    }

    const body = new URLSearchParams({
      access_token: execution.accessToken,
      creation_id: creationId,
    });
    const response = await this.fetchImpl(
      instagramGraphUrl(execution.instagramUserId, "media_publish"),
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      return {
        ...base,
        ok: false,
        status: "failed",
        message:
          sanitizeConnectorPublicText(formatOAuthError(payload, response.status)) ??
          "Instagram media publish failed.",
        data: sanitizeGraphPayload(payload),
      };
    }

    const mediaId = readString(payload.id);
    return {
      ...base,
      ok: true,
      status: "completed",
      resultType: "media-publish",
      message: mediaId
        ? `Instagram media published: ${mediaId}.`
        : "Instagram media published.",
      data: sanitizeGraphPayload(payload),
    };
  }

  private async executeInstagramMediaStatusRead(input: {
    capability: ConnectorCapabilityRecord;
    readiness: ConnectorReadinessRecord;
    args: Record<string, unknown>;
  }): Promise<ConnectorExecuteCapabilityResult> {
    const base = this.instagramCapabilityResultBase(input.capability, input.readiness);
    const execution = await this.resolveInstagramGraphExecution(input.readiness);
    if (execution.ok === false) {
      return { ...base, ...execution.result };
    }

    const mediaId = readConnectorArgString(input.args, [
      "mediaId",
      "media_id",
    ]);
    const creationId = mediaId ?? readConnectorArgString(input.args, [
      "creationId",
      "creation_id",
      "containerId",
      "container_id",
      "id",
    ]);
    if (!creationId) {
      return {
        ...base,
        ok: false,
        status: "failed",
        message: "Instagram media.status.read requires a creation_id or media_id.",
      };
    }

    const url = instagramGraphUrl(creationId, "");
    url.searchParams.set("access_token", execution.accessToken);
    url.searchParams.set(
      "fields",
      mediaId
        ? "id,permalink,media_url,caption,timestamp,media_type"
        : "id,status,status_code",
    );
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      return {
        ...base,
        ok: false,
        status: "failed",
        message:
          sanitizeConnectorPublicText(formatOAuthError(payload, response.status)) ??
          "Instagram media status read failed.",
        data: sanitizeGraphPayload(payload),
      };
    }

    return {
      ...base,
      ok: true,
      status: "completed",
      resultType: "media-status",
      message: "Instagram media status read completed.",
      data: sanitizeGraphPayload(payload),
    };
  }

  private instagramCapabilityResultBase(
    capability: ConnectorCapabilityRecord,
    readiness: ConnectorReadinessRecord,
  ): Omit<ConnectorExecuteCapabilityResult, "ok" | "status" | "message"> {
    return {
      provider: "instagram",
      capabilityId: capability.id,
      action: capability.action,
      resultType: "none",
      accountLabel: readiness.accountLabel ?? this.states.instagram.accountLabel,
      profile: null,
      followers: null,
      draft: null,
      data: null,
      setupMode: readiness.setupMode,
      blockerCodes: readiness.blockers.map((blocker) => blocker.code),
      setupSteps: readiness.blockers.map((blocker) => blocker.nextAction),
      checkedAt: this.now(),
    };
  }

  private instagramApprovalRequiredResult(
    capability: ConnectorCapabilityRecord,
    readiness: ConnectorReadinessRecord,
  ): ConnectorExecuteCapabilityResult {
    return {
      ...this.instagramCapabilityResultBase(capability, readiness),
      ok: false,
      status: "requires-approval",
      message:
        `${capability.label} capability requires preview and explicit user approval before execution.`,
    };
  }

  private async resolveInstagramGraphExecution(
    readiness: ConnectorReadinessRecord,
  ): Promise<
    | {
        ok: true;
        accessToken: string;
        instagramUserId: string;
      }
    | {
        ok: false;
        result: Pick<
          ConnectorExecuteCapabilityResult,
          "ok" | "status" | "message"
        >;
      }
  > {
    const instagramUserId =
      readiness.instagramUserId ??
      this.states.instagram.graphConnection?.instagramUserId ??
      readEnvAny(this.baseEnv, [
        "ROCKY_INSTAGRAM_BUSINESS_ACCOUNT_ID",
        "ROCKY_CONNECTOR_INSTAGRAM_BUSINESS_ACCOUNT_ID",
        "ROCKY_CONNECTOR_INSTAGRAM_ACCOUNT_ID",
        "INSTAGRAM_BUSINESS_ACCOUNT_ID",
        "INSTAGRAM_ACCOUNT_ID",
      ]);
    const accessToken = await this.readInstagramGraphAccessToken();

    if (!instagramUserId) {
      return {
        ok: false,
        result: {
          ok: false,
          status: "failed",
          message: "Instagram Graph API execution requires an Instagram user id.",
        },
      };
    }
    if (!accessToken) {
      return {
        ok: false,
        result: {
          ok: false,
          status: "failed",
          message: "Instagram Graph API execution requires an access token.",
        },
      };
    }

    return {
      ok: true,
      accessToken,
      instagramUserId,
    };
  }

  private async readInstagramGraphAccessToken(): Promise<string | null> {
    const stored = await this.readStoredOAuthToken("instagram");
    const storedAccessToken = stored ? readAccessToken(stored.tokenPayload) : null;
    return (
      storedAccessToken ??
      readEnvAny(this.baseEnv, [
        "ROCKY_INSTAGRAM_ACCESS_TOKEN",
        "ROCKY_CONNECTOR_INSTAGRAM_GRAPH_ACCESS_TOKEN",
        "ROCKY_CONNECTOR_INSTAGRAM_ACCESS_TOKEN",
        "INSTAGRAM_GRAPH_ACCESS_TOKEN",
        "INSTAGRAM_ACCESS_TOKEN",
      ])
    );
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

    const readiness = buildConnectorReadiness(
      provider,
      state,
      this.baseEnv,
      this.oauthSettings.get(provider) ?? null,
      this.now(),
    );
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
      graphConnection: provider === "instagram" ? null : undefined,
      graphDiscovery: provider === "instagram" ? null : undefined,
      testerRequest: provider === "instagram" ? null : undefined,
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
    await Promise.all([
      rm(path.join(dir, OAUTH_TOKEN_FILE), { force: true }),
      rm(path.join(dir, BROWSER_SESSION_FILE), { force: true }),
      rm(path.join(dir, LEGACY_STORAGE_FILE), { force: true }),
      rm(path.join(dir, TESTER_REQUEST_FILE), { force: true }),
      rm(path.join(dir, BROWSER_PROFILE_DIR), { recursive: true, force: true }),
    ]);
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

  private async readStoredOAuthSettings(
    provider: ConnectorProvider,
  ): Promise<StoredConnectorOAuthSettings | null> {
    const settingsPath = path.join(this.providerDir(provider), OAUTH_SETTINGS_FILE);
    try {
      const raw = await readFile(settingsPath, "utf8");
      return await this.parseStoredOAuthSettings(raw, provider);
    } catch {
      return null;
    }
  }

  private async readStoredTesterRequest(
    provider: ConnectorProvider,
  ): Promise<ConnectorTesterRequestRecord | null> {
    if (provider !== "instagram") {
      return null;
    }
    const requestPath = path.join(this.providerDir(provider), TESTER_REQUEST_FILE);
    try {
      const raw = await readFile(requestPath, "utf8");
      return parseStoredTesterRequest(raw);
    } catch {
      return null;
    }
  }

  private async persistOAuthSettings(
    provider: ConnectorProvider,
    settings: StoredConnectorOAuthSettings,
  ): Promise<void> {
    const dir = this.providerDir(provider);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const stored = {
      version: 1,
      provider,
      redirectUri: settings.redirectUri,
      updatedAt: settings.updatedAt,
      secret: await this.encryptConnectorSecret<StoredOAuthSettingsSecret>({
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
      }),
    };
    await writeFile(
      path.join(dir, OAUTH_SETTINGS_FILE),
      `${JSON.stringify(stored, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  }

  private async persistTesterRequest(
    provider: ConnectorProvider,
    record: ConnectorTesterRequestRecord,
  ): Promise<void> {
    const dir = this.providerDir(provider);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(dir, TESTER_REQUEST_FILE),
      `${JSON.stringify(record, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  }

  private async completeTesterRequestIfPresent(
    provider: ConnectorProvider,
    completedAt: string,
  ): Promise<ConnectorTesterRequestRecord | null> {
    const existing = await this.readStoredTesterRequest(provider);
    if (!existing) {
      return null;
    }
    const completed = buildTesterRequestRecord({
      accountIdentifier: existing.accountIdentifier,
      status: "completed",
      requestedAt: existing.requestedAt,
      updatedAt: completedAt,
      completedAt,
    });
    await this.persistTesterRequest(provider, completed);
    return completed;
  }

  private async refreshInstagramOAuthTokenIfNeeded(
    provider: ConnectorProvider,
  ): Promise<void> {
    if (provider !== "instagram") {
      return;
    }
    const state = this.states.instagram;
    if (
      state.status !== "connected" ||
      state.loginMode !== "oauth" ||
      !state.graphConnection ||
      !shouldRefreshConnectorToken(state.graphConnection.token, this.now())
    ) {
      return;
    }

    const stored = await this.readStoredOAuthToken(provider);
    const accessToken = stored ? readAccessToken(stored.tokenPayload) : null;
    if (!stored || !accessToken) {
      return;
    }

    try {
      const checkedAt = this.now();
      const refreshedPayload = await this.refreshInstagramAccessToken({
        currentAccessToken: accessToken,
        existingPayload: stored.tokenPayload,
      });
      const grantedScopes = readGrantedScopes(
        refreshedPayload,
        state.graphConnection.grantedScopes,
      );
      const token = buildTokenMetadata(
        refreshedPayload,
        state.connectedAt ?? stored.connectedAt,
        checkedAt,
      );
      const graphConnection: ConnectorGraphConnectionRecord = {
        ...state.graphConnection,
        grantedScopes,
        token,
        checkedAt,
      };
      const graphDiscovery = updateGraphDiscoveryCandidateScopes(
        state.graphDiscovery ?? null,
        grantedScopes,
      );
      await this.persistOAuthToken(provider, {
        provider,
        accountLabel: graphConnection.accountLabel,
        connectedAt: state.connectedAt ?? stored.connectedAt,
        tokenPayload: refreshedPayload,
        scopes: grantedScopes,
        graphConnection,
        graphDiscovery,
      });
      this.transition(provider, {
        status: "connected",
        message: "Instagram Graph API token was refreshed.",
        accountLabel: graphConnection.accountLabel,
        connectedAt: state.connectedAt ?? stored.connectedAt,
        loginUrl: null,
        loginMode: "oauth",
        lastError: null,
        graphConnection,
        graphDiscovery,
      });
    } catch (error) {
      this.transition(provider, {
        status: "connected",
        message:
          "Instagram Graph API token refresh failed. Reconnect Instagram to approve current permissions.",
        accountLabel: state.accountLabel,
        connectedAt: state.connectedAt,
        loginUrl: null,
        loginMode: "oauth",
        lastError:
          sanitizeConnectorPublicText(
            error instanceof Error ? error.message : String(error),
          ) ?? "Instagram token refresh failed.",
        graphConnection: state.graphConnection,
        graphDiscovery: state.graphDiscovery ?? null,
      });
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
      const oauthSettings = await this.readStoredOAuthSettings(provider);
      if (oauthSettings) {
        this.oauthSettings.set(provider, oauthSettings);
      }
      const testerRequest = await this.readStoredTesterRequest(provider);
      if (testerRequest) {
        this.transition(provider, {
          status:
            testerRequest.status === "completed"
              ? "idle"
              : "failed",
          message: testerRequestStateMessage(testerRequest),
          accountLabel: null,
          connectedAt: null,
          loginUrl: null,
          loginMode: null,
          lastError: null,
          failureKind:
            testerRequest.status === "completed" ? null : "authentication",
          graphConnection: provider === "instagram" ? null : undefined,
          graphDiscovery:
            provider === "instagram" && testerRequest.status !== "completed"
              ? buildBlockedGraphDiscovery(
                  testerRequest.updatedAt,
                  instagramAppAccessBlockers(testerRequest),
                )
              : undefined,
          testerRequest,
        });
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
            graphConnection: stored.graphConnection ?? null,
            graphDiscovery: stored.graphDiscovery ?? null,
            testerRequest,
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
            testerRequest,
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

  private buildPublicOAuthSettings(
    provider: ConnectorProvider,
  ): ConnectorOAuthSettingsRecord {
    const settings = this.oauthSettings.get(provider);
    if (!settings) {
      return emptyOAuthSettingsRecord();
    }
    return {
      configured: true,
      clientIdMasked: maskConnectorSecret(settings.clientId),
      clientSecretMasked: maskConnectorSecret(settings.clientSecret),
      redirectUri: settings.redirectUri,
      updatedAt: settings.updatedAt,
    };
  }

  private assertOAuthSettingsSupported(provider: ConnectorProvider): void {
    if (provider !== "instagram") {
      throw Object.assign(
        new Error("OAuth app settings are currently supported only for Instagram."),
        { statusCode: 400 },
      );
    }
  }

  private browserProfileDir(provider: ConnectorProvider): string {
    return path.join(this.providerDir(provider), BROWSER_PROFILE_DIR);
  }

  private resolveInstagramOAuthBrokerBaseUrl(
    provider: ConnectorProvider,
    config?: Extract<ConnectorOAuthConfig, { supported: true }>,
  ): string | null {
    const explicitBrokerBaseUrl = readEnv(
      this.baseEnv,
      "ROCKY_CONNECTOR_OAUTH_BROKER_BASE_URL",
    );
    if (explicitBrokerBaseUrl) {
      return explicitBrokerBaseUrl;
    }
    if (isTruthyEnv(this.baseEnv.ROCKY_CONNECTOR_DISABLE_DEFAULT_OAUTH_BROKER)) {
      return null;
    }
    if (config && this.hasOAuthClientCredentials(provider, config)) {
      return null;
    }
    return DEFAULT_INSTAGRAM_OAUTH_BROKER_BASE_URL;
  }

  private hasOAuthClientCredentials(
    provider: ConnectorProvider,
    config: Extract<ConnectorOAuthConfig, { supported: true }>,
  ): boolean {
    const prefix = `ROCKY_CONNECTOR_${config.envPrefix}`;
    const storedSettings = this.oauthSettings.get(provider);
    const clientId =
      storedSettings?.clientId ??
      readEnv(this.baseEnv, `${prefix}_CLIENT_ID`) ??
      readEnv(this.baseEnv, `${prefix}_CLIENT_KEY`);
    const clientSecret =
      storedSettings?.clientSecret ??
      readEnv(this.baseEnv, `${prefix}_CLIENT_SECRET`);
    return Boolean(clientId && clientSecret);
  }

  private pruneBrokerOAuthSessions(): void {
    const nowMs = Date.parse(this.now());
    if (!Number.isFinite(nowMs)) return;
    for (const [state, pending] of this.pendingBrokerOAuth.entries()) {
      if (isExpiredIsoTimestamp(pending.createdAt, nowMs, INSTAGRAM_BROKER_SESSION_TTL_MS)) {
        this.pendingBrokerOAuth.delete(state);
      }
    }
    for (const [handoffCode, handoff] of this.brokerHandoffs.entries()) {
      if (isExpiredIsoTimestamp(handoff.createdAt, nowMs, INSTAGRAM_BROKER_SESSION_TTL_MS)) {
        this.brokerHandoffs.delete(handoffCode);
      }
    }
  }

  private resolveOAuthCredentials(
    provider: ConnectorProvider,
    config: Extract<ConnectorOAuthConfig, { supported: true }>,
    redirectBaseUrl: string | null,
    options: {
      redirectEnvKeys?: string[];
      callbackPath?: string;
      useGenericRedirectEnv?: boolean;
    } = {},
  ):
    | { ok: true; value: OAuthCredentials }
    | { ok: false; message: string } {
    const prefix = `ROCKY_CONNECTOR_${config.envPrefix}`;
    const storedSettings = this.oauthSettings.get(provider);
    const clientId =
      storedSettings?.clientId ??
      readEnv(this.baseEnv, `${prefix}_CLIENT_ID`) ??
      readEnv(this.baseEnv, `${prefix}_CLIENT_KEY`);
    const clientSecret =
      storedSettings?.clientSecret ??
      readEnv(this.baseEnv, `${prefix}_CLIENT_SECRET`);
    const redirectUri =
      readEnvAny(this.baseEnv, options.redirectEnvKeys ?? []) ??
      storedSettings?.redirectUri ??
      (options.useGenericRedirectEnv === false
        ? null
        : readEnv(this.baseEnv, `${prefix}_REDIRECT_URI`)) ??
      buildRedirectUri(
        readEnv(this.baseEnv, "ROCKY_CONNECTOR_OAUTH_BASE_URL") ??
          redirectBaseUrl ??
          "http://127.0.0.1:3000",
        provider,
        options.callbackPath,
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

  private async exchangeInstagramOAuthCode(
    pending: PendingOAuthSession,
    code: string,
  ): Promise<Record<string, unknown>> {
    const shortLivedPayload = await this.exchangeOAuthCode(pending, code);
    const accessToken = readAccessToken(shortLivedPayload);
    if (!accessToken) {
      return shortLivedPayload;
    }

    const url = new URL("https://graph.instagram.com/access_token");
    url.searchParams.set("grant_type", "ig_exchange_token");
    url.searchParams.set("client_secret", pending.credentials.clientSecret);
    url.searchParams.set("access_token", accessToken);

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(formatOAuthError(payload, response.status));
    }
    if (!readAccessToken(payload)) {
      throw new Error(
        "Instagram long-lived token exchange did not include an access token.",
      );
    }
    return {
      ...shortLivedPayload,
      ...payload,
      scope:
        readString(payload.scope) ??
        readString(shortLivedPayload.scope) ??
        pending.config.scopes.join(","),
    };
  }

  private async refreshInstagramAccessToken(input: {
    currentAccessToken: string;
    existingPayload: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", input.currentAccessToken);

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
      },
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(formatOAuthError(payload, response.status));
    }
    if (!readAccessToken(payload)) {
      throw new Error("Instagram token refresh did not include an access token.");
    }
    return {
      ...input.existingPayload,
      ...payload,
      scope:
        readString(payload.scope) ??
        readString(input.existingPayload.scope) ??
        readString(input.existingPayload.granted_scopes),
    };
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

  private async discoverInstagramGraphAccounts(
    accessToken: string,
  ): Promise<ConnectorGraphDiscoveryCandidateRecord[]> {
    const url = new URL("https://graph.instagram.com/v22.0/me");
    url.searchParams.set("fields", "id,user_id,username,name,account_type");

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(formatOAuthError(payload, response.status));
    }
    return parseInstagramLoginAccountCandidate(payload, this.now());
  }

  private async persistOAuthToken(
    provider: ConnectorProvider,
    payload: {
      provider: ConnectorProvider;
      accountLabel: string;
      connectedAt: string;
      tokenPayload: Record<string, unknown>;
      scopes: string[];
      graphConnection?: ConnectorGraphConnectionRecord | null;
      graphDiscovery?: ConnectorGraphDiscoveryRecord | null;
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
      graphConnection: payload.graphConnection ?? null,
      graphDiscovery: payload.graphDiscovery ?? null,
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

  private async parseStoredOAuthSettings(
    raw: string,
    provider: ConnectorProvider,
  ): Promise<StoredConnectorOAuthSettings | null> {
    const parsed = parseStoredJson(raw);
    if (!isStoredOAuthSettingsRecord(parsed, provider)) {
      return null;
    }
    const secret = await this.decryptConnectorSecret<StoredOAuthSettingsSecret>(
      parsed.secret,
    );
    if (
      typeof secret.clientId !== "string" ||
      typeof secret.clientSecret !== "string" ||
      !secret.clientId.trim() ||
      !secret.clientSecret.trim()
    ) {
      return null;
    }
    return {
      clientId: secret.clientId.trim(),
      clientSecret: secret.clientSecret.trim(),
      redirectUri: parsed.redirectUri,
      updatedAt: parsed.updatedAt,
    };
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

function emptyOAuthSettingsRecord(): ConnectorOAuthSettingsRecord {
  return {
    configured: false,
    clientIdMasked: null,
    clientSecretMasked: null,
    redirectUri: null,
    updatedAt: null,
  };
}

function normalizeOAuthSettingsInput(
  input: ConnectorOAuthSettingsInput,
  updatedAt: string,
): StoredConnectorOAuthSettings {
  const clientId = requireConnectorSetting(input.clientId, "clientId");
  const clientSecret = requireConnectorSetting(input.clientSecret, "clientSecret");
  const redirectUri = normalizeConnectorRedirectUri(input.redirectUri);
  return {
    clientId,
    clientSecret,
    redirectUri,
    updatedAt,
  };
}

function requireConnectorSetting(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw Object.assign(new Error(`Connector OAuth settings require ${field}.`), {
      statusCode: 400,
    });
  }
  return value.trim();
}

function normalizeConnectorRedirectUri(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw Object.assign(new Error("Connector OAuth redirectUri must be a string."), {
      statusCode: 400,
    });
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return url.toString();
  } catch {
    throw Object.assign(
      new Error("Connector OAuth redirectUri must be a valid HTTP(S) URL."),
      { statusCode: 400 },
    );
  }
}

function maskConnectorSecret(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 2)}${"*".repeat(Math.min(value.length - 4, 8))}${value.slice(-2)}`;
}

function decorateConnectorState(
  provider: ConnectorProvider,
  state: ConnectorState,
  baseEnv: NodeJS.ProcessEnv,
  oauthSettings: StoredConnectorOAuthSettings | null,
  checkedAt: string,
): ConnectorState {
  const readiness = buildConnectorReadiness(
    provider,
    state,
    baseEnv,
    oauthSettings,
    checkedAt,
  );
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
        accountLabel: readiness.accountLabel ?? readInstagramAccountLabel(baseEnv),
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
    entitlement: null,
    blockers: [],
  };
}

function emptyGraphDiscovery(): ConnectorGraphDiscoveryRecord {
  return {
    status: "not-started",
    accountCount: 0,
    candidate: null,
    blockers: [],
    checkedAt: null,
  };
}

function buildBlockedGraphDiscovery(
  checkedAt: string,
  blockers: ConnectorReadinessBlockerRecord[],
): ConnectorGraphDiscoveryRecord {
  return {
    status: "blocked",
    accountCount: 0,
    candidate: null,
    blockers,
    checkedAt,
  };
}

function buildCandidateGraphDiscovery(
  checkedAt: string,
  accountCount: number,
  candidate: ConnectorGraphDiscoveryCandidateRecord,
): ConnectorGraphDiscoveryRecord {
  return {
    status: "candidate",
    accountCount,
    candidate,
    blockers: [],
    checkedAt,
  };
}

function updateGraphDiscoveryCandidateScopes(
  graphDiscovery: ConnectorGraphDiscoveryRecord | null,
  grantedScopes: string[],
): ConnectorGraphDiscoveryRecord | null {
  if (graphDiscovery?.status !== "candidate" || !graphDiscovery.candidate) {
    return graphDiscovery;
  }
  return {
    ...graphDiscovery,
    candidate: {
      ...graphDiscovery.candidate,
      grantedScopes,
    },
  };
}

function buildConnectorReadiness(
  provider: ConnectorProvider,
  state: ConnectorState,
  baseEnv: NodeJS.ProcessEnv,
  oauthSettings: StoredConnectorOAuthSettings | null,
  checkedAt: string,
): ConnectorReadinessRecord {
  if (provider !== "instagram") {
    return emptyConnectorReadiness();
  }
  if (state.graphConnection) {
    return buildInstagramOAuthReadiness(state.graphConnection, checkedAt);
  }
  if (state.graphDiscovery?.status === "candidate" && state.graphDiscovery.candidate) {
    return {
      setupMode: "graph-api",
      accountKind: state.graphDiscovery.candidate.accountKind,
      accountLabel: state.graphDiscovery.candidate.instagramAccountLabel,
      instagramUserId: state.graphDiscovery.candidate.instagramBusinessAccountId,
      grantedScopes: state.graphDiscovery.candidate.grantedScopes,
      tokenStatus: null,
      checkedAt: state.graphDiscovery.checkedAt,
      browserSessionPurpose: "readiness_check",
      entitlement: instagramEntitlementForBlockers(
        [],
        state.graphDiscovery.checkedAt,
        state.testerRequest ?? null,
      ),
      blockers: [],
    };
  }
  if (state.graphDiscovery?.status === "blocked") {
    return {
      setupMode: "graph-api",
      accountKind: "unknown",
      accountLabel: null,
      instagramUserId: null,
      grantedScopes: [],
      tokenStatus: null,
      checkedAt: state.graphDiscovery.checkedAt,
      browserSessionPurpose: "readiness_check",
      entitlement: instagramEntitlementForBlockers(
        state.graphDiscovery.blockers,
        state.graphDiscovery.checkedAt,
        state.testerRequest ?? null,
      ),
      blockers: state.graphDiscovery.blockers,
    };
  }
  if (state.testerRequest && state.testerRequest.status !== "completed") {
    return {
      setupMode: "graph-api",
      accountKind: "unknown",
      accountLabel: null,
      instagramUserId: null,
      grantedScopes: [],
      tokenStatus: null,
      checkedAt: state.testerRequest.updatedAt,
      browserSessionPurpose: "readiness_check",
      entitlement: instagramEntitlementForBlockers(
        instagramAppAccessBlockers(state.testerRequest),
        state.testerRequest.updatedAt,
        state.testerRequest,
      ),
      blockers: instagramAppAccessBlockers(state.testerRequest),
    };
  }
  return buildInstagramGraphReadiness(baseEnv, oauthSettings, checkedAt);
}

function buildInstagramOAuthReadiness(
  connection: ConnectorGraphConnectionRecord,
  checkedAt: string,
): ConnectorReadinessRecord {
  const blockers: ConnectorReadinessBlockerRecord[] = [];
  if (
    connection.accountKind !== "professional_business" &&
    connection.accountKind !== "professional_creator"
  ) {
    blockers.push(professionalAccountBlocker());
  }
  if (!connection.token.accessTokenPresent) {
    blockers.push(accessTokenMissingBlocker());
  } else if (resolveTokenStatus(connection.token, checkedAt) === "expired") {
    blockers.push(tokenExpiredBlocker());
  }

  return {
    setupMode: "graph-api",
    accountKind: connection.accountKind,
    accountLabel: connection.accountLabel,
    instagramUserId: connection.instagramUserId,
    grantedScopes: connection.grantedScopes,
    tokenStatus: resolveTokenStatus(connection.token, checkedAt),
    checkedAt: connection.checkedAt,
    browserSessionPurpose: "readiness_check",
    entitlement: instagramEntitlementForBlockers(
      blockers,
      checkedAt,
      null,
    ),
    blockers,
  };
}

function buildInstagramGraphReadiness(
  baseEnv: NodeJS.ProcessEnv,
  oauthSettings: StoredConnectorOAuthSettings | null,
  checkedAt: string,
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
  const tokenExpiresAt = readEnvAny(baseEnv, [
    "ROCKY_INSTAGRAM_TOKEN_EXPIRES_AT",
    "ROCKY_CONNECTOR_INSTAGRAM_TOKEN_EXPIRES_AT",
    "ROCKY_CONNECTOR_INSTAGRAM_GRAPH_TOKEN_EXPIRES_AT",
    "INSTAGRAM_TOKEN_EXPIRES_AT",
    "INSTAGRAM_GRAPH_TOKEN_EXPIRES_AT",
  ]);
  const tokenStatus =
    hasAccessToken && tokenExpiresAt
      ? isIsoTimestampExpired(tokenExpiresAt, checkedAt)
        ? "expired"
        : "active"
      : hasAccessToken
        ? "unknown"
        : null;
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
  const hasManagedBroker = Boolean(
    readEnv(baseEnv, "ROCKY_CONNECTOR_OAUTH_BROKER_BASE_URL") ||
      !isTruthyEnv(baseEnv.ROCKY_CONNECTOR_DISABLE_DEFAULT_OAUTH_BROKER),
  );
  const hasMetaApp = Boolean(
    hasManagedBroker ||
    oauthSettings?.clientId ||
    readEnvAny(baseEnv, [
      "ROCKY_INSTAGRAM_META_APP_ID",
      "ROCKY_CONNECTOR_INSTAGRAM_META_APP_ID",
      "ROCKY_CONNECTOR_INSTAGRAM_CLIENT_ID",
      "INSTAGRAM_META_APP_ID",
      "INSTAGRAM_CLIENT_ID",
    ]),
  );

  const blockers: ConnectorReadinessBlockerRecord[] = [];
  if (
    accountKind === "unknown" ||
    accountKind === "personal"
  ) {
    blockers.push(professionalAccountBlocker());
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
    blockers.push(accessTokenMissingBlocker());
  }
  if (tokenStatus === "expired") {
    blockers.push(tokenExpiredBlocker());
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

  return {
    setupMode: "graph-api",
    accountKind,
    accountLabel: readInstagramAccountLabel(baseEnv),
    instagramUserId: readEnvAny(baseEnv, [
      "ROCKY_INSTAGRAM_BUSINESS_ACCOUNT_ID",
      "ROCKY_CONNECTOR_INSTAGRAM_BUSINESS_ACCOUNT_ID",
      "ROCKY_CONNECTOR_INSTAGRAM_ACCOUNT_ID",
      "INSTAGRAM_BUSINESS_ACCOUNT_ID",
      "INSTAGRAM_ACCOUNT_ID",
    ]),
    grantedScopes: [...permissions],
    tokenStatus,
    checkedAt,
    browserSessionPurpose: "readiness_check",
    entitlement: instagramEntitlementForBlockers(blockers, checkedAt, null),
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

function professionalAccountBlocker(): ConnectorReadinessBlockerRecord {
  return readinessBlocker(
    "professional_account_required",
    "Instagram Graph API execution requires a Professional Business or Creator account.",
    "Switch the Instagram account to Business or Creator before enabling execution capabilities.",
  );
}

function accessTokenMissingBlocker(): ConnectorReadinessBlockerRecord {
  return readinessBlocker(
    "access_token_missing",
    "No Instagram Graph API access token is configured.",
    "Generate a Graph API token with the required Instagram permissions and connect it to Rocky.",
  );
}

function tokenExpiredBlocker(): ConnectorReadinessBlockerRecord {
  return readinessBlocker(
    "token_expired",
    "The connected Instagram Graph API token is expired.",
    "Reconnect Instagram and approve Rocky access again.",
  );
}

function instagramEntitlementForBlockers(
  blockers: ConnectorReadinessBlockerRecord[],
  checkedAt: string | null | undefined,
  testerRequest: ConnectorTesterRequestRecord | null,
): ConnectorEntitlementRecord {
  const blockedByTesterGate = blockers.some(
    (blocker) => blocker.code === "app_access_required",
  );
  if (testerRequest && testerRequest.status !== "completed") {
    return {
      gate: "instagram-meta-app-tester",
      status: "pending",
      reason: testerRequestStateMessage(testerRequest),
      checkedAt: checkedAt ?? testerRequest.updatedAt,
      testerRequestStatus: testerRequest.status,
    };
  }
  if (blockedByTesterGate) {
    return {
      gate: "instagram-meta-app-tester",
      status: "blocked",
      reason:
        "The Instagram account must be allowed to use the Rocky Meta app before OAuth can complete.",
      checkedAt: checkedAt ?? null,
      testerRequestStatus: null,
    };
  }
  return {
    gate: "instagram-meta-app-tester",
    status: "allowed",
    reason: "No tester gate is currently blocking this Instagram Graph API connection.",
    checkedAt: checkedAt ?? null,
    testerRequestStatus: testerRequest?.status ?? null,
  };
}

function instagramDiscoverySetupBlockers(): ConnectorReadinessBlockerRecord[] {
  return [
    readinessBlocker(
      "meta_app_required",
      "Instagram Graph discovery requires a user-owned Meta app.",
      "Add the Meta app client id and client secret for the Instagram connector, then start Graph API discovery again.",
    ),
  ];
}

function instagramAppAccessBlockers(
  testerRequest?: ConnectorTesterRequestRecord | null,
): ConnectorReadinessBlockerRecord[] {
  const nextAction =
    testerRequest?.status === "accepted"
      ? "Retry Instagram OAuth now that the tester invitation has been accepted."
      : testerRequest?.status === "invited"
        ? "Accept the Rocky Meta app tester invitation in Meta/Instagram, then mark it accepted and retry OAuth."
        : testerRequest?.status === "pending"
          ? "Wait for the Rocky operator to send the tester invitation, accept it in Meta/Instagram, then retry OAuth."
          : "Request Rocky Meta app tester registration, accept the invitation in Meta/Instagram, then retry OAuth.";
  return [
    readinessBlocker(
      "app_access_required",
      "The Rocky Meta app is not available to this Instagram account yet.",
      nextAction,
    ),
  ];
}

function instagramDiscoveryNoAccountBlockers(): ConnectorReadinessBlockerRecord[] {
  return [
    readinessBlocker(
      "professional_account_required",
      "No Instagram Business or Creator account was discovered.",
      "Switch the Instagram account to Business or Creator, then grant instagram_business_basic.",
    ),
  ];
}

function instagramDiscoveryFailureBlockers(
  message: string,
): ConnectorReadinessBlockerRecord[] {
  return isInstagramAppAccessError(message)
    ? instagramAppAccessBlockers()
    : instagramDiscoverySetupBlockers();
}

function isInstagramAppAccessError(message: string): boolean {
  return /tester|test user|app role|app access|invitation|development mode|beta|not authorized|does not have permission|permission for this action|not allowed/iu.test(
    message,
  );
}

function normalizeTesterRequestStatus(
  status: ConnectorTesterRequestStatus | undefined,
): ConnectorTesterRequestStatus {
  if (status === "invited" || status === "accepted" || status === "completed") {
    return status;
  }
  return "pending";
}

function normalizeTesterAccountIdentifier(value: string): string {
  const sanitized = sanitizeConnectorPublicText(value)?.trim() ?? "";
  return sanitized.replace(/\s+/gu, " ").slice(0, 160);
}

function buildTesterRequestRecord(input: {
  accountIdentifier: string;
  status: ConnectorTesterRequestStatus;
  requestedAt: string;
  updatedAt: string;
  completedAt: string | null;
}): ConnectorTesterRequestRecord {
  return {
    provider: "instagram",
    accountIdentifier: input.accountIdentifier,
    status: input.status,
    requestedAt: input.requestedAt,
    updatedAt: input.updatedAt,
    completedAt: input.completedAt,
    message: testerRequestStatusMessage(input.status),
  };
}

function testerRequestStateMessage(
  request: ConnectorTesterRequestRecord,
): string {
  return testerRequestStatusMessage(request.status);
}

function testerRequestStatusMessage(status: ConnectorTesterRequestStatus): string {
  if (status === "invited") {
    return "Instagram tester invitation has been recorded. Accept it in Meta/Instagram, then retry Instagram OAuth.";
  }
  if (status === "accepted") {
    return "Instagram tester invitation acceptance has been recorded. Retry Instagram OAuth to issue the access token.";
  }
  if (status === "completed") {
    return "Instagram tester gate is complete and the Graph API access token has been issued.";
  }
  return "Instagram tester registration request has been recorded for Rocky operator action.";
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

type InstagramPermissionRequirement = {
  label: string;
  aliases: string[];
};

const INSTAGRAM_CAPABILITY_PERMISSION_REQUIREMENTS: Record<
  string,
  InstagramPermissionRequirement[]
> = {
  "instagram.account.read": [
    {
      label: "instagram_business_basic",
      aliases: ["instagram_business_basic", "instagram_basic"],
    },
  ],
  "instagram.automation.prepare": [
    {
      label: "instagram_business_basic",
      aliases: ["instagram_business_basic", "instagram_basic"],
    },
  ],
  "instagram.media.prepare": [
    {
      label: "instagram_business_basic",
      aliases: ["instagram_business_basic", "instagram_basic"],
    },
    {
      label: "instagram_business_content_publish",
      aliases: ["instagram_business_content_publish", "instagram_content_publish"],
    },
  ],
  "instagram.media.publish": [
    {
      label: "instagram_business_basic",
      aliases: ["instagram_business_basic", "instagram_basic"],
    },
    {
      label: "instagram_business_content_publish",
      aliases: ["instagram_business_content_publish", "instagram_content_publish"],
    },
  ],
  "instagram.media.status.read": [
    {
      label: "instagram_business_basic",
      aliases: ["instagram_business_basic", "instagram_basic"],
    },
    {
      label: "instagram_business_content_publish",
      aliases: ["instagram_business_content_publish", "instagram_content_publish"],
    },
  ],
  "instagram.insights.read": [
    {
      label: "instagram_business_basic",
      aliases: ["instagram_business_basic", "instagram_basic"],
    },
    {
      label: "instagram_business_manage_insights",
      aliases: ["instagram_business_manage_insights", "instagram_manage_insights"],
    },
  ],
};

function instagramCapabilityPermissionBlockers(
  capabilityId: string,
  permissions: Set<string>,
): ConnectorReadinessBlockerRecord[] {
  const missing = (INSTAGRAM_CAPABILITY_PERMISSION_REQUIREMENTS[capabilityId] ?? [])
    .filter((requirement) =>
      requirement.aliases.every((permission) => !permissions.has(permission)),
    )
    .map((requirement) => requirement.label);
  if (missing.length === 0) {
    return [];
  }
  return [
    readinessBlocker(
      "permission_missing",
      `Missing required Instagram Graph API permissions: ${missing.join(", ")}.`,
      "Grant the missing permissions to Rocky, then retry Instagram OAuth or refresh the connector environment.",
    ),
  ];
}

function getConnectorExecutionCapabilities(
  provider: ConnectorProvider,
  readiness?: ConnectorReadinessRecord,
): ConnectorCapabilityRecord[] {
  const resolvedReadiness =
    readiness ??
    (provider === "instagram"
      ? buildInstagramGraphReadiness({}, null, new Date(0).toISOString())
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
  return [
    instagramCapability(readiness, {
      id: "instagram.account.read",
      label: "Account read",
      description:
        "Verify the OAuth-bound Instagram User ID and Graph API account readiness.",
      action: "read",
      requiresApproval: false,
    }),
    instagramCapability(readiness, {
      id: "instagram.media.prepare",
      label: "Media preparation",
      description:
        "Prepare Instagram media work only after Graph API account and token readiness are confirmed.",
      action: "write",
      requiresApproval: true,
    }),
    instagramCapability(readiness, {
      id: "instagram.media.publish",
      label: "Media publish",
      description:
        "Publish approved Instagram media through the Graph API after preview and explicit approval.",
      action: "write",
      requiresApproval: true,
    }),
    instagramCapability(readiness, {
      id: "instagram.media.status.read",
      label: "Media status read",
      description:
        "Read Instagram media publishing status through the Graph API.",
      action: "read",
      requiresApproval: false,
    }),
    instagramCapability(readiness, {
      id: "instagram.insights.read",
      label: "Insights read",
      description:
        "Read Instagram account and media insights through approved Graph API permissions.",
      action: "read",
      requiresApproval: false,
    }),
  ];
}

function instagramCapability(
  readiness: ConnectorReadinessRecord,
  input: {
  id: string;
  label: string;
  description: string;
  action: ConnectorCapabilityRecord["action"];
  requiresApproval: boolean;
  },
): ConnectorCapabilityRecord {
  const blockers = [
    ...readiness.blockers,
    ...instagramCapabilityPermissionBlockers(
      input.id,
      new Set(readiness.grantedScopes ?? []),
    ),
  ];
  const setupSteps = blockers.map((blocker) => blocker.nextAction);
  return {
    id: input.id,
    provider: "instagram",
    label: input.label,
    description: input.description,
    action: input.action,
    requiresBrowser: false,
    requiresConnectedAccount: true,
    requiresApproval: input.requiresApproval,
    status: blockers.length === 0 ? "available" : "blocked",
    source: "backend",
    executionOwner: "rocky-server",
    setupMode: "graph-api",
    setupSteps,
    blockerCodes: blockers.map((blocker) => blocker.code),
    blockers,
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
    return [
      instagramCapability(readiness, {
        id: "instagram.automation.prepare",
        label: "Instagram Graph API readiness",
        description:
          "Check whether Instagram native capabilities can run through Graph API credentials.",
        action: "read",
        requiresApproval: false,
      }),
      {
        id: "instagram.feed.screen",
        provider,
        label: "Instagram feed screening",
        description:
          "Read-only public feed screening with deterministic Playwright support; Chrome assist is modeled separately from Instagram Graph API connection and publishing permissions.",
        action: "read",
        requiresBrowser: true,
        requiresConnectedAccount: false,
        requiresApproval: false,
        status: "available",
        source: "backend",
        executionOwner: "rocky-server",
        setupMode: "custom-browser",
        setupSteps: [
          "Use browserMode=playwright-public for the MVP. browserMode=chrome-assist is planned read-only assist support and does not grant Graph API or publishing permission.",
        ],
      },
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

function hasExplicitConnectorApproval(args: Record<string, unknown>): boolean {
  return (
    args.approved === true ||
    args.confirmed === true ||
    args.userApproved === true ||
    args.userApprovedPublish === true
  );
}

function readConnectorArgString(
  args: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readInstagramMediaPrepareArgs(
  args: Record<string, unknown>,
):
  | {
      ok: true;
      kind: "image" | "video";
      url: string;
      caption: string | null;
      mediaType: string | null;
    }
  | { ok: false; message: string } {
  const imageUrl = readConnectorArgString(args, [
    "imageUrl",
    "image_url",
    "mediaUrl",
    "media_url",
    "url",
  ]);
  const videoUrl = readConnectorArgString(args, ["videoUrl", "video_url"]);
  const localFile = readConnectorArgString(args, [
    "imageFile",
    "image_file",
    "mediaFile",
    "media_file",
    "file",
  ]);
  const caption = readConnectorArgString(args, ["caption", "content", "text"]);

  if (imageUrl && videoUrl) {
    return {
      ok: false,
      message: "Instagram media.prepare accepts either imageUrl or videoUrl, not both.",
    };
  }

  const url = imageUrl ?? videoUrl;
  if (!url) {
    return {
      ok: false,
      message: localFile
        ? "Instagram Graph API requires a publicly reachable HTTPS media URL; local workspace files must be uploaded or exposed as imageUrl/videoUrl before publishing."
        : "Instagram media.prepare requires imageUrl or videoUrl.",
    };
  }

  const validation = validatePublicHttpsMediaUrl(url);
  if (validation.ok === false) {
    return validation;
  }

  const mediaType = readConnectorArgString(args, ["mediaType", "media_type"]);
  return {
    ok: true,
    kind: imageUrl ? "image" : "video",
    url,
    caption,
    mediaType: videoUrl ? mediaType ?? "REELS" : null,
  };
}

function validatePublicHttpsMediaUrl(
  value: string,
): { ok: true } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      ok: false,
      message: "Instagram media URL must be an absolute HTTPS URL.",
    };
  }
  if (url.protocol !== "https:") {
    return {
      ok: false,
      message: "Instagram media URL must use HTTPS.",
    };
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^10\./u.test(host) ||
    /^192\.168\./u.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[0-1])\./u.test(host)
  ) {
    return {
      ok: false,
      message:
        "Instagram media URL must be publicly reachable by Meta; localhost and private network URLs are not supported.",
    };
  }
  return { ok: true };
}

function instagramGraphUrl(objectId: string, edge: string): URL {
  const encoded = encodeURIComponent(objectId);
  const suffix = edge ? `/${edge}` : "";
  return new URL(`https://graph.instagram.com/v22.0/${encoded}${suffix}`);
}

function sanitizeGraphPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(
    sanitizeConnectorPublicText(JSON.stringify(payload)) ?? "{}",
  ) as Record<string, unknown>;
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
      /([?&](?:access_token|refresh_token|id_token|auth_token|client_secret|session_id|SESSION_ID|api_cert_key|API_CERT_KEY)=)[^&\s]+/giu,
      "$1[redacted]",
    )
    .replace(
      /("(?:(?:access|refresh|id|auth)_token|client_secret|clientSecret|sessionid|session_id|storageStateJson|cookies?|localStorage|sessionStorage)"\s*:\s*)("[^"]*"|[^,}\]]+)/giu,
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

function buildRedirectUri(
  baseUrl: string,
  provider: ConnectorProvider,
  callbackPath = "oauth/callback",
): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/connectors/${encodeURIComponent(provider)}/${callbackPath}`;
}

function buildPublicPath(baseUrl: string, pathname: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const pathValue = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${pathValue}`;
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

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isExpiredIsoTimestamp(
  timestamp: string,
  nowMs: number,
  ttlMs: number,
): boolean {
  const timestampMs = Date.parse(timestamp);
  return !Number.isFinite(timestampMs) || nowMs - timestampMs > ttlMs;
}

function isAllowedInstagramBrokerReturnUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) {
    return false;
  }
  if (url.protocol === "rocky:") {
    return url.hostname === "oauth" && url.pathname === "/instagram/graph/callback";
  }
  if (url.protocol !== "http:") {
    return false;
  }
  if (!isLoopbackHostname(url.hostname)) {
    return false;
  }
  return (
    url.pathname === "/api/connectors/instagram/graph/broker/callback" ||
    url.pathname === "/connectors/instagram/graph/broker/callback"
  );
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
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

function parseInstagramLoginAccountCandidate(
  payload: Record<string, unknown>,
  discoveredAt: string,
): ConnectorGraphDiscoveryCandidateRecord[] {
  const instagramBusinessAccountId = readString(payload.user_id) ?? readString(payload.id);
  const accountKind = readInstagramLoginAccountKind(payload.account_type);
  if (!instagramBusinessAccountId || !accountKind) {
    return [];
  }
  const instagramUsername = readString(payload.username);
  const instagramName = readString(payload.name);
  return [
    {
      facebookPageId: null,
      facebookPageName: null,
      instagramBusinessAccountId,
      instagramUsername,
      instagramAccountLabel:
        instagramUsername ??
        instagramName ??
        `Instagram Graph account ${instagramBusinessAccountId}`,
      accountKind,
      grantedScopes: [],
      discoveredAt,
    },
  ];
}

function buildInstagramGraphConnection(input: {
  candidate: ConnectorGraphDiscoveryCandidateRecord;
  grantedScopes: string[];
  token: ConnectorTokenMetadataRecord;
  checkedAt: string;
}): ConnectorGraphConnectionRecord {
  return {
    source: "instagram-login-oauth",
    instagramUserId: input.candidate.instagramBusinessAccountId,
    username: input.candidate.instagramUsername,
    accountLabel: input.candidate.instagramAccountLabel,
    accountKind: input.candidate.accountKind,
    grantedScopes: input.grantedScopes,
    token: input.token,
    checkedAt: input.checkedAt,
  };
}

function readInstagramLoginAccountKind(
  value: unknown,
): Extract<ConnectorAccountKind, "professional_business" | "professional_creator"> | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === "BUSINESS") {
    return "professional_business";
  }
  if (normalized === "CREATOR") {
    return "professional_creator";
  }
  return null;
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

function readGrantedScopes(
  payload: Record<string, unknown>,
  fallback: string[],
): string[] {
  const raw =
    readString(payload.scope) ??
    readString(payload.scopes) ??
    readString(payload.granted_scopes);
  const fromString = raw ? [...readPermissionSet(raw)] : [];
  const fromArray = Array.isArray(payload.scopes)
    ? payload.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];
  const fromGrantedArray = Array.isArray(payload.granted_scopes)
    ? payload.granted_scopes.filter(
        (scope): scope is string => typeof scope === "string",
      )
    : [];
  const explicit = [...new Set([...fromString, ...fromArray, ...fromGrantedArray])];
  return explicit.length > 0 ? explicit : [...new Set(fallback)];
}

function buildTokenMetadata(
  payload: Record<string, unknown>,
  connectedAt: string,
  checkedAt: string,
): ConnectorTokenMetadataRecord {
  const expiresAt =
    readIsoTimestamp(payload.expires_at) ??
    readUnixTimestamp(payload.expires_at) ??
    readExpiresInTimestamp(payload.expires_in, connectedAt);
  const dataAccessExpiresAt =
    readIsoTimestamp(payload.data_access_expires_at) ??
    readUnixTimestamp(payload.data_access_expires_at);
  const metadata: ConnectorTokenMetadataRecord = {
    accessTokenPresent: Boolean(readAccessToken(payload)),
    tokenType: readString(payload.token_type),
    expiresAt,
    dataAccessExpiresAt,
    checkedAt,
    status: "unknown",
  };
  return {
    ...metadata,
    status: resolveTokenStatus(metadata, checkedAt),
  };
}

function resolveTokenStatus(
  token: ConnectorTokenMetadataRecord,
  checkedAt: string,
): ConnectorTokenMetadataRecord["status"] {
  if (!token.accessTokenPresent) {
    return "expired";
  }
  if (
    (token.expiresAt && isIsoTimestampExpired(token.expiresAt, checkedAt)) ||
    (token.dataAccessExpiresAt &&
      isIsoTimestampExpired(token.dataAccessExpiresAt, checkedAt))
  ) {
    return "expired";
  }
  return token.expiresAt || token.dataAccessExpiresAt ? "active" : "unknown";
}

function shouldRefreshConnectorToken(
  token: ConnectorTokenMetadataRecord,
  checkedAt: string,
): boolean {
  if (!token.accessTokenPresent) {
    return false;
  }
  return [token.expiresAt, token.dataAccessExpiresAt].some((expiresAt) => {
    if (!expiresAt) {
      return false;
    }
    const expiresMs = Date.parse(expiresAt);
    const checkedMs = Date.parse(checkedAt);
    return (
      Number.isFinite(expiresMs) &&
      Number.isFinite(checkedMs) &&
      expiresMs <= checkedMs + INSTAGRAM_TOKEN_REFRESH_LEEWAY_MS
    );
  });
}

function readExpiresInTimestamp(value: unknown, connectedAt: string): string | null {
  const seconds = readNumber(value);
  if (seconds === null) {
    return null;
  }
  const baseMs = Date.parse(connectedAt);
  if (!Number.isFinite(baseMs)) {
    return null;
  }
  return new Date(baseMs + seconds * 1000).toISOString();
}

function readUnixTimestamp(value: unknown): string | null {
  const seconds = readNumber(value);
  if (seconds === null) {
    return null;
  }
  const milliseconds = seconds > 10_000_000_000 ? seconds : seconds * 1000;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function readIsoTimestamp(value: unknown): string | null {
  const raw = readString(value);
  if (!raw) {
    return null;
  }
  const milliseconds = Date.parse(raw);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isIsoTimestampExpired(value: string, checkedAt: string): boolean {
  const valueMs = Date.parse(value);
  const checkedMs = Date.parse(checkedAt);
  return (
    Number.isFinite(valueMs) &&
    Number.isFinite(checkedMs) &&
    valueMs <= checkedMs
  );
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

function isStoredOAuthSettingsRecord(
  parsed: Record<string, unknown> | null,
  provider: ConnectorProvider,
): parsed is {
  provider: ConnectorProvider;
  redirectUri: string | null;
  updatedAt: string;
  secret: EncryptedConnectorPayload;
} {
  return Boolean(
    parsed &&
      parsed.version === 1 &&
      parsed.provider === provider &&
      (parsed.redirectUri === null || typeof parsed.redirectUri === "string") &&
      typeof parsed.updatedAt === "string" &&
      isEncryptedConnectorPayload(parsed.secret),
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
): {
  accountLabel: string;
  connectedAt: string;
  graphConnection: ConnectorGraphConnectionRecord | null;
  graphDiscovery: ConnectorGraphDiscoveryRecord | null;
} | null {
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
    graphConnection: isConnectorGraphConnectionRecord(parsed.graphConnection)
      ? parsed.graphConnection
      : null,
    graphDiscovery: isConnectorGraphDiscoveryRecord(parsed.graphDiscovery)
      ? parsed.graphDiscovery
      : null,
  };
}

function parseStoredTesterRequest(
  raw: string,
): ConnectorTesterRequestRecord | null {
  const parsed = parseStoredJson(raw);
  if (!parsed || parsed.provider !== "instagram") {
    return null;
  }
  const status = readTesterRequestStatus(parsed.status);
  if (
    !status ||
    typeof parsed.accountIdentifier !== "string" ||
    typeof parsed.requestedAt !== "string" ||
    typeof parsed.updatedAt !== "string" ||
    (parsed.completedAt !== null && typeof parsed.completedAt !== "string")
  ) {
    return null;
  }
  return buildTesterRequestRecord({
    accountIdentifier: normalizeTesterAccountIdentifier(
      parsed.accountIdentifier,
    ),
    status,
    requestedAt: parsed.requestedAt,
    updatedAt: parsed.updatedAt,
    completedAt:
      typeof parsed.completedAt === "string" ? parsed.completedAt : null,
  });
}

function readTesterRequestStatus(
  value: unknown,
): ConnectorTesterRequestStatus | null {
  if (
    value === "pending" ||
    value === "invited" ||
    value === "accepted" ||
    value === "completed"
  ) {
    return value;
  }
  return null;
}

function isConnectorGraphDiscoveryRecord(
  value: unknown,
): value is ConnectorGraphDiscoveryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record.status !== "not-started" &&
    record.status !== "blocked" &&
    record.status !== "candidate"
  ) {
    return false;
  }
  if (
    typeof record.accountCount !== "number" ||
    !Number.isInteger(record.accountCount) ||
    record.accountCount < 0
  ) {
    return false;
  }
  if (
    record.checkedAt !== null &&
    typeof record.checkedAt !== "string"
  ) {
    return false;
  }
  if (!Array.isArray(record.blockers)) {
    return false;
  }
  if (
    record.candidate !== null &&
    !isConnectorGraphDiscoveryCandidateRecord(record.candidate)
  ) {
    return false;
  }
  return true;
}

function isConnectorGraphDiscoveryCandidateRecord(
  value: unknown,
): value is ConnectorGraphDiscoveryCandidateRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.facebookPageId === null ||
      typeof record.facebookPageId === "string") &&
    (record.facebookPageName === null ||
      typeof record.facebookPageName === "string") &&
    typeof record.instagramBusinessAccountId === "string" &&
    (record.instagramUsername === null ||
      typeof record.instagramUsername === "string") &&
    typeof record.instagramAccountLabel === "string" &&
    (record.accountKind === "professional_business" ||
      record.accountKind === "professional_creator") &&
    Array.isArray(record.grantedScopes) &&
    record.grantedScopes.every((scope) => typeof scope === "string") &&
    typeof record.discoveredAt === "string"
  );
}

function isConnectorGraphConnectionRecord(
  value: unknown,
): value is ConnectorGraphConnectionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.source === "instagram-login-oauth" &&
    typeof record.instagramUserId === "string" &&
    (record.username === null || typeof record.username === "string") &&
    typeof record.accountLabel === "string" &&
    (record.accountKind === "professional_business" ||
      record.accountKind === "professional_creator") &&
    Array.isArray(record.grantedScopes) &&
    record.grantedScopes.every((scope) => typeof scope === "string") &&
    isConnectorTokenMetadataRecord(record.token) &&
    typeof record.checkedAt === "string"
  );
}

function isConnectorTokenMetadataRecord(
  value: unknown,
): value is ConnectorTokenMetadataRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.accessTokenPresent === "boolean" &&
    (record.tokenType === null || typeof record.tokenType === "string") &&
    (record.expiresAt === null || typeof record.expiresAt === "string") &&
    (record.dataAccessExpiresAt === null ||
      typeof record.dataAccessExpiresAt === "string") &&
    typeof record.checkedAt === "string" &&
    (record.status === "active" ||
      record.status === "expired" ||
      record.status === "unknown")
  );
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
