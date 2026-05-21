import type {
  ConnectorAdapter,
  ConnectorOAuthConfig,
} from "./connector-runner.js";
import type {
  ConnectorCapabilityRecord,
  ConnectorProvider,
} from "./connector-types.js";

function capability(input: Omit<ConnectorCapabilityRecord, "provider"> & {
  provider: ConnectorProvider;
}): ConnectorCapabilityRecord {
  return input;
}

const AVAILABLE_CONNECTOR_PROVIDERS = new Set<ConnectorProvider>([
  "threads",
  "instagram",
  "facebook",
]);

const threadsOAuth: ConnectorOAuthConfig = {
  supported: true,
  envPrefix: "THREADS",
  authorizationUrl: "https://threads.net/oauth/authorize",
  tokenUrl: "https://graph.threads.net/oauth/access_token",
  scopes: ["threads_basic", "threads_content_publish"],
  scopeSeparator: ",",
  userInfo: {
    url: "https://graph.threads.net/v1.0/me",
    request: "query-access-token",
    query: { fields: "id,username" },
    labelPath: ["username"],
  },
  docsUrl: "https://developers.facebook.com/docs/threads",
};

const instagramOAuth: ConnectorOAuthConfig = {
  supported: true,
  envPrefix: "INSTAGRAM",
  authorizationUrl: "https://www.facebook.com/v22.0/dialog/oauth",
  tokenUrl: "https://graph.facebook.com/v22.0/oauth/access_token",
  scopes: [
    "instagram_basic",
    "pages_show_list",
    "pages_read_engagement",
    "instagram_content_publish",
  ],
  scopeSeparator: ",",
  userInfo: {
    url: "https://graph.facebook.com/v22.0/me",
    request: "query-access-token",
    query: { fields: "id,name" },
    labelPath: ["name"],
  },
  docsUrl: "https://developers.facebook.com/docs/instagram-platform",
};

const xOAuth: ConnectorOAuthConfig = {
  supported: true,
  envPrefix: "X",
  authorizationUrl: "https://x.com/i/oauth2/authorize",
  tokenUrl: "https://api.x.com/2/oauth2/token",
  scopes: ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"],
  pkce: true,
  tokenAuth: "basic",
  userInfo: {
    url: "https://api.x.com/2/users/me",
    request: "bearer",
    labelPath: ["data", "username"],
  },
  docsUrl: "https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code",
};

const facebookOAuth: ConnectorOAuthConfig = {
  supported: true,
  envPrefix: "FACEBOOK",
  authorizationUrl: "https://www.facebook.com/v22.0/dialog/oauth",
  tokenUrl: "https://graph.facebook.com/v22.0/oauth/access_token",
  scopes: ["public_profile", "pages_show_list", "pages_read_engagement", "pages_manage_posts"],
  scopeSeparator: ",",
  userInfo: {
    url: "https://graph.facebook.com/v22.0/me",
    request: "query-access-token",
    query: { fields: "id,name" },
    labelPath: ["name"],
  },
  docsUrl: "https://developers.facebook.com/docs/facebook-login",
};

const linkedinOAuth: ConnectorOAuthConfig = {
  supported: true,
  envPrefix: "LINKEDIN",
  authorizationUrl: "https://www.linkedin.com/oauth/v2/authorization",
  tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
  scopes: ["openid", "profile", "email", "w_member_social"],
  userInfo: {
    url: "https://api.linkedin.com/v2/userinfo",
    request: "bearer",
    labelPath: ["name"],
  },
  docsUrl: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/authentication",
};

const tiktokOAuth: ConnectorOAuthConfig = {
  supported: true,
  envPrefix: "TIKTOK",
  authorizationUrl: "https://www.tiktok.com/v2/auth/authorize/",
  tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
  scopes: ["user.info.basic", "video.list"],
  scopeSeparator: ",",
  pkce: true,
  authClientIdParam: "client_key",
  tokenClientIdParam: "client_key",
  userInfo: {
    url: "https://open.tiktokapis.com/v2/user/info/",
    request: "bearer",
    query: { fields: "open_id,display_name,avatar_url" },
    labelPath: ["data", "user", "display_name"],
  },
  docsUrl: "https://developers.tiktok.com/doc/login-kit-web",
};

const youtubeOAuth: ConnectorOAuthConfig = {
  supported: true,
  envPrefix: "YOUTUBE",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [
    "openid",
    "profile",
    "email",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.upload",
  ],
  pkce: true,
  extraAuthParams: {
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
  },
  userInfo: {
    url: "https://openidconnect.googleapis.com/v1/userinfo",
    request: "bearer",
    labelPath: ["email"],
  },
  docsUrl: "https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps",
};

