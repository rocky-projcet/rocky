import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { ConnectorProvider } from "./connector-types.js";

export type InstagramFeedScreenBrowserMode = "playwright-public" | "chrome-assist";

export interface InstagramFeedScreenInput {
  handles: string[];
  postsPerHandle: number;
  browserMode: InstagramFeedScreenBrowserMode;
}

export interface InstagramFeedScreenPostRecord {
  url: string;
  status: "completed" | "failed";
  caption: string | null;
  metaDescription: string | null;
  visibleEngagementText: string | null;
  artifactRefs?: string[];
  error: string | null;
}

export interface InstagramFeedScreenProfileRecord {
  handle: string;
  status: "completed" | "failed";
  profileUrl: string;
  profileTitle: string | null;
  bio: string | null;
  followerText: string | null;
  recentPostUrls: string[];
  posts: InstagramFeedScreenPostRecord[];
  artifactRefs?: string[];
  error: string | null;
}

export interface InstagramFeedScreenResult {
  provider: Extract<ConnectorProvider, "instagram">;
  capabilityId: "instagram.feed.screen";
  browserMode: InstagramFeedScreenBrowserMode;
  status: "completed" | "partial" | "failed" | "planned";
  handles: InstagramFeedScreenProfileRecord[];
  checkedAt: string;
  notices: string[];
}

export type InstagramFeedScreener = (input: {
  request: InstagramFeedScreenInput;
  now: () => string;
}) => Promise<InstagramFeedScreenResult>;

const MAX_HANDLES = 5;
const MAX_POSTS_PER_HANDLE = 10;
const DEFAULT_POSTS_PER_HANDLE = 3;
const INSTAGRAM_ORIGIN = "https://www.instagram.com";

export function normalizeInstagramFeedScreenInput(
  args: Record<string, unknown>,
): { ok: true; value: InstagramFeedScreenInput } | { ok: false; message: string } {
  const rawHandles = readHandles(args);
  const handles = [...new Set(rawHandles.map(normalizeInstagramHandle).filter(Boolean))];
  if (handles.length === 0) {
    return { ok: false, message: "instagram.feed.screen requires 1-5 public Instagram handles." };
  }
  if (handles.length > MAX_HANDLES) {
    return { ok: false, message: `instagram.feed.screen accepts at most ${MAX_HANDLES} handles per run.` };
  }

  const requestedPosts = readPositiveInteger(
    args.postsPerHandle ?? args.posts_per_handle ?? args.limit,
  );
  const postsPerHandle = Math.min(
    requestedPosts ?? DEFAULT_POSTS_PER_HANDLE,
    MAX_POSTS_PER_HANDLE,
  );
  const browserMode = normalizeBrowserMode(args.browserMode ?? args.browser_mode ?? args.mode);
  if (!browserMode) {
    return {
      ok: false,
      message: "browserMode must be playwright-public or chrome-assist.",
    };
  }

  return {
    ok: true,
    value: {
      handles,
      postsPerHandle,
      browserMode,
    },
  };
}

export async function screenInstagramFeedWithPlaywright(input: {
  request: InstagramFeedScreenInput;
  now: () => string;
}): Promise<InstagramFeedScreenResult> {
  if (input.request.browserMode === "chrome-assist") {
    return chromeAssistPlannedResult(input.request, input.now());
  }

  let browser: Browser | null = null;
  const handles: InstagramFeedScreenProfileRecord[] = [];
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    for (const handle of input.request.handles) {
      handles.push(await screenPublicProfile(context, handle, input.request.postsPerHandle));
    }
  } catch (error) {
    const message = sanitizeInstagramScreenText(
      error instanceof Error ? error.message : String(error),
    ) ?? "Instagram feed screening failed.";
    for (const handle of input.request.handles.slice(handles.length)) {
      handles.push(failedProfile(handle, message));
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }

  return buildScreenResult(input.request, input.now(), handles);
}

