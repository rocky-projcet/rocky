import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = { envPath: ".env", discoverIssuer: false, readApi: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env") args.envPath = argv[++i];
    else if (arg === "--discover-issuer") args.discoverIssuer = true;
    else if (arg === "--no-read-api") args.readApi = false;
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

function requireEnv(env, key) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is missing`);
  return value;
}

function firstEnv(env, keys) {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function summarize(body) {
  const data = body?.Data && typeof body.Data === "object" ? body.Data : {};
  const datas = data.Datas && typeof data.Datas === "object" ? data.Datas : {};
  const output = data.Output;
  return {
    status: body?.Status ?? body?.status ?? null,
    dataCode: data.Code ?? null,
    dataMessage: data.Message ?? data.ResultInfo ?? null,
    errorMessage: body?.Error?.Message ?? null,
    zone: datas.ZONE ?? data.ZONE ?? null,
    sessionIssued: typeof datas.SESSION_ID === "string" && datas.SESSION_ID.length > 0,
    outputKind: Array.isArray(output)
      ? "array"
      : output && typeof output === "object"
        ? "object"
        : output == null
          ? null
          : typeof output,
    outputCount: Array.isArray(output) ? output.length : null,
  };
}

async function postJson(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { httpStatus: response.status, json, textLength: text.length };
  } finally {
    clearTimeout(timer);
  }
}

async function loadPlaywright() {
  const localPath = path.join(process.cwd(), "web", "node_modules", "playwright", "index.js");
  const module = await import(pathToFileURL(localPath).href);
  return module.default ?? module;
}

async function discoverIssuerId(env) {
  const playwright = await loadPlaywright();
  const { chromium } = playwright;
  const comCode = requireEnv(env, "COM_CODE");
  const userId = requireEnv(env, "USER_ID");
  const password = requireEnv(env, "PW");
  const apiKey = requireEnv(env, "API_CERT_KEY");

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = await browser.newContext({ locale: "ko-KR" });
    const page = await context.newPage();
    page.on("dialog", async (dialog) => dialog.accept().catch(() => {}));

    await page.goto("https://login.ecount.com/Login/?lan_type=ko-KR", {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await page.waitForFunction(() => typeof globalThis.excuteLogin === "function", {
      timeout: 15_000,
    });
    await page.locator("#com_code").fill(comCode);
    await page.locator("#id").fill(userId);
    await page.locator("#passwd").fill(password);
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {}),
      page.locator("#save").click(),
    ]);
    await page.waitForTimeout(6_000);

    const afterLoginUrl = new URL(page.url());
    const sid = afterLoginUrl.searchParams.get("ec_req_sid");
    const targetUrl =
      `https://${afterLoginUrl.host}/ec5/view/erp?w_flag=1&ec_req_sid=${encodeURIComponent(sid)}` +
      "#menuType=MENUTREE_000008&menuSeq=MENUTREE_001534&groupSeq=MENUTREE_001600&prgId=E000125&depth=3";
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(8_000);
    await page.locator("#SbApiListBtn").click();
    await page.waitForTimeout(4_000);

    return await page.evaluate((key) => {
      for (const tr of document.querySelectorAll("tr")) {
        const cells = [...tr.querySelectorAll("th,td")].map((cell) =>
          (cell.textContent || "").trim()
        );
        if (cells.includes(key)) return cells[0] || null;
      }
      return null;
    }, apiKey);
  } finally {
    await browser.close();
  }
}

const args = parseArgs(process.argv.slice(2));
const env = parseEnv(await readFile(args.envPath, "utf8"));
const comCode = requireEnv(env, "COM_CODE");
const apiCertKey = requireEnv(env, "API_CERT_KEY");
let apiUserId = firstEnv(env, ["API_USER_ID", "OAPI_USER_ID", "USER_ID"]);
let issuerDiscovered = false;

if (args.discoverIssuer) {
  const issuerId = await discoverIssuerId(env);
  if (issuerId) {
    issuerDiscovered = true;
    apiUserId = issuerId;
  }
}

const attempts = [];
const zoneResponse = await postJson("https://sboapi.ecount.com/OAPI/V2/Zone", {
  COM_CODE: comCode,
});
const zoneSummary = zoneResponse.json ? summarize(zoneResponse.json) : {};
const zone = zoneSummary.zone || "CC";
attempts.push({
  step: "Zone",
  url: "https://sboapi.ecount.com/OAPI/V2/Zone",
  httpStatus: zoneResponse.httpStatus,
  ...zoneSummary,
});

let sessionId = null;
for (const [mode, lanType] of [
  ["ko-KR", "ko-KR"],
  ["manual-literal", "<%=lan_type%>"],
]) {
  const loginUrl = `https://sboapi${zone.toLowerCase()}.ecount.com/OAPI/V2/OAPILogin`;
  const response = await postJson(loginUrl, {
    ZONE: zone,
    COM_CODE: comCode,
    USER_ID: apiUserId,
    API_CERT_KEY: apiCertKey,
    LAN_TYPE: lanType,
    ISTEST: "Y",
  });
  const summary = response.json ? summarize(response.json) : {};
  const passed = Boolean(summary.sessionIssued && String(summary.dataCode) === "00");
  attempts.push({
    step: "Login",
    url: loginUrl,
    mode,
    userSource: issuerDiscovered ? "discovered-key-issuer" : "env",
    httpStatus: response.httpStatus,
    passed,
    ...summary,
  });
  if (passed) {
    sessionId = response.json.Data.Datas.SESSION_ID;
    break;
  }
}

if (sessionId && args.readApi) {
  const readUrl = `https://sboapi${zone.toLowerCase()}.ecount.com/OAPI/V2/InventoryBasic/GetBasicProductsList?session_Id=${encodeURIComponent(sessionId)}`;
  const response = await postJson(readUrl, {});
  const summary = response.json ? summarize(response.json) : {};
  attempts.push({
    step: "ReadApi",
    api: "InventoryBasic/GetBasicProductsList",
    url: `https://sboapi${zone.toLowerCase()}.ecount.com/OAPI/V2/InventoryBasic/GetBasicProductsList?session_Id=[SESSION_ID]`,
    httpStatus: response.httpStatus,
    ...summary,
  });
}

console.log(
  JSON.stringify(
    {
      zone,
      issuerDiscovered,
      loginPassed: Boolean(sessionId),
      attempts,
    },
    null,
    2
  )
);