const naverOAuth: ConnectorOAuthConfig = {
  supported: true,
  envPrefix: "NAVER_BLOG",
  authorizationUrl: "https://nid.naver.com/oauth2.0/authorize",
  tokenUrl: "https://nid.naver.com/oauth2.0/token",
  scopes: [],
  includeStateInToken: true,
  userInfo: {
    url: "https://openapi.naver.com/v1/nid/me",
    request: "bearer",
    labelPath: ["response", "nickname"],
  },
  docsUrl: "https://developers.naver.com/docs/login/api/api.md",
};

const kakaoOAuth = (envPrefix: "BRUNCH" | "KAKAO_CHANNEL"): ConnectorOAuthConfig => ({
  supported: true,
  envPrefix,
  authorizationUrl: "https://kauth.kakao.com/oauth/authorize",
  tokenUrl: "https://kauth.kakao.com/oauth/token",
  scopes: ["profile_nickname", "account_email"],
  scopeSeparator: ",",
  pkce: true,
  userInfo: {
    url: "https://kapi.kakao.com/v2/user/me",
    request: "bearer",
    labelPath: ["properties", "nickname"],
  },
  docsUrl: "https://developers.kakao.com/docs/latest/en/kakaologin/rest-api",
});

const tistoryOAuth: ConnectorOAuthConfig = {
  supported: false,
  unavailableReason: "Tistory Open API가 공식 문서상 종료되어 OAuth 연결을 제공하지 않습니다.",
  docsUrl: "https://tistory.github.io/document-tistory-apis",
};

const mediumOAuth: ConnectorOAuthConfig = {
  supported: false,
  unavailableReason: "Medium API는 공식 저장소가 보관 처리되었고 더 이상 지원되지 않습니다.",
  docsUrl: "https://github.com/Medium/medium-api-docs",
};

const threadsAdapter: ConnectorAdapter = {
  provider: "threads",
  label: "Threads",
  loginUrl: "https://www.threads.net/login",
  oauth: threadsOAuth,
  browserLogin: {
    supported: true,
  },
  detectLoggedIn: async (page) => {
    const cookies = await page.context().cookies();
    const session = cookies.find(
      (cookie) =>
        cookie.name === "sessionid" && cookie.domain.includes("threads"),
    );
    if (!session) return null;
    const url = page.url();
    if (url.includes("/login") || url.includes("/accounts/login")) {
      return null;
    }
    const userId = cookies.find((cookie) => cookie.name === "ds_user_id")?.value;
    return { accountLabel: userId ?? "Threads 계정" };
  },
};

const instagramAdapter: ConnectorAdapter = {
  provider: "instagram",
  label: "Instagram",
  loginUrl: "https://www.instagram.com/accounts/login/",
  oauth: instagramOAuth,
  browserLogin: {
    supported: true,
  },
  detectLoggedIn: async (page) => {
    const cookies = await page.context().cookies();
    const session = cookies.find(
      (cookie) =>
        cookie.name === "sessionid" && cookie.domain.includes("instagram"),
    );
    if (!session) return null;
    const url = page.url();
    if (url.includes("/accounts/login")) return null;
    const userId = cookies.find((cookie) => cookie.name === "ds_user_id")?.value;
    return { accountLabel: userId ?? "Instagram 계정" };
  },
};

const xAdapter: ConnectorAdapter = {
  provider: "x",
  label: "X (트위터)",
  loginUrl: "https://x.com/i/flow/login",
  oauth: xOAuth,
  browserLogin: {
    supported: true,
  },
  detectLoggedIn: async (page) => {
    const cookies = await page.context().cookies();
    const auth = cookies.find((cookie) => cookie.name === "auth_token");
    if (!auth) return null;
    const url = page.url();
    if (url.includes("/login") || url.includes("/i/flow")) return null;
    const userIdCookie = cookies.find((cookie) => cookie.name === "twid")?.value;
    return { accountLabel: parseTwidCookie(userIdCookie) ?? "X 계정" };
  },
};

const facebookAdapter: ConnectorAdapter = {
  provider: "facebook",
  label: "Facebook",
  loginUrl: "https://www.facebook.com/login",
  oauth: facebookOAuth,
  browserLogin: {
    supported: true,
  },
  detectLoggedIn: async (page) => {
    const cookies = await page.context().cookies();
    const cUser = cookies.find((cookie) => cookie.name === "c_user");
    if (!cUser) return null;
    const url = page.url();
    if (url.includes("/login") || url.includes("/checkpoint")) return null;
    return { accountLabel: cUser.value ? `id:${cUser.value}` : "Facebook 계정" };
  },
};

