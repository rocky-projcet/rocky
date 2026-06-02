import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { chromium, type Browser, type Download, type Page } from "playwright";

export type EcountBrowserChannel = "chromium" | "chrome" | "msedge";
export type EcountSalesExcelExportStage =
  | "input"
  | "login"
  | "navigate"
  | "filter"
  | "export"
  | "download"
  | "browser";

export interface EcountWebLoginInput {
  accountLabel?: string | null;
  comCode: string;
  userId: string;
  password: string;
  lanType?: string | null;
}

export interface EcountSalesExcelExportInput {
  login: EcountWebLoginInput;
  outputDir?: string | null;
  fromDate?: string | Date | null;
  toDate?: string | Date | null;
  customerCode?: string | null;
  productCode?: string | null;
  programUrl?: string | null;
  headless?: boolean;
  channel?: EcountBrowserChannel;
}

export interface EcountSalesExportFilters {
  fromDate: string;
  toDate: string;
  customerCode: string | null;
  productCode: string | null;
}

export interface EcountSalesExcelExportResult {
  ok: boolean;
  status: "downloaded" | "failed";
  accountLabel: string | null;
  checkedAt: string;
  programId: "E040206";
  filters: EcountSalesExportFilters;
  downloadedFilePath: string | null;
  fileName: string | null;
  byteSize: number | null;
  pageUrl: string | null;
  message: string;
  diagnostics?: {
    stage: EcountSalesExcelExportStage;
    detail: string;
  };
}

export interface EcountWebLoginCredentials {
  accountLabel: string | null;
  comCode: string;
  userId: string;
  password: string;
  lanType: string;
}

export interface EcountSalesBrowserAutomationInput {
  login: EcountWebLoginCredentials;
  filters: EcountSalesExportFilters;
  outputDir: string;
  suggestedFileName: string;
  programUrl: string | null;
  headless: boolean;
  channel: EcountBrowserChannel;
}

export interface EcountSalesBrowserAutomationOutput {
  downloadedFilePath: string;
  fileName: string;
  pageUrl: string;
}

export interface EcountSalesBrowserAutomation {
  exportSalesExcel(
    input: EcountSalesBrowserAutomationInput
  ): Promise<EcountSalesBrowserAutomationOutput>;
}

export interface EcountSalesExcelExportServiceOptions {
  automation?: EcountSalesBrowserAutomation;
  now?: () => string;
}

const ECOUNT_SALES_PROGRAM_ID = "E040206" as const;
const DEFAULT_OUTPUT_DIR = path.join(
  ".runtime",
  "ecount-browser-assist",
  "sales-excel"
);

export class EcountSalesExcelExportService {
  private readonly automation: EcountSalesBrowserAutomation;
  private readonly now: () => string;

