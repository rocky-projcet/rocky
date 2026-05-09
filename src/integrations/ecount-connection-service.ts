export interface EcountConnectionTestInput {
  accountLabel?: string | null;
  comCode: string;
  userId: string;
  apiCertKey: string;
  zone?: string | null;
  lanType?: string | null;
}

export interface EcountConnectionTestResult {
  ok: boolean;
  status: "connected" | "failed";
  accountLabel: string | null;
  comCode: string;
  userId: string;
  zone: string | null;
  checkedAt: string;
  message: string;
  diagnostics?: {
    stage: "zone" | "login";
    detail: string;
  };
}

export interface EcountConnectionTester {
  testConnection(input: EcountConnectionTestInput): Promise<EcountConnectionTestResult>;
}

export interface EcountBasicProductRecord {
  code: string | null;
  name: string | null;
  spec: string | null;
  unit: string | null;
  raw: Record<string, unknown>;
}

export interface EcountBasicProductsLookupInput {
  limit?: number | null;
  offset?: number | null;
}

export type EcountDatasetId =
  | "products"
  | "inventory"
  | "customers"
  | "sales"
  | "warehouseInventory"
  | "orders"
  | "purchases"
  | "accounting";

export type EcountCapabilityStatus = "supported" | "unsupported";

export interface EcountIntegrationCapabilityRecord {
  provider: "ecount";
  dataset: EcountDatasetId;
  label: string;
  status: EcountCapabilityStatus;
  access: "read";
  api: string | null;
  filters: string[];
  reason: string | null;
}

export interface EcountDatasetQueryInput extends EcountBasicProductsLookupInput {
  dataset: EcountDatasetId | string;
  filters?: Record<string, unknown> | null;
}

export interface EcountDatasetQueryResult {
  ok: boolean;
  provider: "ecount";
  dataset: EcountDatasetId | string;
  title: string;
  status: "ready" | "failed" | "unsupported";
  accountLabel: string | null;
  zone: string | null;
  checkedAt: string;
  api: string | null;
  count: number;
  returnedCount: number;
  records: Record<string, unknown>[];
  message: string;
  diagnostics?: {
    stage: "zone" | "login" | "read" | "capability";
    detail: string;
  };
}

export interface EcountBasicProductsLookupResult {
  ok: boolean;
  status: "connected" | "failed";
  accountLabel: string | null;
  zone: string | null;
  checkedAt: string;
  api: "InventoryBasic/GetBasicProductsList";
  count: number;
  returnedCount: number;
  products: EcountBasicProductRecord[];
  message: string;
  diagnostics?: {
    stage: "zone" | "login" | "read";
    detail: string;
  };
}

export interface EcountLookupServiceLike {
  getBasicProductsList(
    input: EcountConnectionTestInput,
    options?: EcountBasicProductsLookupInput
  ): Promise<EcountBasicProductsLookupResult>;
  listCapabilities?(): EcountIntegrationCapabilityRecord[];
  queryDataset?(
    input: EcountConnectionTestInput,
    query: EcountDatasetQueryInput
  ): Promise<EcountDatasetQueryResult>;
}

export interface EcountConnectionServiceOptions {
  fetchImpl?: typeof fetch;
  now?: () => string;
}