const linkedinAdapter: ConnectorAdapter = {
  provider: "linkedin",
  label: "LinkedIn",
  loginUrl: "https://www.linkedin.com/login",
  oauth: linkedinOAuth,
  detectLoggedIn: async (page) => {
    const cookies = await page.context().cookies();
    const liAt = cookies.find((cookie) => cookie.name === "li_at");
    if (!liAt) return null;
    const url = page.url();
    if (url.includes("/login") || url.includes("/checkpoint")) return null;
    return { accountLabel: "LinkedIn 계정" };
  },
};

const tiktokAdapter: ConnectorAdapter = {
  provider: "tiktok",
  label: "TikTok",
  loginUrl: "https://www.tiktok.com/login",
  oauth: tiktokOAuth,
  detectLoggedIn: async (page) => {
    const cookies = await page.context().cookies();
    const session = cookies.find(
      (cookie) =>
        cookie.name === "sessionid" && cookie.domain.includes("tiktok"),
    );
    if (!session) return null;
    const url = page.url();
    if (url.includes("/login")) return null;
    return { accountLabel: "TikTok 계정" };
  },
};

const naverBlogAdapter: ConnectorAdapter = {
  provider: "naver-blog",
  label: "네이버 블로그",
  loginUrl: "https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fblog.naver.com",
  oauth: naverOAuth,
  detectLoggedIn: async (page) => {
    const cookies = await page.context().cookies();
    const auth = cookies.find((cookie) => cookie.name === "NID_AUT");
    if (!auth) return null;
    const url = page.url();
    if (url.includes("nidlogin.login") || url.includes("nidlogin.error")) {
      return null;
    }
    return { accountLabel: "네이버 계정" };
  },
};

const tistoryAdapter: ConnectorAdapter = {
  provider: "tistory",
  label: "Tistory",
  loginUrl: "https://www.tistory.com/auth/login",
  oauth: tistoryOAuth,
  browserLogin: {
    supported: true,
  },
  detectLoggedIn: async (page) => {
    const url = page.url();
    if (url.includes("/auth/login") || url.includes("accounts.kakao.com")) {
      return null;
    }
    const manageLinkCount = await page.locator('a[href*="/manage"]').count().catch(() => 0);
    const bodyText = await page.locator("body").innerText({ timeout: 1_000 }).catch(() => "");
    const loggedInChromeVisible = /계정관리|로그아웃|운영중인 블로그|내 블로그|글쓰기/u.test(
      bodyText,
    );
    if (manageLinkCount > 0 || loggedInChromeVisible || url.includes("/manage")) {
      return { accountLabel: "Tistory 계정" };
    }
    const loginPromptVisible = await page
      .getByText(/카카오계정으로 시작하기|로그인 및 가입하기/u)
      .first()
      .isVisible()
      .catch(() => false);
    if (loginPromptVisible) {
      return null;
    }
    return null;
  },
};

const youtubeAdapter: ConnectorAdapter = {
  provider: "youtube",
  label: "YouTube",
  loginUrl:
    "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fstudio.youtube.com",
  oauth: youtubeOAuth,
  detectLoggedIn: async (page) => {
    const url = page.url();
    if (url.includes("accounts.google.com")) return null;
    if (url.includes("oauth") || url.includes("signin")) return null;
    if (!url.includes("youtube.com") && !url.includes("google.com")) return null;
    const cookies = await page.context().cookies();
    const session = cookies.find(
      (cookie) =>
        cookie.name === "LOGIN_INFO" ||
        cookie.name === "SAPISID" ||
        cookie.name === "__Secure-3PSID",
    );
    if (!session) return null;
    return { accountLabel: "Google 계정" };
  },
};

const brunchAdapter: ConnectorAdapter = {
  provider: "brunch",
  label: "브런치",
  loginUrl:
    "https://accounts.kakao.com/login?continue=https%3A%2F%2Fbrunch.co.kr",
  oauth: kakaoOAuth("BRUNCH"),
  detectLoggedIn: async (page) => {
    const url = page.url();
    if (url.includes("accounts.kakao.com")) return null;
    if (!url.includes("brunch.co.kr")) return null;
    const cookies = await page.context().cookies();
    const session = cookies.find(
      (cookie) =>
        cookie.name === "_kawlt" ||
        cookie.name === "_karmt" ||
        cookie.name === "_kahai",
    );
    if (!session) return null;
    return { accountLabel: "카카오 계정" };
  },
};

const kakaoChannelAdapter: ConnectorAdapter = {
  provider: "kakao-channel",
  label: "카카오 채널",
  loginUrl:
    "https://accounts.kakao.com/login?continue=https%3A%2F%2Fcenter-pf.kakao.com",
  oauth: kakaoOAuth("KAKAO_CHANNEL"),
  detectLoggedIn: async (page) => {
    const url = page.url();
    if (url.includes("accounts.kakao.com")) return null;
    if (!url.includes("kakao.com")) return null;
    const cookies = await page.context().cookies();
    const session = cookies.find(
      (cookie) => cookie.name === "_kawlt" || cookie.name === "_karmt",
    );
    if (!session) return null;
    return { accountLabel: "카카오 계정" };
  },
};