  constructor(options: EcountSalesExcelExportServiceOptions = {}) {
    this.automation = options.automation ?? new PlaywrightEcountSalesBrowserAutomation();
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async exportSalesExcel(
    input: EcountSalesExcelExportInput
  ): Promise<EcountSalesExcelExportResult> {
    const checkedAt = this.now();
    const accountLabel = trimOptional(input.login.accountLabel);
    const secretValues = [
      input.login.comCode,
      input.login.userId,
      input.login.password,
    ];

    try {
      const login = normalizeLoginInput(input.login);
      const filters = normalizeSalesFilters(input, checkedAt);
      const outputDir = path.resolve(input.outputDir ?? DEFAULT_OUTPUT_DIR);
      const suggestedFileName = salesExportFileName(filters, checkedAt);
      await mkdir(outputDir, { recursive: true });

      const automationResult = await this.automation.exportSalesExcel({
        login,
        filters,
        outputDir,
        suggestedFileName,
        programUrl: trimOptional(input.programUrl),
        headless: input.headless ?? true,
        channel: input.channel ?? "msedge",
      });
      const downloadedFilePath = assertManagedDownloadPath(
        automationResult.downloadedFilePath,
        outputDir
      );
      const stats = await stat(downloadedFilePath);

      return {
        ok: true,
        status: "downloaded",
        accountLabel,
        checkedAt,
        programId: ECOUNT_SALES_PROGRAM_ID,
        filters,
        downloadedFilePath,
        fileName: path.basename(downloadedFilePath),
        byteSize: stats.size,
        pageUrl: redactEcountUrl(automationResult.pageUrl),
        message: "ECOUNT 판매조회 Excel export completed by read-only browser assist.",
      };
    } catch (error) {
      const filters = safeNormalizeSalesFilters(input, checkedAt);
      return {
        ok: false,
        status: "failed",
        accountLabel,
        checkedAt,
        programId: ECOUNT_SALES_PROGRAM_ID,
        filters,
        downloadedFilePath: null,
        fileName: null,
        byteSize: null,
        pageUrl: null,
        message: "ECOUNT 판매조회 Excel export failed.",
        diagnostics: {
          stage: errorStage(error),
          detail: redactSecrets(
            error instanceof Error ? error.message : String(error),
            secretValues
          ),
        },
      };
    }
  }
}

export class PlaywrightEcountSalesBrowserAutomation
  implements EcountSalesBrowserAutomation {
  async exportSalesExcel(
    input: EcountSalesBrowserAutomationInput
  ): Promise<EcountSalesBrowserAutomationOutput> {
    let browser: Browser | null = null;
    try {
      browser = await launchBrowser(input.channel, input.headless);
      const context = await browser.newContext({
        acceptDownloads: true,
        locale: input.login.lanType,
        viewport: { width: 1280, height: 900 },
      });
      context.setDefaultTimeout(20_000);
      context.setDefaultNavigationTimeout(30_000);

      const page = await context.newPage();
      page.on("dialog", (dialog) => {
        void dialog.accept().catch(() => {});
      });

      await loginToEcount(page, input.login);
      await openSalesLookupPage(page, input.programUrl);
      await applySalesLookupFilters(page, input.filters);
      await clickSalesSearchIfAvailable(page);

      const download = await downloadSalesExcel(page);
      const outputPath = path.join(
        input.outputDir,
        sanitizeFileName(input.suggestedFileName, "ecount-sales-export.xlsx")
      );
      await download.saveAs(outputPath);

      return {
        downloadedFilePath: outputPath,
        fileName: path.basename(outputPath),
        pageUrl: page.url(),
      };
    } finally {
      await browser?.close().catch(() => {});
    }
  }
}

export function readEcountWebLoginInputFromEnv(
  env: NodeJS.ProcessEnv = process.env
): EcountWebLoginInput {
  return {
    accountLabel: readEnvAny(env, ["ECOUNT_ERP_ACCOUNT_LABEL", "ECOUNT_ACCOUNT_LABEL"]),
    comCode: requireEnvAny(env, ["COM_CODE", "ECOUNT_ERP_COM"], "ECOUNT web company code"),
    userId: requireEnvAny(env, ["USER_ID", "ECOUNT_ERP_ID"], "ECOUNT web login ID"),
    password: requireEnvAny(env, ["PW", "ECOUNT_ERP_PW"], "ECOUNT web login password"),
    lanType: readEnvAny(env, ["ECOUNT_ERP_LAN_TYPE", "LAN_TYPE"]),
  };
}

function normalizeLoginInput(input: EcountWebLoginInput): EcountWebLoginCredentials {
  return {
    accountLabel: trimOptional(input.accountLabel),
    comCode: requireTrimmed(input.comCode, "ECOUNT web company code"),
    userId: requireTrimmed(input.userId, "ECOUNT web login ID"),
    password: requireTrimmed(input.password, "ECOUNT web login password"),
    lanType: trimOptional(input.lanType) ?? "ko-KR",
  };
}

function normalizeSalesFilters(
  input: EcountSalesExcelExportInput,
  checkedAt: string
): EcountSalesExportFilters {
  const today = checkedAt.slice(0, 10);
  const toDate = normalizeEcountDate(input.toDate, today, "toDate");
  const fromDate = normalizeEcountDate(input.fromDate, toDate.compact, "fromDate");
  if (fromDate.compact > toDate.compact) {
    throw stageError("input", "ECOUNT sales export fromDate must be on or before toDate.");
  }

  return {
    fromDate: fromDate.compact,
    toDate: toDate.compact,
    customerCode: trimOptional(input.customerCode),
    productCode: trimOptional(input.productCode),
  };
}

function safeNormalizeSalesFilters(
  input: EcountSalesExcelExportInput,
  checkedAt: string
): EcountSalesExportFilters {
  try {
    return normalizeSalesFilters(input, checkedAt);
  } catch {
    const today = checkedAt.slice(0, 10).replace(/\D/gu, "");
    return {
      fromDate: today,
      toDate: today,
      customerCode: trimOptional(input.customerCode),
      productCode: trimOptional(input.productCode),
    };
  }
}

function normalizeEcountDate(
  value: string | Date | null | undefined,
  fallback: string,
  label: string
): { compact: string; display: string } {
  const raw = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : trimOptional(value) ?? fallback;
  const digits = raw.replace(/\D/gu, "");
  if (digits.length !== 8) {
    throw stageError("input", `ECOUNT sales export ${label} must be YYYY-MM-DD or YYYYMMDD.`);
  }

  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw stageError("input", `ECOUNT sales export ${label} is not a valid date.`);
  }

