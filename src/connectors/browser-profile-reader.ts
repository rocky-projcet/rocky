import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from "playwright";

import type {
  ConnectorFollowerListRecord,
  ConnectorFollowerRecord,
  ConnectorProfileRecord,
  ConnectorProvider,
  ConnectorReadFollowerListResult,
  ConnectorReadProfileResult,
} from "./connector-types.js";
import {
  connectExistingSystemBrowserContext,
  launchSystemBrowserContext,
} from "./system-browser-context.js";

export interface ConnectorBrowserProfileReadInput {
  provider: ConnectorProvider;
  accountLabel: string;
  storageStateJson: string;
  browserProfileDir?: string | null;
  browserDebuggingPort?: number | null;
  channel: "chrome" | "msedge" | "chromium";
  now: () => string;
}

export type ConnectorBrowserProfileReader = (
  input: ConnectorBrowserProfileReadInput,
) => Promise<ConnectorReadProfileResult>;

export interface ConnectorBrowserFollowerListReadInput
  extends ConnectorBrowserProfileReadInput {
  limit?: number | null;
}

export type ConnectorBrowserFollowerListReader = (
  input: ConnectorBrowserFollowerListReadInput,
) => Promise<ConnectorReadFollowerListResult>;

type BrowserStorageState = Exclude<
  BrowserContextOptions["storageState"],
  string | undefined
>;

export const readBrowserProfile: ConnectorBrowserProfileReader = async (input) => {
  if (input.provider !== "threads") {
    return {
      ok: false,
      provider: input.provider,
      status: "failed",
      accountLabel: input.accountLabel,
      profile: null,
      message: "현재 브라우저 기반 프로필 조회는 Threads만 지원합니다.",
      checkedAt: input.now(),
    };
  }

  return readThreadsProfile(input);
};

export const readBrowserFollowerList: ConnectorBrowserFollowerListReader = async (
  input,
) => {
  if (input.provider !== "threads") {
    return {
      ok: false,
      provider: input.provider,
      status: "failed",
      accountLabel: input.accountLabel,
      followers: null,
      message: "현재 브라우저 기반 팔로워 목록 조회는 Threads만 지원합니다.",
      checkedAt: input.now(),
    };
  }

  return readThreadsFollowerList(input);
};

async function readThreadsProfile(
  input: ConnectorBrowserProfileReadInput,
): Promise<ConnectorReadProfileResult> {
  return withThreadsBrowserPage(input, async (page) => {
    const profile = await readThreadsProfileFromPage(page, input.accountLabel);
    return {
      ok: true,
      provider: "threads",
      status: "profile-read",
      accountLabel: input.accountLabel,
      profile,
      message: "Threads 프로필을 연결된 브라우저 세션으로 조회했습니다.",
      checkedAt: input.now(),
    };
  });
}

async function readThreadsFollowerList(
  input: ConnectorBrowserFollowerListReadInput,
): Promise<ConnectorReadFollowerListResult> {
  return withThreadsBrowserPage(input, async (page) => {
    await openThreadsProfilePage(page, input.accountLabel);
    await openThreadsFollowersPanel(page);
    const followers = await readThreadsFollowersFromPage(
      page,
      normalizeFollowerLimit(input.limit),
    );
    return {
      ok: true,
      provider: "threads",
      status: "followers-read",
      accountLabel: input.accountLabel,
      followers,
      message:
        followers.items.length > 0
          ? `Threads 팔로워 ${followers.items.length}명을 연결된 브라우저 세션으로 조회했습니다.`
          : "Threads 팔로워 화면을 열었지만 이름 목록을 찾지 못했습니다.",
      checkedAt: input.now(),
    };
  });
}

