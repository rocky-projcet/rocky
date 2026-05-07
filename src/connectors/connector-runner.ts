import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

import type { ChromiumChannel, ConnectorProvider } from "./connector-types.js";

export interface ConnectorAdapter {
  provider: ConnectorProvider;
  label: string;
  loginUrl: string;
  /**
   * Inspect the browser page to determine whether the user has finished
   * logging in. Should be cheap; called repeatedly. Returns null until the
   * login is detected, then returns the resolved account label.
   */
  detectLoggedIn: (page: Page) => Promise<{ accountLabel: string } | null>;
}

export type ConnectorRunnerEvent =
  | { kind: "connected"; accountLabel: string; storageStateJson: string }
  | { kind: "failed"; message: string };

export interface ConnectorRunnerSession {
  cancel: () => Promise<void>;
}

const POLL_INTERVAL_MS = 1500;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export async function startHeadedLogin(input: {
  adapter: ConnectorAdapter;
  channel: ChromiumChannel;
  onEvent: (event: ConnectorRunnerEvent) => void;
}): Promise<ConnectorRunnerSession> {
  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless: false,
  };
  if (input.channel === "chrome" || input.channel === "msedge") {
    launchOptions.channel = input.channel;
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1100, height: 800 },
    locale: "ko-KR",
  });
  const page = await context.newPage();

  const state = {
    succeeded: false,
    cancelled: false,
    closed: false,
  };

  await page.goto(input.adapter.loginUrl, { waitUntil: "domcontentloaded" }).catch(() => {
    // Navigation can fail when the user closes the window; the disconnect
    // listener handles surfacing that.
  });

  const finalize = async (event: ConnectorRunnerEvent | null) => {
    if (state.closed) return;
    state.closed = true;
    try {
      await context.close();
    } catch {
      // ignore
    }
    try {
      await browser.close();
    } catch {
      // ignore
    }
    if (event) input.onEvent(event);
  };

  const onDisconnect = () => {
    if (state.succeeded || state.closed || state.cancelled) return;
    void finalize({
      kind: "failed",
      message: "로그인 창이 닫혔어요. 다시 시도해 주세요.",
    });
  };
  browser.on("disconnected", onDisconnect);

  const checkSuccess = async () => {
    if (state.succeeded || state.closed) return;
    let result: { accountLabel: string } | null = null;
    try {
      result = await input.adapter.detectLoggedIn(page);
    } catch {
      // adapters may throw on transient navigation; ignore and try again
      return;
    }
    if (!result) return;
    state.succeeded = true;
    let storageStateJson = "";
    try {
      storageStateJson = JSON.stringify(await context.storageState());
    } catch (error) {
      void finalize({
        kind: "failed",
        message:
          error instanceof Error
            ? error.message
            : "세션을 저장하지 못했습니다.",
      });
      return;
    }
    void finalize({
      kind: "connected",
      accountLabel: result.accountLabel,
      storageStateJson,
    });
  };

  const interval = setInterval(() => {
    void checkSuccess();
  }, POLL_INTERVAL_MS);

  const timeout = setTimeout(() => {
    if (state.succeeded || state.closed) return;
    void finalize({
      kind: "failed",
      message:
        "로그인 시간이 너무 길어요. 창을 닫고 다시 시도해 주세요. (10분 초과)",
    });
  }, LOGIN_TIMEOUT_MS);

  page.on("framenavigated", () => {
    void checkSuccess();
  });

  // First quick check — some sites may already be logged in.
  void checkSuccess();

  return {
    cancel: async () => {
      state.cancelled = true;
      clearInterval(interval);
      clearTimeout(timeout);
      await finalize(null);
    },
  };
}

export async function detectChromium(): Promise<{
  available: boolean;
  channel: ChromiumChannel | null;
  message: string;
}> {
  // Prefer system Chrome — no extra download.
  const candidates: ChromiumChannel[] = ["chrome", "msedge", "chromium"];
  for (const channel of candidates) {
    try {
      const launchOptions: Parameters<typeof chromium.launch>[0] = {
        headless: true,
      };
      if (channel === "chrome" || channel === "msedge") {
        launchOptions.channel = channel;
      }
      const browser = await chromium.launch(launchOptions);
      await browser.close();
      return {
        available: true,
        channel,
        message:
          channel === "chromium"
            ? "Playwright 번들 Chromium 사용"
            : channel === "chrome"
              ? "시스템 Chrome 사용"
              : "시스템 Edge 사용",
      };
    } catch {
      // Try the next candidate.
    }
  }
  return {
    available: false,
    channel: null,
    message:
      "Chrome 또는 Edge가 시스템에 없고 Playwright Chromium도 설치되지 않았어요.",
  };
}

// Re-export type for convenience.
export type { Browser, BrowserContext, Page };
