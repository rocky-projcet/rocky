import type { ConnectorAdapter } from "./connector-runner.js";
import type { ConnectorProvider } from "./connector-types.js";

const threadsAdapter: ConnectorAdapter = {
  provider: "threads",
  label: "Threads",
  loginUrl: "https://www.threads.net/login",
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
  detectLoggedIn: async (page) => {
    const cookies = await page.context().cookies();
    const session = cookies.find(
      (cookie) =>
        (cookie.name === "TSSESSION" || cookie.name === "_T_ANO") &&
        cookie.domain.includes("tistory"),
    );
    if (!session) return null;
    const url = page.url();
    if (url.includes("/auth/login")) return null;
    return { accountLabel: "Tistory 계정" };
  },
};

const youtubeAdapter: ConnectorAdapter = {
  provider: "youtube",
  label: "YouTube",
  loginUrl:
    "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fstudio.youtube.com",
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

export function listSupportedProviders(): ConnectorProvider[] {
  return Object.keys(REGISTRY) as ConnectorProvider[];
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