  return {
    compact: digits,
    display: `${digits.slice(0, 4)}/${digits.slice(4, 6)}/${digits.slice(6, 8)}`,
  };
}

function salesExportFileName(filters: EcountSalesExportFilters, checkedAt: string): string {
  const stamp = checkedAt.replace(/\D/gu, "").slice(0, 14) || "export";
  return `ecount-sales-${filters.fromDate}-${filters.toDate}-${stamp}.xlsx`;
}

async function launchBrowser(
  channel: EcountBrowserChannel,
  headless: boolean
): Promise<Browser> {
  if (channel === "chromium") {
    return chromium.launch({ headless });
  }

  try {
    return await chromium.launch({ channel, headless });
  } catch {
    return chromium.launch({ headless });
  }
}

async function loginToEcount(
  page: Page,
  login: EcountWebLoginCredentials
): Promise<void> {
  await page.goto(
    `https://login.ecount.com/Login/?lan_type=${encodeURIComponent(login.lanType)}`,
    { waitUntil: "domcontentloaded", timeout: 30_000 }
  );
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForFunction(
    () => typeof (globalThis as typeof globalThis & { excuteLogin?: unknown }).excuteLogin === "function",
    { timeout: 15_000 }
  ).catch(() => {});

  await page.locator("#com_code").fill(login.comCode);
  await page.locator("#id").fill(login.userId);
  await page.locator("#passwd").fill(login.password);
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {}),
    page.locator("#save").click(),
  ]);
  await page.waitForTimeout(6_000);

  const outcome = await page.evaluate(() => ({
    url: location.href,
    loggedIn: !location.hostname.startsWith("login."),
    errorCode: (document.querySelector("#error_code") as HTMLInputElement | null)?.value || "",
    errorMessage: (document.querySelector("#error_msg") as HTMLInputElement | null)?.value || "",
  }));
  if (!outcome.loggedIn) {
    throw stageError(
      "login",
      outcome.errorMessage || outcome.errorCode || "ECOUNT web login did not reach ERP."
    );
  }
}

async function openSalesLookupPage(page: Page, programUrl: string | null): Promise<void> {
  const targetUrl = buildSalesLookupUrl(page.url(), programUrl);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(4_000);

  const bodyText = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
  if (!/판매조회/u.test(bodyText) && !page.url().includes(`prgId=${ECOUNT_SALES_PROGRAM_ID}`)) {
    throw stageError("navigate", "ECOUNT 판매조회(E040206) page did not load.");
  }
}

