import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "playwright";

import type { ConnectorProvider } from "./connector-types.js";
import type {
  ConnectorPublishDraftInput,
  ConnectorPublishDraftResult,
} from "./connector-types.js";
import {
  connectExistingSystemBrowserContext,
  launchSystemBrowserContext,
} from "./system-browser-context.js";

export interface ConnectorBrowserDraftPublishInput {
  provider: ConnectorProvider;
  accountLabel: string;
  storageStateJson: string;
  browserProfileDir?: string | null;
  browserDebuggingPort?: number | null;
  draft: ConnectorPublishDraftInput;
  channel: "chrome" | "msedge" | "chromium";
  now: () => string;
}

export type ConnectorBrowserDraftPublisher = (
  input: ConnectorBrowserDraftPublishInput,
) => Promise<ConnectorPublishDraftResult>;

type BrowserStorageState = Exclude<
  BrowserContextOptions["storageState"],
  string | undefined
>;

export const publishBrowserDraft: ConnectorBrowserDraftPublisher = async (input) => {
  if (input.provider !== "tistory") {
    return {
      ok: false,
      provider: input.provider,
      status: "failed",
      accountLabel: input.accountLabel,
      url: null,
      message: "현재 커스텀 브라우저 발행은 Tistory만 지원합니다.",
      checkedAt: input.now(),
    };
  }

  return publishTistoryDraft(input);
};

async function publishTistoryDraft(
  input: ConnectorBrowserDraftPublishInput,
): Promise<ConnectorPublishDraftResult> {
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
    if (input.browserProfileDir) {
      const viewport = { width: 1280, height: 900 };
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
      const viewport = { width: 1280, height: 900 };
      browser = await chromium.launch(launchOptions);
      context = await browser.newContext({
        locale: "ko-KR",
        storageState: parseStorageState(input.storageStateJson),
        viewport,
      });
    }
    const page = await context.newPage();
    const newPostUrl = await resolveTistoryNewPostUrl(page);
    await page.goto(newPostUrl, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await assertTistoryEditorAvailable(page);

    await dismissTistoryEditorPrompts(page);
    await fillTistoryTitle(page, input.draft.title);
    await fillTistoryBody(page, input.draft.contentMarkdown);
    await fillTistoryTags(page, input.draft.tags ?? []);
    await saveTistoryDraft(page);

    return {
      ok: true,
      provider: input.provider,
      status: "draft-saved",
      accountLabel: input.accountLabel,
      url: page.url(),
      message: "Tistory 글쓰기 화면에 원고를 입력하고 임시저장했습니다.",
      checkedAt: input.now(),
    };
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

async function createStorageStateContext(
  input: {
    storageStateJson: string;
    launchOptions: Parameters<typeof chromium.launch>[0];
    viewport: { width: number; height: number };
    onBrowser: (browser: Browser) => void;
  },
): Promise<BrowserContext> {
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

async function resolveTistoryNewPostUrl(page: Page): Promise<string> {
  const discoveryUrls = [
    "https://www.tistory.com/",
    "https://www.tistory.com/feed",
  ];

  for (const url of discoveryUrls) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    if (await isTistoryLoggedOut(page)) {
      continue;
    }

    const manageUrl = await findTistoryManageUrl(page);
    if (!manageUrl) {
      continue;
    }
    const parsed = new URL(manageUrl, page.url());
    if (!parsed.hostname.endsWith(".tistory.com") || parsed.hostname === "www.tistory.com") {
      continue;
    }
    return new URL("/manage/newpost/", parsed.origin).toString();
  }

  throw new Error(
    "Tistory 로그인 세션이 유효하지 않거나 관리 가능한 블로그를 찾지 못했습니다. 계정 연동을 다시 진행해 주세요.",
  );
}

async function isTistoryLoggedOut(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("/auth/login") || url.includes("accounts.kakao.com")) {
    return true;
  }
  const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  const hasLoggedInChrome = /계정관리|로그아웃|운영중인 블로그|내 블로그|글쓰기/u.test(
    bodyText,
  );
  const manageLinkCount = await page.locator('a[href*="/manage"]').count().catch(() => 0);
  if (hasLoggedInChrome || manageLinkCount > 0 || url.includes("/manage")) {
    return false;
  }
  return /카카오계정으로 시작하기|로그인 및 가입하기/u.test(bodyText);
}

async function findTistoryManageUrl(page: Page): Promise<string | null> {
  const linkCandidates = await page
    .locator("a[href]")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute("href") ?? "")
        .filter((href) => href.includes("/manage"))
    )
    .catch(() => []);

  for (const href of linkCandidates) {
    try {
      const url = new URL(href, page.url());
      if (url.hostname.endsWith(".tistory.com") && url.hostname !== "www.tistory.com") {
        return url.toString();
      }
    } catch {
      // Ignore malformed links and keep searching.
    }
  }

  const html = await page.content().catch(() => "");
  const htmlMatch = html.match(/https:\/\/[a-z0-9.-]+\.tistory\.com\/manage[^"'<>\\\s]*/iu);
  return htmlMatch?.[0] ?? null;
}

async function assertTistoryEditorAvailable(page: Page): Promise<void> {
  if (await isTistoryLoggedOut(page)) {
    throw new Error("Tistory 로그인 세션이 만료되었습니다. 계정 연동을 다시 진행해 주세요.");
  }
  const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  if (/존재하지 않는\s*페이지/u.test(bodyText)) {
    throw new Error("Tistory 글쓰기 URL을 열 수 없습니다. 관리 가능한 블로그를 확인해 주세요.");
  }
}

function parseStorageState(storageStateJson: string): BrowserStorageState {
  const parsed = JSON.parse(storageStateJson) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("저장된 브라우저 세션 형식이 올바르지 않습니다.");
  }
  return parsed as BrowserStorageState;
}