async function withThreadsBrowserPage<T>(
  input: ConnectorBrowserProfileReadInput,
  callback: (page: Page) => Promise<T>,
): Promise<T> {
  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless: false,
  };
  if (input.channel === "chrome" || input.channel === "msedge") {
    launchOptions.channel = input.channel;
  }
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let systemBrowser: Awaited<ReturnType<typeof launchSystemBrowserContext>> = null;
  try {
    const viewport = { width: 1280, height: 900 };
    if (input.browserProfileDir) {
      if (input.browserDebuggingPort) {
        systemBrowser = await connectExistingSystemBrowserContext({
          debuggingPort: input.browserDebuggingPort,
          viewport,
        }).catch(() => null);
      }
      if (!systemBrowser) {
        systemBrowser = await launchSystemBrowserContext({
          channel: input.channel,
          userDataDir: input.browserProfileDir,
          locale: "ko-KR",
          viewport,
        }).catch(() => null);
      }
      context = systemBrowser
        ? systemBrowser.context
        : await createStorageStateContext({
            storageStateJson: input.storageStateJson,
            launchOptions,
            viewport,
            onBrowser: (launched) => {
              browser = launched;
            },
          });
      if (systemBrowser) {
        await restoreStorageStateCookies(context, input.storageStateJson);
      }
    } else {
      context = await createStorageStateContext({
        storageStateJson: input.storageStateJson,
        launchOptions,
        viewport,
        onBrowser: (launched) => {
          browser = launched;
        },
      });
    }

    const page = await context.newPage();
    return await callback(page);
  } finally {
    if (systemBrowser) {
      await systemBrowser.close().catch(() => {});
    } else if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function createStorageStateContext(input: {
  storageStateJson: string;
  launchOptions: Parameters<typeof chromium.launch>[0];
  viewport: { width: number; height: number };
  onBrowser: (browser: Browser) => void;
}): Promise<BrowserContext> {
  const browser = await chromium.launch(input.launchOptions);
  input.onBrowser(browser);
  return browser.newContext({
    locale: "ko-KR",
    storageState: parseStorageState(input.storageStateJson),
    viewport: input.viewport,
  });
}

async function restoreStorageStateCookies(
  context: BrowserContext,
  storageStateJson: string,
): Promise<void> {
  const storageState = parseStorageState(storageStateJson);
  const cookies = storageState.cookies.filter(
    (cookie) =>
      typeof cookie.name === "string" &&
      typeof cookie.value === "string" &&
      typeof cookie.domain === "string" &&
      typeof cookie.path === "string",
  );
  if (cookies.length === 0) return;
  await context.addCookies(cookies);
}

async function readThreadsProfileFromPage(
  page: Page,
  accountLabel: string,
): Promise<ConnectorProfileRecord> {
  await openThreadsProfilePage(page, accountLabel);
  const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  const metadata = await readPageMetadata(page);
  return buildThreadsProfileRecord({
    accountLabel,
    url: page.url(),
    title: metadata.title,
    description: metadata.description,
    bodyText,
  });
}

async function openThreadsProfilePage(
  page: Page,
  accountLabel: string,
): Promise<void> {
  await page.goto("https://www.threads.net/", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await assertThreadsLoggedIn(page);

  const profileUrl = await resolveThreadsProfileUrl(page, accountLabel);
  if (profileUrl) {
    await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await assertThreadsLoggedIn(page);
  } else if (!extractThreadsUsername(page.url())) {
    throw new Error(
      "Threads 프로필 링크를 찾지 못했습니다. 계정 연동을 새로고침한 뒤 다시 시도해 주세요.",
    );
  }
}

async function openThreadsFollowersPanel(page: Page): Promise<void> {
  const profileUrl = page.url();
  if (await clickThreadsFollowersControl(page)) {
    return;
  }

  const directFollowerUrl = buildThreadsFollowersUrl(page.url());
  if (directFollowerUrl) {
    await page.goto(directFollowerUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    await assertThreadsLoggedIn(page);
    if (await pageContainsFollowerSurface(page)) {
      return;
    }
    await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    await assertThreadsLoggedIn(page);
    if (await clickThreadsFollowersControl(page)) {
      return;
    }
  }

  throw new Error("Threads 팔로워 화면을 찾지 못했습니다.");
}

async function clickThreadsFollowersControl(page: Page): Promise<boolean> {
  const clicked = await clickFirstVisible([
    page.locator('[role="button"]:has-text("followers")').first(),
    page.locator('[role="button"]:has-text("팔로워")').first(),
    page.locator('a[href*="/followers"]').first(),
    page.locator('a:has-text("followers")').first(),
    page.locator('a:has-text("팔로워")').first(),
    page.getByText(/followers|팔로워/iu).first(),
  ]);
  if (!clicked) return false;
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(1_000);
  await assertThreadsLoggedIn(page);
  return true;
}

async function assertThreadsLoggedIn(page: Page): Promise<void> {
  const url = page.url();
  if (url.includes("/login") || url.includes("/accounts/login")) {
    throw new Error("Threads 로그인 세션이 만료되었습니다. 계정 연동을 다시 진행해 주세요.");
  }

  const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  if (/로그인|Log in|Sign up|가입/u.test(bodyText) && !/@[a-z0-9._]+/iu.test(bodyText)) {
    throw new Error("Threads 로그인 세션이 만료되었습니다. 계정 연동을 다시 진행해 주세요.");
  }
}

async function resolveThreadsProfileUrl(
  page: Page,
  accountLabel: string,
): Promise<string | null> {
  const normalized = normalizeThreadsUsername(accountLabel);
  if (normalized) {
    return `https://www.threads.net/@${normalized}`;
  }

  const hrefs = await page
    .locator("a[href]")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute("href") ?? "")
        .filter((href) => /^\/@[a-z0-9._]+\/?$/iu.test(href)),
    )
    .catch(() => []);
  const firstProfileHref = hrefs[0];
  if (!firstProfileHref) {
    return null;
  }
  return new URL(firstProfileHref, page.url()).toString();
}

async function readPageMetadata(
  page: Page,
): Promise<{ title: string; description: string | null }> {
  const title = await page.title().catch(() => "");
  const description =
    (await page
      .locator('meta[name="description"]')
      .first()
      .getAttribute("content")
      .catch(() => null)) ??
    (await page
      .locator('meta[property="og:description"]')
      .first()
      .getAttribute("content")
      .catch(() => null));
  return { title, description };
}

async function readThreadsFollowersFromPage(
  page: Page,
  limit: number,
): Promise<ConnectorFollowerListRecord> {
  const currentUsername = extractThreadsUsername(page.url());
  const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  const anchorRecords = await page
    .locator('a[href^="/@"], a[href*="threads.net/@"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        href: node.getAttribute("href") ?? "",
        text: (node.textContent ?? "").replace(/\s+/gu, " ").trim(),
      })),
    )
    .catch(() => []);
  const items = mergeFollowerRecords([
    ...followerRecordsFromLines(bodyText, currentUsername),
    ...anchorRecords.map((record) =>
      followerRecordFromAnchor(record.href, record.text, page.url()),
    ),
  ])
    .filter((record) => !sameUsername(record.username, currentUsername))
    .slice(0, limit);

  return {
    items,
    url: page.url() || null,
    rawText: uniqueNonEmptyLines(bodyText).slice(0, 80).join("\n") || null,
  };
}

