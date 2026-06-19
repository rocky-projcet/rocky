export interface EcountConnectionTestInput {
  accountLabel?: string | null;
  comCode: string;
  userId: string;
  apiCertKey: string;
  zone?: string | null;
  lanType?: string | null;
  serverType?: EcountServerType | null;
}

export type EcountServerType = "test" | "production";

export const DEFAULT_ECOUNT_SERVER_TYPE: EcountServerType = "test";

export interface EcountConnectionTestResult {
  ok: boolean;
  status: "connected" | "failed";
  accountLabel: string | null;
  comCode: string;
  userId: string;
  zone: string | null;
  serverType: EcountServerType;
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
  filters?: Record<string, unknown> | null;
}

export type EcountDatasetId =
  | "product"
  | "products"
  | "inventoryBalance"
  | "inventory"
  | "warehouseInventoryBalance"
  | "warehouseInventory"
  | "customers"
  | "sales"
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

type EcountReadStage = "zone" | "login" | "read" | "capability";

interface EcountReadConfig {
  dataset: EcountDatasetId;
  api: string;
  requiresProductCode?: boolean;
  buildPayload(input: {
    sessionId: string | null;
    filters?: Record<string, unknown> | null;
    checkedAt: string;
    limit?: number | null;
  }): Record<string, unknown>;
  normalize(value: unknown): Record<string, unknown> | null;
}