function trimOptional(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const INVENTORY_BALANCE_BY_LOCATION_API =
  "InventoryBalance/GetListInventoryBalanceStatusByLocation";
const PURCHASE_ORDER_LIST_API = "Purchases/GetPurchasesOrderList";

const ECOUNT_DATASET_CAPABILITIES: EcountIntegrationCapabilityRecord[] = [
  {
    provider: "ecount",
    dataset: "products",
    label: "품목",
    status: "supported",
    access: "read",
    api: "InventoryBasic/GetBasicProductsList",
    filters: ["limit", "offset"],
    reason: null,
  },
  {
    provider: "ecount",
    dataset: "inventory",
    label: "재고현황",
    status: "supported",
    access: "read",
    api: INVENTORY_BALANCE_BY_LOCATION_API,
    filters: ["baseDate", "warehouseCode", "productCode", "limit", "offset"],
    reason: null,
  },
  {
    provider: "ecount",
    dataset: "customers",
    label: "거래처",
    status: "unsupported",
    access: "read",
    api: null,
    filters: ["customerCode"],
    reason: "The public ECOUNT Open API page lists customer/vendor input, not a verified read endpoint.",
  },
  {
    provider: "ecount",
    dataset: "sales",
    label: "판매",
    status: "unsupported",
    access: "read",
    api: null,
    filters: ["fromDate", "toDate", "customerCode", "productCode"],
    reason: "The current backend has no verified read-only ECOUNT sales lookup endpoint.",
  },
  {
    provider: "ecount",
    dataset: "warehouseInventory",
    label: "창고별 재고",
    status: "supported",
    access: "read",
    api: INVENTORY_BALANCE_BY_LOCATION_API,
    filters: ["baseDate", "warehouseCode", "productCode", "limit", "offset"],
    reason: null,
  },
  {
    provider: "ecount",
    dataset: "orders",
    label: "주문서",
    status: "unsupported",
    access: "read",
    api: null,
    filters: ["fromDate", "toDate", "customerCode", "productCode"],
    reason: "The public ECOUNT Open API page lists sales order input, not a verified read endpoint.",
  },
  {
    provider: "ecount",
    dataset: "purchases",
    label: "구매",
    status: "supported",
    access: "read",
    api: PURCHASE_ORDER_LIST_API,
    filters: ["fromDate", "toDate", "customerCode", "productCode", "period", "limit", "offset"],
    reason: null,
  },
  {
    provider: "ecount",
    dataset: "accounting",
    label: "매출·매입",
    status: "unsupported",
    access: "read",
    api: null,
    filters: ["fromDate", "toDate", "customerCode"],
    reason: "The public ECOUNT Open API page lists sales/purchase invoice input, not a verified read endpoint.",
  },
];

export function listEcountIntegrationCapabilities(): EcountIntegrationCapabilityRecord[] {
  return ECOUNT_DATASET_CAPABILITIES.map((capability) => ({ ...capability }));
}

export function normalizeEcountDatasetId(value: string): EcountDatasetId | string {
  const normalized = value.trim();
  const compact = normalized.replace(/[\s_-]+/gu, "").toLowerCase();
  const aliases: Record<string, EcountDatasetId> = {
    product: "products",
    products: "products",
    item: "products",
    items: "products",
    품목: "products",
    상품: "products",
    inventory: "inventory",
    inventorybalance: "inventory",
    재고: "inventory",
    재고현황: "inventory",
    customer: "customers",
    customers: "customers",
    vendor: "customers",
    vendors: "customers",
    거래처: "customers",
    sales: "sales",
    sale: "sales",
    판매: "sales",
    warehouseinventory: "warehouseInventory",
    warehouseinventorybalance: "warehouseInventory",
    locationinventory: "warehouseInventory",
    창고별재고: "warehouseInventory",
    창고별재고현황: "warehouseInventory",
    orders: "orders",
    order: "orders",
    salesorder: "orders",
    주문서: "orders",
    주문: "orders",
    purchases: "purchases",
    purchase: "purchases",
    purchaseorder: "purchases",
    구매: "purchases",
    발주서: "purchases",
    accounting: "accounting",
    invoice: "accounting",
    invoices: "accounting",
    매출매입: "accounting",
    매출입: "accounting",
    회계: "accounting",
  };
  return aliases[compact] ?? normalized;
}

function ecountCapabilityForDataset(
  dataset: string
): EcountIntegrationCapabilityRecord | null {
  const normalized = normalizeEcountDatasetId(dataset);
  return (
    ECOUNT_DATASET_CAPABILITIES.find((capability) => capability.dataset === normalized) ??
    null
  );
}

function unsupportedDatasetResult(input: {
  dataset: string;
  accountLabel: string | null;
  zone: string | null;
  checkedAt: string;
}): EcountDatasetQueryResult {
  const capability = ecountCapabilityForDataset(input.dataset);
  const dataset = capability?.dataset ?? normalizeEcountDatasetId(input.dataset);
  const label = capability?.label ?? input.dataset;
  const reason =
    capability?.reason ??
    `Unknown ECOUNT dataset: ${input.dataset}. Add a provider capability before querying it.`;
  return {
    ok: false,
    provider: "ecount",
    dataset,
    title: `ECOUNT ERP ${label} 조회`,
    status: "unsupported",
    accountLabel: input.accountLabel,
    zone: input.zone,
    checkedAt: input.checkedAt,
    api: capability?.api ?? null,
    count: 0,
    returnedCount: 0,
    records: [],
    message: `ECOUNT ${label} lookup is not supported by the current read-only backend.`,
    diagnostics: {
      stage: "capability",
      detail: reason,
    },
  };
}

function productLookupToDatasetResult(
  result: EcountBasicProductsLookupResult
): EcountDatasetQueryResult {
  return {
    ok: result.ok,
    provider: "ecount",
    dataset: "products",
    title: "ECOUNT ERP 품목 조회",
    status: result.ok ? "ready" : "failed",
    accountLabel: result.accountLabel,
    zone: result.zone,
    checkedAt: result.checkedAt,
    api: result.api,
    count: result.count,
    returnedCount: result.returnedCount,
    records: result.products.map((product) => ({
      code: product.code,
      name: product.name,
      spec: product.spec,
      unit: product.unit,
      raw: product.raw,
    })),
    message: result.message,
    diagnostics: result.diagnostics,
  };
}

function coerceString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toEcountDate(value: unknown, fallbackIso: string): string {
  const raw = coerceString(value);
  if (raw) {
    const digits = raw.replace(/\D/gu, "");
    if (digits.length >= 8) {
      return digits.slice(0, 8);
    }
  }
  return fallbackIso.slice(0, 10).replace(/\D/gu, "");
}

function parseEcountDate(value: unknown): string | null {
  const raw = coerceString(value);
  if (!raw) {
    return null;
  }
  const digits = raw.replace(/\D/gu, "");
  return digits.length >= 8 ? digits.slice(0, 8) : null;
}

function dateFromEcountDate(value: string): Date | null {
  if (!/^\d{8}$/u.test(value)) {
    return null;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function formatEcountDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function addDaysToEcountDate(value: string, days: number): string {
  const date = dateFromEcountDate(value);
  if (!date) {
    return value;
  }
  date.setUTCDate(date.getUTCDate() + days);
  return formatEcountDate(date);
}

function dateRangeFromFilters(
  filters: Record<string, unknown> | null | undefined,
  checkedAt: string
): { fromDate: string; toDate: string } {
  const explicitFrom = parseEcountDate(filters?.fromDate);
  const explicitTo =
    parseEcountDate(filters?.toDate) ??
    parseEcountDate(filters?.baseDate) ??
    parseEcountDate(filters?.date);
  const today = toEcountDate(null, checkedAt);
  const period = coerceString(filters?.period);
  const periodDates = period?.match(/\d{4}[-./]?\d{2}[-./]?\d{2}/gu) ?? [];
  const periodFrom = parseEcountDate(periodDates[0]);
  const periodTo = parseEcountDate(periodDates[1]);
  const toDate = explicitTo ?? periodTo ?? today;

  if (explicitFrom || periodFrom) {
    return {
      fromDate: explicitFrom ?? periodFrom ?? toDate,
      toDate,
    };
  }

  if (period && /recent-?30-?days|최근\s*30\s*일/iu.test(period)) {
    return {
      fromDate: addDaysToEcountDate(toDate, -30),
      toDate,
    };
  }

  return {
    fromDate: toDate,
    toDate,
  };
}

function numericField(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const normalized = Number(value.replace(/,/gu, ""));
      if (Number.isFinite(normalized)) {
        return normalized;
      }
    }
  }
  return null;
}

function applyRecordWindow<T>(
  records: T[],
  options: EcountBasicProductsLookupInput
): T[] {
  const limit =
    typeof options.limit === "number" && Number.isFinite(options.limit)
      ? Math.max(1, Math.floor(options.limit))
      : null;
  const offset =
    typeof options.offset === "number" && Number.isFinite(options.offset)
      ? Math.max(0, Math.floor(options.offset))
      : 0;
  const offsetRecords = offset > 0 ? records.slice(offset) : records;
  return limit ? offsetRecords.slice(0, limit) : offsetRecords;
}

function buildInventoryBalancePayload(input: {
  comCode: string;
  userId: string;
  apiCertKey: string;
  zone: string;
  lanType: string;
  sessionId: string | null;
  filters?: Record<string, unknown> | null;
  checkedAt: string;
}): Record<string, unknown> {
  return {
    SESSION_ID: input.sessionId,
    BASE_DATE: toEcountDate(
      input.filters?.baseDate ?? input.filters?.toDate ?? input.filters?.date,
      input.checkedAt
    ),
    COM_CODE: input.comCode,
    USER_ID: input.userId,
    ZONE: input.zone,
    API_CERT_KEY: input.apiCertKey,
    LAN_TYPE: input.lanType,
    PROD_CD: coerceString(input.filters?.productCode) ?? "",
    WH_CD: coerceString(input.filters?.warehouseCode) ?? "",
  };
}

function buildPurchaseOrderListPayload(input: {
  comCode: string;
  userId: string;
  apiCertKey: string;
  zone: string;
  lanType: string;
  sessionId: string | null;
  filters?: Record<string, unknown> | null;
  checkedAt: string;
}): Record<string, unknown> {
  const range = dateRangeFromFilters(input.filters, input.checkedAt);
  return {
    SESSION_ID: input.sessionId,
    START_DATE: range.fromDate,
    END_DATE: range.toDate,
    COM_CODE: input.comCode,
    USER_ID: input.userId,
    ZONE: input.zone,
    API_CERT_KEY: input.apiCertKey,
    LAN_TYPE: input.lanType,
    CUST: coerceString(input.filters?.customerCode) ?? "",
    PROD_CD: coerceString(input.filters?.productCode) ?? "",
  };
}

function normalizeWarehouseInventoryRecord(
  value: unknown
): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    productCode: firstStringField(record, ["PROD_CD", "PROD_CODE", "ITEM_CD", "ITEM_CODE"]),
    productName: firstStringField(record, ["PROD_DES", "PROD_NAME", "ITEM_DES", "ITEM_NAME"]),
    warehouseCode: firstStringField(record, ["WH_CD", "WH_CODE", "WAREHOUSE_CD"]),
    warehouseName: firstStringField(record, ["WH_DES", "WH_NAME", "WAREHOUSE_NAME"]),
    balanceQuantity: numericField(record, [
      "BAL_QTY",
      "BALANCE_QTY",
      "INV_QTY",
      "STOCK_QTY",
      "QTY",
    ]),
    raw: record,
  };
}

function normalizePurchaseOrderRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    orderNo: firstStringField(record, [
      "IO_NO",
      "ORDER_NO",
      "ORD_NO",
      "PURCHASE_ORDER_NO",
      "PURCHASES_ORDER_NO",
      "NO",
      "SER_NO",
    ]),
    orderDate: firstStringField(record, [
      "IO_DATE",
      "ORDER_DATE",
      "ORD_DATE",
      "DATE",
      "WR_DATE",
    ]),
    customerCode: firstStringField(record, [
      "CUST",
      "CUST_CD",
      "CUST_CODE",
      "BUSINESS_NO",
    ]),
    customerName: firstStringField(record, [
      "CUST_DES",
      "CUST_NAME",
      "CUSTOMER_NAME",
      "BUSINESS_NAME",
    ]),
    productCode: firstStringField(record, [
      "PROD_CD",
      "PROD_CODE",
      "ITEM_CD",
      "ITEM_CODE",
    ]),
    productName: firstStringField(record, [
      "PROD_DES",
      "PROD_NAME",
      "ITEM_DES",
      "ITEM_NAME",
    ]),
    quantity: numericField(record, [
      "QTY",
      "ORDER_QTY",
      "ORD_QTY",
      "PURCHASE_QTY",
    ]),
    supplyAmount: numericField(record, [
      "SUPPLY_AMT",
      "SUPPLY_AMOUNT",
      "AMT",
      "PRICE",
    ]),
    totalAmount: numericField(record, [
      "TOTAL_AMT",
      "TOTAL_AMOUNT",
      "SUM_AMT",
      "TOT_AMT",
    ]),
    status: firstStringField(record, [
      "STATUS",
      "ORDER_STATUS",
      "PROGRESS_STATUS",
    ]),
    raw: record,
  };
}