function buildSalesLookupUrl(loginUrl: string, programUrl: string | null): string {
  const source = new URL(loginUrl);
  const sid = source.searchParams.get("ec_req_sid");
  if (programUrl) {
    const target = new URL(programUrl);
    if (sid) target.searchParams.set("ec_req_sid", sid);
    return target.toString();
  }

  const target = new URL("/ec5/view/erp", source.origin);
  target.searchParams.set("w_flag", "1");
  if (sid) target.searchParams.set("ec_req_sid", sid);
  target.hash = [
    "menuType=MENUTREE_000004",
    "menuSeq=MENUTREE_000492",
    "groupSeq=MENUTREE_000030",
    `prgId=${ECOUNT_SALES_PROGRAM_ID}`,
    "depth=4",
  ].join("&");
  return target.toString();
}

async function applySalesLookupFilters(
  page: Page,
  filters: EcountSalesExportFilters
): Promise<void> {
  let dateControls = await fillSalesDateRange(page, filters);
  if (dateControls < 2) {
    await openSalesSearchPanel(page);
    dateControls = await fillSalesDateRange(page, filters);
  }
  if (dateControls < 2) {
    throw stageError("filter", "ECOUNT 판매조회 date range fields were not found.");
  }

  if (filters.customerCode) {
    await fillOptionalFilter(page, filters.customerCode, /cust|거래처|customer|business/iu);
  }
  if (filters.productCode) {
    await fillOptionalFilter(page, filters.productCode, /prod|품목|상품|product|item/iu);
  }
}

async function fillSalesDateRange(
  page: Page,
  filters: EcountSalesExportFilters
): Promise<number> {
  const fromDate = dateDisplay(filters.fromDate);
  const toDate = dateDisplay(filters.toDate);
  return page.evaluate(
    ({ fromDate: from, toDate: to, fromParts, toParts }) => {
      const datepickerCount = setEcountDatepickerRange(fromParts, toParts);
      if (datepickerCount >= 2) {
        return datepickerCount;
      }

      const controls = visibleTextControls();
      const dateLikeControls = controls.filter((control) => {
        const haystack = [
          control.id,
          control.getAttribute("name"),
          control.getAttribute("title"),
          control.getAttribute("placeholder"),
          control.getAttribute("aria-label"),
          readControlValue(control),
        ].join(" ");
        return /date|일자|기간|from|to|start|end|fr|dt|io_date|start_date|end_date|^s_?date|^e_?date/iu.test(haystack) ||
          /\d{4}[./-]\d{2}[./-]\d{2}/u.test(haystack);
      });
      if (dateLikeControls.length < 2) {
        return dateLikeControls.length;
      }
      setControlValue(dateLikeControls[0], from);
      setControlValue(dateLikeControls[1], to);
      return dateLikeControls.length;

      function setEcountDatepickerRange(
        first: { year: string; month: string; day: string },
        second: { year: string; month: string; day: string }
      ): number {
        const groups = Array.from(document.querySelectorAll(".control-set, .control"))
          .filter((group) =>
            group.querySelectorAll('button[data-id="year"]').length >= 2 &&
            group.querySelectorAll('button[data-id="month"]').length >= 2 &&
            group.querySelectorAll('input[data-id="day"], input#day').length >= 2
          )
          .sort((left, right) => left.querySelectorAll("*").length - right.querySelectorAll("*").length);
        const group = groups[0];
        if (!group) {
          return 0;
        }

        const pickers = Array.from(group.querySelectorAll(".wrapper-datepicker"))
          .filter((picker) =>
            directChild(picker, 'button[data-id="year"]') &&
            directChild(picker, 'button[data-id="month"]') &&
            directChild(picker, 'input[data-id="day"], input#day')
          );
        if (pickers.length < 2) {
          return 0;
        }

        setDatepicker(pickers[0], first);
        setDatepicker(pickers[1], second);
        return pickers.length;
      }

      function setDatepicker(
        picker: Element,
        value: { year: string; month: string; day: string }
      ): void {
        setSelectButtonLabel(directChild(picker, 'button[data-id="year"]'), value.year);
        setSelectButtonLabel(directChild(picker, 'button[data-id="month"]'), value.month);
        const directInputs = Array.from(
          picker.querySelectorAll("input.select-direct-input")
        ) as HTMLInputElement[];
        if (directInputs[0]) setControlValue(directInputs[0], value.year);
        if (directInputs[1]) setControlValue(directInputs[1], value.month);
        const dayInput = directChild(picker, 'input[data-id="day"], input#day') as HTMLInputElement | null;
        if (dayInput) setControlValue(dayInput, value.day);
      }

      function setSelectButtonLabel(button: Element | null, value: string): void {
        if (!button) return;
        const label = button.querySelector(".selectbox-label");
        if (label) {
          label.textContent = value;
        }
        button.setAttribute("data-value", value);
        button.dispatchEvent(new Event("input", { bubbles: true }));
        button.dispatchEvent(new Event("change", { bubbles: true }));
      }

      function directChild(parent: Element, selector: string): Element | null {
        return Array.from(parent.children).find((child) => child.matches(selector)) ?? null;
      }

      function visibleTextControls(): Array<HTMLInputElement | HTMLTextAreaElement> {
        return Array.from(document.querySelectorAll("input, textarea"))
          .filter((element): element is HTMLInputElement | HTMLTextAreaElement => {
            const type = element instanceof HTMLInputElement ? element.type.toLowerCase() : "text";
            if (["hidden", "button", "submit", "reset", "checkbox", "radio", "file"].includes(type)) {
              return false;
            }
            const control = element as HTMLInputElement | HTMLTextAreaElement;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.width > 0 &&
              rect.height > 0 &&
              !control.disabled &&
              !control.readOnly;
          });
      }

      function readControlValue(element: HTMLInputElement | HTMLTextAreaElement): string {
        return "value" in element ? element.value : "";
      }

      function setControlValue(
        element: HTMLInputElement | HTMLTextAreaElement,
        value: string
      ): void {
        const prototype = element instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        setter?.call(element, value);
        element.setAttribute("value", value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));
      }
    },
    {
      fromDate,
      toDate,
      fromParts: ecountDateParts(filters.fromDate),
      toParts: ecountDateParts(filters.toDate),
    }
  );
}