async function dismissTistoryEditorPrompts(page: Page): Promise<void> {
  const prompts = [
    /취소/u,
    /확인/u,
    /닫기/u,
    /나가기/u,
  ];
  for (const name of prompts) {
    const button = page.getByRole("button", { name }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

async function fillTistoryTitle(page: Page, title: string): Promise<void> {
  const selectors = [
    'textarea[placeholder*="제목"]',
    'input[placeholder*="제목"]',
    '[contenteditable="true"][data-placeholder*="제목"]',
    ".textarea_tit",
    "#post-title-inp",
  ];
  if (await fillFirst(page, selectors, title)) return;
  throw new Error("Tistory 제목 입력 영역을 찾지 못했습니다.");
}

async function fillTistoryBody(page: Page, content: string): Promise<void> {
  const html = markdownToTistoryHtml(content);
  if (await insertTistoryContentViaTinyMce(page, html)) return;

  const selectors = [
    ".ProseMirror",
    '[contenteditable="true"][aria-label*="본문"]',
    '[contenteditable="true"][data-placeholder*="내용"]',
    '[contenteditable="true"]',
    'textarea[placeholder*="본문"]',
    'textarea[placeholder*="내용"]',
  ];
  if (await fillFirst(page, selectors, content)) return;

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    for (const selector of selectors) {
      const locator = frame.locator(selector).first();
      if (!(await locator.isVisible().catch(() => false))) continue;
      await locator.click();
      await locator.fill(content).catch(async () => {
        await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await page.keyboard.insertText(content);
      });
      return;
    }
  }

  throw new Error("Tistory 본문 입력 영역을 찾지 못했습니다.");
}

async function fillTistoryTags(page: Page, tags: string[]): Promise<void> {
  if (tags.length === 0) return;
  const selectors = [
    'input[placeholder*="태그"]',
    'textarea[placeholder*="태그"]',
    ".tag_input input",
    ".tagInput input",
    'input[name*="tag" i]',
    '[class*="tag" i] input',
    "#tagText",
  ];
  if (await enterTistoryTags(page, selectors, tags)) return;

  const value = tags.join(", ");
  await fillFirst(page, selectors, value);
}

async function insertTistoryContentViaTinyMce(
  page: Page,
  html: string,
): Promise<boolean> {
  return page
    .evaluate((contentHtml) => {
      const win = window as typeof window & {
        tinymce?: {
          activeEditor?: unknown;
          editors?: unknown[];
        };
      };
      const editors = Array.isArray(win.tinymce?.editors)
        ? win.tinymce.editors
        : [];
      const editor = (win.tinymce?.activeEditor ?? editors[0]) as
        | {
            setContent?: (html: string) => void;
            fire?: (eventName: string) => void;
            save?: () => void;
            getElement?: () => Element | null;
          }
        | null
        | undefined;
      if (!editor || typeof editor.setContent !== "function") {
        return false;
      }

      editor.setContent(contentHtml);
      editor.fire?.("input");
      editor.fire?.("change");
      editor.save?.();
      const element = editor.getElement?.();
      element?.dispatchEvent(new Event("input", { bubbles: true }));
      element?.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, html)
    .catch(() => false);
}

async function enterTistoryTags(
  page: Page,
  selectors: string[],
  tags: string[],
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.isVisible().catch(() => false))) continue;
    await locator.click();
    for (const tag of tags) {
      await locator.fill(tag).catch(async () => {
        await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await page.keyboard.insertText(tag);
      });
      await locator.press("Enter");
      await page.waitForTimeout(120);
    }
    return true;
  }
  return false;
}

function markdownToTistoryHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${paragraph.map(formatInlineMarkdown).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]?.length ?? 2;
      blocks.push(`<h${level}>${formatInlineMarkdown(heading[2] ?? "")}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/u);
    if (bullet) {
      flushParagraph();
      listItems.push(bullet[1] ?? "");
      continue;
    }

    flushList();
    paragraph.push(line.replace(/\s{2,}$/u, ""));
  }

  flushParagraph();
  flushList();
  return blocks.join("\n");
}

function formatInlineMarkdown(value: string): string {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function saveTistoryDraft(page: Page): Promise<void> {
  const roleCandidates = [/임시저장/u, /저장/u];
  for (const name of roleCandidates) {
    const button = page.getByRole("button", { name }).first();
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click();
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    return;
  }

  const textCandidates = ["text=임시저장", "text=저장"];
  for (const selector of textCandidates) {
    const target = page.locator(selector).first();
    if (!(await target.isVisible().catch(() => false))) continue;
    await target.click();
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    return;
  }

  throw new Error("Tistory 임시저장 버튼을 찾지 못했습니다.");
}

async function fillFirst(
  page: Page,
  selectors: string[],
  value: string,
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.isVisible().catch(() => false))) continue;
    await locator.click();
    await locator.fill(value).catch(async () => {
      await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.insertText(value);
    });
    return true;
  }
  return false;
}