export function chromeAssistPlannedResult(
  request: InstagramFeedScreenInput,
  checkedAt: string,
): InstagramFeedScreenResult {
  return {
    provider: "instagram",
    capabilityId: "instagram.feed.screen",
    browserMode: "chrome-assist",
    status: "planned",
    handles: request.handles.map((handle) => failedProfile(
      handle,
      "Chrome assist feed screening is represented in the API design but is not executable in this Playwright MVP.",
    )),
    checkedAt,
    notices: [
      "Browser assist session semantics are read-only screening support and are separate from Instagram Graph API credentials or publishing permissions.",
      "Rocky does not persist cookies, tokens, browser storage, or unsanitized page HTML from this capability.",
    ],
  };
}

function readHandles(args: Record<string, unknown>): string[] {
  const value = args.handles ?? args.handle ?? args.usernames ?? args.username;
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value === "string") {
    return value.split(/[\s,]+/u);
  }
  return [];
}

function normalizeInstagramHandle(raw: string): string {
  let value = raw.trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!/(^|\.)instagram\.com$/iu.test(url.hostname)) return "";
    value = url.pathname.split("/").filter(Boolean)[0] ?? "";
  } catch {
    // Not a URL; treat as handle text.
  }
  value = value.replace(/^@/u, "").trim().toLowerCase();
  return /^[a-z0-9._]{1,30}$/u.test(value) ? value : "";
}

function normalizeBrowserMode(value: unknown): InstagramFeedScreenBrowserMode | null {
  if (value == null || value === "" || value === "playwright" || value === "deterministic") {
    return "playwright-public";
  }
  if (value === "playwright-public") return "playwright-public";
  if (value === "chrome" || value === "chrome-assist" || value === "browser-assist") {
    return "chrome-assist";
  }
  return null;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(1, Math.trunc(value));
}