async function openSalesSearchPanel(page: Page): Promise<void> {
  if (await page.locator("button#header_search").first().isVisible().catch(() => false)) {
    return;
  }

  const candidates = [
    page.locator("button#search"),
    page.locator('button:has-text("Search(F3)")'),
    page.getByRole("button", { name: /Search\(F3\)|Search|검색/iu }),
  ];
  for (const locator of candidates) {
    const target = locator.first();
    if (await target.isVisible().catch(() => false)) {
      await target.click();
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(1_000);
      return;
    }
  }
}

async function fillOptionalFilter(
  page: Page,
  value: string,
  matcher: RegExp
): Promise<void> {
  const filled = await page.evaluate(
    ({ value: nextValue, matcherSource, matcherFlags }) => {
      const matcher = new RegExp(matcherSource, matcherFlags);
      const controls = Array.from(document.querySelectorAll("input, textarea"))
        .filter((element): element is HTMLInputElement | HTMLTextAreaElement => {
          const type = element instanceof HTMLInputElement ? element.type.toLowerCase() : "text";
          if (["hidden", "button", "submit", "reset", "checkbox", "radio", "file"].includes(type)) {
            return false;
          }
          const control = element as HTMLInputElement | HTMLTextAreaElement;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0 &&
            !control.disabled &&
            !control.readOnly;
        });
      const target = controls.find((control) => matcher.test([
        control.id,
        control.getAttribute("name"),
        control.getAttribute("title"),
        control.getAttribute("placeholder"),
        control.getAttribute("aria-label"),
      ].join(" ")));
      if (!target) {
        return false;
      }
      const prototype = target instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(target, nextValue);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      target.dispatchEvent(new Event("blur", { bubbles: true }));
      return true;
    },
    {
      value,
      matcherSource: matcher.source,
      matcherFlags: matcher.flags,
    }
  );
  if (!filled) {
    throw stageError("filter", "Requested ECOUNT 판매조회 filter field was not found.");
  }
}