function aggregateInventoryRecords(
  records: Record<string, unknown>[]
): Record<string, unknown>[] {
  const aggregate = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    const productCode = coerceString(record.productCode) ?? "";
    const productName = coerceString(record.productName) ?? "";
    const key = productCode || productName || JSON.stringify(record.raw ?? record);
    const current = aggregate.get(key);
    const quantity =
      typeof record.balanceQuantity === "number" && Number.isFinite(record.balanceQuantity)
        ? record.balanceQuantity
        : 0;
    if (!current) {
      aggregate.set(key, {
        productCode: productCode || null,
        productName: productName || null,
        balanceQuantity: quantity,
        warehouses: record.warehouseCode ? [record] : [],
      });
      continue;
    }
    current.balanceQuantity =
      typeof current.balanceQuantity === "number"
        ? current.balanceQuantity + quantity
        : quantity;
    if (record.warehouseCode && Array.isArray(current.warehouses)) {
      current.warehouses.push(record);
    }
  }
  return [...aggregate.values()];
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function firstStringAt(value: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const entry = readPath(value, path);
    if (typeof entry === "string" && entry.trim()) {
      return entry.trim();
    }
  }
  return null;
}

function firstMessage(value: unknown): string | null {
  return firstStringAt(value, [
    ["message"],
    ["Message"],
    ["ERROR_DES"],
    ["Error", "Message"],
    ["Data", "Message"],
    ["Data", "Datas", "Message"],
    ["data", "message"],
  ]);
}