async function screenPublicProfile(
  context: BrowserContext,
  handle: string,
  postsPerHandle: number,
): Promise<InstagramFeedScreenProfileRecord> {
  const page = await context.newPage();
  const profileUrl = `${INSTAGRAM_ORIGIN}/${handle}/`;
  try {
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    const title = sanitizeInstagramScreenText(await page.title().catch(() => ""));
    const bodyText = sanitizeInstagramScreenText(
      await page.locator("body").innerText({ timeout: 3_000 }).catch(() => ""),
    );
    const metaDescription = sanitizeInstagramScreenText(
      await readMetaContent(page, "description"),
    );
    const postUrls = await collectPostUrls(page, postsPerHandle);
    const posts: InstagramFeedScreenPostRecord[] = [];
    for (const url of postUrls) {
      posts.push(await screenPublicPost(context, url));
    }
    return {
      handle,
      status: "completed",
      profileUrl,
      profileTitle: title,
      bio: extractBio(bodyText, metaDescription),
      followerText: extractFollowerText(bodyText, metaDescription),
      recentPostUrls: postUrls,
      posts,
      error: null,
    };
  } catch (error) {
    return failedProfile(handle, error instanceof Error ? error.message : String(error));
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function screenPublicPost(
  context: BrowserContext,
  url: string,
): Promise<InstagramFeedScreenPostRecord> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    const metaDescription = sanitizeInstagramScreenText(
      (await readMetaContent(page, "og:description")) || (await readMetaContent(page, "description")),
    );
    const bodyText = sanitizeInstagramScreenText(
      await page.locator("body").innerText({ timeout: 3_000 }).catch(() => ""),
    );
    return {
      url,
      status: "completed",
      caption: extractCaption(bodyText, metaDescription),
      metaDescription,
      visibleEngagementText: extractEngagementText(bodyText, metaDescription),
      error: null,
    };
  } catch (error) {
    return {
      url,
      status: "failed",
      caption: null,
      metaDescription: null,
      visibleEngagementText: null,
      error: sanitizeInstagramScreenText(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function readMetaContent(page: Page, name: string): Promise<string> {
  return page
    .locator(`meta[property="${name}"], meta[name="${name}"]`)
    .first()
    .getAttribute("content", { timeout: 1_000 })
    .catch(() => "") ?? "";
}

async function collectPostUrls(page: Page, limit: number): Promise<string[]> {
  const hrefs = await page
    .locator('a[href*="/p/"], a[href*="/reel/"]')
    .evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href))
    .catch(() => []);
  const urls = hrefs
    .map((href) => {
      try {
        const url = new URL(href, INSTAGRAM_ORIGIN);
        const isCanonicalPostPath = /^\/(?:[^/]+\/)?(?:p|reel)\//u.test(url.pathname);
        return url.hostname.endsWith("instagram.com") && isCanonicalPostPath
          ? `${url.origin}${url.pathname}`
          : null;
      } catch {
        return null;
      }
    })
    .filter((url): url is string => Boolean(url));
  return [...new Set(urls)].slice(0, limit);
}

function buildScreenResult(
  request: InstagramFeedScreenInput,
  checkedAt: string,
  handles: InstagramFeedScreenProfileRecord[],
): InstagramFeedScreenResult {
  const completed = handles.filter((handle) => handle.status === "completed").length;
  const status = completed === handles.length ? "completed" : completed === 0 ? "failed" : "partial";
  return {
    provider: "instagram",
    capabilityId: "instagram.feed.screen",
    browserMode: request.browserMode,
    status,
    handles,
    checkedAt,
    notices: [
      "Public Instagram browser screening is read-only and separate from Instagram Graph API connection, credential, or publishing permission semantics.",
      "Results contain sanitized visible/meta text only; cookies, tokens, browser storage, and full page HTML are not persisted.",
    ],
  };
}

function failedProfile(handle: string, error: string): InstagramFeedScreenProfileRecord {
  return {
    handle,
    status: "failed",
    profileUrl: `${INSTAGRAM_ORIGIN}/${handle}/`,
    profileTitle: null,
    bio: null,
    followerText: null,
    recentPostUrls: [],
    posts: [],
    error: sanitizeInstagramScreenText(error),
  };
}

function extractBio(bodyText: string | null, metaDescription: string | null): string | null {
  return firstNonEmpty([metaDescription, firstLines(bodyText, 5)]);
}

function extractFollowerText(bodyText: string | null, metaDescription: string | null): string | null {
  const source = `${metaDescription ?? ""}\n${bodyText ?? ""}`;
  const match = source.match(/(?:[\d.,]+\s*[KMB만천]?\s*)?(?:followers|팔로워)[^\n.]*/iu);
  return sanitizeInstagramScreenText(match?.[0] ?? null);
}

function extractCaption(bodyText: string | null, metaDescription: string | null): string | null {
  return firstNonEmpty([metaDescription, firstLines(bodyText, 8)]);
}

function extractEngagementText(bodyText: string | null, metaDescription: string | null): string | null {
  const source = `${metaDescription ?? ""}\n${bodyText ?? ""}`;
  const matches = source.match(/[^\n]*(?:likes|views|comments|좋아요|조회|댓글)[^\n]*/giu) ?? [];
  return sanitizeInstagramScreenText(matches.slice(0, 4).join(" | "));
}

function firstLines(value: string | null, count: number): string | null {
  if (!value) return null;
  return value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, count).join("\n");
}

function firstNonEmpty(values: Array<string | null>): string | null {
  for (const value of values) {
    const sanitized = sanitizeInstagramScreenText(value);
    if (sanitized) return sanitized;
  }
  return null;
}

export function sanitizeInstagramScreenText(value: string | null | undefined): string | null {
  if (!value) return null;
  const sanitized = value
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/(?:access_token|sessionid|csrftoken|ds_user_id|Authorization)\s*[:=]\s*[^\s&]+/giu, "$1=[redacted]")
    .replace(/(?:bearer\s+)[a-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/[\u0000-\u001f\u007f]+/gu, "\n")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return sanitized ? sanitized.slice(0, 4_000) : null;
}