function trimOptional(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeEcountServerType(
  value: EcountServerType | string | null | undefined
): EcountServerType {
  return value === "production" ? "production" : DEFAULT_ECOUNT_SERVER_TYPE;
}

const PRODUCT_DETAIL_API = "InventoryBasic/ViewBasicProduct";
const PRODUCT_LIST_API = "InventoryBasic/GetBasicProductsList";
const INVENTORY_BALANCE_API = "InventoryBalance/ViewInventoryBalanceStatus";
const INVENTORY_BALANCE_LIST_API = "InventoryBalance/GetListInventoryBalanceStatus";
const INVENTORY_BALANCE_BY_LOCATION_API =
  "InventoryBalance/ViewInventoryBalanceStatusByLocation";
const INVENTORY_BALANCE_BY_LOCATION_LIST_API =
  "InventoryBalance/GetListInventoryBalanceStatusByLocation";
const PURCHASE_ORDER_LIST_API = "Purchases/GetPurchasesOrderList";

const ECOUNT_DATASET_CAPABILITIES: EcountIntegrationCapabilityRecord[] = [
  {
    provider: "ecount",
    dataset: "product",
    label: "품목(단건)",
    status: "supported",
    access: "read",
    api: PRODUCT_DETAIL_API,
    filters: ["productCode", "productType"],
    reason: null,
  },
  {
    provider: "ecount",
    dataset: "products",
    label: "품목",
    status: "supported",
    access: "read",
    api: PRODUCT_LIST_API,
    filters: [
      "productCode",
      "productCodes",
      "productType",
      "fromProductCode",
      "toProductCode",
      "commaFlag",
      "limit",
      "offset",
    ],
    reason: null,
  },
  {
    provider: "ecount",
    dataset: "inventoryBalance",
    label: "재고현황(단건)",
    status: "supported",
    access: "read",
    api: INVENTORY_BALANCE_API,
    filters: [
      "baseDate",
      "productCode",
      "warehouseCode",
      "zeroFlag",
      "balanceFlag",
      "deleteFlag",
      "safeFlag",
      "limit",
      "offset",
    ],
    reason: null,
  },
  {
    provider: "ecount",
    dataset: "inventory",
    label: "재고현황",
    status: "supported",
    access: "read",
    api: INVENTORY_BALANCE_LIST_API,
    filters: [
      "baseDate",
      "productCode",
      "warehouseCode",
      "zeroFlag",
      "balanceFlag",
      "deleteFlag",
      "safeFlag",
      "limit",
      "offset",
    ],
    reason: null,
  },
  {
    provider: "ecount",
    dataset: "warehouseInventoryBalance",
    label: "창고별 재고현황(단건)",
    status: "supported",
    access: "read",
    api: INVENTORY_BALANCE_BY_LOCATION_API,
    filters: [
      "baseDate",
      "productCode",
      "warehouseCode",
      "balanceFlag",
      "deleteFlag",
      "deleteLocationFlag",
      "limit",
      "offset",
    ],
    reason: null,
  },
  {
    provider: "ecount",
    dataset: "warehouseInventory",
    label: "창고별 재고현황",
    status: "supported",
    access: "read",
    api: INVENTORY_BALANCE_BY_LOCATION_LIST_API,
    filters: [
      "baseDate",
      "productCode",
      "warehouseCode",
      "balanceFlag",
      "deleteFlag",
      "deleteLocationFlag",
      "limit",
      "offset",
    ],
    reason: null,
  },
  {
    provider: "ecount",
    dataset: "purchases",
    label: "발주서",
    status: "supported",
    access: "read",
    api: PURCHASE_ORDER_LIST_API,
    filters: [
      "fromDate",
      "toDate",
      "customerCode",
      "customerCodes",
      "productCode",
      "productCodes",
      "period",
      "page",
      "pageSize",
      "limit",
      "offset",
    ],
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
    reason: "The scraped ECOUNT Open API manual lists customer/vendor input, not a verified read endpoint.",
  },
  {
    provider: "ecount",
    dataset: "sales",
    label: "판매",
    status: "unsupported",
    access: "read",
    api: null,
    filters: ["fromDate", "toDate", "customerCode", "productCode"],
    reason: "The scraped ECOUNT Open API manual lists sale input, not a verified sales lookup endpoint."
  },
  {
    provider: "ecount",
    dataset: "orders",
    label: "주문서",
    status: "unsupported",
    access: "read",
    api: null,
    filters: ["fromDate", "toDate", "customerCode", "productCode"],
    reason: "The scraped ECOUNT Open API manual lists sales order input, not a verified read endpoint.",
  },
  {
    provider: "ecount",
    dataset: "accounting",
    label: "매출·매입",
    status: "unsupported",
    access: "read",
    api: null,
    filters: ["fromDate", "toDate", "customerCode"],
    reason: "The scraped ECOUNT Open API manual lists invoice auto input, not a verified read endpoint.",
  },
];

export function listEcountIntegrationCapabilities(): EcountIntegrationCapabilityRecord[] {
  return ECOUNT_DATASET_CAPABILITIES.map((capability) => ({ ...capability }));
}

const ECOUNT_DATASET_IDS = new Set<string>([
  "product",
  "products",
  "inventoryBalance",
  "inventory",
  "warehouseInventoryBalance",
  "warehouseInventory",
  "customers",
  "sales",
  "orders",
  "purchases",
  "accounting",
]);

export function normalizeEcountDatasetId(value: string): EcountDatasetId | string {
  const normalized = value.trim();
  if (ECOUNT_DATASET_IDS.has(normalized)) {
    return normalized as EcountDatasetId;
  }
  const compact = normalized.replace(/[\s_-]+/gu, "").toLowerCase();
  const aliases: Record<string, EcountDatasetId> = {
    product: "product",
    productlist: "products",
    products: "products",
    items: "products",
    item: "products",
    품목: "products",
    상품: "products",
    basicproduct: "product",
    productdetail: "product",
    singleproduct: "product",
    품목단건: "product",
    품목조회단건: "product",
    inventory: "inventory",
    inventorybalance: "inventoryBalance",
    inventorybalances: "inventory",
    inventorybalancelist: "inventory",
    stock: "inventory",
    stocks: "inventory",
    재고: "inventory",
    재고현황: "inventory",
    재고현황목록: "inventory",
    singleinventorybalance: "inventoryBalance",
    inventorybalancedetail: "inventoryBalance",
    재고현황단건: "inventoryBalance",
    warehouseinventory: "warehouseInventory",
    warehouseinventorybalance: "warehouseInventoryBalance",
    warehouseinventorybalances: "warehouseInventory",
    warehouseinventorybalancelist: "warehouseInventory",
    locationinventory: "warehouseInventory",
    locationinventorybalance: "warehouseInventory",
    창고별재고: "warehouseInventory",
    창고별재고현황: "warehouseInventory",
    창고별재고현황목록: "warehouseInventory",
    singlewarehouseinventorybalance: "warehouseInventoryBalance",
    warehouseinventorybalancedetail: "warehouseInventoryBalance",
    locationinventorybalancedetail: "warehouseInventoryBalance",
    창고별재고현황단건: "warehouseInventoryBalance",
    customer: "customers",
    customers: "customers",
    vendor: "customers",
    vendors: "customers",
    거래처: "customers",
    sales: "sales",
    sale: "sales",
    판매: "sales",
    orders: "orders",
    order: "orders",
    salesorder: "orders",
    주문서: "orders",
    주문: "orders",
    purchases: "purchases",
    purchase: "purchases",
    purchaseorder: "purchases",
    purchaseorders: "purchases",
    구매: "purchases",
    발주서: "purchases",
    발주서조회: "purchases",
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

function datasetLabel(dataset: string): string {
  return ecountCapabilityForDataset(dataset)?.label ?? dataset;
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

function missingRequiredFilterResult(input: {
  dataset: EcountDatasetId;
  label: string;
  api: string;
  accountLabel: string | null;
  zone: string | null;
  checkedAt: string;
  filter: string;
}): EcountDatasetQueryResult {
  return {
    ok: false,
    provider: "ecount",
    dataset: input.dataset,
    title: `ECOUNT ERP ${input.label} 조회`,
    status: "failed",
    accountLabel: input.accountLabel,
    zone: input.zone,
    checkedAt: input.checkedAt,
    api: input.api,
    count: 0,
    returnedCount: 0,
    records: [],
    message: `ECOUNT ${input.label} lookup requires ${input.filter}.`,
    diagnostics: {
      stage: "capability",
      detail: `The ECOUNT ${input.api} manual requires ${input.filter}.`,
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

function coercePositiveInt(value: unknown, max: number | null = null): number | null {
  const raw = coerceString(value);
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const normalized = Math.max(1, Math.floor(parsed));
  return max ? Math.min(normalized, max) : normalized;
}

function coerceStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => coerceString(entry))
      .filter((entry): entry is string => Boolean(entry));
  }
  const raw = coerceString(value);
  return raw ? [raw] : [];
}

function delimitedFilter(
  filters: Record<string, unknown> | null | undefined,
  keys: string[]
): string | null {
  for (const key of keys) {
    const values = coerceStringList(filters?.[key]);
    if (values.length > 0) {
      return values.join("∬");
    }
  }
  return null;
}

function ynFlag(
  filters: Record<string, unknown> | null | undefined,
  keys: string[]
): "Y" | "N" | null {
  for (const key of keys) {
    const raw = filters?.[key];
    if (typeof raw === "boolean") {
      return raw ? "Y" : "N";
    }
    const value = coerceString(raw)?.toUpperCase();
    if (!value) {
      continue;
    }
    if (["Y", "YES", "TRUE", "1", "INCLUDE"].includes(value)) {
      return "Y";
    }
    if (["N", "NO", "FALSE", "0", "EXCLUDE"].includes(value)) {
      return "N";
    }
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
  const explicitFrom = parseEcountDate(filters?.fromDate ?? filters?.startDate);
  const explicitTo =
    parseEcountDate(filters?.toDate ?? filters?.endDate) ??
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
      fromDate: addDaysToEcountDate(toDate, -29),
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

function buildProductPayload(input: {
  sessionId: string | null;
  filters?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    SESSION_ID: input.sessionId,
    PROD_CD: delimitedFilter(input.filters, ["productCode", "productCodes", "prodCd", "PROD_CD"]) ?? "",
  };
  const productType = delimitedFilter(input.filters, ["productType", "productTypes", "prodType", "PROD_TYPE"]);
  if (productType) {
    payload.PROD_TYPE = productType;
  }
  const fromProductCode = coerceString(input.filters?.fromProductCode ?? input.filters?.fromProdCd);
  if (fromProductCode) {
    payload.FROM_PROD_CD = fromProductCode;
  }
  const toProductCode = coerceString(input.filters?.toProductCode ?? input.filters?.toProdCd);
  if (toProductCode) {
    payload.TO_PROD_CD = toProductCode;
  }
  const commaFlag = ynFlag(input.filters, ["commaFlag", "comma", "COMMA_FLAG"]);
  if (commaFlag) {
    payload.COMMA_FLAG = commaFlag;
  }
  return payload;
}

function buildInventoryBalancePayload(input: {
  sessionId: string | null;
  filters?: Record<string, unknown> | null;
  checkedAt: string;
  byLocation: boolean;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    SESSION_ID: input.sessionId,
    BASE_DATE: toEcountDate(
      input.filters?.baseDate ?? input.filters?.toDate ?? input.filters?.date,
      input.checkedAt
    ),
    PROD_CD: delimitedFilter(input.filters, ["productCode", "productCodes", "prodCd", "PROD_CD"]) ?? "",
    WH_CD: delimitedFilter(input.filters, ["warehouseCode", "warehouseCodes", "whCd", "WH_CD"]) ?? "",
  };

  const balanceFlag = ynFlag(input.filters, ["balanceFlag", "includeUnmanagedProducts", "balFlag", "BAL_FLAG"]);
  if (balanceFlag) {
    payload.BAL_FLAG = balanceFlag;
  }
  const deleteFlag = ynFlag(input.filters, ["deleteFlag", "includeInactiveProducts", "delGubun", "DEL_GUBUN"]);
  if (deleteFlag) {
    payload.DEL_GUBUN = deleteFlag;
  }

  if (input.byLocation) {
    const deleteLocationFlag = ynFlag(input.filters, [
      "deleteLocationFlag",
      "includeInactiveWarehouses",
      "delLocationYn",
      "DEL_LOCATION_YN",
    ]);
    if (deleteLocationFlag) {
      payload.DEL_LOCATION_YN = deleteLocationFlag;
    }
    return payload;
  }

  const zeroFlag = ynFlag(input.filters, ["zeroFlag", "includeZero", "ZERO_FLAG"]);
  if (zeroFlag) {
    payload.ZERO_FLAG = zeroFlag;
  }
  const safeFlag = ynFlag(input.filters, ["safeFlag", "belowSafetyStock", "SAFE_FLAG"]);
  if (safeFlag) {
    payload.SAFE_FLAG = safeFlag;
  }
  return payload;
}

function buildPurchaseOrderListPayload(input: {
  sessionId: string | null;
  filters?: Record<string, unknown> | null;
  checkedAt: string;
  limit?: number | null;
}): Record<string, unknown> {
  const range = dateRangeFromFilters(input.filters, input.checkedAt);
  const pageSize =
    coercePositiveInt(input.filters?.pageSize ?? input.filters?.PAGE_SIZE, 100) ??
    (typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.min(Math.max(1, Math.floor(input.limit)), 100)
      : 100);
  return {
    SESSION_ID: input.sessionId,
    PROD_CD: delimitedFilter(input.filters, ["productCode", "productCodes", "prodCd", "PROD_CD"]) ?? "",
    CUST_CD: delimitedFilter(input.filters, ["customerCode", "customerCodes", "custCd", "CUST_CD"]) ?? "",
    ListParam: {
      PAGE_CURRENT:
        coercePositiveInt(input.filters?.page ?? input.filters?.pageCurrent ?? input.filters?.PAGE_CURRENT) ??
        1,
      PAGE_SIZE: pageSize,
      BASE_DATE_FROM: range.fromDate,
      BASE_DATE_TO: range.toDate,
    },
  };
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

function parseEmbeddedJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/u.test(trimmed)) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
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
  const direct = firstStringAt(value, [
    ["message"],
    ["Message"],
    ["ERROR_DES"],
    ["Error", "Message"],
    ["Data", "Message"],
    ["Data", "Datas", "Message"],
    ["data", "message"],
  ]);
  if (direct) {
    return direct;
  }
  const errors = firstArrayAt(value, [["Errors"], ["Data", "Errors"]]);
  const firstError = asRecord(errors?.[0]);
  return firstStringField(firstError ?? {}, ["Message", "message", "ERROR_DES"]);
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
  const parsed = parseEmbeddedJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function firstArrayAt(value: unknown, paths: string[][]): unknown[] | null {
  for (const path of paths) {
    const entry = parseEmbeddedJson(readPath(value, path));
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

function arrayFromValue(value: unknown): Record<string, unknown>[] | null {
  const parsed = parseEmbeddedJson(value);
  if (Array.isArray(parsed)) {
    return parsed
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }
  const record = asRecord(parsed);
  if (!record) {
    return null;
  }
  for (const entry of Object.values(record)) {
    const nested = arrayFromValue(entry);
    if (nested && nested.length > 0) {
      return nested;
    }
  }
  return null;
}

function extractRows(payload: unknown): Record<string, unknown>[] {
  const candidates = [
    payload,
    readPath(payload, ["Data", "Output"]),
    readPath(payload, ["Data", "Datas", "Output"]),
    readPath(payload, ["Data", "Result"]),
    readPath(payload, ["Data", "Datas", "Result"]),
    readPath(payload, ["Output"]),
    readPath(payload, ["Result"]),
  ];

  for (const candidate of candidates) {
    const rows = arrayFromValue(candidate);
    if (rows && rows.length > 0) {
      return rows;
    }
  }

  const resultRecord =
    asRecord(readPath(payload, ["Data", "Result"])) ??
    asRecord(readPath(payload, ["Data", "Datas", "Result"]));
  return resultRecord ? [resultRecord] : [];
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
      "PROD_SIZE_DES",
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

function normalizeProductDatasetRecord(value: unknown): Record<string, unknown> | null {
  const product = normalizeProductRecord(value);
  if (!product) {
    return null;
  }
  return {
    code: product.code,
    name: product.name,
    spec: product.spec,
    unit: product.unit,
    raw: product.raw,
  };
}

function normalizeInventoryBalanceRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    productCode: firstStringField(record, ["PROD_CD", "PROD_CODE", "ITEM_CD", "ITEM_CODE"]),
    productName: firstStringField(record, ["PROD_DES", "PROD_NAME", "ITEM_DES", "ITEM_NAME"]),
    productSpec: firstStringField(record, ["PROD_SIZE_DES", "SIZE_DES", "SPEC_DES", "SPEC"]),
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
      "ORD_NO",
      "ORDER_NO",
      "IO_NO",
      "PURCHASE_ORDER_NO",
      "PURCHASES_ORDER_NO",
      "NO",
      "SER_NO",
    ]),
    orderDate: firstStringField(record, [
      "ORD_DATE",
      "ORDER_DATE",
      "IO_DATE",
      "DATE",
      "WR_DATE",
    ]),
    warehouseCode: firstStringField(record, ["WH_CD", "WH_CODE", "WAREHOUSE_CD"]),
    warehouseName: firstStringField(record, ["WH_DES", "WH_NAME", "WAREHOUSE_NAME"]),
    projectCode: firstStringField(record, ["PJT_CD", "PROJECT_CD", "PROJECT_CODE"]),
    projectName: firstStringField(record, ["PJT_DES", "PROJECT_NAME"]),
    employeeCode: firstStringField(record, ["EMP_CD", "EMP_CODE"]),
    managerName: firstStringField(record, ["CUST_NAME", "EMP_NAME", "MANAGER_NAME"]),
    customerCode: firstStringField(record, [
      "CUST",
      "CUST_CD",
      "CUST_CODE",
      "BUSINESS_NO",
    ]),
    customerName: firstStringField(record, [
      "CUST_DES",
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
    dueDate: firstStringField(record, ["TIME_DATE", "DUE_DATE"]),
    quantity: numericField(record, [
      "QTY",
      "ORDER_QTY",
      "ORD_QTY",
      "PURCHASE_QTY",
    ]),
    supplyAmount: numericField(record, [
      "BUY_AMT",
      "SUPPLY_AMT",
      "SUPPLY_AMOUNT",
      "AMT",
      "PRICE",
    ]),
    vatAmount: numericField(record, ["VAT_AMT", "VAT_AMOUNT"]),
    totalAmount: numericField(record, ["TOTAL_AMT", "TOTAL_AMOUNT", "SUM_AMT", "TOT_AMT"]),
    foreignAmount: numericField(record, ["BUY_AMT_F", "FOREIGN_AMT"]),
    status: firstStringField(record, [
      "P_FLAG",
      "STATUS",
      "ORDER_STATUS",
      "PROGRESS_STATUS",
    ]),
    raw: record,
  };
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

function ecountDataApiUrl(
  serverType: EcountServerType,
  zone: string,
  api: string,
  sessionId: string | null,
  sessionParam: "SESSION_ID" | "session_Id" = "SESSION_ID"
): string {
  return `https://${ecountApiHost(serverType, zone)}/OAPI/V2/${api}?${sessionParam}=${encodeURIComponent(sessionId ?? "")}`;
}

function ecountApiHost(serverType: EcountServerType, zone?: string | null): string {
  const prefix = serverType === "production" ? "oapi" : "sboapi";
  return `${prefix}${zone ?? ""}.ecount.com`;
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
    const serverType = normalizeEcountServerType(input.serverType);

    try {
      const zone = await this.resolveZone(comCode, trimOptional(input.zone), serverType);
      const sessionId = await this.login({
        comCode,
        userId,
        apiCertKey,
        zone,
        lanType,
        serverType,
      });

      return {
        ok: true,
        status: "connected",
        accountLabel,
        comCode,
        userId,
        zone,
        serverType,
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
        serverType,
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
    const serverType = normalizeEcountServerType(input.serverType);
    let stage: "zone" | "login" | "read" = "zone";
    let zone = trimOptional(input.zone);

    try {
      zone = await this.resolveZone(comCode, zone, serverType);
      stage = "login";
      const sessionId = await this.login({
        comCode,
        userId,
        apiCertKey,
        zone,
        lanType,
        serverType,
      });
      stage = "read";
      const payload = await postJson(
        this.fetchImpl,
        ecountDataApiUrl(serverType, zone, PRODUCT_LIST_API, sessionId, "session_Id"),
        buildProductPayload({
          sessionId,
          filters: options.filters,
        })
      );
      const code = firstDataCode(payload);
      if (code && code !== "00") {
        throw new Error(firstMessage(payload) ?? `ECOUNT read returned code ${code}.`);
      }

      const products = extractRows(payload)
        .map((row) => normalizeProductRecord(row))
        .filter((row): row is EcountBasicProductRecord => Boolean(row));
      const limitedProducts = applyRecordWindow(products, options);

      return {
        ok: true,
        status: "connected",
        accountLabel,
        zone,
        checkedAt,
        api: PRODUCT_LIST_API,
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
        api: PRODUCT_LIST_API,
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
    const dataset = normalizeEcountDatasetId(String(query.dataset));
    const checkedAt = this.now();
    const accountLabel = trimOptional(input.accountLabel);
    const zone = trimOptional(input.zone);

    if (dataset === "products") {
      return productLookupToDatasetResult(
        await this.getBasicProductsList(input, {
          limit: query.limit,
          offset: query.offset,
          filters: query.filters,
        })
      );
    }

    if (dataset === "product") {
      return this.getReadDataset(input, query, {
        dataset: "product",
        api: PRODUCT_DETAIL_API,
        requiresProductCode: true,
        buildPayload: ({ sessionId, filters }) => buildProductPayload({ sessionId, filters }),
        normalize: normalizeProductDatasetRecord,
      });
    }

    if (dataset === "inventory" || dataset === "inventoryBalance") {
      return this.getReadDataset(input, query, {
        dataset: dataset as "inventory" | "inventoryBalance",
        api: dataset === "inventoryBalance" ? INVENTORY_BALANCE_API : INVENTORY_BALANCE_LIST_API,
        requiresProductCode: dataset === "inventoryBalance",
        buildPayload: ({ sessionId, filters, checkedAt: payloadCheckedAt }) =>
          buildInventoryBalancePayload({
            sessionId,
            filters,
            checkedAt: payloadCheckedAt,
            byLocation: false,
          }),
        normalize: normalizeInventoryBalanceRecord,
      });
    }

    if (dataset === "warehouseInventory" || dataset === "warehouseInventoryBalance") {
      return this.getReadDataset(input, query, {
        dataset: dataset as "warehouseInventory" | "warehouseInventoryBalance",
        api:
          dataset === "warehouseInventoryBalance"
            ? INVENTORY_BALANCE_BY_LOCATION_API
            : INVENTORY_BALANCE_BY_LOCATION_LIST_API,
        requiresProductCode: dataset === "warehouseInventoryBalance",
        buildPayload: ({ sessionId, filters, checkedAt: payloadCheckedAt }) =>
          buildInventoryBalancePayload({
            sessionId,
            filters,
            checkedAt: payloadCheckedAt,
            byLocation: true,
          }),
        normalize: normalizeInventoryBalanceRecord,
      });
    }

    if (dataset === "purchases") {
      return this.getReadDataset(input, query, {
        dataset: "purchases",
        api: PURCHASE_ORDER_LIST_API,
        buildPayload: ({ sessionId, filters, checkedAt: payloadCheckedAt, limit }) =>
          buildPurchaseOrderListPayload({
            sessionId,
            filters,
            checkedAt: payloadCheckedAt,
            limit,
          }),
        normalize: normalizePurchaseOrderRecord,
      });
    }

    return unsupportedDatasetResult({
      dataset: String(dataset),
      accountLabel,
      zone,
      checkedAt,
    });
  }

  private async getReadDataset(
    input: EcountConnectionTestInput,
    query: EcountDatasetQueryInput,
    config: EcountReadConfig
  ): Promise<EcountDatasetQueryResult> {
    const checkedAt = this.now();
    const accountLabel = trimOptional(input.accountLabel);
    const comCode = input.comCode.trim();
    const userId = input.userId.trim();
    const apiCertKey = input.apiCertKey.trim();
    const lanType = trimOptional(input.lanType) ?? "ko-KR";
    const serverType = normalizeEcountServerType(input.serverType);
    const label = datasetLabel(config.dataset);
    let stage: EcountReadStage = "capability";
    let zone = trimOptional(input.zone);

    if (
      config.requiresProductCode &&
      !delimitedFilter(query.filters, ["productCode", "productCodes", "prodCd", "PROD_CD"])
    ) {
      return missingRequiredFilterResult({
        dataset: config.dataset,
        label,
        api: config.api,
        accountLabel,
        zone,
        checkedAt,
        filter: "productCode",
      });
    }

    try {
      stage = "zone";
      zone = await this.resolveZone(comCode, zone, serverType);
      stage = "login";
      const sessionId = await this.login({
        comCode,
        userId,
        apiCertKey,
        zone,
        lanType,
        serverType,
      });
      stage = "read";
      const payload = await postJson(
        this.fetchImpl,
        ecountDataApiUrl(serverType, zone, config.api, sessionId),
        config.buildPayload({
          sessionId,
          filters: query.filters,
          checkedAt,
          limit: query.limit,
        })
      );
      const code = firstDataCode(payload);
      if (code && code !== "00") {
        throw new Error(firstMessage(payload) ?? `ECOUNT read returned code ${code}.`);
      }

      const records = extractRows(payload)
        .map((row) => config.normalize(row))
        .filter((row): row is Record<string, unknown> => Boolean(row));
      const windowedRecords = applyRecordWindow(records, query);

      return {
        ok: true,
        provider: "ecount",
        dataset: config.dataset,
        title: `ECOUNT ERP ${label} 조회`,
        status: "ready",
        accountLabel,
        zone,
        checkedAt,
        api: config.api,
        count: records.length,
        returnedCount: windowedRecords.length,
        records: windowedRecords,
        message: `ECOUNT ${label} lookup returned ${records.length} record(s).`,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown ECOUNT error.";
      return {
        ok: false,
        provider: "ecount",
        dataset: config.dataset,
        title: `ECOUNT ERP ${label} 조회`,
        status: "failed",
        accountLabel,
        zone,
        checkedAt,
        api: config.api,
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

  private async resolveZone(
    comCode: string,
    zone: string | null,
    serverType: EcountServerType
  ): Promise<string> {
    if (zone) {
      return zone;
    }

    const payload = await postJson(
      this.fetchImpl,
      `https://${ecountApiHost(serverType)}/OAPI/V2/Zone`,
      {
        COM_CODE: comCode,
      }
    );
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
    serverType: EcountServerType;
  }): Promise<string | null> {
    const payload = await postJson(
      this.fetchImpl,
      `https://${ecountApiHost(input.serverType, input.zone)}/OAPI/V2/OAPILogin`,
      {
        COM_CODE: input.comCode,
        USER_ID: input.userId,
        API_CERT_KEY: input.apiCertKey,
        LAN_TYPE: input.lanType,
        ZONE: input.zone,
        ISTEST: input.serverType === "production" ? "N" : "Y",
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