function firstDataCode(value: unknown): string | null {
  return firstStringAt(value, [
    ["Data", "Code"],
    ["Data", "Datas", "Code"],
    ["data", "code"],
    ["Code"],
  ]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstArrayAt(value: unknown, paths: string[][]): unknown[] | null {
  for (const path of paths) {
    const entry = readPath(value, path);
    if (Array.isArray(entry)) {
      return entry;
    }
  }
  return null;
}

function firstStringField(
  record: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function normalizeProductRecord(value: unknown): EcountBasicProductRecord | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    code: firstStringField(record, [
      "PROD_CD",
      "PROD_CODE",
      "ITEM_CD",
      "ITEM_CODE",
      "CODE",
    ]),
    name: firstStringField(record, [
      "PROD_DES",
      "PROD_NAME",
      "ITEM_DES",
      "ITEM_NAME",
      "NAME",
    ]),
    spec: firstStringField(record, [
      "SIZE_DES",
      "SIZE",
      "SPEC",
      "SPEC_DES",
    ]),
    unit: firstStringField(record, [
      "UNIT",
      "UNIT_CD",
      "UNIT_DES",
    ]),
    raw: record,
  };
}

function extractRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }

  const directRows = firstArrayAt(payload, [
    ["Data", "Output"],
    ["Data", "Datas", "Output"],
    ["Data", "Result"],
    ["Data", "Datas", "Result"],
    ["Output"],
    ["Result"],
  ]);
  if (directRows) {
    return directRows
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }

  const output = asRecord(readPath(payload, ["Data", "Output"])) ??
    asRecord(readPath(payload, ["Data", "Datas"]));
  if (!output) {
    return [];
  }

  for (const value of Object.values(output)) {
    if (Array.isArray(value)) {
      return value
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    }
  }

  return [];
}

function extractProductRows(payload: unknown): Record<string, unknown>[] {
  return extractRows(payload);
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text };
    }
  }

  if (!response.ok) {
    throw new Error(firstMessage(parsed) ?? `${response.status} ${response.statusText}`);
  }

  return parsed;
}

export class EcountConnectionService implements EcountConnectionTester {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => string;