const mediumAdapter: ConnectorAdapter = {
  provider: "medium",
  label: "Medium",
  loginUrl: "https://medium.com/m/signin",
  oauth: mediumOAuth,
  detectLoggedIn: async (page) => {
    const url = page.url();
    if (url.includes("/m/signin") || url.includes("/m/sso")) return null;
    if (!url.includes("medium.com")) return null;
    const cookies = await page.context().cookies();
    const session = cookies.find(
      (cookie) =>
        cookie.name === "sid" ||
        cookie.name === "uid" ||
        cookie.name === "__signed_in",
    );
    if (!session) return null;
    return { accountLabel: "Medium 계정" };
  },
};

const REGISTRY: Record<ConnectorProvider, ConnectorAdapter> = {
  threads: threadsAdapter,
  instagram: instagramAdapter,
  x: xAdapter,
  facebook: facebookAdapter,
  linkedin: linkedinAdapter,
  tiktok: tiktokAdapter,
  youtube: youtubeAdapter,
  "naver-blog": naverBlogAdapter,
  tistory: tistoryAdapter,
  brunch: brunchAdapter,
  "kakao-channel": kakaoChannelAdapter,
  medium: mediumAdapter,
};

export function getConnectorAdapter(provider: ConnectorProvider): ConnectorAdapter {
  const adapter = REGISTRY[provider];
  if (!adapter) {
    throw Object.assign(new Error(`지원하지 않는 커넥터입니다: ${provider}`), {
      statusCode: 400,
    });
  }
  return adapter;
}

export function getConnectorCapabilities(
  provider: ConnectorProvider
): ConnectorCapabilityRecord[] {
  const adapter = getConnectorAdapter(provider);
  const available = isConnectorProviderAvailable(provider);
  if (adapter.capabilities && adapter.capabilities.length > 0) {
    return adapter.capabilities.map((record) => ({
      ...record,
      status: available ? record.status : "planned",
    }));
  }

  const capabilities: ConnectorCapabilityRecord[] = [
    capability({
      id: `${provider}.account.read`,
      provider,
      label: "계정 상태 확인",
      description: `${adapter.label} 연동 계정 상태를 확인합니다.`,
      action: "read",
      requiresBrowser: false,
      requiresConnectedAccount: true,
      requiresApproval: false,
      status: available ? "available" : "planned",
    }),
  ];

  if (provider === "threads") {
    capabilities.push(
      capability({
        id: "threads.automation.prepare",
        provider,
        label: "Automation readiness check",
        description:
          "Validate the connected Threads account and expose safe profile metadata before AI automation runs.",
        action: "read",
        requiresBrowser: true,
        requiresConnectedAccount: true,
        requiresApproval: false,
        status: available ? "available" : "planned",
        source: "backend",
      })
    );
  }

  const scopeText =
    adapter.oauth.supported === true ? adapter.oauth.scopes.join(" ") : "";
  const hasWriteScope = /write|manage|publish|upload|content_publish/iu.test(
    scopeText
  );
  if (hasWriteScope || adapter.browserLogin?.supported === true) {
    capabilities.push(
      capability({
        id: `${provider}.content.write`,
        provider,
        label: "콘텐츠 작성",
        description: `${adapter.label} 콘텐츠를 작성하거나 발행합니다.`,
        action: "write",
        requiresBrowser: adapter.browserLogin?.supported === true,
        requiresConnectedAccount: true,
        requiresApproval: true,
        status: available ? "available" : "planned",
      })
    );
  }

  if (provider === "instagram") {
    capabilities.push(
      capability({
        id: "instagram.automation.prepare",
        provider,
        label: "Automation readiness",
        description:
          "Checks whether the connected Instagram account can be used for Rocky-managed automation preparation.",
        action: "read",
        requiresBrowser: true,
        requiresConnectedAccount: true,
        requiresApproval: false,
        status: available ? "available" : "planned",
      })
    );
  }

  return capabilities;
}

export function listSupportedProviders(): ConnectorProvider[] {
  return Object.keys(REGISTRY) as ConnectorProvider[];
}

export function isConnectorProviderAvailable(provider: ConnectorProvider): boolean {
  return AVAILABLE_CONNECTOR_PROVIDERS.has(provider);
}

function parseTwidCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  // Cookies look like u%3D1234567890; URL-decode and strip the u= prefix.
  try {
    const decoded = decodeURIComponent(raw);
    const match = decoded.match(/u=(\d+)/);
    return match ? `id:${match[1]}` : null;
  } catch {
    return null;
  }
}