function buildThreadsProfileRecord(input: {
  accountLabel: string;
  url: string;
  title: string;
  description: string | null;
  bodyText: string;
}): ConnectorProfileRecord {
  const lines = uniqueNonEmptyLines(
    [input.title, input.description ?? "", input.bodyText].join("\n"),
  );
  const username =
    extractThreadsUsername(input.url) ??
    lines.map(extractThreadsUsername).find((value): value is string => Boolean(value)) ??
    normalizeThreadsUsername(input.accountLabel);
  const usernameLine = username ? `@${username}` : null;
  const usernameIndex =
    usernameLine === null
      ? -1
      : lines.findIndex((line) => line.toLowerCase() === usernameLine.toLowerCase());
  const displayName =
    usernameIndex > 0
      ? cleanProfileLine(lines[usernameIndex - 1])
      : cleanProfileLine(lines.find((line) => !line.startsWith("@")) ?? null);
  const followersText =
    lines.find((line) => /followers|팔로워|follower/iu.test(line)) ?? null;
  const bio =
    usernameIndex >= 0
      ? cleanProfileLine(
          lines
            .slice(usernameIndex + 1)
            .find(
              (line) =>
                line !== followersText &&
                !/^threads$/iu.test(line) &&
                !/followers|팔로워|follower/iu.test(line),
            ) ?? null,
        )
      : null;

  return {
    id: /^\d+$/u.test(input.accountLabel) ? input.accountLabel : null,
    username,
    displayName,
    bio,
    followersText,
    url: input.url,
    rawText: lines.slice(0, 20).join("\n") || null,
  };
}

function buildThreadsFollowersUrl(value: string): string | null {
  const username = extractThreadsUsername(value);
  return username ? `https://www.threads.net/@${username}/followers` : null;
}

async function pageContainsFollowerSurface(page: Page): Promise<boolean> {
  const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  return /followers|팔로워/iu.test(bodyText);
}

async function clickFirstVisible(locators: Locator[]): Promise<boolean> {
  for (const locator of locators) {
    if (await locator.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await locator.click({ timeout: 5_000 });
      return true;
    }
  }
  return false;
}