  constructor(options: EcountConnectionServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async testConnection(
    input: EcountConnectionTestInput
  ): Promise<EcountConnectionTestResult> {
    const checkedAt = this.now();
    const accountLabel = trimOptional(input.accountLabel);
    const comCode = input.comCode.trim();
    const userId = input.userId.trim();
    const apiCertKey = input.apiCertKey.trim();
    const lanType = trimOptional(input.lanType) ?? "ko-KR";

    try {
      const zone = await this.resolveZone(comCode, trimOptional(input.zone));
      const sessionId = await this.login({
        comCode,
        userId,
        apiCertKey,
        zone,
        lanType,
      });

      return {
        ok: true,
        status: "connected",
        accountLabel,
        comCode,
        userId,
        zone,
        checkedAt,
        message: sessionId
          ? "ECOUNT login succeeded and a session was issued."
          : "ECOUNT login succeeded.",
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown ECOUNT error.";
      return {
        ok: false,
        status: "failed",
        accountLabel,
        comCode,
        userId,
        zone: trimOptional(input.zone),
        checkedAt,
        message: "ECOUNT connection test failed.",
        diagnostics: {
          stage: detail.toLowerCase().includes("zone") ? "zone" : "login",
          detail,
        },
      };
    }
  }

  async getBasicProductsList(
    input: EcountConnectionTestInput,
    options: EcountBasicProductsLookupInput = {}
  ): Promise<EcountBasicProductsLookupResult> {
    const checkedAt = this.now();
    const accountLabel = trimOptional(input.accountLabel);
    const comCode = input.comCode.trim();
    const userId = input.userId.trim();
    const apiCertKey = input.apiCertKey.trim();
    const lanType = trimOptional(input.lanType) ?? "ko-KR";
    const limit =
      typeof options.limit === "number" && Number.isFinite(options.limit)
        ? Math.max(1, Math.floor(options.limit))
        : null;
    const offset =
      typeof options.offset === "number" && Number.isFinite(options.offset)
        ? Math.max(0, Math.floor(options.offset))
        : 0;
    let stage: "zone" | "login" | "read" = "zone";
    let zone = trimOptional(input.zone);

    try {
      zone = await this.resolveZone(comCode, zone);
      stage = "login";
      const sessionId = await this.login({
        comCode,
        userId,
        apiCertKey,
        zone,
        lanType,
      });
      stage = "read";
      const payload = await postJson(
        this.fetchImpl,
        `https://sboapi${zone}.ecount.com/OAPI/V2/InventoryBasic/GetBasicProductsList?session_Id=${encodeURIComponent(sessionId ?? "")}`,
        {}
      );
      const code = firstDataCode(payload);
      if (code && code !== "00") {
        throw new Error(firstMessage(payload) ?? `ECOUNT read returned code ${code}.`);
      }

      const rows = extractProductRows(payload);
      const products = rows
        .map((row) => normalizeProductRecord(row))
        .filter((row): row is EcountBasicProductRecord => Boolean(row));
      const offsetProducts = offset > 0 ? products.slice(offset) : products;
      const limitedProducts = limit ? offsetProducts.slice(0, limit) : offsetProducts;

      return {
        ok: true,
        status: "connected",
        accountLabel,
        zone,
        checkedAt,
        api: "InventoryBasic/GetBasicProductsList",
        count: products.length,
        returnedCount: limitedProducts.length,
        products: limitedProducts,
        message: `ECOUNT product lookup returned ${products.length} product(s).`,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown ECOUNT error.";
      return {
        ok: false,
        status: "failed",
        accountLabel,
        zone,
        checkedAt,
        api: "InventoryBasic/GetBasicProductsList",
        count: 0,
        returnedCount: 0,
        products: [],
        message: "ECOUNT product lookup failed.",
        diagnostics: {
          stage,
          detail,
        },
      };
    }
  }

  listCapabilities(): EcountIntegrationCapabilityRecord[] {
    return listEcountIntegrationCapabilities();
  }

  async queryDataset(
    input: EcountConnectionTestInput,
    query: EcountDatasetQueryInput
  ): Promise<EcountDatasetQueryResult> {
    const dataset = normalizeEcountDatasetId(query.dataset);
    const checkedAt = this.now();
    const accountLabel = trimOptional(input.accountLabel);
    const zone = trimOptional(input.zone);

    if (dataset === "products") {
      return productLookupToDatasetResult(
        await this.getBasicProductsList(input, {
          limit: query.limit,
          offset: query.offset,
        })
      );
    }

    if (dataset === "inventory" || dataset === "warehouseInventory") {
      return this.getInventoryBalanceDataset(input, {
        ...query,
        dataset,
      });
    }

    if (dataset === "purchases") {
      return this.getPurchaseOrdersDataset(input, {
        ...query,
        dataset,
      });
    }

    return unsupportedDatasetResult({
      dataset,
      accountLabel,
      zone,
      checkedAt,
    });
  }

  private async getInventoryBalanceDataset(
    input: EcountConnectionTestInput,
    query: EcountDatasetQueryInput & { dataset: "inventory" | "warehouseInventory" }
  ): Promise<EcountDatasetQueryResult> {
    const checkedAt = this.now();
    const accountLabel = trimOptional(input.accountLabel);
    const comCode = input.comCode.trim();
    const userId = input.userId.trim();
    const apiCertKey = input.apiCertKey.trim();
    const lanType = trimOptional(input.lanType) ?? "ko-KR";
    const capability = ecountCapabilityForDataset(query.dataset);
    let stage: "zone" | "login" | "read" = "zone";
    let zone = trimOptional(input.zone);

    try {
      zone = await this.resolveZone(comCode, zone);
      stage = "login";
      const sessionId = await this.login({
        comCode,
        userId,
        apiCertKey,
        zone,
        lanType,
      });
      stage = "read";
      const payload = await postJson(
        this.fetchImpl,
        `https://sboapi${zone}.ecount.com/OAPI/V2/${INVENTORY_BALANCE_BY_LOCATION_API}?SESSION_ID=${encodeURIComponent(sessionId ?? "")}`,
        buildInventoryBalancePayload({
          comCode,
          userId,
          apiCertKey,
          zone,
          lanType,
          sessionId,
          filters: query.filters,
          checkedAt,
        })
      );
      const code = firstDataCode(payload);
      if (code && code !== "00") {
        throw new Error(firstMessage(payload) ?? `ECOUNT read returned code ${code}.`);
      }

      const warehouseRecords = extractRows(payload)
        .map((row) => normalizeWarehouseInventoryRecord(row))
        .filter((row): row is Record<string, unknown> => Boolean(row));
      const records =
        query.dataset === "inventory"
          ? aggregateInventoryRecords(warehouseRecords)
          : warehouseRecords;
      const windowedRecords = applyRecordWindow(records, query);
      const label = capability?.label ?? query.dataset;

      return {
        ok: true,
        provider: "ecount",
        dataset: query.dataset,
        title: `ECOUNT ERP ${label} 조회`,
        status: "ready",
        accountLabel,
        zone,
        checkedAt,
        api: INVENTORY_BALANCE_BY_LOCATION_API,
        count: records.length,
        returnedCount: windowedRecords.length,
        records: windowedRecords,
        message: `ECOUNT ${label} lookup returned ${records.length} record(s).`,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown ECOUNT error.";
      const label = capability?.label ?? query.dataset;
      return {
        ok: false,
        provider: "ecount",
        dataset: query.dataset,
        title: `ECOUNT ERP ${label} 조회`,
        status: "failed",
        accountLabel,
        zone,
        checkedAt,
        api: INVENTORY_BALANCE_BY_LOCATION_API,
        count: 0,
        returnedCount: 0,
        records: [],
        message: `ECOUNT ${label} lookup failed.`,
        diagnostics: {
          stage,
          detail,
        },
      };
    }
  }

  private async getPurchaseOrdersDataset(
    input: EcountConnectionTestInput,
    query: EcountDatasetQueryInput & { dataset: "purchases" }
  ): Promise<EcountDatasetQueryResult> {
    const checkedAt = this.now();
    const accountLabel = trimOptional(input.accountLabel);
    const comCode = input.comCode.trim();
    const userId = input.userId.trim();
    const apiCertKey = input.apiCertKey.trim();
    const lanType = trimOptional(input.lanType) ?? "ko-KR";
    const capability = ecountCapabilityForDataset(query.dataset);
    let stage: "zone" | "login" | "read" = "zone";
    let zone = trimOptional(input.zone);

    try {
      zone = await this.resolveZone(comCode, zone);
      stage = "login";
      const sessionId = await this.login({
        comCode,
        userId,
        apiCertKey,
        zone,
        lanType,
      });
      stage = "read";
      const payload = await postJson(
        this.fetchImpl,
        `https://sboapi${zone}.ecount.com/OAPI/V2/${PURCHASE_ORDER_LIST_API}?SESSION_ID=${encodeURIComponent(sessionId ?? "")}`,
        buildPurchaseOrderListPayload({
          comCode,
          userId,
          apiCertKey,
          zone,
          lanType,
          sessionId,
          filters: query.filters,
          checkedAt,
        })
      );
      const code = firstDataCode(payload);
      if (code && code !== "00") {
        throw new Error(firstMessage(payload) ?? `ECOUNT read returned code ${code}.`);
      }

      const records = extractRows(payload)
        .map((row) => normalizePurchaseOrderRecord(row))
        .filter((row): row is Record<string, unknown> => Boolean(row));
      const windowedRecords = applyRecordWindow(records, query);
      const label = capability?.label ?? query.dataset;

      return {
        ok: true,
        provider: "ecount",
        dataset: query.dataset,
        title: `ECOUNT ERP ${label} 조회`,
        status: "ready",
        accountLabel,
        zone,
        checkedAt,
        api: PURCHASE_ORDER_LIST_API,
        count: records.length,
        returnedCount: windowedRecords.length,
        records: windowedRecords,
        message: `ECOUNT ${label} lookup returned ${records.length} record(s).`,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown ECOUNT error.";
      const label = capability?.label ?? query.dataset;
      return {
        ok: false,
        provider: "ecount",
        dataset: query.dataset,
        title: `ECOUNT ERP ${label} 조회`,
        status: "failed",
        accountLabel,
        zone,
        checkedAt,
        api: PURCHASE_ORDER_LIST_API,
        count: 0,
        returnedCount: 0,
        records: [],
        message: `ECOUNT ${label} lookup failed.`,
        diagnostics: {
          stage,
          detail,
        },
      };
    }
  }

  private async resolveZone(comCode: string, zone: string | null): Promise<string> {
    if (zone) {
      return zone;
    }

    const payload = await postJson(this.fetchImpl, "https://sboapi.ecount.com/OAPI/V2/Zone", {
      COM_CODE: comCode,
    });
    const resolvedZone = firstStringAt(payload, [
      ["Data", "Datas", "ZONE"],
      ["Data", "ZONE"],
      ["data", "ZONE"],
      ["ZONE"],
    ]);
    if (!resolvedZone) {
      throw new Error(firstMessage(payload) ?? "ECOUNT zone lookup did not return ZONE.");
    }
    return resolvedZone;
  }

  private async login(input: {
    comCode: string;
    userId: string;
    apiCertKey: string;
    zone: string;
    lanType: string;
  }): Promise<string | null> {
    const payload = await postJson(
      this.fetchImpl,
      `https://sboapi${input.zone}.ecount.com/OAPI/V2/OAPILogin`,
      {
        COM_CODE: input.comCode,
        USER_ID: input.userId,
        API_CERT_KEY: input.apiCertKey,
        LAN_TYPE: input.lanType,
        ZONE: input.zone,
        ISTEST: "Y",
      }
    );
    const sessionId = firstStringAt(payload, [
      ["Data", "Datas", "SESSION_ID"],
      ["Data", "SESSION_ID"],
      ["data", "SESSION_ID"],
      ["SESSION_ID"],
    ]);
    if (!sessionId) {
      throw new Error(firstMessage(payload) ?? "ECOUNT login did not return SESSION_ID.");
    }
    return sessionId;
  }
}
