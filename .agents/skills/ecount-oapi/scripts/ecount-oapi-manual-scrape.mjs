import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = {
    envPath: ".env",
    url: null,
    outDir: "/tmp/ecount-oapi-manual",
    headful: false,
    includePages: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env") args.envPath = argv[++i];
    else if (arg === "--url") args.url = argv[++i];
    else if (arg === "--out-dir") args.outDir = argv[++i];
    else if (arg === "--headful") args.headful = true;
    else if (arg === "--include-pages") args.includePages = true;
  }
  return args;
}

function parseEnv(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([^=]+)=(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function requireFirstEnv(env, keys, label) {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  throw new Error(`${label ?? keys.join("/")} is missing`);
}

async function loadPlaywright() {
  const candidates = [
    path.join(process.cwd(), "node_modules", "playwright", "index.js"),
    path.join(process.cwd(), "web", "node_modules", "playwright", "index.js"),
  ];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const module = await import(pathToFileURL(candidate).href);
      return module.default ?? module;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Playwright is not installed");
}

async function launchChromium(chromium, headless) {
  try {
    return await chromium.launch({ channel: "msedge", headless });
  } catch {
    return await chromium.launch({ headless });
  }
}

async function login(page, env) {
  await page.goto("https://login.ecount.com/Login/?lan_type=ko-KR", {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.waitForFunction(() => typeof globalThis.excuteLogin === "function", {
    timeout: 15_000,
  });
  await page.locator("#com_code").fill(requireFirstEnv(env, ["COM_CODE", "ECOUNT_ERP_COM"], "company code"));
  await page.locator("#id").fill(requireFirstEnv(env, ["USER_ID", "ECOUNT_ERP_ID"], "web login ID"));
  await page.locator("#passwd").fill(requireFirstEnv(env, ["PW", "ECOUNT_ERP_PW"], "web login password"));
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {}),
    page.locator("#save").click(),
  ]);
  await page.waitForTimeout(6_000);
  return await page.evaluate(() => ({
    url: location.href,
    loggedIn: !location.hostname.startsWith("login."),
    errorCode: document.querySelector("#error_code")?.value || "",
    errorMessage: document.querySelector("#error_msg")?.value || "",
  }));
}

async function maybeOpenManual(page, manualUrl) {
  const afterLoginUrl = new URL(page.url());
  const sid = afterLoginUrl.searchParams.get("ec_req_sid");

  if (manualUrl) {
    const target = new URL(manualUrl);
    if (sid) target.searchParams.set("ec_req_sid", sid);
    await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(5_000);
    return target.href;
  }

  const zone = sid?.split("-")[0]?.toLowerCase() || "cc";
  const targetUrl =
    `https://sboapi${zone}.ecount.com/ECERP/OAPIView/OAPIManual?lan_type=ko-KR` +
    (sid ? `&ec_req_sid=${encodeURIComponent(sid)}` : "");
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(5_000);
  return targetUrl;
}

function compactText(text) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function redactUrl(url) {
  try {
    const parsed = new URL(url);
    for (const key of ["ec_req_sid", "sid", "session_Id", "SESSION_ID"]) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, "[REDACTED]");
    }
    return parsed.href;
  } catch {
    return url;
  }
}

function safeFilePart(value) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
}

async function scrapeMenuPages(page, outDir) {
  const manual = new URL(page.url());
  const lanType = manual.searchParams.get("lan_type") || "ko-KR";
  const pages = await page.$$eval("#menuArea a[title]", (anchors) => {
    const seen = new Set();
    return anchors
      .map((anchor) => ({
        title: anchor.getAttribute("title") || "",
        label: (anchor.textContent || "").trim(),
      }))
      .filter((entry) => {
        if (!entry.title || seen.has(entry.title)) return false;
        seen.add(entry.title);
        return true;
      });
  });

  const pageDir = path.join(outDir, "pages");
  await mkdir(pageDir, { recursive: true });
  const combined = [];
  for (let index = 0; index < pages.length; index += 1) {
    const entry = pages[index];
    const url = new URL(`/ECERP/OAPI/${entry.title}`, manual.origin);
    url.searchParams.set("lan_type", lanType);
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const title = await page.title().catch(() => "");
    const text = compactText(await page.locator("body").innerText({ timeout: 10_000 }));
    const html = await page.content();
    const base = `${String(index + 1).padStart(2, "0")}-${safeFilePart(entry.title)}`;
    await writeFile(path.join(pageDir, `${base}.txt`), text);
    await writeFile(path.join(pageDir, `${base}.html`), html);
    combined.push(`# ${entry.label || entry.title}\n\nRoute: ${entry.title}\nTitle: ${title}\n\n${text}`);
  }
  await writeFile(path.join(outDir, "manual-pages.md"), combined.join("\n\n---\n\n"));
  return pages;
}

const args = parseArgs(process.argv.slice(2));
const env = parseEnv(await readFile(args.envPath, "utf8"));
const playwright = await loadPlaywright();
const browser = await launchChromium(playwright.chromium, !args.headful);
const requestLog = [];
const diagnostics = [];

try {
  const context = await browser.newContext({ locale: "ko-KR" });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      diagnostics.push({ type: "console", level: message.type(), text: message.text().slice(0, 500) });
    }
  });
  page.on("pageerror", (error) => {
    diagnostics.push({ type: "pageerror", text: error.message.slice(0, 500) });
  });
  page.on("dialog", async (dialog) => {
    diagnostics.push({ type: "dialog", message: dialog.message().slice(0, 500) });
    await dialog.accept().catch(() => {});
  });
  page.on("response", (response) => {
    const url = response.url();
    if (/ecount\.com/i.test(url) && !/resource\.ecount\.com/i.test(url)) {
      diagnostics.push({
        type: "response",
        status: response.status(),
        url: redactUrl(url),
      });
    }
  });
  page.on("requestfinished", (request) => {
    const url = request.url();
    if (/OAPI|oapi|OAPIView|sboapi/i.test(url)) requestLog.push(redactUrl(url));
  });

  const loginOutcome = await login(page, env);
  const manualUrl = await maybeOpenManual(page, args.url);

  await mkdir(args.outDir, { recursive: true });
  const title = await page.title().catch(() => "");
  const url = page.url();
  const text = compactText(await page.locator("body").innerText({ timeout: 10_000 }));
  const html = await page.content();
  await writeFile(path.join(args.outDir, "manual.txt"), text);
  await writeFile(path.join(args.outDir, "manual.html"), html);
  await writeFile(path.join(args.outDir, "requests.json"), JSON.stringify(requestLog, null, 2));
  await writeFile(path.join(args.outDir, "diagnostics.json"), JSON.stringify(diagnostics, null, 2));
  const pages = args.includePages ? await scrapeMenuPages(page, args.outDir) : [];

  console.log(
    JSON.stringify(
      {
        loginOutcome: { ...loginOutcome, url: redactUrl(loginOutcome.url) },
        title,
        url: redactUrl(url),
        manualUrl: redactUrl(manualUrl),
        textChars: text.length,
        requestCount: requestLog.length,
        diagnosticsCount: diagnostics.length,
        pageCount: pages.length,
        outDir: args.outDir,
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