function followerRecordFromAnchor(
  href: string,
  text: string,
  baseUrl: string,
): ConnectorFollowerRecord | null {
  const username = extractThreadsUsername(href) ?? extractThreadsUsername(text);
  const cleanedText = cleanProfileLine(text);
  if (!username && !cleanedText) {
    return null;
  }
  if (isFollowerChromeText(cleanedText ?? "")) {
    return null;
  }
  return {
    username,
    displayName: displayNameFromFollowerText(cleanedText, username),
    profileUrl: username ? new URL(`/@${username}`, baseUrl).toString() : null,
    rawText: cleanedText ?? (username ? `@${username}` : ""),
  };
}

function followerRecordsFromLines(
  bodyText: string,
  currentUsername: string | null,
): ConnectorFollowerRecord[] {
  const lines = uniqueNonEmptyLines(bodyText);
  const records: ConnectorFollowerRecord[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const username = usernameFromFollowerLine(line);
    if (!username || sameUsername(username, currentUsername) || isFollowerChromeText(line)) {
      continue;
    }
    const previous = index > 0 ? lines[index - 1] : null;
    const next = index + 1 < lines.length ? lines[index + 1]! : null;
    const hasExplicitUsername = Boolean(extractThreadsUsername(line));
    const nextLooksLikeUsername = Boolean(usernameFromFollowerLine(next ?? ""));
    const displayNameSource =
      hasExplicitUsername ? previous : nextLooksLikeUsername ? null : next;
    records.push({
      username,
      displayName: displayNameFromFollowerText(displayNameSource, username),
      profileUrl: `https://www.threads.net/@${username}`,
      rawText: line,
    });
  }
  return records;
}

function mergeFollowerRecords(
  records: Array<ConnectorFollowerRecord | null>,
): ConnectorFollowerRecord[] {
  const byKey = new Map<string, ConnectorFollowerRecord>();
  for (const record of records) {
    if (!record) continue;
    const key = (record.username ?? record.displayName ?? record.rawText).toLowerCase();
    if (!key || byKey.has(key)) continue;
    byKey.set(key, record);
  }
  return [...byKey.values()];
}

function displayNameFromFollowerText(
  value: string | null,
  username: string | null,
): string | null {
  const cleaned = cleanProfileLine(value);
  if (!cleaned || isFollowerChromeText(cleaned)) {
    return null;
  }
  if (sameUsername(cleaned, username)) {
    return null;
  }
  const withoutUsername = username
    ? cleaned.replace(new RegExp(`@${escapeRegExp(username)}`, "iu"), "").trim()
    : cleaned;
  return cleanProfileLine(withoutUsername) ?? cleaned;
}

function isFollowerChromeText(value: string): boolean {
  return /^(followers|following|follow|requested|팔로워|팔로잉|팔로우|맞팔로우|요청함|threads|home|search|login|log in|sign up|instagram|가입|로그인)$/iu.test(value);
}

function normalizeFollowerLimit(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 50;
  }
  return Math.max(1, Math.min(Math.trunc(value), 200));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizeThreadsUsername(value: string): string | null {
  const trimmed = value.trim().replace(/^@/u, "");
  if (!trimmed || /^\d+$/u.test(trimmed)) {
    return null;
  }
  return /^[a-z0-9._]+$/iu.test(trimmed) ? trimmed : null;
}

function usernameFromFollowerLine(value: string): string | null {
  return extractThreadsUsername(value) ?? normalizeThreadsUsername(value);
}

function extractThreadsUsername(value: string): string | null {
  const match = value.match(/(?:^|[^\w.])@([a-z0-9._]+)/iu);
  return match?.[1] ?? null;
}

function sameUsername(left: string | null, right: string | null): boolean {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function uniqueNonEmptyLines(value: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of value.split(/\r?\n/u)) {
    const trimmed = cleanProfileLine(line);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(trimmed);
  }
  return lines;
}

function cleanProfileLine(value: string | null): string | null {
  const cleaned = value?.replace(/\s+/gu, " ").trim() ?? "";
  return cleaned || null;
}

function parseStorageState(storageStateJson: string): BrowserStorageState {
  const parsed = JSON.parse(storageStateJson) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("저장된 브라우저 세션 형식이 올바르지 않습니다.");
  }
  return parsed as BrowserStorageState;
}