async function clickSalesSearchIfAvailable(page: Page): Promise<void> {
  const candidates = [
    page.locator("button#header_search").first(),
    page.locator('button:has-text("Search(F3)")'),
    page.locator('a:has-text("Search(F3)")'),
    page.getByRole("button", { name: /Search\(F3\)|Search|검색/iu }),
    page.getByText(/^Search\(F3\)$/u),
  ];
  for (const locator of candidates) {
    const target = locator.first();
    if (await target.isVisible().catch(() => false)) {
      await target.click();
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(1_000);
      return;
    }
  }
}

async function downloadSalesExcel(page: Page): Promise<Download> {
  const candidates = [
    page.getByRole("button", { name: /Excel|엑셀/iu }),
    page.locator('button:has-text("Excel")'),
    page.locator('a:has-text("Excel")'),
    page.getByText(/^Excel$/u),
    page.getByText(/^엑셀$/u),
  ];
  for (const locator of candidates) {
    const target = locator.first();
    if (await target.isVisible().catch(() => false)) {
      const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
      await target.click();
      return downloadPromise;
    }
  }
  throw stageError("export", "ECOUNT 판매조회 Excel button was not found.");
}

function dateDisplay(value: string): string {
  return `${value.slice(0, 4)}/${value.slice(4, 6)}/${value.slice(6, 8)}`;
}

function ecountDateParts(value: string): { year: string; month: string; day: string } {
  return {
    year: value.slice(0, 4),
    month: value.slice(4, 6),
    day: value.slice(6, 8),
  };
}

function assertManagedDownloadPath(filePath: string, outputDir: string): string {
  const resolvedFile = path.resolve(filePath);
  const resolvedOutputDir = path.resolve(outputDir);
  const relative = path.relative(resolvedOutputDir, resolvedFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw stageError("download", "ECOUNT sales export downloaded outside the managed output directory.");
  }
  return resolvedFile;
}

function sanitizeFileName(value: string, fallback: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/gu, "-")
    .replace(/\s+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 160);
  const fileName = sanitized || fallback;
  return /[.]xlsx$/iu.test(fileName) ? fileName : `${fileName}.xlsx`;
}

function redactEcountUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    for (const key of ["ec_req_sid", "sid", "SESSION_ID", "session_Id"]) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    return url.toString();
  } catch {
    return value.replace(/(ec_req_sid|sid|SESSION_ID|session_Id)=([^&#]+)/giu, "$1=[REDACTED]");
  }
}

function stageError(
  stage: EcountSalesExcelExportStage,
  message: string
): Error {
  return Object.assign(new Error(message), { ecountSalesStage: stage });
}

function errorStage(error: unknown): EcountSalesExcelExportStage {
  if (
    error &&
    typeof error === "object" &&
    "ecountSalesStage" in error &&
    typeof (error as { ecountSalesStage?: unknown }).ecountSalesStage === "string"
  ) {
    return (error as { ecountSalesStage: EcountSalesExcelExportStage }).ecountSalesStage;
  }
  return "browser";
}

function redactSecrets(message: string, values: Array<string | null | undefined>): string {
  let redacted = message;
  for (const value of values) {
    const trimmed = trimOptional(value);
    if (!trimmed) continue;
    redacted = redacted.split(trimmed).join("[REDACTED]");
  }
  return redacted;
}

function readEnvAny(env: NodeJS.ProcessEnv, keys: string[]): string | null {
  for (const key of keys) {
    const value = trimOptional(env[key]);
    if (value) return value;
  }
  return null;
}

function requireEnvAny(env: NodeJS.ProcessEnv, keys: string[], label: string): string {
  const value = readEnvAny(env, keys);
  if (!value) {
    throw new Error(`${label} is missing from .env (${keys.join("/")}).`);
  }
  return value;
}

function trimOptional(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function requireTrimmed(value: string, label: string): string {
  const trimmed = trimOptional(value);
  if (!trimmed) {
    throw stageError("input", `${label} is required.`);
  }
  return trimmed;
}
