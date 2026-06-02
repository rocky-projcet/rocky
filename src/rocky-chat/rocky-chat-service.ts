import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  open,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { AgentRecord } from "../agents/agent-types.js";
import { AgentLocalSkillService } from "../agents/agent-local-skill-service.js";
import type { AgentLocalSkillRecord } from "../agents/agent-local-skill-service.js";
import {
  ensureWorkspaceSkillBridge,
  WORKSPACE_LOCAL_SKILL_AUTHORING_DIR,
} from "../agents/agent-workspace.js";
import {
  deleteRockyChatRecord,
  listRockyChatPaths,
  readRockyCoreSettingsRecord,
  readRockyChatRecord,
  readRockyWorkerRecord,
  resolveRockyCoreSettingsPaths,
  resolveRockyChatPaths,
  resolveRockyWorkerPaths,
  writeRockyCoreSettingsRecord,
  writeRockyChatRecord,
  writeRockyWorkerRecord,
} from "./rocky-chat-store.js";
import {
  ROCKY_CORE_SKILL,
  ROCKY_ORCHESTRATION_SKILLS,
  extractRockyProtectionHints,
  getRockySkillByAbilityId,
  getRockySkillByWorkerId,
  listRockySkillAbilityCards,
  selectRockySkill,
  type RockyOrchestrationSkill,
} from "./rocky-skill-registry.js";
import {
  type AgentEcountLookupInstruction,
  type AgentConnectorSummary,
  type AgentConnectorProfileSummary,
  type AgentPreparedIntegrationSummary,
  buildAgentTurnSystemInstructions,
  buildRockyTurnSystemInstructions,
  rockyTaskAttachmentDirectory,
  rockyTaskInputDirectory,
  rockyTaskOutputDirectory,
  syncRockyAgentSkillWorkspace,
  writeAgentTurnContextFile,
  writeRockyTurnContextFile,
} from "./rocky-agent-skill-workspace.js";
import {
  RockyOrchestratorService,
  type RockyAgentServiceLike,
  type RockySessionServiceLike,
} from "./rocky-orchestrator-service.js";
import {
  TmpfilesTemporaryMediaHost,
  type TemporaryMediaHostLike,
} from "./media-host.js";
import {
  buildTemplateInterviewAgentPrompt,
  parseTemplateInterviewAgentResult,
} from "./rocky-template-interview.js";

import type {
  RockyAttachmentInput,
  RockyAttachmentRecord,
  RockyChatCreateInput,
  RockyChatDomain,
  RockyChatMessageInput,
  RockyChatMessagePageInput,
  RockyChatMessagePageRecord,
  RockyChatRecord,
  RockyCoreManagementRecord,
  RockyCoreSettingsRecord,
  RockyCoreSettingsUpdateInput,
  RockyCoreSkillRecord,
  RockyDispatchRecord,
  RockyInstagramPublishApprovalRecord,
  RockyInstagramPublishDraftPreviewMediaRecord,
  RockyInstagramPublishDraftPreviewRecord,
  RockyMessageRecord,
  RockyOrchestrationRecord,
  RockyRoutingIntent,
  RockySkillCandidateRecord,
  RockyTemplateInterviewTurnInput,
  RockyTemplateInterviewTurnResult,
  RockyUsedSkillRecord,
  RockyWorkerRecord,
} from "./rocky-chat-types.js";
import type {
  RuntimeKind,
  RuntimeOllamaLaunchTarget,
  RuntimeReasoningEffort,
  RuntimeServiceTier,
} from "../runtime/runtime-types.js";
import { contentTypeForArtifactPath } from "../runtime/runtime-artifact-metadata.js";
import type { AgentSessionRecord } from "../sessions/session-types.js";
import { SkillTemplateStore } from "../skills/skill-template-store.js";
import type { RuntimeSkillTemplateRecord } from "../skills/skill-template-store.js";
import {
  EcountSettingsService,
  type EcountSettingsServiceLike,
} from "../integrations/ecount-settings-service.js";
import {
  EcountConnectionService,
  normalizeEcountDatasetId,
  type EcountDatasetId,
  type EcountDatasetQueryInput,
  type EcountDatasetQueryResult,
  type EcountLookupServiceLike,
} from "../integrations/ecount-connection-service.js";
import { EcountSalesExcelExportService } from "../integrations/ecount-browser-sales-export.js";
import type {
  ConnectorExecuteCapabilityResult,
  ConnectorPublishDraftInput,
  ConnectorPublishDraftResult,
  ConnectorProvider,
  ConnectorServiceLike,
} from "../connectors/connector-types.js";
import { listAgentConnectorIntegrations } from "../connectors/agent-connector-integrations.js";
import { getConnectorAdapter, listSupportedProviders } from "../connectors/adapters.js";

export interface RockyChatServiceOptions {
  stateRoot?: string;
  now?: () => string;
  idGenerator?: () => string;
  publicWorkspaceBaseUrl?: string | null;
  agentService?: RockyAgentServiceLike;
  sessionService?: RockySessionServiceLike;
  skillTemplateStore?: SkillTemplateStore;
  ecountSettingsService?: EcountSettingsServiceLike;
  ecountLookupService?: EcountLookupServiceLike;
  ecountSalesExportService?: EcountSalesExcelExportService;
  connectorService?: ConnectorServiceLike;
  instagramTemporaryMediaHost?: TemporaryMediaHostLike;
}

type RockyAttachmentDraft = RockyAttachmentRecord & {
  contentBase64: string | null;
};

type RockyMessageRouteResult = {
  worker: RockyWorkerRecord | null;
  attachments: RockyAttachmentRecord[];
  skillCandidates: RockySkillCandidateRecord[];
  dispatch: RockyDispatchRecord | null;
  rockyMessage: RockyMessageRecord;
};

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function notFound(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 404,
  });
}

function conflict(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 409,
  });
}

function gatewayTimeout(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 504,
  });
}

function badGateway(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 502,
  });
}

function titleFromMessage(message: string): string {
  const compact = message.replace(/\s+/gu, " ").trim();
  if (!compact) {
    return "Rocky와 새 대화";
  }

  return compact.length > 32 ? `${compact.slice(0, 32)}...` : compact;
}

function agentChatSkillId(agentId: string): string {
  return `agent.${agentId}`;
}

function agentChatWorkerId(agentId: string): string {
  return `agent-${agentId}-worker`;
}

function isAgentChatWorker(worker: RockyWorkerRecord | null): boolean {
  return worker?.skillId.startsWith("agent.") ?? false;
}

function buildAgentOrchestrationSkill(agent: AgentRecord): RockyOrchestrationSkill {
  return {
    id: agentChatSkillId(agent.id),
    version: "agent-local",
    mode: "agent",
    domain: "general",
    displayName: agent.name,
    description: agent.description || `${agent.name} 에이전트 세션에서 요청을 처리합니다.`,
    worker: {
      id: agentChatWorkerId(agent.id),
      displayName: agent.name,
    },
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
    },
    capabilities: [
      "에이전트의 설정, 작업 폴더, 런타임 홈, agent-local skills를 사용해 요청을 처리합니다.",
    ],
    operatingRules: [
      "현재 에이전트 세션에서 사용할 수 있는 local skill이 요청에 맞으면 적용합니다.",
      "모호한 요청은 필요한 확인 질문을 먼저 합니다.",
    ],
    handoffContract: [
      "사용자에게 바로 전달할 수 있는 최종 답변을 작성합니다.",
      "실행하지 못한 부분이 있으면 이유와 필요한 입력을 명확히 적습니다.",
    ],
    candidateRules: [],
    protectionRules: [],
  };
}

function skillInvocationMessage(message: string, skillId: string | null | undefined): string {
  const normalizedSkillId = skillId?.trim();
  if (!normalizedSkillId) {
    return message;
  }

  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return `$${normalizedSkillId}`;
  }

  return `$${normalizedSkillId}\n\n${trimmedMessage}`;
}

function withAgentSoul(message: string, soul: string | null | undefined): string {
  const trimmedSoul = soul?.trim();
  if (!trimmedSoul) {
    return message;
  }
  return `# 직원 페르소나 (SOUL.md)\n${trimmedSoul}\n\n---\n\n${message}`;
}

function mentionsEcountIntegration(content: string): boolean {
  return /ecount|이카운트/iu.test(content);
}

const ECOUNT_DATASET_KEYWORDS: Array<{
  dataset: EcountDatasetId;
  keywords: RegExp[];
}> = [
  {
    dataset: "warehouseInventory",
    keywords: [/창고\s*별\s*재고/u, /warehouse\s*inventory/iu, /location\s*inventory/iu],
  },
  {
    dataset: "accounting",
    keywords: [/매출\s*[·/]\s*매입/u, /매출매입/u, /회계/u, /accounting/iu, /invoice/iu],
  },
  {
    dataset: "products",
    keywords: [/품목/u, /상품/u, /\bproducts?\b/iu, /\bitems?\b/iu],
  },
  {
    dataset: "inventory",
    keywords: [/재고\s*현황/u, /\binventory\b/iu, /inventory\s*balance/iu],
  },
  {
    dataset: "customers",
    keywords: [/거래처/u, /\bcustomers?\b/iu, /\bvendors?\b/iu],
  },
  {
    dataset: "sales",
    keywords: [/판매/u, /매출\s*분석/u, /\bsales?\b/iu],
  },
  {
    dataset: "orders",
    keywords: [/주문서/u, /주문/u, /\borders?\b/iu, /sales\s*order/iu],
  },
  {
    dataset: "purchases",
    keywords: [/구매/u, /발주서/u, /\bpurchases?\b/iu, /purchase\s*order/iu],
  },
];

const DEFAULT_ECOUNT_SKILL_DATASETS: EcountDatasetId[] = [
  "products",
  "inventory",
  "customers",
  "sales",
  "warehouseInventory",
  "orders",
  "purchases",
  "accounting",
];

const ECOUNT_DATASET_LABELS: Record<EcountDatasetId, string> = {
  product: "품목(단건)",
  products: "품목",
  inventoryBalance: "재고현황(단건)",
  inventory: "재고현황",
  warehouseInventoryBalance: "창고별 재고현황(단건)",
  warehouseInventory: "창고별 재고",
  customers: "거래처",
  sales: "판매",
  orders: "주문서",
  purchases: "구매",
  accounting: "매출·매입",
};

function ecountDatasetTitle(dataset: EcountDatasetId | string): string {
  return `ECOUNT ERP ${
    ECOUNT_DATASET_LABELS[dataset as EcountDatasetId] ?? dataset
  } 조회`;
}

function uniqueEcountDatasets(datasets: Array<EcountDatasetId | string>): EcountDatasetId[] {
  const seen = new Set<EcountDatasetId>();
  for (const dataset of datasets) {
    const normalized = normalizeEcountDatasetId(String(dataset));
    if (!DEFAULT_ECOUNT_SKILL_DATASETS.includes(normalized as EcountDatasetId)) {
      continue;
    }
    const typed = normalized as EcountDatasetId;
    if (seen.has(typed)) {
      continue;
    }
    seen.add(typed);
  }
  return DEFAULT_ECOUNT_SKILL_DATASETS.filter((dataset) => seen.has(dataset));
}

function extractEcountDatasets(content: string): EcountDatasetId[] {
  const datasets: EcountDatasetId[] = [];
  for (const entry of ECOUNT_DATASET_KEYWORDS) {
    if (entry.keywords.some((keyword) => keyword.test(content))) {
      datasets.push(entry.dataset);
    }
  }
  return uniqueEcountDatasets(datasets);
}

function shouldPrepareEcountLookup(input: {
  message: string;
  hasSelectedEcountSkill: boolean;
  messageDatasets: EcountDatasetId[];
}): boolean {
  const normalized = input.message.replace(/\s+/gu, " ").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const explicitIntegrationIntent = /ecount|이카운트|erp/u.test(normalized);
  const lookupIntent = /조회|검색|목록|전체|확인|가져|보여|새로고침|refresh|list|all|lookup|search/u.test(
    normalized
  );
  const actionIntent = /진행|실행|시작|분석|보고서|pdf|해줘|해주세요|yes|예/u.test(
    normalized
  );
  if (input.messageDatasets.length > 0 && (lookupIntent || actionIntent)) {
    return true;
  }
  if (input.hasSelectedEcountSkill && (lookupIntent || actionIntent || explicitIntegrationIntent)) {
    return true;
  }
  return explicitIntegrationIntent && lookupIntent;
}

function ecountDatasetLookupWorkspacePath(chatId: string, dataset: string): string {
  return path.posix.join(
    rockyTaskInputDirectory(chatId),
    "integrations",
    "ecount",
    `${dataset}.json`
  );
}

function ecountSalesExportDirectoryWorkspacePath(chatId: string): string {
  return path.posix.join(
    rockyTaskInputDirectory(chatId),
    "integrations",
    "ecount",
    "sales-export"
  );
}

function ecountSalesExportWorkspacePath(chatId: string, fileName: string): string {
  return path.posix.join(ecountSalesExportDirectoryWorkspacePath(chatId), fileName);
}

function threadsFollowerLookupWorkspacePath(chatId: string): string {
  return path.posix.join(
    rockyTaskInputDirectory(chatId),
    "integrations",
    "threads",
    "followers.json"
  );
}

function instagramAutomationReadinessWorkspacePath(chatId: string): string {
  return path.posix.join(
    rockyTaskInputDirectory(chatId),
    "integrations",
    "instagram",
    "automation-readiness.json"
  );
}

function instagramAccountReadinessWorkspacePath(chatId: string): string {
  return path.posix.join(
    rockyTaskInputDirectory(chatId),
    "integrations",
    "instagram",
    "account-readiness.json"
  );
}

function instagramFollowingUnsupportedWorkspacePath(chatId: string): string {
  return path.posix.join(
    rockyTaskInputDirectory(chatId),
    "integrations",
    "instagram",
    "following.json"
  );
}

function legacyEcountProductLookupWorkspacePath(chatId: string): string {
  return path.posix.join(
    rockyTaskInputDirectory(chatId),
    "integrations",
    "ecount-products.json"
  );
}

function ecountQueryOptionsForDataset(dataset: EcountDatasetId): Omit<EcountDatasetQueryInput, "dataset"> {
  return dataset === "products" ? {} : { filters: { period: "recent-30-days" } };
}

function defaultEcountSalesExportDates(checkedAt: string): { fromDate: string; toDate: string } {
  const toDate = new Date(checkedAt);
  if (Number.isNaN(toDate.getTime())) {
    const today = new Date();
    return defaultEcountSalesExportDates(today.toISOString());
  }
  const fromDate = new Date(toDate);
  fromDate.setUTCDate(fromDate.getUTCDate() - 30);
  return {
    fromDate: toDateString(fromDate),
    toDate: toDateString(toDate),
  };
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function ecountResultToPreparedSummary(
  result: EcountDatasetQueryResult,
  workspacePath: string | null,
  source: AgentPreparedIntegrationSummary["source"]
): AgentPreparedIntegrationSummary {
  return {
    provider: "ecount",
    dataset: String(result.dataset),
    title: result.title,
    status: result.status,
    api: result.api,
    count: result.count,
    returnedCount: result.returnedCount,
    checkedAt: result.checkedAt,
    workspacePath,
    message: result.message,
    diagnostic: result.diagnostics?.detail ?? null,
    source,
  };
}

function ecountProductLookupToDatasetResult(
  result: Awaited<ReturnType<EcountLookupServiceLike["getBasicProductsList"]>>
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

function unsupportedEcountDatasetResult(dataset: EcountDatasetId): EcountDatasetQueryResult {
  return {
    ok: false,
    provider: "ecount",
    dataset,
    title: `ECOUNT ERP ${dataset} 조회`,
    status: "unsupported",
    accountLabel: null,
    zone: null,
    checkedAt: new Date().toISOString(),
    api: null,
    count: 0,
    returnedCount: 0,
    records: [],
    message: `ECOUNT ${dataset} lookup is not supported by the current read-only backend.`,
    diagnostics: {
      stage: "capability",
      detail: "The current ECOUNT lookup service does not implement this dataset.",
    },
  };
}

function latestUsedSkillId(chat: RockyChatRecord): string | null {
  for (const message of [...chat.messages].reverse()) {
    const skillId = message.usedSkills[0]?.id;
    if (skillId) {
      return skillId;
    }
  }
  return null;
}

function shouldUseSkillScopeForEcountLookup(message: string): boolean {
  const normalized = message.replace(/\s+/gu, " ").trim().toLowerCase();
  return /진행|실행|시작|분석|보고서|pdf|새로고침|refresh|erp|이카운트|ecount/u.test(
    normalized
  );
}

function shouldPrepareEcountProductLookup(message: string): boolean {
  const normalized = message.replace(/\s+/gu, " ").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const productIntent = /품목|상품|product|item/u.test(normalized);
  const lookupIntent = /조회|검색|목록|전체|확인|가져|보여|list|all|lookup|search/u.test(
    normalized
  );
  return productIntent && lookupIntent;
}

function ecountProductLookupWorkspacePath(chatId: string): string {
  return legacyEcountProductLookupWorkspacePath(chatId);
}

const DEFAULT_ATTACHMENT_MESSAGE = "Please review the attached file.";
const DEFAULT_ROCKY_CHAT_MESSAGE_PAGE_LIMIT = 50;
const MAX_ROCKY_CHAT_MESSAGE_PAGE_LIMIT = 100;
const SKILL_DELETE_FOLLOWUP_MARKER = "삭제할 agent-local 스킬을 지정해 주세요.";
const TEMPLATE_INTERVIEW_AGENT_WAIT_TIMEOUT_MS = 60_000;
const TEMPLATE_INTERVIEW_AGENT_POLL_INTERVAL_MS = 750;
const TISTORY_DRAFT_PUBLISH_MARKER = "<!-- rocky-tistory-draft-publish:";
const INSTAGRAM_MEDIA_PUBLISH_MARKER = "<!-- rocky-instagram-media-publish:";
const INSTAGRAM_PUBLISH_REQUEST_FILE = "instagram-publish-request.json";
const INSTAGRAM_PUBLISH_REQUEST_CLAIM_FILE = `${INSTAGRAM_PUBLISH_REQUEST_FILE}.lock`;
const INSTAGRAM_PUBLISH_DRAFT_JSON_PATTERN = /instagram[-_].*(?:publish|draft|post).*[.]json$/iu;
const INSTAGRAM_MEDIA_CONTAINER_MAX_POLLS = 30;
const INSTAGRAM_MEDIA_CONTAINER_POLL_INTERVAL_MS = 2_000;

function requestMessageOrAttachmentDefault(input: {
  message: string;
  attachments: RockyAttachmentRecord[];
}): string {
  const message = input.message.trim();
  if (message) {
    return message;
  }
  if (input.attachments.length > 0) {
    return DEFAULT_ATTACHMENT_MESSAGE;
  }

  throw badRequest("message or attachments are required.");
}

function normalizeMessagePageLimit(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return DEFAULT_ROCKY_CHAT_MESSAGE_PAGE_LIMIT;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw badRequest("message limit must be a positive integer.");
  }

  return Math.min(value, MAX_ROCKY_CHAT_MESSAGE_PAGE_LIMIT);
}

function pageRockyMessages(
  messages: RockyMessageRecord[],
  input: RockyChatMessagePageInput = {}
): RockyChatMessagePageRecord {
  const limit = normalizeMessagePageLimit(input.limit);
  const before = input.before?.trim() || null;
  const endIndex = before
    ? messages.findIndex((message) => message.id === before)
    : messages.length;

  if (endIndex < 0) {
    throw badRequest(`Unknown Rocky message cursor: ${before}`);
  }

  const startIndex = Math.max(0, endIndex - limit);
  const pageMessages = messages.slice(startIndex, endIndex);
  const hasPrevious = startIndex > 0;

  return {
    messages: pageMessages,
    limit,
    totalCount: messages.length,
    hasPrevious,
    nextBefore: hasPrevious ? pageMessages[0]?.id ?? null : null,
  };
}

function isActiveOrchestrationStatus(
  status: RockyOrchestrationRecord["status"]
): boolean {
  return status === "planned" || status === "running";
}

function timestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function latestTimestamp(values: Array<string | null | undefined>): string | null {
  let latest: { value: string; ms: number } | null = null;
  for (const value of values) {
    const ms = timestampMs(value);
    if (ms === null || !value) {
      continue;
    }
    if (!latest || ms > latest.ms) {
      latest = { value, ms };
    }
  }

  return latest?.value ?? null;
}

function orchestrationActivityUpdatedAt(
  orchestration: RockyOrchestrationRecord | null,
  fallback: string | null | undefined = null
): string | null {
  if (!orchestration) {
    return fallback ?? null;
  }

  if (isActiveOrchestrationStatus(orchestration.status)) {
    return latestTimestamp([
      orchestration.updatedAt,
      orchestration.startedAt,
      fallback,
    ]);
  }

  return latestTimestamp([
    orchestration.endedAt,
    orchestration.startedAt,
    fallback,
  ]);
}

function rockyChatActivityUpdatedAt(chat: RockyChatRecord): string {
  const dispatchTimes = chat.dispatches.flatMap((dispatch) => [
    dispatch.createdAt,
    orchestrationActivityUpdatedAt(dispatch.orchestration, dispatch.createdAt),
  ]);
  const latest = latestTimestamp([
    chat.createdAt,
    ...chat.messages.map((message) => message.createdAt),
    ...dispatchTimes,
    orchestrationActivityUpdatedAt(chat.orchestration),
  ]);

  return latest ?? chat.updatedAt;
}

function sanitizeUploadedFilename(filename: string): string {
  const basename = path.basename(filename.trim()).normalize("NFKC");
  const sanitized = basename
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return sanitized || "upload.bin";
}

function stripAttachmentContent(
  attachment: RockyAttachmentDraft
): RockyAttachmentRecord {
  const { contentBase64: _contentBase64, ...record } = attachment;
  return record;
}

function isUnknownSessionError(error: unknown): boolean {
  return error instanceof Error && /^Unknown session: /u.test(error.message);
}

function isRuntimeKind(value: unknown): value is RuntimeKind {
  return value === "codex-cli" || value === "claude-code" || value === "ollama";
}

function compactText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function requiresPdfOutputLabel(value: string): boolean {
  return value.toLowerCase().includes("pdf");
}

function hasSkillDeleteSignal(message: string): boolean {
  const compact = compactText(message).toLowerCase();
  return /스킬|skill/u.test(compact) && /삭제|지워|제거|delete|remove/u.test(compact);
}

function hasDeleteSignal(message: string): boolean {
  return /삭제|지워|제거|delete|remove/u.test(compactText(message).toLowerCase());
}

function shouldPrepareThreadsFollowerLookup(message: string): boolean {
  const compact = compactText(message).toLowerCase();
  return /팔로워|followers?|follower\s+names?/iu.test(compact);
}

function shouldPrepareFacebookProfileLookup(message: string): boolean {
  const compact = compactText(message).toLowerCase();
  const facebookSignal = /facebook|페이스북/iu.test(compact);
  const profileIntent =
    /profile|account|status|connected|login|check|read|프로필|계정|상태|연동|로그인|확인|조회/iu.test(
      compact,
  );
  return facebookSignal && profileIntent;
}

function shouldPrepareInstagramAutomation(message: string): boolean {
  const compact = compactText(message).toLowerCase();
  return /instagram|insta|reels?|\uC778\uC2A4\uD0C0|\uB9B4\uC2A4/iu.test(compact);
}

function shouldPrepareSelectedConnectorFollowup(message: string): boolean {
  const compact = compactText(message).toLowerCase();
  return /다시\s*시도|재시도|계속|진행|준비|게시|발행|업로드|포스팅|승인|retry|again|continue|prepare|post|publish|upload|approve/iu.test(
    compact,
  );
}

function shouldPrepareInstagramFollowingUnsupported(message: string): boolean {
  const compact = compactText(message).toLowerCase();
  return /팔로잉|following\s+(?:list|accounts?|names?)|followings|내가\s*팔로우/u.test(
    compact,
  );
}

function shouldPrepareInstagramAccountRead(message: string): boolean {
  const compact = compactText(message).toLowerCase();
  return /profile|account|status|connected|login|check|read|조회|확인|계정|상태|연동|로그인|프로필|팔로잉|following|follows?/iu.test(
    compact,
  );
}

function hasSelectedInstagramSkill(
  summary: AgentConnectorSummary,
  selectedSkillId: string | null,
): boolean {
  if (!selectedSkillId) {
    return false;
  }
  if (
    summary.requiredBySkills?.some((skill) => skill.id === selectedSkillId)
  ) {
    return true;
  }
  return summary.capabilities.some(
    (capability) => capability.sourceSkillId === selectedSkillId,
  );
}

function shouldPrepareInstagramConnectorLookup(input: {
  message: string;
  selectedSkillId: string | null;
  summary: AgentConnectorSummary;
}): boolean {
  if (shouldPrepareInstagramAutomation(input.message)) {
    return true;
  }
  if (!hasSelectedInstagramSkill(input.summary, input.selectedSkillId)) {
    return false;
  }
  return (
    shouldPrepareInstagramAccountRead(input.message) ||
    shouldPrepareInstagramFollowingUnsupported(input.message) ||
    shouldPrepareSelectedConnectorFollowup(input.message)
  );
}

function hasAvailableConnectorCapability(
  summary: AgentConnectorSummary,
  capabilityId: string
): boolean {
  return summary.capabilities.some(
    (capability) =>
      capability.id === capabilityId &&
      (capability.status === undefined || capability.status === "available") &&
      capability.action === "read" &&
      !capability.requiresApproval
  );
}

function formatSkillList(skillIds: string[]): string {
  if (skillIds.length === 0) {
    return "- 없음";
  }

  return skillIds.map((skillId) => `- \`${skillId}\``).join("\n");
}

function usedSkillMarkerPattern(): RegExp {
  return /<!--\s*rocky-used-skills:\s*(\[[\s\S]*?\])\s*-->/giu;
}

interface TistoryPublishReadyDraft {
  workspacePath: string;
  input: ConnectorPublishDraftInput;
}

interface InstagramPublishReadyRequest {
  workspacePath: string;
  absolutePath: string;
  claimPath: string;
  payload: Record<string, unknown>;
  args: Record<string, unknown>;
}

interface InstagramPublishExecutionResult {
  status: "published" | "publish_failed" | "verification_required" | "already_published";
  requestPath: string;
  checkedAt: string;
  message: string;
  creationId: string | null;
  mediaId: string | null;
  permalink: string | null;
  publishedAt: string | null;
}

interface InstagramPublishApprovalState {
  schemaVersion: 1;
  chatId: string;
  agentId: string;
  approvalId: string;
  draftFingerprint: string;
  result: RockyInstagramPublishApprovalRecord;
}

type InstagramPublishChatAction = "approve" | "status";

function shouldAttemptTistoryDraftPublish(input: {
  request: string;
  output: string | null;
}): boolean {
  if (!input.output || input.output.includes(TISTORY_DRAFT_PUBLISH_MARKER)) {
    return false;
  }
  const request = compactText(input.request).toLowerCase();
  const tistorySignal = /티스토리|tistory/iu.test(request);
  const publishIntent = /발행|업로드|올려|게시|임시저장|다시\s*발행|publish|upload|draft/iu.test(
    request
  );
  const negativeIntent =
    /하지\s*마|하지\s*말|금지|취소|하지\s*않|do not|don't|dont|no\s+(?:publish|upload|post|draft)/iu.test(
      request
    );
  return tistorySignal && publishIntent && !negativeIntent;
}

function shouldAttemptInstagramMediaPublish(input: {
  request: string;
  output: string | null;
}): boolean {
  if (!input.output || input.output.includes(INSTAGRAM_MEDIA_PUBLISH_MARKER)) {
    return false;
  }

  const request = compactText(input.request).toLowerCase();
  const statusCheckIntent =
    /(?:\uAC8C\uC2DC|\uBC1C\uD589|publish|post).*(?:\uB410|\uB418\uC5C8|\uC644\uB8CC|\uD655\uC778|done|status)|(?:\uC9C4\uD589).*(?:\uB410|\uB418\uC5C8|\uC644\uB8CC)/iu.test(
      request
    );
  if (statusCheckIntent) {
    return false;
  }

  const publishIntent =
    /\uAC8C\uC2DC|\uBC1C\uD589|\uC5C5\uB85C\uB4DC|\uC62C\uB824|\uD3EC\uC2A4\uD305|\uC2B9\uC778|\uC7AC\uC2DC\uB3C4|publish|post|upload|approve|retry|again/iu.test(
      request
    );
  const negativeIntent =
    /\uD558\uC9C0\s*\uB9C8|\uD558\uC9C0\s*\uB9D0|\uAE08\uC9C0|\uCDE8\uC18C|do not|don't|dont|no\s+(?:publish|upload|post)/iu.test(
      request
    );
  return publishIntent && !negativeIntent;
}

function classifyInstagramPublishChatAction(message: string): InstagramPublishChatAction | null {
  const request = compactText(message).toLowerCase();
  if (!request) {
    return null;
  }

  const statusCheckIntent =
    /(?:게시|발행|업로드|포스팅|publish|published|post|posted|upload|uploaded).*(?:됐|되었|완료됐|완료되었|끝났|상태|확인|결과|성공|실패|done|status|complete|completed|finished|success|failed|live)/iu.test(
      request
    ) ||
    /(?:did|has|have|is|was|status).*(?:publish|published|post|posted|upload|uploaded|live|done)/iu.test(
      request
    ) ||
    /(?:됐|되었|완료됐|완료되었|끝났|done|status|complete|completed|finished).*(?:게시|발행|업로드|포스팅|publish|post|upload)/iu.test(
      request
    ) ||
    /\b(?:published|posted|uploaded)\??$/iu.test(request);
  if (statusCheckIntent) {
    return "status";
  }

  const negativeIntent =
    /하지\s*마|하지\s*말|금지|취소|보류|중단|do not|don't|dont|no\s+(?:publish|upload|post)|not\s+(?:publish|upload|post)|cancel|stop/iu.test(
      request
    );
  if (negativeIntent) {
    return null;
  }

  const publishIntent =
    /(?:게시|발행|업로드|포스팅)\s*(?:해|해줘|해주세요|하자|진행|시작|승인|부탁)/iu.test(
      request
    ) ||
    /올려\s*(?:줘|주세요|라|줘요)?/iu.test(request) ||
    /승인\s*(?:해|해줘|해주세요|하자|진행|시작|부탁)/iu.test(
      request
    ) ||
    /\b(?:publish|upload|post)\b(?:\s+(?:it|this|now|please))?\b/iu.test(
      request
    ) ||
    /\b(?:go ahead|approve|ship it)\b/iu.test(request);

  return publishIntent ? "approve" : null;
}

function extractMarkdownWorkspacePaths(text: string): string[] {
  const paths = new Set<string>();
  const pattern = /(?:^|[\s(["'`])((?:\.\/)?outputs\/[^\s)"'`<>]+?\.md)/giu;
  for (const match of text.matchAll(pattern)) {
    const raw = match[1]?.trim();
    if (!raw) {
      continue;
    }
    paths.add(raw.replace(/^[.][/\\]/u, "").replace(/[.,;:]+$/u, ""));
  }
  return [...paths];
}

function normalizeWorkspaceRelativePath(value: string): string | null {
  const trimmed = value.trim().replace(/^[.][/\\]/u, "");
  if (!trimmed || path.isAbsolute(trimmed)) {
    return null;
  }
  const normalized = path.posix.normalize(trimmed.replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return null;
  }
  return normalized;
}

function parseTistoryPublishReadyMarkdown(input: {
  workspacePath: string;
  markdown: string;
}): TistoryPublishReadyDraft | null {
  const titleSection = findMarkdownSection(input.markdown, /제목/u);
  const bodySection = findMarkdownSection(input.markdown, /본문|원고|내용/u);
  const tagsSection = findMarkdownSection(input.markdown, /태그|tags?/iu);
  const title =
    firstContentLine(titleSection) ??
    input.markdown.match(/^#\s+(.+)$/mu)?.[1]?.trim() ??
    null;
  const contentMarkdown = stripSectionDecorations(bodySection ?? "").trim();

  if (!title || !contentMarkdown) {
    return null;
  }

  return {
    workspacePath: input.workspacePath,
    input: {
      title,
      contentMarkdown,
      tags: splitTistoryTags(tagsSection ?? ""),
      visibility: "draft",
    },
  };
}

function findMarkdownSection(markdown: string, headingPattern: RegExp): string | null {
  const headings = [...markdown.matchAll(/^#{1,3}\s+(.+?)\s*$/gmu)];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const title = heading[1] ?? "";
    if (!headingPattern.test(title)) {
      continue;
    }
    const start = (heading.index ?? 0) + heading[0].length;
    const next = headings[index + 1];
    const end = next?.index ?? markdown.length;
    return stripSectionDecorations(markdown.slice(start, end));
  }
  return null;
}

function stripSectionDecorations(value: string): string {
  return value
    .split(/\r?\n/u)
    .filter((line) => !/^[-*_]{3,}\s*$/u.test(line.trim()))
    .join("\n")
    .trim();
}

function firstContentLine(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return (
    stripSectionDecorations(value)
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

function splitTistoryTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n]/u)
        .map((tag) => tag.trim().replace(/^#+/u, ""))
        .filter(Boolean)
    ),
  ];
}

function appendTistoryDraftPublishResult(input: {
  output: string;
  draft: TistoryPublishReadyDraft;
  result: ConnectorPublishDraftResult;
}): string {
  const lines = [
    input.output.trimEnd(),
    "",
    "---",
    "",
    "Tistory 발행 결과:",
    `- 상태: ${input.result.ok ? "임시저장 완료" : "임시저장 실패"}`,
    `- 원고: ${input.draft.workspacePath}`,
    input.result.url ? `- URL: ${input.result.url}` : null,
    `- 메시지: ${input.result.message}`,
    `${TISTORY_DRAFT_PUBLISH_MARKER} ${input.result.checkedAt} -->`,
  ].filter((line): line is string => line !== null);

  return lines.join("\n");
}

function readRecordString(
  record: Record<string, unknown> | null | undefined,
  keys: string[]
): string | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readRecordObject(
  record: Record<string, unknown> | null | undefined,
  keys: string[]
): Record<string, unknown> | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

function readInstagramDraftMediaField(
  payload: Record<string, unknown>,
  keys: string[]
): string | null {
  return (
    readRecordString(payload, keys) ??
    readRecordString(readRecordObject(payload, ["media"]), keys)
  );
}

function readInstagramDraftCaptionField(
  payload: Record<string, unknown>,
  keys: string[]
): string | null {
  return (
    readRecordString(payload, keys) ??
    readRecordString(readRecordObject(payload, ["caption"]), keys)
  );
}

function readRecordBoolean(
  record: Record<string, unknown>,
  keys: string[]
): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

function hasFilesystemErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function isInstagramPublishRequestApproved(
  payload: Record<string, unknown>
): boolean {
  return (
    readRecordBoolean(payload, ["final_publish_approval_received"]) === true &&
    readRecordBoolean(payload, ["requires_final_publish_approval"]) === false
  );
}

function isTerminalInstagramPublishRequest(
  payload: Record<string, unknown>
): boolean {
  const status =
    readRecordString(payload, ["status"])
      ?.toLowerCase()
      .replace(/[\s-]+/gu, "_") ?? "";
  return (
    status === "published" ||
    status === "already_published" ||
    status === "verification_required" ||
    status === "publishing" ||
    status === "publish_in_progress" ||
    Boolean(readRecordString(payload, ["media_id", "mediaId"])) ||
    Boolean(readRecordString(payload, ["permalink", "published_url", "publishedUrl"]))
  );
}

function hasInstagramDraftMedia(payload: Record<string, unknown>): boolean {
  return Boolean(readInstagramDraftMediaReference(payload));
}

function isInstagramPublishDraftPayload(input: {
  payload: Record<string, unknown>;
  workspacePath: string;
}): boolean {
  const basename = path.posix.basename(input.workspacePath);
  const pathSignal =
    basename === INSTAGRAM_PUBLISH_REQUEST_FILE ||
    INSTAGRAM_PUBLISH_DRAFT_JSON_PATTERN.test(basename);
  const payloadSignal = [
    readRecordString(input.payload, ["provider", "platform", "channel"]),
    readRecordString(input.payload, ["content_type", "contentType"]),
    readRecordString(input.payload, ["publish_type", "publishType", "post_type", "postType"]),
    readRecordString(input.payload, ["media_type", "mediaType"]),
    readRecordString(input.payload, ["status"]),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  const instagramSignal = /instagram|insta|reels?|feed|피드|릴스|인스타/iu.test(
    payloadSignal
  );

  return (
    (pathSignal || instagramSignal) &&
    (hasInstagramDraftMedia(input.payload) ||
      Boolean(
        readInstagramDraftCaptionField(input.payload, [
          "caption",
          "caption_file",
          "captionFile",
          "text",
          "content",
        ])
      ))
  );
}

function isActiveInstagramPublishDraftPayload(input: {
  payload: Record<string, unknown>;
  workspacePath: string;
}): boolean {
  if (!isInstagramPublishDraftPayload(input)) {
    return false;
  }
  if (isTerminalInstagramPublishRequest(input.payload)) {
    return false;
  }
  const status =
    readRecordString(input.payload, ["status", "state"])
      ?.toLowerCase()
      .replace(/[\s-]+/gu, "_") ?? "";
  return ![
    "failed",
    "failure",
    "cancelled",
    "canceled",
    "expired",
    "deleted",
  ].includes(status);
}

function readInstagramDraftPublishType(
  payload: Record<string, unknown>
): "feed" | "reels" {
  const signal = [
    readRecordString(payload, ["content_type", "contentType"]),
    readRecordString(payload, ["publish_type", "publishType", "post_type", "postType"]),
    readRecordString(payload, ["media_type", "mediaType"]),
    readRecordString(payload, ["type"]),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  return /reels?|릴스/iu.test(signal) ? "reels" : "feed";
}

function readInstagramDraftTargetAccount(
  payload: Record<string, unknown>
): string | null {
  return readRecordString(payload, [
    "accountLabel",
    "account_label",
    "targetAccountLabel",
    "target_account_label",
    "targetAccount",
    "target_account",
    "instagramAccount",
    "instagram_account",
    "instagramUsername",
    "instagram_username",
    "account",
  ]);
}

function canRetryInstagramPublishApproval(
  result: RockyInstagramPublishApprovalRecord
): boolean {
  return result.status === "publish_failed";
}

function readInstagramDraftKnownPublication(
  payload: Record<string, unknown>
): { mediaId: string | null; permalink: string | null; publishedAt: string | null } | null {
  const status =
    readRecordString(payload, ["status"])
      ?.toLowerCase()
      .replace(/[\s-]+/gu, "_") ?? "";
  const mediaId = readRecordString(payload, ["media_id", "mediaId"]);
  const permalink = safeInstagramPermalink(
    readRecordString(payload, ["permalink", "published_url", "publishedUrl"])
  );
  const publishedAt = readRecordString(payload, [
    "published_at",
    "publishedAt",
    "timestamp",
  ]);
  if (!mediaId && !permalink && status !== "published" && status !== "already_published") {
    return null;
  }
  return { mediaId, permalink, publishedAt };
}

function readInstagramDraftMediaReference(
  payload: Record<string, unknown>
):
  | { kind: "image" | "video" | "unknown"; source: "workspace" | "external"; value: string }
  | null {
  const videoFile = readInstagramDraftMediaField(payload, [
    "videoFile",
    "video_file",
  ]);
  if (videoFile) {
    return { kind: "video", source: "workspace", value: videoFile };
  }
  const imageFile = readInstagramDraftMediaField(payload, [
    "imageFile",
    "image_file",
    "mediaFile",
    "media_file",
    "file",
  ]);
  if (imageFile) {
    const extension = path.extname(imageFile).toLowerCase();
    return {
      kind: [".mp4", ".mov", ".m4v", ".webm", ".ogv"].includes(extension)
        ? "video"
        : "image",
      source: "workspace",
      value: imageFile,
    };
  }
  const videoUrl = readInstagramDraftMediaField(payload, [
    "videoUrl",
    "video_url",
    "publicVideoUrl",
    "public_video_url",
  ]);
  if (videoUrl) {
    return { kind: "video", source: "external", value: videoUrl };
  }
  const imageUrl = readInstagramDraftMediaField(payload, [
    "imageUrl",
    "image_url",
    "publicImageUrl",
    "public_image_url",
    "mediaUrl",
    "media_url",
    "publicMediaUrl",
    "public_media_url",
    "url",
  ]);
  if (imageUrl) {
    return { kind: "image", source: "external", value: imageUrl };
  }
  return null;
}

function workspaceFileContentPath(agentId: string, searchPath: string): string {
  const search = new URLSearchParams();
  search.set("path", searchPath);
  return `/agents/${encodeURIComponent(agentId)}/workspace/file/content?${search.toString()}`;
}

function sanitizeInstagramPublishUserText(text: string): string {
  return text
    .replace(
      /(?:[\w.-]+[/\\])*instagram[-_][\w.-]*(?:publish|draft|post)[\w.-]*[.]json/giu,
      "Instagram Publish draft"
    )
    .replace(
      /\binstagram[.]media[.](?:prepare|publish|status[.]read)\b|\binstagram[.](?:automation[.]prepare|account[.]read|insights[.]read)\b/giu,
      "Instagram connector"
    )
    .replace(/https:\/\/(?:graph[.]facebook|graph[.]instagram)[.]com\/[^\s)"'<>`]+/giu, "Instagram API")
    .replace(/https:\/\/tmpfiles[.]org\/[^\s)"'<>`]+/giu, "임시 미디어 링크")
    .replace(
      /([?&](?:access_token|refresh_token|id_token|auth_token|client_secret|session_id)=)[^&\s]+/giu,
      "$1[redacted]"
    )
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu, "인증 정보는 숨겼습니다")
    .replace(/\b(?:access_token|refresh_token|id_token|auth_token|client_secret|sessionid|session_id|cookie)\b\s*[:=]\s*[^\s,;\])}]+/giu, "인증 정보는 숨겼습니다")
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"'<>]*(?:agent-workspaces|runtime-home|browser-profile|connectors|outputs)[^\s"'<>]*/giu, "작업공간 경로")
    .replace(/(?:^|\s)(?:[.][\\/])?outputs[\\/][^\s"'<>]+/giu, " 작업공간 파일")
    .replace(
      /\b(?:creation[_ -]?id|creationId|containerId|media[_ -]?id|mediaId)\b\s*[:=]\s*[^\s,;\])}]+/giu,
      "발행 식별자는 숨겼습니다"
    )
    .replace(/\b(?:creation|media)-[A-Za-z0-9_-]+\b/gu, "발행 식별자");
}

function buildInstagramMediaPrepareArgs(input: {
  payload: Record<string, unknown>;
  caption: string | null;
}): Record<string, unknown> {
  const imageUrl = readInstagramDraftMediaField(input.payload, [
    "imageUrl",
    "image_url",
    "publicImageUrl",
    "public_image_url",
    "mediaUrl",
    "media_url",
    "publicMediaUrl",
    "public_media_url",
    "url",
  ]);
  const videoUrl = readInstagramDraftMediaField(input.payload, [
    "videoUrl",
    "video_url",
    "publicVideoUrl",
    "public_video_url",
  ]);
  const videoFile = readInstagramDraftMediaField(input.payload, [
    "videoFile",
    "video_file",
  ]);
  const imageFile = readInstagramDraftMediaField(input.payload, [
    "imageFile",
    "image_file",
    "mediaFile",
    "media_file",
    "file",
  ]);
  const mediaType = readInstagramDraftMediaField(input.payload, [
    "mediaType",
    "media_type",
    "type",
  ]);
  const args: Record<string, unknown> = {
    approved: true,
  };

  if (imageUrl) {
    args.imageUrl = imageUrl;
  }
  if (videoUrl) {
    args.videoUrl = videoUrl;
  }
  if (!imageUrl && !videoUrl && videoFile) {
    args.videoFile = videoFile;
  } else if (!imageUrl && !videoUrl && imageFile) {
    args.imageFile = imageFile;
  }
  if (mediaType) {
    args.mediaType = mediaType;
  }
  if (input.caption) {
    args.caption = input.caption;
  }

  return args;
}

function normalizePublicWorkspaceBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || isLocalOrPrivateHost(url.hostname)) {
    return null;
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString().replace(/\/$/u, "");
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^10\./u.test(host) ||
    /^192\.168\./u.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[0-1])\./u.test(host)
  );
}

function buildPublicWorkspaceFileUrl(input: {
  publicWorkspaceBaseUrl: string;
  agentId: string;
  workspacePath: string;
}): string {
  const base = input.publicWorkspaceBaseUrl.endsWith("/")
    ? input.publicWorkspaceBaseUrl
    : `${input.publicWorkspaceBaseUrl}/`;
  const url = new URL(
    `agents/${encodeURIComponent(input.agentId)}/workspace/file/content`,
    base
  );
  url.searchParams.set("path", input.workspacePath);
  return url.toString();
}

function readCapabilityDataString(
  result: ConnectorExecuteCapabilityResult,
  keys: string[]
): string | null {
  return readRecordString(result.data ?? null, keys);
}

function readInstagramMediaContainerStatus(
  result: ConnectorExecuteCapabilityResult
): string | null {
  const rawStatus = readCapabilityDataString(result, [
    "status_code",
    "statusCode",
    "status",
  ]);
  if (!rawStatus) {
    return null;
  }

  const normalized = rawStatus.trim().toUpperCase().replace(/[\s-]+/gu, "_");
  if (normalized.includes("FINISH")) {
    return "FINISHED";
  }
  if (normalized.includes("ERROR") || normalized.includes("FAILED")) {
    return "ERROR";
  }
  if (normalized.includes("EXPIRE")) {
    return "EXPIRED";
  }
  if (
    normalized.includes("IN_PROGRESS") ||
    normalized.includes("PROCESS") ||
    normalized.includes("PENDING")
  ) {
    return "IN_PROGRESS";
  }
  return normalized;
}

function instagramPublishFailure(input: {
  requestPath: string;
  checkedAt: string;
  message: string;
  creationId?: string | null;
  mediaId?: string | null;
  verificationRequired?: boolean;
}): InstagramPublishExecutionResult {
  const status = input.verificationRequired
    ? "verification_required"
    : "publish_failed";
  return {
    status,
    requestPath: input.requestPath,
    checkedAt: input.checkedAt,
    message: input.verificationRequired
      ? formatInstagramPublishVerificationRequiredMessage(input.message)
      : formatInstagramPublishRetryableFailureMessage(input.message),
    creationId: input.creationId ?? null,
    mediaId: input.mediaId ?? null,
    permalink: null,
    publishedAt: null,
  };
}

function formatInstagramPublishRetryableFailureMessage(message: string): string {
  const detail = sanitizeInstagramPublishPublicMessage(message);
  return [
    "Instagram 발행을 시작하기 전에 실패했습니다.",
    detail,
    "문제를 수정한 뒤 다시 승인하면 안전하게 재시도할 수 있습니다.",
  ]
    .filter(Boolean)
    .join(" ");
}

function formatInstagramPublishVerificationRequiredMessage(message: string): string {
  const detail = sanitizeInstagramPublishPublicMessage(message);
  return [
    "Instagram 발행 요청 이후 상태 확인이 필요합니다.",
    detail,
    "새 발행으로 재시도하지 말고 Instagram 게시 여부를 먼저 확인해 주세요.",
  ]
    .filter(Boolean)
    .join(" ");
}

function formatUnexpectedInstagramPublishError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Instagram media publish failed unexpectedly.";
  }

  const message = error.message.trim() || error.name;
  const cause = formatErrorCause((error as { cause?: unknown }).cause);
  if (!cause || cause === message) {
    return message;
  }

  return `${message} (${cause})`;
}

function formatErrorCause(cause: unknown): string | null {
  if (!cause) {
    return null;
  }

  if (cause instanceof Error) {
    const code = readErrorCode(cause);
    const message = cause.message.trim() || cause.name;
    return code ? `${code}: ${message}` : message;
  }

  if (typeof cause === "string") {
    return cause.trim() || null;
  }

  if (typeof cause === "object") {
    const record = cause as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code.trim() : "";
    const message =
      typeof record.message === "string" ? record.message.trim() : "";
    if (code && message) {
      return `${code}: ${message}`;
    }
    return code || message || null;
  }

  return null;
}

function readErrorCode(error: Error): string | null {
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

function appendInstagramMediaPublishResult(input: {
  output: string;
  result: InstagramPublishExecutionResult;
}): string {
  const lines = [
    input.output.trimEnd(),
    "",
    "---",
    "",
    "Instagram publish result:",
    `- Status: ${
      input.result.status === "published"
        ? "published"
        : input.result.status === "verification_required"
          ? "verification required"
          : input.result.status === "already_published"
            ? "already published"
            : "failed"
    }`,
    `- Request: ${input.result.requestPath}`,
    input.result.creationId ? `- Creation ID: ${input.result.creationId}` : null,
    input.result.mediaId ? `- Media ID: ${input.result.mediaId}` : null,
    input.result.permalink ? `- Permalink: ${input.result.permalink}` : null,
    input.result.publishedAt
      ? `- Published at: ${input.result.publishedAt}`
      : null,
    `- Message: ${input.result.message}`,
    `${INSTAGRAM_MEDIA_PUBLISH_MARKER} ${input.result.checkedAt} -->`,
  ].filter((line): line is string => line !== null);

  return lines.join("\n");
}

function mergeInstagramPublishResult(
  payload: Record<string, unknown>,
  result: InstagramPublishExecutionResult
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...payload,
    status: result.status,
    checked_at: result.checkedAt,
    publish_message: result.message,
  };

  if (result.creationId) {
    next.creation_id = result.creationId;
  }
  if (result.mediaId) {
    next.media_id = result.mediaId;
  }
  if (result.permalink) {
    next.permalink = result.permalink;
  }
  if (result.publishedAt) {
    next.published_at = result.publishedAt;
  }
  if (result.status === "publish_failed" || result.status === "verification_required") {
    next.publish_error_message = result.message;
  }

  return next;
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function sanitizeInstagramPublishPublicMessage(message: string): string {
  const sanitized = sanitizeInstagramPublishUserText(message)
    .replace(/\bInstagram media container prepared:?\s*[^.\n]+[.]?/giu, "Instagram media container prepared.")
    .replace(/\bInstagram media published:?\s*[^.\n]+[.]?/giu, "Instagram media published.")
    .replace(/\b(?:id|creation_id|creationId|media_id|mediaId)\b\s*[:=]\s*[^\s,;\])}]+/giu, "발행 식별자는 숨겼습니다")
    .trim();

  return sanitized || "Instagram publish status updated.";
}

function instagramPublishTypeLabel(value: "feed" | "reels"): string {
  return value === "reels" ? "릴스" : "피드";
}

function safeInstagramPublishText(
  value: string | null | undefined,
  maxLength = 120
): string | null {
  const sanitized = sanitizeInstagramPublishUserText(value ?? "")
    .replace(/[{}\[\]`]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!sanitized) {
    return null;
  }
  return sanitized.length > maxLength
    ? `${sanitized.slice(0, maxLength).trimEnd()}...`
    : sanitized;
}

function safeInstagramPermalink(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      /(?:^|[.])(?:graph[.]facebook[.]com|graph[.]instagram[.]com|tmpfiles[.]org)$/iu.test(
        url.hostname
      )
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function instagramApprovalCtaForBlockerCode(code: string): string | null {
  if (code === "professional_account_required") {
    return "Instagram 계정을 Business 또는 Creator 프로페셔널 계정으로 전환한 뒤 다시 연결해 주세요.";
  }
  if (code === "access_token_missing" || code === "token_expired") {
    return "Instagram을 다시 연결해 Graph API 토큰을 갱신해 주세요.";
  }
  if (code === "permission_missing" || code === "app_review_required") {
    return "Instagram 발행에 필요한 Graph API 권한을 승인한 뒤 다시 연결해 주세요.";
  }
  if (code === "app_access_required") {
    return "Meta 앱 테스트 사용자 또는 앱 역할 승인을 완료한 뒤 Instagram을 다시 연결해 주세요.";
  }
  if (code === "instagram_business_account_id_missing") {
    return "Instagram Business Account ID를 확인하거나 Graph API 연결을 다시 진행해 주세요.";
  }
  return null;
}

function instagramApprovalCtaFromBlockers(
  blockers: Array<{ code?: unknown; nextAction?: unknown }> | undefined
): string | null {
  for (const blocker of blockers ?? []) {
    if (typeof blocker.code === "string") {
      const mapped = instagramApprovalCtaForBlockerCode(blocker.code);
      if (mapped) {
        return mapped;
      }
    }
  }
  for (const blocker of blockers ?? []) {
    if (typeof blocker.nextAction === "string" && blocker.nextAction.trim()) {
      return sanitizeInstagramPublishPublicMessage(blocker.nextAction);
    }
  }
  return null;
}

function formatInstagramPublishApprovalChatMessage(
  result: RockyInstagramPublishApprovalRecord
): string {
  const publishType = instagramPublishTypeLabel(result.publishType);
  const target = safeInstagramPublishText(result.targetAccountLabel, 80);
  const targetText = target ? ` 대상: ${target}.` : "";
  const publicMessage = safeInstagramPublishText(result.message, 180);
  const permalink = safeInstagramPermalink(result.permalink);

  if (result.status === "published") {
    return [
      `Instagram ${publishType} 발행이 완료되었습니다.`,
      targetText.trim(),
      permalink ? `결과 링크: ${permalink}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join(" ");
  }

  if (result.status === "already_published") {
    return [
      `Instagram ${publishType} 초안은 이미 발행된 것으로 확인되어 새 발행을 만들지 않습니다.`,
      targetText.trim(),
      permalink ? `결과 링크: ${permalink}` : null,
      publicMessage ?? "Instagram에서 게시 상태를 확인해 주세요.",
    ]
      .filter((line): line is string => Boolean(line))
      .join(" ");
  }

  if (result.status === "publishing") {
    return [
      `Instagram ${publishType} 발행 승인을 기록했고 지금 진행 중입니다.`,
      targetText.trim(),
    ]
      .filter((line): line is string => Boolean(line))
      .join(" ");
  }

  if (result.status === "blocked") {
    return [
      `Instagram ${publishType} 발행을 시작하지 못했습니다.`,
      targetText.trim(),
      publicMessage,
    ]
      .filter((line): line is string => Boolean(line))
      .join(" ");
  }

  if (result.status === "verification_required") {
    return [
      `Instagram ${publishType} 발행 상태 확인이 필요합니다.`,
      targetText.trim(),
      publicMessage,
    ]
      .filter((line): line is string => Boolean(line))
      .join(" ");
  }

  return [
    `Instagram ${publishType} 발행을 완료하지 못했습니다.`,
    targetText.trim(),
    publicMessage,
  ]
    .filter((line): line is string => Boolean(line))
    .join(" ");
}

function formatInstagramPublishStatusChatMessage(input: {
  approval: RockyInstagramPublishApprovalRecord | null;
  preview: RockyInstagramPublishDraftPreviewRecord | null;
}): string {
  if (input.approval) {
    return `현재 ${formatInstagramPublishApprovalChatMessage(input.approval)}`;
  }

  const preview = input.preview;
  if (!preview) {
    return "현재 확인할 Instagram Publish 초안이나 발행 결과가 없습니다.";
  }

  const publishType = instagramPublishTypeLabel(preview.publishType);
  const target = safeInstagramPublishText(preview.targetAccountLabel, 80);
  const caption = safeInstagramPublishText(preview.caption, 140);
  const blocker = safeInstagramPublishText(preview.blocker, 180);
  const statusText =
    preview.status === "blocked"
      ? `현재 Instagram ${publishType} 초안은 발행 준비가 막혀 있습니다.`
      : `현재 Instagram ${publishType} 초안은 발행 승인 대기 중입니다.`;

  return [
    statusText,
    target ? `대상: ${target}.` : null,
    caption ? `캡션: ${caption}` : null,
    blocker ? `차단 사유: ${blocker}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join(" ");
}

function isTemporaryMediaUrl(value: unknown): boolean {
  return typeof value === "string" && /https:\/\/tmpfiles[.]org\//iu.test(value);
}

function mergeInstagramApprovalPublishResult(
  payload: Record<string, unknown>,
  result: RockyInstagramPublishApprovalRecord
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...payload,
    status: result.status,
    checked_at: result.updatedAt,
    rocky_publish_approval_recorded: true,
    publish_message: result.message,
  };

  const hiddenKeys = [
    "creation_id",
    "creationId",
    "container_id",
    "containerId",
    "media_id",
    "mediaId",
    "capability_id",
    "capabilityId",
    "graph_endpoint",
    "graphEndpoint",
    "raw_request",
    "rawRequest",
    "raw_response",
    "rawResponse",
    "temporary_media_url",
    "temporaryMediaUrl",
  ];
  for (const key of hiddenKeys) {
    delete next[key];
  }

  const temporaryUrlKeys = [
    "imageUrl",
    "image_url",
    "videoUrl",
    "video_url",
    "publicImageUrl",
    "public_image_url",
    "publicVideoUrl",
    "public_video_url",
    "mediaUrl",
    "media_url",
    "publicMediaUrl",
    "public_media_url",
    "url",
  ];
  for (const key of temporaryUrlKeys) {
    if (isTemporaryMediaUrl(next[key])) {
      delete next[key];
    }
  }

  if (result.permalink) {
    next.permalink = result.permalink;
  }
  if (result.publishedAt) {
    next.published_at = result.publishedAt;
  }
  if (
    result.status === "publish_failed" ||
    result.status === "verification_required" ||
    result.status === "blocked"
  ) {
    next.publish_error_message = result.message;
  }

  return next;
}

function extractUsedSkillRefs(text: string): {
  text: string;
  refs: string[];
} {
  const refs: string[] = [];
  for (const match of text.matchAll(usedSkillMarkerPattern())) {
    const rawJson = match[1]?.trim();
    if (!rawJson) {
      continue;
    }
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) {
        refs.push(
          ...parsed.filter((entry): entry is string => typeof entry === "string")
        );
      }
    } catch {
      // Ignore malformed model-authored metadata and only strip the marker.
    }
  }

  return {
    text: text.replace(usedSkillMarkerPattern(), "").trim(),
    refs,
  };
}

function normalizeSkillRef(value: string): string {
  return value.trim().replace(/^\$/u, "").toLowerCase();
}

function mergeUsedSkills(
  ...groups: Array<RockyUsedSkillRecord[] | null | undefined>
): RockyUsedSkillRecord[] {
  const merged = new Map<string, RockyUsedSkillRecord>();
  for (const group of groups) {
    for (const skill of group ?? []) {
      merged.set(skill.id, skill);
    }
  }
  return [...merged.values()];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeReasoningEffort(
  value: unknown
): RuntimeReasoningEffort | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  return value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
    ? value
    : null;
}

function normalizeServiceTier(
  value: unknown
): RuntimeServiceTier | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "" || value === "default" || value === "flex") {
    return null;
  }
  return value === "fast" ? value : null;
}

function normalizeOllamaLaunchTarget(
  value: unknown
): RuntimeOllamaLaunchTarget | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  return value === "codex" || value === "claude" ? value : null;
}

function defaultCoreSettings(): RockyCoreSettingsRecord {
  return {
    defaultRuntimeKind: "codex-cli",
    defaultModel: null,
    defaultReasoningEffort: null,
    defaultServiceTier: null,
    defaultOllamaLaunchTarget: null,
    updatedAt: null,
  };
}

export class RockyChatService {
  private readonly stateRoot: string | undefined;
  private readonly now: () => string;
  private readonly idGenerator: () => string;
  private readonly agentService: RockyAgentServiceLike | undefined;
  private readonly sessionService: RockySessionServiceLike | undefined;
  private readonly orchestrator: RockyOrchestratorService;
  private readonly agentLocalSkillService = new AgentLocalSkillService();
  private readonly skillTemplateStore: SkillTemplateStore;
  private readonly ecountSettingsService: EcountSettingsServiceLike;
  private readonly ecountLookupService: EcountLookupServiceLike;
  private readonly ecountSalesExportService: EcountSalesExcelExportService;
  private readonly connectorService: ConnectorServiceLike | null;
  private readonly publicWorkspaceBaseUrl: string | null;
  private readonly instagramTemporaryMediaHost: TemporaryMediaHostLike;
  private readonly instagramPublishRequestClaims = new Set<string>();
  private readonly instagramPublishApprovalsInFlight = new Map<
    string,
    RockyInstagramPublishApprovalRecord
  >();

  constructor(options: RockyChatServiceOptions = {}) {
    this.stateRoot = options.stateRoot;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.publicWorkspaceBaseUrl = normalizePublicWorkspaceBaseUrl(
      options.publicWorkspaceBaseUrl ??
        process.env.ROCKY_CONNECTOR_PUBLIC_WORKSPACE_BASE_URL ??
        process.env.ROCKY_PUBLIC_WORKSPACE_BASE_URL ??
        null
    );
    this.agentService = options.agentService;
    this.sessionService = options.sessionService;
    this.skillTemplateStore =
      options.skillTemplateStore ??
      new SkillTemplateStore({
        stateRoot: options.stateRoot,
        now: this.now,
        idGenerator: this.idGenerator,
      });
    this.ecountSettingsService =
      options.ecountSettingsService ??
      new EcountSettingsService({
        stateRoot: options.stateRoot,
        now: this.now,
      });
    this.ecountLookupService =
      options.ecountLookupService ??
      new EcountConnectionService({
        now: this.now,
      });
    this.ecountSalesExportService =
      options.ecountSalesExportService ??
      new EcountSalesExcelExportService({
        now: this.now,
      });
    this.connectorService = options.connectorService ?? null;
    this.instagramTemporaryMediaHost =
      options.instagramTemporaryMediaHost ??
      new TmpfilesTemporaryMediaHost({ now: this.now });
    this.orchestrator = new RockyOrchestratorService({
      sessionService: options.sessionService,
      now: this.now,
      idGenerator: this.idGenerator,
    });
  }

  private async waitForTemplateInterviewAgent(
    started: RockyOrchestrationRecord
  ): Promise<RockyOrchestrationRecord> {
    let current = await this.orchestrator.refresh(started);
    const deadline = Date.now() + TEMPLATE_INTERVIEW_AGENT_WAIT_TIMEOUT_MS;

    while (isActiveOrchestrationStatus(current.status) && Date.now() < deadline) {
      await sleep(TEMPLATE_INTERVIEW_AGENT_POLL_INTERVAL_MS);
      current = await this.orchestrator.refresh(current);
    }

    return current;
  }

  async listAbilityCards() {
    const agent = await this.findCoreAgent();
    const installedSkillIds = await this.listInstalledSkillIds(agent);
    return listRockySkillAbilityCards({ installedSkillIds });
  }

  async startAbilityGuide(abilityId: string): Promise<RockyChatRecord> {
    const skill = getRockySkillByAbilityId(abilityId);
    if (!skill?.ability) {
      throw notFound(`Unknown Rocky ability: ${abilityId}`);
    }

    const timestamp = this.now();
    const chatId = `rocky-chat-${this.idGenerator()}`;
    const { worker } = await this.ensureCoreWorker({
      skill,
      reason: `${skill.displayName} 홈 안내를 열었습니다.`,
      timestamp,
    });
    const rockyMessage: RockyMessageRecord = {
      id: `message-${this.idGenerator()}`,
      chatId,
      role: "rocky",
      intent: "conversation",
      text: skill.ability.guideMarkdown,
      attachmentIds: [],
      domain: skill.domain,
      workerId: worker.id,
      skillCandidateIds: [],
      usedSkills: [],
      dispatchId: null,
      createdAt: timestamp,
    };
    const chat: RockyChatRecord = {
      id: chatId,
      title: skill.ability.title,
      intent: "conversation",
      domain: skill.domain,
      worker,
      attachments: [],
      messages: [rockyMessage],
      skillCandidates: [],
      dispatches: [],
      orchestration: null,
      executionStarted: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.writeChat(chat);
    return chat;
  }

  async processTemplateInterviewTurn(
    input: RockyTemplateInterviewTurnInput
  ): Promise<RockyTemplateInterviewTurnResult> {
    const timestamp = this.now();
    const chatId = `rocky-template-interview-${this.idGenerator()}`;
    const messageId = `message-${this.idGenerator()}`;
    const prompt = buildTemplateInterviewAgentPrompt(input);
    const { agent, worker } = await this.ensureCoreWorker({
      skill: ROCKY_CORE_SKILL,
      reason: "템플릿 인터뷰 답변을 Rocky Core에서 처리합니다.",
      timestamp,
    });
    const dispatch = this.buildDispatch({
      chatId,
      messageId,
      skill: ROCKY_CORE_SKILL,
      intent: "conversation",
      domain: "general",
      workerId: worker.id,
      attachments: [],
      message: prompt,
      skillCandidates: [],
      timestamp,
    });
    const extraSystemInstructions = await this.buildExtraSystemInstructions({
      agent,
      chatId,
      dispatch,
      domain: "general",
      skill: ROCKY_CORE_SKILL,
      message: prompt,
      attachments: [],
      skillCandidates: [],
      timestamp,
    });
    const settings = await this.readCoreSettings();
    const started = await this.orchestrator.start({
      chatId,
      domain: "general",
      message: prompt,
      worker,
      dispatch,
      attachments: [],
      skillCandidates: [],
      skill: ROCKY_CORE_SKILL,
      protectionHints: dispatch.protectionHints,
      reuseSessionId: null,
      defaultRuntimeKind: settings.defaultRuntimeKind,
      defaultOllamaLaunchTarget: settings.defaultOllamaLaunchTarget,
      defaultModel: settings.defaultModel,
      defaultReasoningEffort: settings.defaultReasoningEffort,
      defaultServiceTier: settings.defaultServiceTier,
      timestamp,
      extraSystemInstructions,
    });
    const orchestration = await this.waitForTemplateInterviewAgent(started);
    if (isActiveOrchestrationStatus(orchestration.status)) {
      throw gatewayTimeout(
        "Rocky Core가 템플릿 인터뷰 답변을 아직 완료하지 못했습니다. 잠시 뒤 다시 시도해 주세요."
      );
    }
    if (orchestration.status !== "completed") {
      throw badGateway(
        orchestration.error ??
          "Rocky Core가 템플릿 인터뷰 답변을 완료하지 못했습니다."
      );
    }

    const agentResult = parseTemplateInterviewAgentResult({
      output: orchestration.output,
      requestedStepId: input.stepId,
    });
    if (!agentResult) {
      throw badGateway(
        "Rocky Core가 템플릿 인터뷰 결과를 읽을 수 있는 JSON으로 반환하지 않았습니다."
      );
    }

    return {
      ...agentResult,
      source: "agent",
      agent: {
        status: orchestration.status,
        sessionId: orchestration.sessionId,
        runId: orchestration.runId,
        output: orchestration.output,
        error: orchestration.error,
      },
    };
  }

  async createChat(input: RockyChatCreateInput): Promise<RockyChatRecord> {
    const timestamp = this.now();
    const chatId = `rocky-chat-${this.idGenerator()}`;
    const attachmentDrafts = this.normalizeAttachments(input.attachments ?? [], timestamp);
    const attachments = attachmentDrafts.map(stripAttachmentContent);
    const message = requestMessageOrAttachmentDefault({
      message: input.message,
      attachments,
    });
    const selection = selectRockySkill({ message, attachments });
    const { domain, intent } = selection;
    const userMessageId = `message-${this.idGenerator()}`;
    const targetAgent = input.agentId
      ? await this.requireRunnableAgent(input.agentId)
      : null;
    const routed = targetAgent
      ? await this.handleAgentMessage({
          agent: targetAgent,
          chatId,
          messageId: userMessageId,
          message,
          runtimeMessage: withAgentSoul(
            skillInvocationMessage(message, input.skillId),
            targetAgent.soul,
          ),
          selectedSkillId: input.skillId ?? null,
          attachments: attachmentDrafts,
          domain,
          intent,
          reuseSessionId: null,
          timestamp,
        })
      : await this.handleRockyCoreMessage({
          chatId,
          messageId: userMessageId,
          message,
          attachments: attachmentDrafts,
          domain,
          intent,
          skill: selection.skill,
          selectionReason: selection.reason,
          reuseCoreSessionId: null,
          awaitingSkillDelete: false,
          timestamp,
        });
    const userMessage = this.buildUserMessage({
      id: userMessageId,
      chatId,
      message,
      attachments: routed.attachments,
      domain,
      intent,
      createdAt: timestamp,
    });

    const chat: RockyChatRecord = {
      id: chatId,
      title: titleFromMessage(message),
      intent,
      domain,
      worker: routed.worker,
      attachments: routed.attachments,
      messages: [userMessage, routed.rockyMessage],
      skillCandidates: routed.skillCandidates,
      dispatches: routed.dispatch ? [routed.dispatch] : [],
      orchestration: routed.dispatch?.orchestration ?? null,
      executionStarted: Boolean(routed.dispatch?.executionStarted),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.writeChat(chat);
    return this.toPagedChatWithPreview(chat);
  }

  async getChat(
    chatId: string,
    page: RockyChatMessagePageInput = {}
  ): Promise<RockyChatRecord> {
    const refreshed = await this.refreshChat(await this.requireChat(chatId), {
      persist: true,
    });
    return this.toPagedChatWithPreview(refreshed, page);
  }

  async getChatMessages(
    chatId: string,
    page: RockyChatMessagePageInput = {}
  ): Promise<RockyChatMessagePageRecord> {
    const refreshed = await this.refreshChat(await this.requireChat(chatId), {
      persist: true,
    });
    return pageRockyMessages(refreshed.messages, page);
  }

  async listChats(): Promise<RockyChatRecord[]> {
    const paths = await listRockyChatPaths(this.stateRoot);
    const chats = (
      await Promise.all(paths.map((entry) => readRockyChatRecord(entry)))
    ).filter((chat): chat is RockyChatRecord => Boolean(chat));

    const refreshed = await Promise.all(
      chats.map((chat) => this.refreshChat(chat, { persist: true }))
    );

    const sorted = refreshed.sort(
      (left, right) =>
        rockyChatActivityUpdatedAt(right).localeCompare(
          rockyChatActivityUpdatedAt(left)
        ) ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id)
    );

    return Promise.all(sorted.map((chat) => this.toPagedChatWithPreview(chat)));
  }

  async approveInstagramPublishDraft(
    chatId: string
  ): Promise<RockyInstagramPublishApprovalRecord> {
    const chat = await this.requireChat(chatId);
    const existingState = await this.readInstagramPublishApprovalState(chatId);
    const agent = await this.findChatDraftAgent(chat);
    if (!agent) {
      if (existingState) {
        return existingState.result;
      }
      throw badRequest("No Instagram Publish draft agent is available.");
    }

    const draft = await this.findActiveInstagramPublishDraft({
      agent,
      chatId,
    });
    if (!draft) {
      if (existingState && !canRetryInstagramPublishApproval(existingState.result)) {
        return existingState.result;
      }
      const knownPublished = await this.findKnownPublishedInstagramPublishApproval({
        agent,
        chatId,
      });
      if (knownPublished) {
        return knownPublished;
      }
      if (existingState) {
        return existingState.result;
      }
      throw badRequest("No active Instagram Publish draft is available.");
    }

    const caption = await this.readInstagramPublishCaption({
      agent,
      payload: draft.payload,
    });
    const draftFingerprint = await this.buildInstagramPublishDraftFingerprint({
      agent,
      chatId,
      draft,
      caption,
    });
    const inFlight = this.instagramPublishApprovalsInFlight.get(draftFingerprint);
    if (inFlight) {
      return inFlight;
    }
    if (
      existingState?.draftFingerprint === draftFingerprint &&
      !canRetryInstagramPublishApproval(existingState.result)
    ) {
      return existingState.result;
    }

    const connectorStateResult = await this.readInstagramConnectorStateForApproval();
    const blocker = this.instagramPublishApprovalBlocker(
      connectorStateResult.error,
      connectorStateResult.state
    );
    const publishType = readInstagramDraftPublishType(draft.payload);
    const targetAccountLabel =
      readInstagramDraftTargetAccount(draft.payload) ??
      connectorStateResult.state?.accountLabel ??
      "Instagram 계정";
    if (blocker) {
      return {
        provider: "instagram",
        status: "blocked",
        publishType,
        targetAccountLabel,
        permalink: null,
        publishedAt: null,
        message: blocker,
        approvedAt: this.now(),
        updatedAt: this.now(),
        completedAt: this.now(),
      };
    }

    const approvalId = `instagram-publish-${this.idGenerator()}`;
    const approvedAt = this.now();
    const publishing: RockyInstagramPublishApprovalRecord = {
      provider: "instagram",
      status: "publishing",
      publishType,
      targetAccountLabel,
      permalink: null,
      publishedAt: null,
      message: "Instagram publish approval recorded. Publishing is in progress.",
      approvedAt,
      updatedAt: approvedAt,
      completedAt: null,
    };
    this.instagramPublishApprovalsInFlight.set(draftFingerprint, publishing);

    try {
      await this.writeInstagramPublishApprovalState({
        schemaVersion: 1,
        chatId,
        agentId: agent.id,
        approvalId,
        draftFingerprint,
        result: publishing,
      });
      const result = await this.executeApprovedInstagramPublishDraft({
        agent,
        draft,
        caption,
      });
      const completedAt = result.checkedAt;
      const completed: RockyInstagramPublishApprovalRecord = {
        provider: "instagram",
        status: result.status,
        publishType,
        targetAccountLabel,
        permalink: result.permalink,
        publishedAt: result.publishedAt,
        message:
          result.status === "published"
            ? "Instagram publish completed."
            : sanitizeInstagramPublishPublicMessage(result.message),
        approvedAt,
        updatedAt: completedAt,
        completedAt,
      };
      await this.writeInstagramPublishApprovalState({
        schemaVersion: 1,
        chatId,
        agentId: agent.id,
        approvalId,
        draftFingerprint,
        result: completed,
      });
      await this.writeInstagramPublishApprovalWorkspaceResult({
        absolutePath: draft.absolutePath,
        payload: draft.payload,
        result: completed,
      });
      return completed;
    } catch (error) {
      const checkedAt = this.now();
      const failed: RockyInstagramPublishApprovalRecord = {
        provider: "instagram",
        status: "publish_failed",
        publishType,
        targetAccountLabel,
        permalink: null,
        publishedAt: null,
        message: formatInstagramPublishRetryableFailureMessage(
          formatUnexpectedInstagramPublishError(error)
        ),
        approvedAt,
        updatedAt: checkedAt,
        completedAt: checkedAt,
      };
      await this.writeInstagramPublishApprovalState({
        schemaVersion: 1,
        chatId,
        agentId: agent.id,
        approvalId,
        draftFingerprint,
        result: failed,
      });
      await this.writeInstagramPublishApprovalWorkspaceResult({
        absolutePath: draft.absolutePath,
        payload: draft.payload,
        result: failed,
      });
      return failed;
    } finally {
      this.instagramPublishApprovalsInFlight.delete(draftFingerprint);
    }
  }

  async cancelChat(chatId: string): Promise<RockyChatRecord> {
    const existing = await this.refreshChat(await this.requireChat(chatId), {
      persist: true,
    });
    const timestamp = this.now();
    let changed = false;

    const dispatches = await Promise.all(
      existing.dispatches.map(async (dispatch) => {
        const orchestration = dispatch.orchestration;
        if (!orchestration || !isActiveOrchestrationStatus(orchestration.status)) {
          return dispatch;
        }

        if (orchestration.runId && this.sessionService?.cancelRun) {
          await this.sessionService.cancelRun(orchestration.runId);
        } else if (
          orchestration.sessionId &&
          this.sessionService?.stopSessionRuns
        ) {
          await this.sessionService.stopSessionRuns(orchestration.sessionId);
        }

        changed = true;
        return {
          ...dispatch,
          orchestration: {
            ...orchestration,
            status: "cancelled",
            endedAt: orchestration.endedAt ?? timestamp,
            updatedAt: timestamp,
          } satisfies RockyOrchestrationRecord,
        };
      })
    );

    if (!changed) {
      return this.toPagedChatWithPreview(existing);
    }

    const orchestration =
      [...dispatches].reverse().find((dispatch) => dispatch.orchestration)
        ?.orchestration ?? null;
    const chat: RockyChatRecord = {
      ...existing,
      dispatches,
      orchestration,
      updatedAt: timestamp,
    };

    await this.writeChat(chat);
    return this.toPagedChatWithPreview(chat);
  }

  async getCoreManagement(): Promise<RockyCoreManagementRecord> {
    const [settings, rawChats, agent] = await Promise.all([
      this.readCoreSettings(),
      this.readAllChats(),
      this.findCoreAgent(),
    ]);
    const sessions = await this.listCoreSessions();

    return this.buildCoreManagementRecord({
      agent,
      settings,
      chats: rawChats.map((chat) => this.hydrateChat(chat)),
      sessions,
    });
  }

  async updateCoreSettings(
    input: RockyCoreSettingsUpdateInput
  ): Promise<RockyCoreManagementRecord> {
    const current = await this.readCoreSettings();
    const next: RockyCoreSettingsRecord = {
      ...current,
      updatedAt: this.now(),
    };

    if (Object.prototype.hasOwnProperty.call(input, "defaultRuntimeKind")) {
      if (!isRuntimeKind(input.defaultRuntimeKind)) {
        throw badRequest(
          "defaultRuntimeKind must be codex-cli, claude-code, or ollama."
        );
      }
      next.defaultRuntimeKind = input.defaultRuntimeKind;
    }

    if (Object.prototype.hasOwnProperty.call(input, "defaultModel")) {
      if (input.defaultModel === null || input.defaultModel === undefined) {
        next.defaultModel = null;
      } else if (typeof input.defaultModel === "string") {
        const trimmed = input.defaultModel.trim();
        next.defaultModel = trimmed.length > 0 ? trimmed : null;
      } else {
        throw badRequest("defaultModel must be a string or null.");
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(input, "defaultReasoningEffort")
    ) {
      const normalized = normalizeReasoningEffort(input.defaultReasoningEffort);
      if (
        normalized === null &&
        input.defaultReasoningEffort !== null &&
        input.defaultReasoningEffort !== undefined
      ) {
        throw badRequest(
          "defaultReasoningEffort must be low, medium, high, xhigh, max, or null."
        );
      }
      next.defaultReasoningEffort = normalized ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "defaultServiceTier")) {
      const normalized = normalizeServiceTier(input.defaultServiceTier);
      if (
        normalized === null &&
        input.defaultServiceTier !== null &&
        input.defaultServiceTier !== undefined
      ) {
        throw badRequest("defaultServiceTier must be fast or null.");
      }
      next.defaultServiceTier = normalized ?? null;
    }

    if (
      Object.prototype.hasOwnProperty.call(input, "defaultOllamaLaunchTarget")
    ) {
      const normalized = normalizeOllamaLaunchTarget(
        input.defaultOllamaLaunchTarget
      );
      if (
        normalized === null &&
        input.defaultOllamaLaunchTarget !== null &&
        input.defaultOllamaLaunchTarget !== undefined
      ) {
        throw badRequest(
          "defaultOllamaLaunchTarget must be codex, claude, or null."
        );
      }
      next.defaultOllamaLaunchTarget = normalized ?? null;
    }

    if (next.defaultRuntimeKind !== "ollama") {
      next.defaultOllamaLaunchTarget = null;
    }

    await writeRockyCoreSettingsRecord(
      resolveRockyCoreSettingsPaths(this.stateRoot),
      next
    );

    return this.getCoreManagement();
  }

  async syncCoreSkills(): Promise<RockyCoreManagementRecord> {
    const timestamp = this.now();
    for (const skill of ROCKY_ORCHESTRATION_SKILLS) {
      await this.ensureCoreWorker({
        skill,
        reason: "Rocky Core 관리 화면에서 스킬 동기화를 요청했습니다.",
        timestamp,
      });
    }

    return this.getCoreManagement();
  }

  async addMessage(
    chatId: string,
    input: RockyChatMessageInput
  ): Promise<RockyChatRecord> {
    const existing = await this.requireChat(chatId);
    const timestamp = this.now();
    const attachmentDrafts = this.normalizeAttachments(input.attachments ?? [], timestamp);
    const attachments = attachmentDrafts.map(stripAttachmentContent);
    const message = requestMessageOrAttachmentDefault({
      message: input.message,
      attachments,
    });
    const selection = selectRockySkill({
      message,
      attachments,
      contextDomain: existing.domain,
    });
    const { domain, intent, skill } = selection;
    const userMessageId = `message-${this.idGenerator()}`;
    const existingAgentId =
      isAgentChatWorker(existing.worker) && existing.worker?.agentId
        ? existing.worker.agentId
        : null;
    const targetAgent = existingAgentId
      ? await this.requireRunnableAgent(existingAgentId)
      : null;
    const instagramPublishChatAction = await this.tryHandleInstagramPublishChatAction({
      existing,
      agent: targetAgent,
      chatId,
      message,
      attachmentDrafts,
      domain,
      intent,
      timestamp,
    });
    if (instagramPublishChatAction) {
      return instagramPublishChatAction;
    }

    const reusableSessionId = this.findReusableSessionId(existing);
    const followupSkillId = latestUsedSkillId(existing);
    const routed = targetAgent
      ? await this.handleAgentMessage({
          agent: targetAgent,
          chatId,
          messageId: userMessageId,
          message,
          runtimeMessage: withAgentSoul(message, targetAgent.soul),
          selectedSkillId: followupSkillId,
          attachments: [...existing.attachments, ...attachmentDrafts],
          domain,
          intent,
          reuseSessionId: reusableSessionId,
          timestamp,
        })
      : await this.handleRockyCoreMessage({
          chatId,
          messageId: userMessageId,
          message,
          attachments: [...existing.attachments, ...attachmentDrafts],
          domain,
          intent,
          skill,
          selectionReason: selection.reason,
          reuseCoreSessionId: reusableSessionId,
          awaitingSkillDelete: this.isAwaitingSkillDelete(existing),
          timestamp,
        });
    const newAttachments = routed.attachments.filter((attachment) =>
      attachmentDrafts.some((draft) => draft.id === attachment.id)
    );
    const userMessage = this.buildUserMessage({
      id: userMessageId,
      chatId,
      message,
      attachments: newAttachments,
      domain,
      intent,
      createdAt: timestamp,
    });
    const skillCandidates = this.mergeSkillCandidates(
      existing.skillCandidates,
      routed.skillCandidates
    );

    const chat: RockyChatRecord = {
      ...existing,
      title: existing.title || titleFromMessage(message),
      intent,
      domain,
      worker: routed.worker ?? existing.worker,
      attachments: routed.attachments,
      messages: [...existing.messages, userMessage, routed.rockyMessage],
      skillCandidates,
      dispatches: routed.dispatch
        ? [...existing.dispatches, routed.dispatch]
        : existing.dispatches,
      orchestration: routed.dispatch?.orchestration ?? existing.orchestration ?? null,
      executionStarted:
        Boolean(routed.dispatch?.executionStarted) || Boolean(existing.executionStarted),
      updatedAt: timestamp,
    };

    await this.writeChat(chat);
    return this.toPagedChatWithPreview(chat);
  }

  private async tryHandleInstagramPublishChatAction(input: {
    existing: RockyChatRecord;
    agent: AgentRecord | null;
    chatId: string;
    message: string;
    attachmentDrafts: RockyAttachmentDraft[];
    domain: RockyChatDomain;
    intent: RockyRoutingIntent;
    timestamp: string;
  }): Promise<RockyChatRecord | null> {
    if (input.attachmentDrafts.length > 0) {
      return null;
    }

    const action = classifyInstagramPublishChatAction(input.message);
    if (!action) {
      return null;
    }

    const existingState = await this.readInstagramPublishApprovalState(input.chatId);
    let activeDraft = false;
    let knownPublished: RockyInstagramPublishApprovalRecord | null = null;
    if (input.agent) {
      activeDraft = Boolean(
        await this.findActiveInstagramPublishDraft({
          agent: input.agent,
          chatId: input.chatId,
        })
      );
      if (!activeDraft && !existingState) {
        knownPublished = await this.findKnownPublishedInstagramPublishApproval({
          agent: input.agent,
          chatId: input.chatId,
        });
      }
    }

    if (!activeDraft && !existingState && !knownPublished) {
      return null;
    }

    const rockyText =
      action === "approve"
        ? formatInstagramPublishApprovalChatMessage(
            await this.approveInstagramPublishDraft(input.chatId)
          )
        : formatInstagramPublishStatusChatMessage({
            approval: existingState?.result ?? knownPublished,
            preview: existingState || knownPublished
              ? null
              : await this.findChatInstagramPublishDraftPreview(input.existing),
          });

    return this.appendInstagramPublishChatReply({
      chatId: input.chatId,
      message: input.message,
      rockyText,
      domain: input.domain,
      intent: input.intent,
      timestamp: input.timestamp,
    });
  }

  private async appendInstagramPublishChatReply(input: {
    chatId: string;
    message: string;
    rockyText: string;
    domain: RockyChatDomain;
    intent: RockyRoutingIntent;
    timestamp: string;
  }): Promise<RockyChatRecord> {
    const latest = await this.requireChat(input.chatId);
    const userMessage = this.buildUserMessage({
      id: `message-${this.idGenerator()}`,
      chatId: input.chatId,
      message: input.message,
      attachments: [],
      domain: input.domain,
      intent: input.intent,
      createdAt: input.timestamp,
    });
    const rockyMessage: RockyMessageRecord = {
      id: `message-${this.idGenerator()}`,
      chatId: input.chatId,
      role: "rocky",
      intent: input.intent,
      text: input.rockyText,
      attachmentIds: [],
      domain: input.domain,
      workerId: latest.worker?.id ?? null,
      skillCandidateIds: [],
      usedSkills: [],
      dispatchId: null,
      createdAt: input.timestamp,
    };
    const chat: RockyChatRecord = {
      ...latest,
      title: latest.title || titleFromMessage(input.message),
      intent: input.intent,
      domain: input.domain,
      messages: [...latest.messages, userMessage, rockyMessage],
      updatedAt: input.timestamp,
    };

    await this.writeChat(chat);
    return this.toPagedChatWithPreview(chat);
  }

  async deleteChat(chatId: string): Promise<void> {
    const chat = await this.requireChat(chatId);
    const sessionIds = [...new Set(
      chat.dispatches.flatMap((dispatch) =>
        dispatch.orchestration?.sessionId ? [dispatch.orchestration.sessionId] : []
      )
    )];

    await Promise.all(
      sessionIds.map((sessionId) => this.deleteSessionIfPresent(sessionId))
    );
    await deleteRockyChatRecord(
      resolveRockyChatPaths({
        stateRoot: this.stateRoot,
        chatId,
      })
    );
  }

  private normalizeAttachments(
    attachments: RockyAttachmentInput[],
    addedAt: string
  ): RockyAttachmentDraft[] {
    return attachments
      .filter((attachment) => attachment.name.trim())
      .slice(0, 20)
      .map((attachment) => ({
        id: `attachment-${this.idGenerator()}`,
        name: attachment.name.trim(),
        contentType: attachment.contentType?.trim() || null,
        size:
          typeof attachment.size === "number" && Number.isFinite(attachment.size)
            ? attachment.size
            : null,
        workspacePath: null,
        publicUrl: attachment.publicUrl?.trim() || null,
        contentBase64: attachment.contentBase64?.trim() || null,
        addedAt,
      }));
  }

  private buildUserMessage(input: {
    id: string;
    chatId: string;
    message: string;
    attachments: RockyAttachmentRecord[];
    domain: RockyChatDomain;
    intent: RockyRoutingIntent;
    createdAt: string;
  }): RockyMessageRecord {
    return {
      id: input.id,
      chatId: input.chatId,
      role: "user",
      intent: input.intent,
      text: input.message,
      attachmentIds: input.attachments.map((attachment) => attachment.id),
      domain: input.domain,
      workerId: null,
      skillCandidateIds: [],
      usedSkills: [],
      dispatchId: null,
      createdAt: input.createdAt,
    };
  }

  private async findAgentById(agentId: string | null): Promise<AgentRecord | null> {
    if (!this.agentService || !agentId) {
      return null;
    }

    const agents = await this.agentService.listAgents();
    return agents.find((agent) => agent.id === agentId) ?? null;
  }

  private async listSavedSkillTemplates(): Promise<RuntimeSkillTemplateRecord[]> {
    try {
      return await this.skillTemplateStore.listSkills();
    } catch {
      return [];
    }
  }

  private savedTemplateDisplayName(
    template: RuntimeSkillTemplateRecord
  ): string {
    return template.skill.displayName.trim() || template.title;
  }

  private connectorTemplateSkillFiles(
    template: RuntimeSkillTemplateRecord
  ): { manifest: boolean; scriptName: string | null } {
    const signal = [
      template.skill.id,
      template.skill.displayName,
      template.title,
      template.description,
      template.skill.skillMarkdown,
    ].join("\n");
    if (/threads|쓰레드|스레드/iu.test(signal)) {
      return { manifest: true, scriptName: "threads-crud.mjs" };
    }
    if (/facebook|페이스북/iu.test(signal)) {
      return { manifest: true, scriptName: "facebook-crud.mjs" };
    }
    if (/instagram|insta|reels?|\uC778\uC2A4\uD0C0|\uB9B4\uC2A4/iu.test(signal)) {
      return { manifest: true, scriptName: null };
    }
    return { manifest: false, scriptName: null };
  }

  private async savedSkillTemplateBySkillId(): Promise<
    Map<string, RuntimeSkillTemplateRecord>
  > {
    const templates = await this.listSavedSkillTemplates();
    return new Map(templates.map((template) => [template.skill.id, template]));
  }

  private async shouldSyncInstalledTemplateSkill(
    installed: AgentLocalSkillRecord,
    template: RuntimeSkillTemplateRecord
  ): Promise<boolean> {
    const displayName = this.savedTemplateDisplayName(template);
    if (
      installed.displayName !== displayName ||
      installed.description !== template.skill.description
    ) {
      return true;
    }

    const connectorFiles = this.connectorTemplateSkillFiles(template);
    if (connectorFiles.manifest) {
      const skillDir = path.dirname(installed.skillPath);
      if (!(await this.fileExists(path.join(skillDir, "connector-capabilities.json")))) {
        return true;
      }
      if (
        connectorFiles.scriptName &&
        !(await this.fileExists(path.join(skillDir, "scripts", connectorFiles.scriptName)))
      ) {
        return true;
      }
    }

    try {
      const markdown = await readFile(installed.skillPath, "utf8");
      if (!markdown.includes("## Output Directory Rules")) {
        return true;
      }
      if (!markdown.includes("`outputs/`")) {
        return true;
      }
      if (
        requiresPdfOutputLabel(template.outputFormatLabel) &&
        !markdown.includes("browser rendering engine")
      ) {
        return true;
      }
    } catch {
      return true;
    }

    return false;
  }

  private async syncAgentTemplateSkills(agent: AgentRecord): Promise<void> {
    const templatesBySkillId = await this.savedSkillTemplateBySkillId();
    if (templatesBySkillId.size === 0) {
      return;
    }

    const installedSkills = await this.agentLocalSkillService.listAgentLocalSkills(agent);
    for (const installed of installedSkills) {
      const template = templatesBySkillId.get(installed.id);
      if (!template) {
        continue;
      }

      if (!(await this.shouldSyncInstalledTemplateSkill(installed, template))) {
        continue;
      }

      try {
        await this.agentLocalSkillService.upsertAgentLocalSkill(
          agent,
          template.skill.id,
          await this.skillTemplateStore.getSkillFiles(template.id),
          { replace: true }
        );
      } catch {
        // Keep the request runnable even if a stale local skill cannot be refreshed.
      }
    }
  }

  private async listAgentEcountSkillContexts(
    agent: AgentRecord,
    selectedSkillId: string | null
  ): Promise<Array<{ skill: AgentLocalSkillRecord; content: string }>> {
    const skills = await this.agentLocalSkillService.listAgentLocalSkills(agent);
    const contexts: Array<{ skill: AgentLocalSkillRecord; content: string }> = [];
    for (const skill of skills) {
      if (selectedSkillId && skill.id !== selectedSkillId) {
        continue;
      }
      let content = "";
      try {
        content = await readFile(skill.skillPath, "utf8");
      } catch {
        content = "";
      }
      if (
        mentionsEcountIntegration(skill.displayName) ||
        mentionsEcountIntegration(skill.description ?? "") ||
        mentionsEcountIntegration(content)
      ) {
        contexts.push({ skill, content });
      }
    }

    return contexts;
  }

  private async listAgentConnectorSummaries(
    agent: AgentRecord
  ): Promise<AgentConnectorSummary[]> {
    if (!this.connectorService) {
      return [];
    }

    try {
      let skills = await this.agentLocalSkillService.listAgentLocalSkills(agent);
      let repairedConnectorFiles = false;
      for (const skill of skills) {
        repairedConnectorFiles =
          (await this.agentLocalSkillService.ensureAgentLocalSkillConnectorFiles(
            agent,
            skill.id,
          )) || repairedConnectorFiles;
      }
      if (repairedConnectorFiles) {
        skills = await this.agentLocalSkillService.listAgentLocalSkills(agent);
      }
      const integrations = await listAgentConnectorIntegrations({
        skills,
        connectorService: this.connectorService,
      });
      const summaries = integrations.map((integration): AgentConnectorSummary => ({
        provider: integration.provider,
        label: integration.label,
        status: integration.status,
        loginMode: integration.loginMode,
        accountLabel: integration.accountLabel,
        connectedAt: integration.connectedAt,
        browserAccess: integration.browserAccess,
        capabilities: integration.capabilities,
        requiredBySkills: integration.requiredBySkills,
        draftPublishing:
          integration.provider === "tistory" &&
          integration.status === "connected" &&
          integration.loginMode === "custom-browser"
            ? "server-managed"
            : null,
      }));
      const seen = new Set(summaries.map((summary) => summary.provider));
      for (const provider of listSupportedProviders()) {
        if (seen.has(provider)) {
          continue;
        }
        const state = await this.connectorService.getState(provider);
        if (state.status !== "connected") {
          continue;
        }
        summaries.push({
          provider,
          label: getConnectorAdapter(provider).label,
          status: state.status,
          loginMode: state.loginMode,
          accountLabel: state.accountLabel,
          connectedAt: state.connectedAt,
          browserAccess: state.browserAccess,
          capabilities: state.capabilities,
          draftPublishing:
            provider === "tistory" && state.loginMode === "custom-browser"
              ? "server-managed"
              : null,
        });
      }
      return summaries;
    } catch {
      return [];
    }
  }

  private async maybePublishTistoryDraftAfterAgentTurn(input: {
    agent: AgentRecord;
    chatId: string;
    request: string;
    orchestration: RockyOrchestrationRecord;
  }): Promise<RockyOrchestrationRecord> {
    if (
      !this.connectorService ||
      input.orchestration.status !== "completed" ||
      !shouldAttemptTistoryDraftPublish({
        request: input.request,
        output: input.orchestration.output,
      })
    ) {
      return input.orchestration;
    }

    let tistoryState;
    try {
      tistoryState = await this.connectorService.getState("tistory");
    } catch {
      return input.orchestration;
    }
    if (
      tistoryState.status !== "connected" ||
      tistoryState.loginMode !== "custom-browser"
    ) {
      return input.orchestration;
    }

    const draft = await this.findTistoryPublishReadyDraft({
      agent: input.agent,
      chatId: input.chatId,
      output: input.orchestration.output ?? "",
    });
    if (!draft) {
      const checkedAt = this.now();
      return {
        ...input.orchestration,
        output: appendTistoryDraftPublishResult({
          output: input.orchestration.output ?? "",
          draft: {
            workspacePath: rockyTaskOutputDirectory(input.chatId),
            input: {
              title: "Tistory draft",
              contentMarkdown: "Tistory draft",
              tags: [],
              visibility: "draft",
            },
          },
          result: {
            ok: false,
            provider: "tistory",
            status: "failed",
            accountLabel: null,
            url: null,
            message:
              "Tistory 발행용 Markdown에서 제목, 본문, 태그 섹션을 찾지 못했습니다.",
            checkedAt,
          },
        }),
        updatedAt: checkedAt,
      };
    }

    const result = await this.connectorService.publishDraft("tistory", draft.input);
    return {
      ...input.orchestration,
      output: appendTistoryDraftPublishResult({
        output: input.orchestration.output ?? "",
        draft,
        result,
      }),
      updatedAt: result.checkedAt,
    };
  }

  private async findTistoryPublishReadyDraft(input: {
    agent: AgentRecord;
    chatId: string;
    output: string;
  }): Promise<TistoryPublishReadyDraft | null> {
    const candidates = [
      ...extractMarkdownWorkspacePaths(input.output),
      ...(await this.listMarkdownWorkspacePaths(
        input.agent.workspaceRoot,
        rockyTaskOutputDirectory(input.chatId)
      )),
    ];

    for (const candidate of [...new Set(candidates)]) {
      const relativePath = normalizeWorkspaceRelativePath(candidate);
      if (!relativePath) {
        continue;
      }
      const absolutePath = this.workspaceAbsolutePath(
        input.agent.workspaceRoot,
        relativePath
      );
      if (!absolutePath) {
        continue;
      }

      let markdown = "";
      try {
        markdown = await readFile(absolutePath, "utf8");
      } catch {
        continue;
      }
      const draft = parseTistoryPublishReadyMarkdown({
        workspacePath: relativePath,
        markdown,
      });
      if (draft) {
        return draft;
      }
    }

    return null;
  }

  private async maybePublishInstagramMediaAfterAgentTurn(input: {
    agent: AgentRecord;
    chatId: string;
    request: string;
    orchestration: RockyOrchestrationRecord;
  }): Promise<RockyOrchestrationRecord> {
    if (
      !this.connectorService ||
      input.orchestration.status !== "completed" ||
      !shouldAttemptInstagramMediaPublish({
        request: input.request,
        output: input.orchestration.output,
      })
    ) {
      return input.orchestration;
    }

    const request = await this.findInstagramPublishReadyRequest({
      agent: input.agent,
      chatId: input.chatId,
    });
    if (!request) {
      return input.orchestration;
    }

    try {
    const prepareResult = await this.connectorService.executeCapability("instagram", {
      capabilityId: "instagram.media.prepare",
      args: request.args,
    });
    if (!prepareResult.ok) {
      const result = instagramPublishFailure({
        requestPath: request.workspacePath,
        checkedAt: prepareResult.checkedAt,
        message: prepareResult.message,
      });
      await this.writeInstagramPublishRequestResult(request, result);
      return {
        ...input.orchestration,
        output: appendInstagramMediaPublishResult({
          output: input.orchestration.output ?? "",
          result,
        }),
        updatedAt: result.checkedAt,
      };
    }

    const creationId = readCapabilityDataString(prepareResult, [
      "id",
      "creation_id",
      "creationId",
    ]);
    if (!creationId) {
      const result = instagramPublishFailure({
        requestPath: request.workspacePath,
        checkedAt: prepareResult.checkedAt,
        message:
          "Instagram media.prepare completed without returning a creation_id.",
      });
      await this.writeInstagramPublishRequestResult(request, result);
      return {
        ...input.orchestration,
        output: appendInstagramMediaPublishResult({
          output: input.orchestration.output ?? "",
          result,
        }),
        updatedAt: result.checkedAt,
      };
    }

    const containerFailure = await this.waitForInstagramMediaContainerReady({
      creationId,
      requestPath: request.workspacePath,
    });
    if (containerFailure) {
      await this.writeInstagramPublishRequestResult(request, containerFailure);
      return {
        ...input.orchestration,
        output: appendInstagramMediaPublishResult({
          output: input.orchestration.output ?? "",
          result: containerFailure,
        }),
        updatedAt: containerFailure.checkedAt,
      };
    }

    const publishResult = await this.connectorService.executeCapability("instagram", {
      capabilityId: "instagram.media.publish",
      args: {
        approved: true,
        creationId,
      },
    });
    if (!publishResult.ok) {
      const result = instagramPublishFailure({
        requestPath: request.workspacePath,
        checkedAt: publishResult.checkedAt,
        message: publishResult.message,
        creationId,
      });
      await this.writeInstagramPublishRequestResult(request, result);
      return {
        ...input.orchestration,
        output: appendInstagramMediaPublishResult({
          output: input.orchestration.output ?? "",
          result,
        }),
        updatedAt: result.checkedAt,
      };
    }

    const mediaId = readCapabilityDataString(publishResult, [
      "id",
      "media_id",
      "mediaId",
    ]);
    if (!mediaId) {
      const result = instagramPublishFailure({
        requestPath: request.workspacePath,
        checkedAt: publishResult.checkedAt,
        message:
          "Instagram media.publish completed without returning a media_id.",
        creationId,
      });
      await this.writeInstagramPublishRequestResult(request, result);
      return {
        ...input.orchestration,
        output: appendInstagramMediaPublishResult({
          output: input.orchestration.output ?? "",
          result,
        }),
        updatedAt: result.checkedAt,
      };
    }

    let permalink: string | null = null;
    let publishedAt: string | null = null;
    let checkedAt = publishResult.checkedAt;
    let message = publishResult.message;

    const statusResult = await this.connectorService.executeCapability(
      "instagram",
      {
        capabilityId: "instagram.media.status.read",
        args: { mediaId },
      }
    );
    checkedAt = statusResult.checkedAt;
    if (statusResult.ok) {
      permalink = readCapabilityDataString(statusResult, ["permalink"]);
      publishedAt = readCapabilityDataString(statusResult, [
        "timestamp",
        "published_at",
        "publishedAt",
      ]);
    } else {
      message = `${publishResult.message} Status verification failed: ${statusResult.message}`;
    }

    const result: InstagramPublishExecutionResult = {
      status: "published",
      requestPath: request.workspacePath,
      checkedAt,
      message,
      creationId,
      mediaId,
      permalink,
      publishedAt,
    };
    await this.writeInstagramPublishRequestResult(request, result);
    return {
      ...input.orchestration,
      output: appendInstagramMediaPublishResult({
        output: input.orchestration.output ?? "",
        result,
      }),
      updatedAt: result.checkedAt,
    };
    } catch (error) {
      const result = instagramPublishFailure({
        requestPath: request.workspacePath,
        checkedAt: this.now(),
        message: formatUnexpectedInstagramPublishError(error),
      });
      await this.writeInstagramPublishRequestResult(request, result);
      return {
        ...input.orchestration,
        output: appendInstagramMediaPublishResult({
          output: input.orchestration.output ?? "",
          result,
        }),
        updatedAt: result.checkedAt,
      };
    } finally {
      this.instagramPublishRequestClaims.delete(request.absolutePath);
      await this.releaseInstagramPublishRequestFileClaim(request.claimPath);
    }
  }

  private async waitForInstagramMediaContainerReady(input: {
    creationId: string;
    requestPath: string;
  }): Promise<InstagramPublishExecutionResult | null> {
    if (!this.connectorService) {
      return instagramPublishFailure({
        requestPath: input.requestPath,
        checkedAt: this.now(),
        message: "Instagram connector is unavailable.",
        creationId: input.creationId,
      });
    }

    let lastCheckedAt = this.now();
    let lastStatus = "unknown";
    for (let attempt = 0; attempt < INSTAGRAM_MEDIA_CONTAINER_MAX_POLLS; attempt += 1) {
      const statusResult = await this.connectorService.executeCapability("instagram", {
        capabilityId: "instagram.media.status.read",
        args: { creationId: input.creationId },
      });
      lastCheckedAt = statusResult.checkedAt;

      if (!statusResult.ok) {
        return instagramPublishFailure({
          requestPath: input.requestPath,
          checkedAt: statusResult.checkedAt,
          message: `Instagram media container status check failed: ${statusResult.message}`,
          creationId: input.creationId,
          verificationRequired: true,
        });
      }

      const status = readInstagramMediaContainerStatus(statusResult);
      if (!status) {
        return instagramPublishFailure({
          requestPath: input.requestPath,
          checkedAt: statusResult.checkedAt,
          message: "Instagram media container status response did not include a status.",
          creationId: input.creationId,
          verificationRequired: true,
        });
      }
      if (status === "FINISHED") {
        return null;
      }
      if (status === "ERROR" || status === "EXPIRED") {
        return instagramPublishFailure({
          requestPath: input.requestPath,
          checkedAt: statusResult.checkedAt,
          message: `Instagram media container status is ${status}.`,
          creationId: input.creationId,
        });
      }

      lastStatus = status ?? "missing";
      if (attempt < INSTAGRAM_MEDIA_CONTAINER_MAX_POLLS - 1) {
        await sleep(INSTAGRAM_MEDIA_CONTAINER_POLL_INTERVAL_MS);
      }
    }

    return instagramPublishFailure({
      requestPath: input.requestPath,
      checkedAt: lastCheckedAt,
      message: `Instagram media container did not finish processing before timeout. Last status: ${lastStatus}.`,
      creationId: input.creationId,
      verificationRequired: true,
    });
  }

  private async findInstagramPublishReadyRequest(input: {
    agent: AgentRecord;
    chatId: string;
  }): Promise<InstagramPublishReadyRequest | null> {
    const workspacePath = path.posix.join(
      rockyTaskOutputDirectory(input.chatId),
      INSTAGRAM_PUBLISH_REQUEST_FILE
    );
    const absolutePath = this.workspaceAbsolutePath(
      input.agent.workspaceRoot,
      workspacePath
    );
    if (!absolutePath) {
      return null;
    }

    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      return null;
    }

    if (
      !isInstagramPublishRequestApproved(payload) ||
      isTerminalInstagramPublishRequest(payload)
    ) {
      return null;
    }
    if (this.instagramPublishRequestClaims.has(absolutePath)) {
      return null;
    }
    this.instagramPublishRequestClaims.add(absolutePath);
    let claimPath: string | null = null;

    try {
      const publishExecutionId = randomUUID();
      claimPath = await this.tryClaimInstagramPublishRequestFile({
        absolutePath,
        workspacePath,
        chatId: input.chatId,
        publishExecutionId,
      });
      if (!claimPath) {
        this.instagramPublishRequestClaims.delete(absolutePath);
        return null;
      }

      const reparsed = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
      if (!reparsed || typeof reparsed !== "object" || Array.isArray(reparsed)) {
        await this.releaseInstagramPublishRequestFileClaim(claimPath);
        this.instagramPublishRequestClaims.delete(absolutePath);
        return null;
      }
      payload = reparsed as Record<string, unknown>;
      if (
        !isInstagramPublishRequestApproved(payload) ||
        isTerminalInstagramPublishRequest(payload)
      ) {
        await this.releaseInstagramPublishRequestFileClaim(claimPath);
        this.instagramPublishRequestClaims.delete(absolutePath);
        return null;
      }

      const caption = await this.readInstagramPublishCaption({
        agent: input.agent,
        payload,
      });
      const args = buildInstagramMediaPrepareArgs({ payload, caption });
      await this.attachPublicWorkspaceMediaUrl({
        agent: input.agent,
        payload,
        args,
      });

      const claimedPayload = {
        ...payload,
        status: "publishing",
        publish_execution_id: publishExecutionId,
        publish_started_at: this.now(),
      };
      await writeFile(
        absolutePath,
        `${JSON.stringify(claimedPayload, null, 2)}\n`,
        "utf8"
      );

      return {
        workspacePath,
        absolutePath,
        claimPath,
        payload: claimedPayload,
        args,
      };
    } catch (error) {
      if (claimPath) {
        await this.releaseInstagramPublishRequestFileClaim(claimPath);
      }
      this.instagramPublishRequestClaims.delete(absolutePath);
      throw error;
    }
  }

  private async tryClaimInstagramPublishRequestFile(input: {
    absolutePath: string;
    workspacePath: string;
    chatId: string;
    publishExecutionId: string;
  }): Promise<string | null> {
    const claimPath = path.join(
      path.dirname(input.absolutePath),
      INSTAGRAM_PUBLISH_REQUEST_CLAIM_FILE
    );
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(claimPath, "wx");
      await handle.writeFile(
        `${JSON.stringify(
          {
            chat_id: input.chatId,
            request_path: input.workspacePath,
            publish_execution_id: input.publishExecutionId,
            claimed_at: this.now(),
            process_id: process.pid,
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      return claimPath;
    } catch (error) {
      if (hasFilesystemErrorCode(error, "EEXIST")) {
        return null;
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private async releaseInstagramPublishRequestFileClaim(
    claimPath: string
  ): Promise<void> {
    try {
      await unlink(claimPath);
    } catch {
      // Leaving a stale claim is safer than risking a duplicate external publish.
    }
  }

  private async readInstagramPublishCaption(input: {
    agent: AgentRecord;
    payload: Record<string, unknown>;
  }): Promise<string | null> {
    const captionPath = readInstagramDraftCaptionField(input.payload, [
      "captionFile",
      "caption_file",
      "file",
    ]);
    if (captionPath) {
      const relativePath = normalizeWorkspaceRelativePath(captionPath);
      const absolutePath = relativePath
        ? this.workspaceAbsolutePath(input.agent.workspaceRoot, relativePath)
        : null;
      if (absolutePath) {
        try {
          const caption = (await readFile(absolutePath, "utf8")).trimEnd();
          if (caption) {
            return caption;
          }
        } catch {
          // Fall back to inline caption when the referenced file is unavailable.
        }
      }
    }

    return readInstagramDraftCaptionField(input.payload, [
      "caption",
      "content",
      "text",
    ]);
  }

  private async readInstagramConnectorStateForApproval(): Promise<{
    state: Awaited<ReturnType<ConnectorServiceLike["getState"]>> | null;
    error: unknown | null;
  }> {
    if (!this.connectorService) {
      return { state: null, error: new Error("Instagram connector is unavailable.") };
    }
    try {
      return {
        state: await this.connectorService.getState("instagram"),
        error: null,
      };
    } catch (error) {
      return { state: null, error };
    }
  }

  private instagramPublishApprovalBlocker(
    stateError: unknown,
    state: Awaited<ReturnType<ConnectorServiceLike["getState"]>> | null
  ): string | null {
    if (!this.connectorService) {
      return "Instagram 연결 상태를 확인할 수 없습니다. 연동 설정에서 Instagram Graph API 연결을 확인해 주세요.";
    }
    if (stateError) {
      return "Instagram 연결 상태를 확인하지 못했습니다. 연동 설정을 확인한 뒤 다시 시도해 주세요.";
    }
    if (!state || state.status !== "connected") {
      const nextAction = instagramApprovalCtaFromBlockers(state?.readiness.blockers);
      return nextAction
        ? `Instagram Graph API 연결이 필요합니다. ${nextAction}`
        : "Instagram Graph API 연결이 필요합니다. 연동 설정에서 Instagram 계정을 연결해 주세요.";
    }

    const requiredCapabilities = [
      "instagram.media.prepare",
      "instagram.media.publish",
      "instagram.media.status.read",
    ];
    for (const capabilityId of requiredCapabilities) {
      const capability = state.capabilities.find(
        (entry) => entry.id === capabilityId
      );
      if (!capability) {
        return "Instagram 발행 기능을 사용할 수 없습니다. 연동 설정에서 계정과 권한을 확인해 주세요.";
      }
      if (
        capability.status !== undefined &&
        capability.status !== "available"
      ) {
        if (
          capability.status === "planned" ||
          capability.status === "unsupported"
        ) {
          return "Instagram 발행 기능은 아직 사용할 수 없습니다. 현재는 초안 미리보기만 가능합니다.";
        }
        const nextAction =
          instagramApprovalCtaFromBlockers(capability.blockers) ??
          instagramApprovalCtaFromBlockers(state.readiness.blockers) ??
          capability.setupSteps?.map(sanitizeInstagramPublishPublicMessage).find(Boolean) ??
          "Instagram 계정과 발행 권한을 확인해 주세요.";
        return `Instagram 발행 준비가 필요합니다. ${nextAction}`;
      }
    }

    const publishCapability = state.capabilities.find(
      (entry) => entry.id === "instagram.media.publish"
    );
    if (publishCapability?.requiresApproval !== true) {
      return "Instagram 발행 승인 게이트를 확인할 수 없습니다. 연동 설정에서 발행 권한을 다시 확인해 주세요.";
    }

    return null;
  }

  private async buildInstagramPublishDraftFingerprint(input: {
    agent: AgentRecord;
    chatId: string;
    draft: {
      payload: Record<string, unknown>;
      workspacePath: string;
      absolutePath: string;
      updatedAt: string;
    };
    caption: string | null;
  }): Promise<string> {
    const media = readInstagramDraftMediaReference(input.draft.payload);
    let mediaIdentity: Record<string, unknown> | null = null;
    if (media?.source === "workspace") {
      const relativePath = normalizeWorkspaceRelativePath(media.value);
      const absolutePath = relativePath
        ? this.workspaceAbsolutePath(input.agent.workspaceRoot, relativePath)
        : null;
      let fileMetadata: Awaited<ReturnType<typeof stat>> | null = null;
      if (absolutePath) {
        try {
          fileMetadata = await stat(absolutePath);
        } catch {
          fileMetadata = null;
        }
      }
      mediaIdentity = {
        kind: media.kind,
        source: media.source,
        path: relativePath ?? media.value,
        size: fileMetadata?.size ?? null,
        mtimeMs: fileMetadata?.mtimeMs ?? null,
        contentType: absolutePath ? contentTypeForArtifactPath(absolutePath) : null,
      };
    } else if (media) {
      mediaIdentity = {
        kind: media.kind,
        source: media.source,
        value: media.value,
      };
    }

    return sha256Json({
      chatId: input.chatId,
      agentId: input.agent.id,
      workspacePath: input.draft.workspacePath,
      publishType: readInstagramDraftPublishType(input.draft.payload),
      targetAccount: readInstagramDraftTargetAccount(input.draft.payload),
      caption: input.caption,
      media: mediaIdentity,
    });
  }

  private async executeApprovedInstagramPublishDraft(input: {
    agent: AgentRecord;
    draft: {
      payload: Record<string, unknown>;
      workspacePath: string;
      absolutePath: string;
    };
    caption: string | null;
  }): Promise<InstagramPublishExecutionResult> {
    if (!this.connectorService) {
      return instagramPublishFailure({
        requestPath: input.draft.workspacePath,
        checkedAt: this.now(),
        message: "Instagram connector is unavailable.",
      });
    }

    let verificationRequiredOnError = false;
    try {
      const args = buildInstagramMediaPrepareArgs({
        payload: input.draft.payload,
        caption: input.caption,
      });
      await this.attachTemporaryHostedInstagramMediaUrl({
        agent: input.agent,
        payload: input.draft.payload,
        args,
      });

      const prepareResult = await this.connectorService.executeCapability("instagram", {
        capabilityId: "instagram.media.prepare",
        args,
      });
      if (!prepareResult.ok) {
        return instagramPublishFailure({
          requestPath: input.draft.workspacePath,
          checkedAt: prepareResult.checkedAt,
          message: prepareResult.message,
        });
      }

      const creationId = readCapabilityDataString(prepareResult, [
        "id",
        "creation_id",
        "creationId",
      ]);
      if (!creationId) {
        return instagramPublishFailure({
          requestPath: input.draft.workspacePath,
          checkedAt: prepareResult.checkedAt,
          message:
            "Instagram media.prepare completed without returning a creation_id.",
          verificationRequired: true,
        });
      }

      verificationRequiredOnError = true;
      const containerFailure = await this.waitForInstagramMediaContainerReady({
        creationId,
        requestPath: input.draft.workspacePath,
      });
      if (containerFailure) {
        return containerFailure;
      }

      const publishResult = await this.connectorService.executeCapability("instagram", {
        capabilityId: "instagram.media.publish",
        args: {
          approved: true,
          creationId,
        },
      });
      if (!publishResult.ok) {
        return instagramPublishFailure({
          requestPath: input.draft.workspacePath,
          checkedAt: publishResult.checkedAt,
          message: publishResult.message,
          creationId,
          verificationRequired: true,
        });
      }

      const mediaId = readCapabilityDataString(publishResult, [
        "id",
        "media_id",
        "mediaId",
      ]);
      if (!mediaId) {
        return instagramPublishFailure({
          requestPath: input.draft.workspacePath,
          checkedAt: publishResult.checkedAt,
          message:
            "Instagram media.publish completed without returning a media_id.",
          creationId,
          verificationRequired: true,
        });
      }

      let permalink: string | null = null;
      let publishedAt: string | null = null;
      let checkedAt = publishResult.checkedAt;
      let message = publishResult.message;
      const statusResult = await this.connectorService.executeCapability(
        "instagram",
        {
          capabilityId: "instagram.media.status.read",
          args: { mediaId },
        }
      );
      checkedAt = statusResult.checkedAt;
      if (statusResult.ok) {
        permalink = readCapabilityDataString(statusResult, ["permalink"]);
        publishedAt = readCapabilityDataString(statusResult, [
          "timestamp",
          "published_at",
          "publishedAt",
        ]);
      } else {
        return instagramPublishFailure({
          requestPath: input.draft.workspacePath,
          checkedAt: statusResult.checkedAt,
          message: `${publishResult.message} Status verification failed: ${statusResult.message}`,
          creationId,
          mediaId,
          verificationRequired: true,
        });
      }

      return {
        status: "published",
        requestPath: input.draft.workspacePath,
        checkedAt,
        message,
        creationId,
        mediaId,
        permalink,
        publishedAt,
      };
    } catch (error) {
      return instagramPublishFailure({
        requestPath: input.draft.workspacePath,
        checkedAt: this.now(),
        message: formatUnexpectedInstagramPublishError(error),
        verificationRequired: verificationRequiredOnError,
      });
    }
  }

  private async attachTemporaryHostedInstagramMediaUrl(input: {
    agent: AgentRecord;
    payload: Record<string, unknown>;
    args: Record<string, unknown>;
  }): Promise<void> {
    const media = readInstagramDraftMediaReference(input.payload);
    if (media?.source !== "workspace") {
      return;
    }

    const relativePath = normalizeWorkspaceRelativePath(media.value);
    const absolutePath = relativePath
      ? this.workspaceAbsolutePath(input.agent.workspaceRoot, relativePath)
      : null;
    if (!relativePath || !absolutePath || !(await this.fileExists(absolutePath))) {
      throw badRequest("Instagram Publish draft media file is unavailable.");
    }

    const uploaded = await this.instagramTemporaryMediaHost.upload({
      absolutePath,
      filename: path.posix.basename(relativePath),
      contentType: contentTypeForArtifactPath(absolutePath),
    });
    if (media.kind === "video") {
      input.args.videoUrl = uploaded.publicUrl;
      delete input.args.imageUrl;
    } else {
      input.args.imageUrl = uploaded.publicUrl;
      delete input.args.videoUrl;
    }
    delete input.args.imageFile;
    delete input.args.image_file;
    delete input.args.videoFile;
    delete input.args.video_file;
    delete input.args.mediaFile;
    delete input.args.media_file;
    delete input.args.file;
  }

  private instagramPublishApprovalStatePath(chatId: string): string {
    return path.join(
      resolveRockyChatPaths({ stateRoot: this.stateRoot, chatId }).chatRoot,
      "instagram-publish-approval.json"
    );
  }

  private async readInstagramPublishApprovalState(
    chatId: string
  ): Promise<InstagramPublishApprovalState | null> {
    try {
      const parsed = JSON.parse(
        await readFile(this.instagramPublishApprovalStatePath(chatId), "utf8")
      ) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      const record = parsed as Partial<InstagramPublishApprovalState>;
      const result = record.result;
      if (
        record.schemaVersion !== 1 ||
        typeof record.chatId !== "string" ||
        typeof record.agentId !== "string" ||
        typeof record.approvalId !== "string" ||
        typeof record.draftFingerprint !== "string" ||
        !result ||
        result.provider !== "instagram" ||
        (result.status !== "publishing" &&
          result.status !== "published" &&
          result.status !== "publish_failed" &&
          result.status !== "verification_required" &&
          result.status !== "already_published" &&
          result.status !== "blocked")
      ) {
        return null;
      }
      return record as InstagramPublishApprovalState;
    } catch (error) {
      if (hasFilesystemErrorCode(error, "ENOENT")) {
        return null;
      }
      return null;
    }
  }

  private async writeInstagramPublishApprovalState(
    state: InstagramPublishApprovalState
  ): Promise<void> {
    const targetPath = this.instagramPublishApprovalStatePath(state.chatId);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  private async writeInstagramPublishApprovalWorkspaceResult(input: {
    absolutePath: string;
    payload: Record<string, unknown>;
    result: RockyInstagramPublishApprovalRecord;
  }): Promise<void> {
    await writeFile(
      input.absolutePath,
      `${JSON.stringify(
        mergeInstagramApprovalPublishResult(input.payload, input.result),
        null,
        2
      )}\n`,
      "utf8"
    );
  }

  private async buildInstagramDraftMediaPreview(input: {
    agent: AgentRecord;
    payload: Record<string, unknown>;
  }): Promise<RockyInstagramPublishDraftPreviewMediaRecord | null> {
    const media = readInstagramDraftMediaReference(input.payload);
    if (!media) {
      return null;
    }

    if (media.source === "external") {
      return {
        kind: media.kind,
        label:
          media.kind === "video"
            ? "외부 영상 링크"
            : media.kind === "image"
              ? "외부 이미지 링크"
              : "외부 미디어 링크",
        contentType: null,
        previewUrl: null,
      };
    }

    const relativePath = normalizeWorkspaceRelativePath(media.value);
    const absolutePath = relativePath
      ? this.workspaceAbsolutePath(input.agent.workspaceRoot, relativePath)
      : null;
    const contentType = absolutePath ? contentTypeForArtifactPath(absolutePath) : null;
    const fileExists = absolutePath ? await this.fileExists(absolutePath) : false;
    const previewable = Boolean(
      relativePath &&
        contentType &&
        (contentType.startsWith("image/") || contentType.startsWith("video/")) &&
        absolutePath &&
        fileExists
    );

    return {
      kind: media.kind,
      label: path.posix.basename(relativePath ?? media.value),
      contentType,
      previewUrl: previewable ? workspaceFileContentPath(input.agent.id, relativePath!) : null,
    };
  }

  private instagramDraftPreviewBlocker(
    stateError: unknown,
    state: Awaited<ReturnType<ConnectorServiceLike["getState"]>> | null
  ): string | null {
    if (!this.connectorService) {
      return "Instagram 연결 상태를 확인할 수 없습니다. 연동 설정에서 Instagram Graph API 연결을 확인해 주세요.";
    }
    if (stateError) {
      return "Instagram 연결 상태를 확인하지 못했습니다. 연동 설정을 확인한 뒤 다시 시도해 주세요.";
    }
    if (!state || state.status !== "connected") {
      return "Instagram Graph API 연결이 필요합니다. 연동 설정에서 Instagram 계정을 연결해 주세요.";
    }

    const publishCapability = state.capabilities.find(
      (capability) => capability.id === "instagram.media.publish"
    );
    if (!publishCapability) {
      return "Instagram 발행 기능을 사용할 수 없습니다. 연동 설정에서 계정과 권한을 확인해 주세요.";
    }
    if (publishCapability.status === "available" || publishCapability.status === undefined) {
      return null;
    }
    if (publishCapability.status === "planned" || publishCapability.status === "unsupported") {
      return "Instagram 발행 기능은 아직 사용할 수 없습니다. 현재는 초안 미리보기만 가능합니다.";
    }

    const nextAction =
      publishCapability.setupSteps?.find(Boolean) ??
      publishCapability.blockers?.map((blocker) => blocker.nextAction).find(Boolean) ??
      "Instagram 계정과 발행 권한을 확인해 주세요.";
    return `Instagram 발행 준비가 필요합니다. ${nextAction}`;
  }

  private async findActiveInstagramPublishDraft(input: {
    agent: AgentRecord;
    chatId: string;
  }): Promise<
    | {
        payload: Record<string, unknown>;
        workspacePath: string;
        absolutePath: string;
        updatedAt: string;
      }
    | null
  > {
    const outputRoot = rockyTaskOutputDirectory(input.chatId);
    const absoluteRoot = this.workspaceAbsolutePath(input.agent.workspaceRoot, outputRoot);
    if (!absoluteRoot) {
      return null;
    }

    const candidates: Array<{
      payload: Record<string, unknown>;
      workspacePath: string;
      absolutePath: string;
      updatedAt: string;
      mtimeMs: number;
    }> = [];

    const visit = async (absoluteDirectory: string, relativeDirectory: string) => {
      let entries;
      try {
        entries = await readdir(absoluteDirectory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const workspacePath = path.posix.join(relativeDirectory, entry.name);
        const absolutePath = path.join(absoluteDirectory, entry.name);
        if (entry.isDirectory()) {
          await visit(absolutePath, workspacePath);
          continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) {
          continue;
        }

        let payload: Record<string, unknown>;
        let metadata: Awaited<ReturnType<typeof stat>>;
        try {
          const parsed = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            continue;
          }
          payload = parsed as Record<string, unknown>;
          metadata = await stat(absolutePath);
        } catch {
          continue;
        }

        if (!isActiveInstagramPublishDraftPayload({ payload, workspacePath })) {
          continue;
        }
        candidates.push({
          payload,
          workspacePath,
          absolutePath,
          updatedAt: metadata.mtime.toISOString(),
          mtimeMs: metadata.mtimeMs,
        });
      }
    };

    await visit(absoluteRoot, outputRoot);
    candidates.sort(
      (left, right) =>
        right.mtimeMs - left.mtimeMs || right.workspacePath.localeCompare(left.workspacePath)
    );

    return candidates[0] ?? null;
  }

  private async findKnownPublishedInstagramPublishApproval(input: {
    agent: AgentRecord;
    chatId: string;
  }): Promise<RockyInstagramPublishApprovalRecord | null> {
    const outputRoot = rockyTaskOutputDirectory(input.chatId);
    const absoluteRoot = this.workspaceAbsolutePath(input.agent.workspaceRoot, outputRoot);
    if (!absoluteRoot) {
      return null;
    }

    const candidates: Array<{
      payload: Record<string, unknown>;
      updatedAt: string;
      mtimeMs: number;
    }> = [];

    const visit = async (absoluteDirectory: string, relativeDirectory: string) => {
      let entries;
      try {
        entries = await readdir(absoluteDirectory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const workspacePath = path.posix.join(relativeDirectory, entry.name);
        const absolutePath = path.join(absoluteDirectory, entry.name);
        if (entry.isDirectory()) {
          await visit(absolutePath, workspacePath);
          continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) {
          continue;
        }

        let payload: Record<string, unknown>;
        let metadata: Awaited<ReturnType<typeof stat>>;
        try {
          const parsed = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            continue;
          }
          payload = parsed as Record<string, unknown>;
          metadata = await stat(absolutePath);
        } catch {
          continue;
        }

        if (
          !isInstagramPublishDraftPayload({ payload, workspacePath }) ||
          !readInstagramDraftKnownPublication(payload)
        ) {
          continue;
        }
        candidates.push({
          payload,
          updatedAt: metadata.mtime.toISOString(),
          mtimeMs: metadata.mtimeMs,
        });
      }
    };

    await visit(absoluteRoot, outputRoot);
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    const latest = candidates[0] ?? null;
    if (!latest) {
      return null;
    }

    const known = readInstagramDraftKnownPublication(latest.payload);
    if (!known) {
      return null;
    }
    const timestamp = this.now();
    return {
      provider: "instagram",
      status: "already_published",
      publishType: readInstagramDraftPublishType(latest.payload),
      targetAccountLabel:
        readInstagramDraftTargetAccount(latest.payload) ?? "Instagram 계정",
      permalink: known.permalink,
      publishedAt: known.publishedAt,
      message:
        "이 Instagram 초안은 이미 게시물 식별자 또는 링크가 있어 새 발행으로 재시도하지 않습니다. Instagram에서 게시 상태를 확인해 주세요.",
      approvedAt: latest.updatedAt,
      updatedAt: timestamp,
      completedAt: timestamp,
    };
  }

  private async findChatInstagramPublishDraftPreview(
    chat: RockyChatRecord
  ): Promise<RockyInstagramPublishDraftPreviewRecord | null> {
    const agent = await this.findChatDraftAgent(chat);
    if (!agent) {
      return null;
    }

    const draft = await this.findActiveInstagramPublishDraft({
      agent,
      chatId: chat.id,
    });
    if (!draft) {
      return null;
    }

    let connectorState: Awaited<ReturnType<ConnectorServiceLike["getState"]>> | null = null;
    let connectorStateError: unknown = null;
    if (this.connectorService) {
      try {
        connectorState = await this.connectorService.getState("instagram");
      } catch (error) {
        connectorStateError = error;
      }
    }

    const blocker = this.instagramDraftPreviewBlocker(
      connectorStateError,
      connectorState
    );
    const caption = await this.readInstagramPublishCaption({
      agent,
      payload: draft.payload,
    });
    const media = await this.buildInstagramDraftMediaPreview({
      agent,
      payload: draft.payload,
    });
    const targetAccountLabel =
      readInstagramDraftTargetAccount(draft.payload) ??
      connectorState?.accountLabel ??
      "Instagram 계정";

    return {
      provider: "instagram",
      status: blocker ? "blocked" : "ready",
      publishType: readInstagramDraftPublishType(draft.payload),
      targetAccountLabel,
      media,
      caption,
      blocker,
      updatedAt: draft.updatedAt,
    };
  }

  private async findChatDraftAgent(chat: RockyChatRecord): Promise<AgentRecord | null> {
    const agentId =
      [...chat.dispatches]
        .reverse()
        .find((dispatch) => dispatch.orchestration?.agentId)
        ?.orchestration?.agentId ??
      chat.worker?.agentId ??
      null;
    return this.findAgentById(agentId);
  }

  private async attachInstagramPublishDraftPreview(
    chat: RockyChatRecord
  ): Promise<RockyChatRecord> {
    let preview: RockyInstagramPublishDraftPreviewRecord | null = null;
    try {
      preview = await this.findChatInstagramPublishDraftPreview(chat);
    } catch {
      preview = null;
    }

    return {
      ...chat,
      instagramPublishDraftPreview: preview,
    };
  }

  private async attachPublicWorkspaceMediaUrl(input: {
    agent: AgentRecord;
    payload: Record<string, unknown>;
    args: Record<string, unknown>;
  }): Promise<void> {
    if (
      !this.publicWorkspaceBaseUrl ||
      readRecordString(input.args, ["imageUrl", "videoUrl"])
    ) {
      return;
    }

    const videoFile = readInstagramDraftMediaField(input.payload, [
      "videoFile",
      "video_file",
    ]);
    const imageFile = readInstagramDraftMediaField(input.payload, [
      "imageFile",
      "image_file",
      "mediaFile",
      "media_file",
      "file",
    ]);
    const localFile = videoFile ?? imageFile;
    if (!localFile) {
      return;
    }

    const relativePath = normalizeWorkspaceRelativePath(localFile);
    const absolutePath = relativePath
      ? this.workspaceAbsolutePath(input.agent.workspaceRoot, relativePath)
      : null;
    if (!relativePath || !absolutePath || !(await this.fileExists(absolutePath))) {
      return;
    }

    const publicUrl = buildPublicWorkspaceFileUrl({
      publicWorkspaceBaseUrl: this.publicWorkspaceBaseUrl,
      agentId: input.agent.id,
      workspacePath: relativePath,
    });
    if (videoFile) {
      input.args.videoUrl = publicUrl;
    } else {
      input.args.imageUrl = publicUrl;
    }
    delete input.args.imageFile;
  }

  private async writeInstagramPublishRequestResult(
    request: InstagramPublishReadyRequest,
    result: InstagramPublishExecutionResult
  ): Promise<void> {
    await writeFile(
      request.absolutePath,
      `${JSON.stringify(mergeInstagramPublishResult(request.payload, result), null, 2)}\n`,
      "utf8"
    );
  }

  private async finalizeServerManagedPublishesAfterAgentTurn(input: {
    agent: AgentRecord;
    chatId: string;
    request: string;
    orchestration: RockyOrchestrationRecord;
  }): Promise<RockyOrchestrationRecord> {
    // #92 exposes Instagram Publish drafts as read-only previews only. Graph
    // prepare/publish execution and temporary public media hosting are reserved
    // for the later explicit approval flow.
    return this.maybePublishTistoryDraftAfterAgentTurn(input);
  }

  private async listMarkdownWorkspacePaths(
    workspaceRoot: string,
    relativeRoot: string
  ): Promise<string[]> {
    const normalizedRoot = normalizeWorkspaceRelativePath(relativeRoot);
    if (!normalizedRoot) {
      return [];
    }
    const absoluteRoot = this.workspaceAbsolutePath(workspaceRoot, normalizedRoot);
    if (!absoluteRoot) {
      return [];
    }

    const results: string[] = [];
    const visit = async (absoluteDirectory: string, relativeDirectory: string) => {
      let entries;
      try {
        entries = await readdir(absoluteDirectory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const relativePath = path.posix.join(relativeDirectory, entry.name);
        const absolutePath = path.join(absoluteDirectory, entry.name);
        if (entry.isDirectory()) {
          await visit(absolutePath, relativePath);
          continue;
        }
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          results.push(relativePath);
        }
      }
    };

    await visit(absoluteRoot, normalizedRoot);
    return results;
  }

  private workspaceAbsolutePath(
    workspaceRoot: string,
    relativePath: string
  ): string | null {
    const root = path.resolve(workspaceRoot);
    const absolutePath = path.resolve(root, ...relativePath.split("/"));
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
      return null;
    }
    return absolutePath;
  }

  private async readExistingEcountLookups(
    agent: AgentRecord,
    chatId: string,
    datasets: EcountDatasetId[]
  ): Promise<AgentPreparedIntegrationSummary[]> {
    const paths = new Map<string, string>();
    for (const dataset of datasets) {
      paths.set(dataset, ecountDatasetLookupWorkspacePath(chatId, dataset));
    }

    if (datasets.includes("products")) {
      paths.set("products:legacy", legacyEcountProductLookupWorkspacePath(chatId));
    }

    if (datasets.length === 0) {
      const integrationDir = path.join(
        agent.workspaceRoot,
        ...path.posix.join(rockyTaskInputDirectory(chatId), "integrations", "ecount").split("/")
      );
      try {
        for (const fileName of await readdir(integrationDir)) {
          if (!fileName.endsWith(".json")) {
            continue;
          }
          const dataset = fileName.replace(/\.json$/u, "");
          paths.set(dataset, path.posix.join(rockyTaskInputDirectory(chatId), "integrations", "ecount", fileName));
        }
      } catch {
        // No prepared standard integration directory for this chat yet.
      }
      paths.set("products:legacy", legacyEcountProductLookupWorkspacePath(chatId));
    }

    const summaries: AgentPreparedIntegrationSummary[] = [];
    const seenDatasets = new Set<string>();
    for (const [key, workspacePath] of paths) {
      const absolutePath = path.join(agent.workspaceRoot, ...workspacePath.split("/"));
      try {
        const parsed = JSON.parse(await readFile(absolutePath, "utf8")) as {
          dataset?: string;
          title?: string;
          status?: "ready" | "failed" | "unsupported" | "not-configured";
          api?: string | null;
          count?: number;
          returnedCount?: number;
          checkedAt?: string;
          message?: string;
          diagnostics?: { detail?: string };
        };
        const dataset = parsed.dataset ?? (key === "products:legacy" ? "products" : key);
        if (seenDatasets.has(dataset)) {
          continue;
        }
        seenDatasets.add(dataset);
        summaries.push({
          provider: "ecount",
          dataset,
          title: parsed.title ?? ecountDatasetTitle(dataset),
          status: parsed.status ?? "ready",
          api: typeof parsed.api === "string" ? parsed.api : null,
          count: typeof parsed.count === "number" ? parsed.count : null,
          returnedCount:
            typeof parsed.returnedCount === "number" ? parsed.returnedCount : null,
          checkedAt: typeof parsed.checkedAt === "string" ? parsed.checkedAt : null,
          workspacePath,
          message: parsed.message ?? "Previous ECOUNT lookup result is available.",
          diagnostic: parsed.diagnostics?.detail ?? null,
          source: "existing",
        });
      } catch {
        // Ignore missing or stale lookup files.
      }
    }
    return summaries;
  }

  private async queryEcountDataset(
    connectionInput: Awaited<ReturnType<EcountSettingsServiceLike["getConnectionInput"]>>,
    query: EcountDatasetQueryInput
  ): Promise<EcountDatasetQueryResult> {
    if (!connectionInput) {
      return unsupportedEcountDatasetResult(query.dataset as EcountDatasetId);
    }
    if (this.ecountLookupService.queryDataset) {
      return this.ecountLookupService.queryDataset(connectionInput, query);
    }
    const dataset = normalizeEcountDatasetId(String(query.dataset));
    if (dataset === "products") {
      return ecountProductLookupToDatasetResult(
        await this.ecountLookupService.getBasicProductsList(connectionInput, {
          limit: query.limit,
          offset: query.offset,
        })
      );
    }
    return {
      ...unsupportedEcountDatasetResult(dataset as EcountDatasetId),
      checkedAt: this.now(),
    };
  }

  private async prepareEcountSalesExport(input: {
    agent: AgentRecord;
    chatId: string;
  }): Promise<AgentPreparedIntegrationSummary> {
    const workspacePath = ecountDatasetLookupWorkspacePath(input.chatId, "sales");
    const absolutePath = path.join(input.agent.workspaceRoot, ...workspacePath.split("/"));
    await mkdir(path.dirname(absolutePath), { recursive: true });

    const webLogin = await this.ecountSettingsService.getWebLoginInput();
    if (!webLogin) {
      const document = {
        provider: "ecount",
        dataset: "sales",
        title: ecountDatasetTitle("sales"),
        status: "not-configured",
        api: "browser:E040206",
        accountLabel: null,
        zone: null,
        checkedAt: this.now(),
        count: 0,
        returnedCount: 0,
        records: [],
        message: "ECOUNT web login settings are not configured for sales export.",
        diagnostics: {
          stage: "capability",
          detail: "Complete ECOUNT ERP web login settings for 판매조회 Browser Assist.",
        },
        export: null,
      };
      await writeFile(absolutePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
      return {
        provider: "ecount",
        dataset: "sales",
        title: document.title,
        status: "not-configured",
        api: document.api,
        count: 0,
        returnedCount: 0,
        checkedAt: document.checkedAt,
        workspacePath,
        message: document.message,
        diagnostic: document.diagnostics.detail,
        source: "settings",
      };
    }

    const checkedAt = this.now();
    const dates = defaultEcountSalesExportDates(checkedAt);
    const outputWorkspaceDir = ecountSalesExportDirectoryWorkspacePath(input.chatId);
    const outputDir = path.join(input.agent.workspaceRoot, ...outputWorkspaceDir.split("/"));
    const result = await this.ecountSalesExportService.exportSalesExcel({
      login: webLogin,
      outputDir,
      fromDate: dates.fromDate,
      toDate: dates.toDate,
    });
    const exportWorkspacePath = result.fileName
      ? ecountSalesExportWorkspacePath(input.chatId, result.fileName)
      : null;
    const status = result.ok ? "ready" : "failed";
    const document = {
      provider: "ecount",
      dataset: "sales",
      title: ecountDatasetTitle("sales"),
      status,
      api: "browser:E040206",
      accountLabel: result.accountLabel,
      zone: null,
      checkedAt: result.checkedAt,
      count: 0,
      returnedCount: 0,
      records: [],
      message: result.message,
      diagnostics: result.diagnostics ?? null,
      filters: result.filters,
      export: result.ok
        ? {
            programId: result.programId,
            fileName: result.fileName,
            byteSize: result.byteSize,
            workspacePath: exportWorkspacePath,
          }
        : null,
    };
    await writeFile(absolutePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    return {
      provider: "ecount",
      dataset: "sales",
      title: document.title,
      status,
      api: document.api,
      count: 0,
      returnedCount: 0,
      checkedAt: result.checkedAt,
      workspacePath,
      message: result.message,
      diagnostic: result.diagnostics?.detail ?? (exportWorkspacePath ? `export=${exportWorkspacePath}` : null),
      source: "fresh",
    };
  }

  private async prepareEcountLookups(input: {
    agent: AgentRecord;
    chatId: string;
    message: string;
    selectedSkillId: string | null;
    skillContexts: Array<{ skill: AgentLocalSkillRecord; content: string }>;
  }): Promise<AgentPreparedIntegrationSummary[]> {
    const messageDatasets = extractEcountDatasets(input.message);
    const skillDatasets = uniqueEcountDatasets(
      input.skillContexts.flatMap((context) => extractEcountDatasets(context.content))
    );
    const useSkillScope =
      input.skillContexts.length > 0 &&
      (messageDatasets.length === 0 || shouldUseSkillScopeForEcountLookup(input.message));
    const requestedDatasets = uniqueEcountDatasets(
      useSkillScope
        ? skillDatasets.length > 0
          ? skillDatasets
          : DEFAULT_ECOUNT_SKILL_DATASETS
        : messageDatasets
    );
    const shouldPrepare = shouldPrepareEcountLookup({
      message: input.message,
      hasSelectedEcountSkill: Boolean(input.selectedSkillId && input.skillContexts.length > 0),
      messageDatasets,
    });
    const existing = await this.readExistingEcountLookups(
      input.agent,
      input.chatId,
      requestedDatasets
    );
    if (!shouldPrepare) {
      return existing;
    }

    const datasets: EcountDatasetId[] = requestedDatasets.length > 0
      ? requestedDatasets
      : shouldPrepareEcountProductLookup(input.message)
        ? ["products"]
        : DEFAULT_ECOUNT_SKILL_DATASETS;
    const connectionInput = await this.ecountSettingsService.getConnectionInput();

    const summaries: AgentPreparedIntegrationSummary[] = [];
    for (const dataset of datasets) {
      if (dataset === "sales") {
        summaries.push(await this.prepareEcountSalesExport(input));
        continue;
      }

      if (!connectionInput) {
        summaries.push({
          provider: "ecount",
          dataset,
          title: ecountDatasetTitle(dataset),
          status: "not-configured",
          api: null,
          count: null,
          returnedCount: null,
          checkedAt: null,
          workspacePath: null,
          message: "ECOUNT Open API connection settings are not configured.",
          diagnostic: null,
          source: "settings",
        });
        continue;
      }

      const query: EcountDatasetQueryInput = {
        ...ecountQueryOptionsForDataset(dataset),
        dataset,
      };
      const result = await this.queryEcountDataset(connectionInput, query);
      const workspacePath = ecountDatasetLookupWorkspacePath(input.chatId, dataset);
      const absolutePath = path.join(input.agent.workspaceRoot, ...workspacePath.split("/"));
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(
        absolutePath,
        `${JSON.stringify(
          {
            provider: "ecount",
            dataset: result.dataset,
            title: result.title,
            status: result.status,
            api: result.api,
            accountLabel: result.accountLabel,
            zone: result.zone,
            checkedAt: result.checkedAt,
            count: result.count,
            returnedCount: result.returnedCount,
            records: result.records,
            message: result.message,
            diagnostics: result.diagnostics ?? null,
            filters: query.filters ?? null,
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      summaries.push(ecountResultToPreparedSummary(result, workspacePath, "fresh"));
    }
    return summaries;
  }

  private async resolveAgentEcountLookupInstruction(input: {
    agent: AgentRecord;
    chatId: string;
    message: string;
    selectedSkillId: string | null;
  }): Promise<AgentEcountLookupInstruction | null> {
    const skillContexts = await this.listAgentEcountSkillContexts(
      input.agent,
      input.selectedSkillId
    );
    if (skillContexts.length === 0) {
      return null;
    }

    let configured = false;
    try {
      const settings = await this.ecountSettingsService.getPublicSettings();
      configured = settings.configured || settings.webLoginConfigured;
    } catch {
      configured = false;
    }

    return {
      configured,
      preparedResults: configured
        ? await this.prepareEcountLookups({
            ...input,
            skillContexts,
          })
        : [],
    };
  }

  private async prepareAgentConnectorLookups(input: {
    agent: AgentRecord;
    chatId: string;
    message: string;
    selectedSkillId: string | null;
    connectorSummaries: AgentConnectorSummary[];
  }): Promise<AgentPreparedIntegrationSummary[]> {
    if (!this.connectorService) {
      return [];
    }

    const summaries: AgentPreparedIntegrationSummary[] = [];

    if (shouldPrepareThreadsFollowerLookup(input.message)) {
      const threads = input.connectorSummaries.find(
        (summary) =>
          summary.provider === "threads" &&
          summary.status === "connected" &&
          hasAvailableConnectorCapability(summary, "threads.followers.read"),
      );
      if (threads) {
        const result = await this.connectorService.executeCapability("threads", {
          capabilityId: "threads.followers.read",
          args: { limit: 200 },
        });
        const workspacePath = threadsFollowerLookupWorkspacePath(input.chatId);
        const absolutePath = path.join(
          input.agent.workspaceRoot,
          ...workspacePath.split("/"),
        );
        const count = result.followers?.items.length ?? null;
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(
          absolutePath,
          `${JSON.stringify(
            {
              provider: "threads",
              dataset: "followers",
              title: "Threads 팔로워 목록",
              ok: result.ok,
              status: result.status,
              capabilityId: result.capabilityId,
              accountLabel: result.accountLabel,
              checkedAt: result.checkedAt,
              count,
              followers: result.followers?.items ?? [],
              url: result.followers?.url ?? null,
              rawText: result.followers?.rawText ?? null,
              message: result.message,
            },
            null,
            2,
          )}\n`,
          "utf8",
        );

        summaries.push({
          provider: "threads",
          dataset: "followers",
          title: "Threads 팔로워 목록",
          status: result.ok
            ? "ready"
            : result.status === "unsupported"
              ? "unsupported"
              : "failed",
          api: null,
          count,
          returnedCount: count,
          checkedAt: result.checkedAt,
          workspacePath,
          message: result.message,
          diagnostic: result.ok ? null : result.message,
          source: "fresh",
        });
      }
    }

    const instagram = input.connectorSummaries.find(
      (summary) => summary.provider === "instagram"
    );
    if (
      instagram &&
      shouldPrepareInstagramConnectorLookup({
        message: input.message,
        selectedSkillId: input.selectedSkillId,
        summary: instagram,
      })
    ) {
      if (shouldPrepareInstagramFollowingUnsupported(input.message)) {
        const workspacePath = instagramFollowingUnsupportedWorkspacePath(
          input.chatId,
        );
        const absolutePath = path.join(
          input.agent.workspaceRoot,
          ...workspacePath.split("/"),
        );
        const message =
          "Instagram Graph API does not officially provide a following account list endpoint. Use officially supported Instagram Graph API capabilities only.";
        const checkedAt = this.now();
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(
          absolutePath,
          `${JSON.stringify(
            {
              provider: "instagram",
              dataset: "following",
              title: "Instagram 팔로잉 목록",
              ok: false,
              status: "unsupported",
              capabilityId: "instagram.following.read",
              accountLabel: instagram.accountLabel,
              checkedAt,
              message,
              officialSupport: false,
              supportedOfficialCapabilities: instagram.capabilities
                .filter(
                  (capability) =>
                    capability.status === undefined ||
                    capability.status === "available",
                )
                .map((capability) => capability.id)
                .sort(),
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        summaries.push({
          provider: "instagram",
          dataset: "following",
          title: "Instagram 팔로잉 목록",
          status: "unsupported",
          api: null,
          count: null,
          returnedCount: null,
          checkedAt,
          workspacePath,
          message,
          diagnostic: null,
          source: "fresh",
        });
      }

      const capabilityId =
        shouldPrepareInstagramAutomation(input.message) ||
        shouldPrepareSelectedConnectorFollowup(input.message)
          ? "instagram.automation.prepare"
          : "instagram.account.read";
      const workspacePath =
        capabilityId === "instagram.automation.prepare"
          ? instagramAutomationReadinessWorkspacePath(input.chatId)
          : instagramAccountReadinessWorkspacePath(input.chatId);
      if (hasAvailableConnectorCapability(instagram, capabilityId)) {
        const result = await this.connectorService.executeCapability("instagram", {
          capabilityId,
        });
        const absolutePath = path.join(input.agent.workspaceRoot, ...workspacePath.split("/"));
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(
          absolutePath,
          `${JSON.stringify(
            {
              provider: "instagram",
              dataset:
                capabilityId === "instagram.automation.prepare"
                  ? "automation-readiness"
                  : "account-readiness",
              title:
                capabilityId === "instagram.automation.prepare"
                  ? "Instagram automation readiness"
                  : "Instagram account readiness",
              ok: result.ok,
              status: result.status,
              capabilityId: result.capabilityId,
              accountLabel: result.accountLabel,
              checkedAt: result.checkedAt,
              message: result.message,
            },
            null,
            2
          )}\n`,
          "utf8"
        );

        summaries.push({
          provider: "instagram",
          dataset:
            capabilityId === "instagram.automation.prepare"
              ? "automation-readiness"
              : "account-readiness",
          title:
            capabilityId === "instagram.automation.prepare"
              ? "Instagram automation readiness"
              : "Instagram account readiness",
          status: result.ok
            ? "ready"
            : result.status === "unsupported"
              ? "unsupported"
              : "failed",
          api: null,
          count: null,
          returnedCount: null,
          checkedAt: result.checkedAt,
          workspacePath,
          message: result.message,
          diagnostic: result.ok ? null : result.message,
          source: "fresh",
        });
      }
    }

    return summaries;
  }

  private async prepareAgentConnectorProfileResults(input: {
    message: string;
    connectorSummaries: AgentConnectorSummary[];
  }): Promise<AgentConnectorProfileSummary[]> {
    if (!this.connectorService || !shouldPrepareFacebookProfileLookup(input.message)) {
      return [];
    }

    const facebook = input.connectorSummaries.find(
      (summary) =>
        summary.provider === "facebook" &&
        summary.status === "connected" &&
        hasAvailableConnectorCapability(summary, "facebook.profile.read")
    );
    if (!facebook) {
      return [];
    }

    const result = await this.connectorService.executeCapability("facebook", {
      capabilityId: "facebook.profile.read",
    });
    return [
      {
        provider: "facebook",
        label: facebook.label,
        status: result.ok
          ? "ready"
          : result.status === "unsupported"
            ? "unsupported"
            : "failed",
        accountLabel: result.accountLabel,
        profile: result.profile,
        message: result.message,
        checkedAt: result.checkedAt,
      },
    ];
  }

  private async resolveUsedSkills(
    agent: AgentRecord,
    refs: string[]
  ): Promise<RockyUsedSkillRecord[]> {
    if (refs.length === 0) {
      return [];
    }

    const skills = await this.agentLocalSkillService.listAgentLocalSkills(agent);
    const templatesBySkillId = await this.savedSkillTemplateBySkillId();
    const byRef = new Map<string, RockyUsedSkillRecord>();
    for (const skill of skills) {
      const template = templatesBySkillId.get(skill.id);
      const displayName = template
        ? this.savedTemplateDisplayName(template)
        : skill.displayName;
      const usedSkill = {
        id: skill.id,
        displayName,
      } satisfies RockyUsedSkillRecord;
      byRef.set(normalizeSkillRef(skill.id), usedSkill);
      byRef.set(normalizeSkillRef(skill.invocation), usedSkill);
      byRef.set(normalizeSkillRef(skill.displayName), usedSkill);
      byRef.set(normalizeSkillRef(displayName), usedSkill);
    }

    const resolved: RockyUsedSkillRecord[] = [];
    const seen = new Set<string>();
    for (const ref of refs) {
      const skill = byRef.get(normalizeSkillRef(ref));
      if (!skill || seen.has(skill.id)) {
        continue;
      }
      seen.add(skill.id);
      resolved.push(skill);
    }

    return resolved;
  }

  private async resolveUsedSkillsByAgentId(
    agentId: string | null,
    refs: string[]
  ): Promise<RockyUsedSkillRecord[]> {
    if (!agentId || refs.length === 0) {
      return [];
    }
    const agent = await this.findAgentById(agentId);
    return agent ? this.resolveUsedSkills(agent, refs) : [];
  }

  private sanitizeOrchestrationOutput(
    orchestration: RockyOrchestrationRecord
  ): {
    orchestration: RockyOrchestrationRecord;
    usedSkillRefs: string[];
  } {
    if (!orchestration.output) {
      return { orchestration, usedSkillRefs: [] };
    }

    const extracted = extractUsedSkillRefs(orchestration.output);
    const sanitizedText = sanitizeInstagramPublishUserText(extracted.text);
    return {
      orchestration:
        sanitizedText === orchestration.output
          ? orchestration
          : {
              ...orchestration,
              output: sanitizedText || null,
            },
      usedSkillRefs: extracted.refs,
    };
  }

  private async handleAgentMessage(input: {
    agent: AgentRecord;
    chatId: string;
    messageId: string;
    message: string;
    runtimeMessage: string;
    selectedSkillId: string | null;
    attachments: Array<RockyAttachmentRecord | RockyAttachmentDraft>;
    domain: RockyChatDomain;
    intent: RockyRoutingIntent;
    reuseSessionId: string | null;
    timestamp: string;
  }): Promise<RockyMessageRouteResult> {
    await this.syncAgentTemplateSkills(input.agent);
    await ensureWorkspaceSkillBridge(input.agent.workspaceRoot);
    const { skill, worker } = await this.ensureAgentWorker({
      agent: input.agent,
      timestamp: input.timestamp,
    });
    const attachments = await this.materializeAttachmentUploads({
      agent: input.agent,
      chatId: input.chatId,
      attachments: input.attachments,
    });
    await this.ensureTaskFileWorkspace(input.agent, input.chatId);
    const selectedUsedSkills = await this.resolveUsedSkills(
      input.agent,
      input.selectedSkillId ? [input.selectedSkillId] : []
    );
    const ecountLookup = await this.resolveAgentEcountLookupInstruction({
      agent: input.agent,
      chatId: input.chatId,
      message: input.message,
      selectedSkillId: input.selectedSkillId,
    });
    const connectorSummaries = await this.listAgentConnectorSummaries(input.agent);
    const connectorProfileResults = await this.prepareAgentConnectorProfileResults({
      message: input.message,
      connectorSummaries,
    });
    const preparedConnectorLookups = await this.prepareAgentConnectorLookups({
      agent: input.agent,
      chatId: input.chatId,
      message: input.message,
      selectedSkillId: input.selectedSkillId,
      connectorSummaries,
    });
    const preparedIntegrations = [
      ...(ecountLookup?.preparedResults ?? []),
      ...preparedConnectorLookups,
    ];
    const hasTistoryDraftPublisher = connectorSummaries.some(
      (summary) =>
        summary.provider === "tistory" &&
        summary.status === "connected" &&
        summary.draftPublishing === "server-managed"
    );
    const hasConnectedBrowserConnector = connectorSummaries.some(
      (summary) =>
        summary.status === "connected" &&
        summary.loginMode === "custom-browser"
    );
    const hasConnectorCapabilityContext = connectorSummaries.some(
      (summary) => summary.capabilities.length > 0
    );
    const hasServerManagedConnectorContext = connectorSummaries.some(
      (summary) =>
        summary.capabilities.some(
          (capability) => capability.executionOwner === "rocky-server",
        ),
    );
    const skillCandidates: RockySkillCandidateRecord[] = [];
    const dispatch = this.buildDispatch({
      chatId: input.chatId,
      messageId: input.messageId,
      skill,
      intent: input.intent,
      domain: input.domain,
      workerId: worker.id,
      attachments,
      message: input.message,
      skillCandidates,
      timestamp: input.timestamp,
    });
    const contextRelativePath = await writeAgentTurnContextFile({
      agent: input.agent,
      chatId: input.chatId,
      dispatch,
      attachments,
      preparedIntegrations,
      connectorProfileResults,
      connectorSummaries,
      timestamp: input.timestamp,
    });
    const startedOrchestration = await this.orchestrator.start({
      chatId: input.chatId,
      domain: input.domain,
      message: input.runtimeMessage,
      worker,
      dispatch,
      attachments,
      skillCandidates,
      skill,
      protectionHints: dispatch.protectionHints,
      reuseSessionId: input.reuseSessionId,
      timestamp: input.timestamp,
      extraSystemInstructions: buildAgentTurnSystemInstructions({
        agent: input.agent,
        contextRelativePath,
        chatId: input.chatId,
        ecountLookup,
        hasTistoryDraftPublisher,
        hasConnectorCapabilityContext,
        hasServerManagedConnectorContext,
        hasConnectedBrowserConnector,
        hasConnectorProfileResults: connectorProfileResults.length > 0,
        hasPreparedIntegrationResults: preparedIntegrations.length > 0,
      }),
    });
    const currentOrchestration = isActiveOrchestrationStatus(
      startedOrchestration.status
    )
      ? startedOrchestration
      : await this.orchestrator.refresh(startedOrchestration);
    const sanitized = this.sanitizeOrchestrationOutput(currentOrchestration);
    const finalizedOrchestration = await this.finalizeServerManagedPublishesAfterAgentTurn({
      agent: input.agent,
      chatId: input.chatId,
      request: input.message,
      orchestration: sanitized.orchestration,
    });
    const reportedUsedSkills = await this.resolveUsedSkills(
      input.agent,
      sanitized.usedSkillRefs
    );
    const usedSkills = mergeUsedSkills(selectedUsedSkills, reportedUsedSkills);
    const startedDispatch: RockyDispatchRecord = {
      ...dispatch,
      orchestration: finalizedOrchestration,
      executionStarted: Boolean(finalizedOrchestration.runId),
    };

    return {
      worker,
      attachments,
      skillCandidates,
      dispatch: startedDispatch,
      rockyMessage: this.buildCoreRockyMessage({
        chatId: input.chatId,
        domain: input.domain,
        intent: input.intent,
        worker,
        dispatchId: startedDispatch.id,
        orchestration: finalizedOrchestration,
        usedSkills,
        timestamp: input.timestamp,
      }),
    };
  }

  private async handleRockyCoreMessage(input: {
    chatId: string;
    messageId: string;
    message: string;
    attachments: Array<RockyAttachmentRecord | RockyAttachmentDraft>;
    domain: RockyChatDomain;
    intent: RockyRoutingIntent;
    skill: RockyOrchestrationSkill;
    selectionReason: string;
    reuseCoreSessionId: string | null;
    awaitingSkillDelete: boolean;
    timestamp: string;
  }): Promise<RockyMessageRouteResult> {
    const { agent, worker } = await this.ensureCoreWorker({
      skill: input.skill,
      reason: input.selectionReason,
      timestamp: input.timestamp,
    });
    const attachments = await this.materializeAttachmentUploads({
      agent,
      chatId: input.chatId,
      attachments: input.attachments,
    });
    const localSkillManagementMessage =
      await this.tryHandleLocalSkillManagementMessage({
        agent,
        worker,
        chatId: input.chatId,
        domain: input.domain,
        intent: input.intent,
        message: input.message,
        awaitingSkillDelete: input.awaitingSkillDelete,
        timestamp: input.timestamp,
      });
    if (localSkillManagementMessage) {
      return {
        worker,
        attachments,
        skillCandidates: [],
        dispatch: null,
        rockyMessage: localSkillManagementMessage,
      };
    }
    if (agent) {
      await this.ensureTaskFileWorkspace(agent, input.chatId);
    }
    const skillCandidates: RockySkillCandidateRecord[] = [];
    const dispatch = this.buildDispatch({
      chatId: input.chatId,
      messageId: input.messageId,
      skill: input.skill,
      intent: input.intent,
      domain: input.domain,
      workerId: worker.id,
      attachments,
      message: input.message,
      skillCandidates,
      timestamp: input.timestamp,
    });
    const extraSystemInstructions = await this.buildExtraSystemInstructions({
      agent,
      chatId: input.chatId,
      dispatch,
      domain: input.domain,
      skill: input.skill,
      message: input.message,
      attachments,
      skillCandidates,
      timestamp: input.timestamp,
    });
    const settings = await this.readCoreSettings();
    const orchestration = await this.orchestrator.start({
      chatId: input.chatId,
      domain: input.domain,
      message: input.message,
      worker,
      dispatch,
      attachments,
      skillCandidates,
      skill: input.skill,
      protectionHints: dispatch.protectionHints,
      reuseSessionId: input.reuseCoreSessionId,
      defaultRuntimeKind: settings.defaultRuntimeKind,
      defaultOllamaLaunchTarget: settings.defaultOllamaLaunchTarget,
      defaultModel: settings.defaultModel,
      defaultReasoningEffort: settings.defaultReasoningEffort,
      defaultServiceTier: settings.defaultServiceTier,
      timestamp: input.timestamp,
      extraSystemInstructions,
    });
    const startedDispatch: RockyDispatchRecord = {
      ...dispatch,
      orchestration,
      executionStarted: Boolean(orchestration.runId),
    };

    return {
      worker,
      attachments,
      skillCandidates,
      dispatch: startedDispatch,
      rockyMessage: this.buildCoreRockyMessage({
        chatId: input.chatId,
        domain: input.domain,
        intent: input.intent,
        worker,
        dispatchId: startedDispatch.id,
        orchestration,
        timestamp: input.timestamp,
      }),
    };
  }

  private async materializeAttachmentUploads(input: {
    agent: AgentRecord | null;
    chatId: string;
    attachments: Array<RockyAttachmentRecord | RockyAttachmentDraft>;
  }): Promise<RockyAttachmentRecord[]> {
    return Promise.all(
      input.attachments.map(async (attachment) => {
        const draft = attachment as Partial<RockyAttachmentDraft>;
        const contentBase64 = draft.contentBase64?.trim();
        const existingRecord = {
          id: attachment.id,
          name: attachment.name,
          contentType: attachment.contentType,
          size: attachment.size,
          workspacePath: attachment.workspacePath ?? null,
          publicUrl: attachment.publicUrl ?? null,
          addedAt: attachment.addedAt,
        } satisfies RockyAttachmentRecord;

        if (!input.agent || !contentBase64 || existingRecord.workspacePath) {
          return existingRecord;
        }

        const body = Buffer.from(contentBase64, "base64");
        const safeName = sanitizeUploadedFilename(existingRecord.name);
        const workspacePath = path.posix.join(
          rockyTaskAttachmentDirectory(input.chatId, existingRecord.id),
          safeName
        );
        const absolutePath = path.join(
          input.agent.workspaceRoot,
          ...workspacePath.split("/")
        );

        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, body);

        return {
          ...existingRecord,
          size: existingRecord.size ?? body.byteLength,
          workspacePath,
        };
      })
    );
  }

  private async ensureTaskFileWorkspace(
    agent: AgentRecord,
    chatId: string
  ): Promise<void> {
    await Promise.all(
      [rockyTaskInputDirectory(chatId), rockyTaskOutputDirectory(chatId)].map(
        async (relativePath) => {
          await mkdir(
            path.join(agent.workspaceRoot, ...relativePath.split("/")),
            { recursive: true }
          );
        }
      )
    );
  }

  private async buildExtraSystemInstructions(input: {
    agent: AgentRecord | null;
    chatId: string;
    dispatch: RockyDispatchRecord;
    domain: RockyChatDomain;
    skill: RockyOrchestrationSkill;
    message: string;
    attachments: RockyAttachmentRecord[];
    skillCandidates: RockySkillCandidateRecord[];
    timestamp: string;
  }): Promise<string[]> {
    if (!input.agent) {
      return [];
    }

    const extraSystemInstructions = buildRockyTurnSystemInstructions({
      skill: input.skill,
      chatId: input.chatId,
      contextRelativePath: await writeRockyTurnContextFile({
        agent: input.agent,
        chatId: input.chatId,
        dispatch: input.dispatch,
        domain: input.domain,
        skill: input.skill,
        attachments: input.attachments,
        skillCandidates: input.skillCandidates,
        protectionHints: input.dispatch.protectionHints,
        timestamp: input.timestamp,
      }),
    });

    return extraSystemInstructions;
  }

  private protectedCoreSkillIds(): string[] {
    return ROCKY_ORCHESTRATION_SKILLS.map((skill) => skill.id);
  }

  private isAwaitingSkillDelete(chat: RockyChatRecord): boolean {
    const lastRockyMessage = [...chat.messages]
      .reverse()
      .find((message) => message.role === "rocky");

    return Boolean(
      lastRockyMessage?.text.includes(SKILL_DELETE_FOLLOWUP_MARKER)
    );
  }

  private buildLocalRockyMessage(input: {
    chatId: string;
    domain: RockyChatDomain;
    intent: RockyRoutingIntent;
    worker: RockyWorkerRecord;
    text: string;
    timestamp: string;
  }): RockyMessageRecord {
    return {
      id: `message-${this.idGenerator()}`,
      chatId: input.chatId,
      role: "rocky",
      intent: input.intent,
      text: input.text,
      attachmentIds: [],
      domain: input.domain,
      workerId: input.worker.id,
      skillCandidateIds: [],
      usedSkills: [],
      dispatchId: null,
      createdAt: input.timestamp,
    };
  }

  private async tryHandleLocalSkillManagementMessage(input: {
    agent: AgentRecord | null;
    worker: RockyWorkerRecord;
    chatId: string;
    domain: RockyChatDomain;
    intent: RockyRoutingIntent;
    message: string;
    awaitingSkillDelete: boolean;
    timestamp: string;
  }): Promise<RockyMessageRecord | null> {
    if (!input.agent) {
      return null;
    }

    const skills = await this.agentLocalSkillService.listAgentLocalSkills(input.agent);
    const protectedSkillIds = new Set(this.protectedCoreSkillIds());
    const deletableSkillIds = skills
      .map((skill) => skill.id)
      .filter((skillId) => !protectedSkillIds.has(skillId))
      .sort((left, right) => left.localeCompare(right));
    const normalizedMessage = compactText(input.message);
    const lowerMessage = normalizedMessage.toLowerCase();
    const requestedSkillId =
      deletableSkillIds.find(
        (skillId) => lowerMessage === skillId.toLowerCase()
      ) ??
      deletableSkillIds.find((skillId) =>
        new RegExp(
          `(^|\\s|\`)${escapeRegExp(skillId)}(\\s|\`|$)`,
          "iu"
        ).test(normalizedMessage)
      ) ??
      null;
    const deleteRequested =
      hasSkillDeleteSignal(input.message) ||
      (Boolean(requestedSkillId) && hasDeleteSignal(input.message));

    if (!deleteRequested && !(input.awaitingSkillDelete && requestedSkillId)) {
      return null;
    }

    if (!requestedSkillId) {
      return this.buildLocalRockyMessage({
        chatId: input.chatId,
        domain: input.domain,
        intent: input.intent,
        worker: input.worker,
        timestamp: input.timestamp,
        text: [
          SKILL_DELETE_FOLLOWUP_MARKER,
          "",
          "현재 삭제 가능한 agent-local 스킬은:",
          "",
          formatSkillList(deletableSkillIds),
        ].join("\n"),
      });
    }

    const deleted = await this.agentLocalSkillService.deleteAgentLocalSkill(
      input.agent,
      requestedSkillId,
      {
        protectedSkillIds: this.protectedCoreSkillIds(),
      }
    );
    const remainingDeletableSkillIds = deleted.skills
      .map((skill) => skill.id)
      .filter((skillId) => !protectedSkillIds.has(skillId))
      .sort((left, right) => left.localeCompare(right));

    return this.buildLocalRockyMessage({
      chatId: input.chatId,
      domain: input.domain,
      intent: input.intent,
      worker: input.worker,
      timestamp: input.timestamp,
      text: [
        `\`${requestedSkillId}\` agent-local 스킬을 삭제했습니다.`,
        "",
        "남은 삭제 가능 스킬:",
        "",
        formatSkillList(remainingDeletableSkillIds),
      ].join("\n"),
    });
  }

  private async readCoreSettings(): Promise<RockyCoreSettingsRecord> {
    const persisted = await readRockyCoreSettingsRecord(
      resolveRockyCoreSettingsPaths(this.stateRoot)
    );

    return {
      ...defaultCoreSettings(),
      ...(persisted ?? {}),
      defaultRuntimeKind: isRuntimeKind(persisted?.defaultRuntimeKind)
        ? persisted.defaultRuntimeKind
        : "codex-cli",
      defaultReasoningEffort:
        normalizeReasoningEffort(persisted?.defaultReasoningEffort) ?? null,
      defaultServiceTier: normalizeServiceTier(persisted?.defaultServiceTier) ?? null,
      defaultOllamaLaunchTarget:
        normalizeOllamaLaunchTarget(persisted?.defaultOllamaLaunchTarget) ?? null,
    };
  }

  private async readAllChats(): Promise<RockyChatRecord[]> {
    const paths = await listRockyChatPaths(this.stateRoot);
    return (
      await Promise.all(paths.map((entry) => readRockyChatRecord(entry)))
    ).filter((chat): chat is RockyChatRecord => Boolean(chat));
  }

  private async findCoreAgent(): Promise<AgentRecord | null> {
    if (!this.agentService) {
      return null;
    }

    const agents = await this.agentService.listAgents();
    return agents.find((agent) => agent.id === ROCKY_CORE_SKILL.agent.id) ?? null;
  }

  private async requireRunnableAgent(agentId: string): Promise<AgentRecord> {
    if (!this.agentService) {
      throw badRequest("Agent-specific Rocky chats require an agent service.");
    }

    const agents = await this.agentService.listAgents();
    const agent = agents.find((entry) => entry.id === agentId);
    if (!agent) {
      throw notFound(`Unknown agent: ${agentId}`);
    }
    if (agent.lifecycle === "archived") {
      throw conflict(`Archived agents are read-only: ${agentId}`);
    }

    return agent;
  }

  private async listInstalledSkillIds(agent: AgentRecord | null): Promise<string[]> {
    if (!agent) {
      return [];
    }

    const skills = await this.agentLocalSkillService.listAgentLocalSkills(agent);
    return skills.map((skill) => skill.id).sort((left, right) => left.localeCompare(right));
  }

  private async listCoreSessions(): Promise<AgentSessionRecord[]> {
    if (!this.sessionService?.listAgentSessions) {
      return [];
    }

    try {
      return await this.sessionService.listAgentSessions(ROCKY_CORE_SKILL.agent.id, {
        includeArchived: true,
        kinds: ["task-request"],
      });
    } catch (error) {
      if (error instanceof Error && /^Unknown agent: /u.test(error.message)) {
        return [];
      }
      throw error;
    }
  }

  private async fileExists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async buildCoreSkillRecords(
    agent: AgentRecord | null
  ): Promise<RockyCoreSkillRecord[]> {
    const installedSkillIds = new Set(await this.listInstalledSkillIds(agent));

    return Promise.all(
      ROCKY_ORCHESTRATION_SKILLS.map(async (skill) => {
        const workspacePath = agent
          ? `${WORKSPACE_LOCAL_SKILL_AUTHORING_DIR}/${skill.id}/SKILL.md`
          : null;
        const absoluteSkillPath =
          agent && workspacePath
            ? `${agent.workspaceRoot}/${workspacePath}`
            : null;
        const matchedSkillIds = skill.ability?.installableSkillIds ?? [];
        const matchedInstalledSkillIds = matchedSkillIds.filter((skillId) =>
          installedSkillIds.has(skillId)
        );

        return {
          id: skill.id,
          version: skill.version,
          displayName: skill.displayName,
          description: skill.description,
          workspacePath,
          matchedSkillIds,
          installedSkillIds: matchedInstalledSkillIds,
          installed: matchedInstalledSkillIds.length > 0,
          synchronized: absoluteSkillPath
            ? await this.fileExists(absoluteSkillPath)
            : false,
        };
      })
    );
  }

  private async buildCoreManagementRecord(input: {
    agent: AgentRecord | null;
    settings: RockyCoreSettingsRecord;
    chats: RockyChatRecord[];
    sessions: AgentSessionRecord[];
  }): Promise<RockyCoreManagementRecord> {
    const existingSessionIds = new Set(input.sessions.map((session) => session.id));
    const chatSessionIds = input.chats.map((chat) => [
      ...new Set(
        chat.dispatches
          .map((dispatch) => dispatch.orchestration?.sessionId)
          .filter((sessionId): sessionId is string => Boolean(sessionId))
      ),
    ]);
    const danglingSessionIds = [
      ...new Set(
        chatSessionIds.flat().filter((sessionId) => !existingSessionIds.has(sessionId))
      ),
    ].sort();

    return {
      agent: input.agent
        ? {
            id: input.agent.id,
            name: input.agent.name,
            description: input.agent.description,
            workspaceRoot: input.agent.workspaceRoot,
            runtimeHome: input.agent.runtimeHome,
            defaultRuntime: input.agent.defaultRuntime,
            lifecycle: input.agent.lifecycle,
            updatedAt: input.agent.updatedAt,
          }
        : null,
      settings: input.settings,
      skills: await this.buildCoreSkillRecords(input.agent),
      sessionHealth: {
        homeChatCount: input.chats.length,
        chatsWithDispatches: input.chats.filter(
          (chat) => chat.dispatches.length > 0
        ).length,
        chatsWithoutSessionIds: chatSessionIds.filter(
          (sessionIds) => sessionIds.length === 0
        ).length,
        chatsWithMissingSessions: chatSessionIds.filter((sessionIds) =>
          sessionIds.some((sessionId) => !existingSessionIds.has(sessionId))
        ).length,
        existingSessionCount: input.sessions.length,
        runningSessionCount: input.sessions.filter(
          (session) => session.status === "running"
        ).length,
        danglingSessionIds,
      },
    };
  }

  private async deleteSessionIfPresent(sessionId: string): Promise<void> {
    if (!this.sessionService) {
      return;
    }

    try {
      if (this.sessionService.stopSessionRuns) {
        await this.sessionService.stopSessionRuns(sessionId);
      }
      if (this.sessionService.deleteSession) {
        await this.sessionService.deleteSession(sessionId);
      }
    } catch (error) {
      if (isUnknownSessionError(error)) {
        return;
      }
      throw error;
    }
  }

  private buildCoreRockyMessage(input: {
    chatId: string;
    domain: RockyChatDomain;
    intent: RockyRoutingIntent;
    worker: RockyWorkerRecord;
    dispatchId: string;
    orchestration: RockyOrchestrationRecord;
    usedSkills?: RockyUsedSkillRecord[];
    timestamp: string;
  }): RockyMessageRecord {
    const actor = input.worker.displayName || "Rocky";
    const text =
      input.orchestration.output ??
      (input.orchestration.status === "failed"
        ? `${actor} 실행을 시작하지 못했습니다.`
        : `${actor}이(가) 답변을 작성하고 있어요.`);

    return {
      id: `message-${this.idGenerator()}`,
      chatId: input.chatId,
      role: "rocky",
      intent: input.intent,
      text,
      attachmentIds: [],
      domain: input.domain,
      workerId: input.worker.id,
      skillCandidateIds: [],
      usedSkills: input.usedSkills ?? [],
      dispatchId: input.dispatchId,
      createdAt: input.timestamp,
    };
  }

  private mergeSkillCandidates(
    current: RockySkillCandidateRecord[],
    next: RockySkillCandidateRecord[]
  ): RockySkillCandidateRecord[] {
    const seen = new Set(current.map((candidate) => candidate.title));
    const additions = next.filter((candidate) => !seen.has(candidate.title));
    return [...current, ...additions];
  }

  private buildDispatch(input: {
    chatId: string;
    messageId: string;
    skill: RockyOrchestrationSkill;
    intent: RockyRoutingIntent;
    domain: RockyChatDomain;
    workerId: string;
    attachments: RockyAttachmentRecord[];
    message: string;
    skillCandidates: RockySkillCandidateRecord[];
    timestamp: string;
  }): RockyDispatchRecord {
    return {
      id: `dispatch-${this.idGenerator()}`,
      chatId: input.chatId,
      messageId: input.messageId,
      skillId: input.skill.id,
      intent: input.intent,
      domain: input.domain,
      workerId: input.workerId,
      attachmentIds: input.attachments.map((attachment) => attachment.id),
      originalRequest: input.message,
      skillCandidateIds: input.skillCandidates.map((candidate) => candidate.id),
      protectionHints: extractRockyProtectionHints({
        skill: input.skill,
        message: input.message,
        attachments: input.attachments,
      }),
      orchestration: null,
      executionStarted: false,
      createdAt: input.timestamp,
    };
  }

  private async ensureCoreWorker(input: {
    skill: RockyOrchestrationSkill;
    reason: string;
    timestamp: string;
  }): Promise<{ agent: AgentRecord | null; worker: RockyWorkerRecord }> {
    const paths = resolveRockyWorkerPaths({
      stateRoot: this.stateRoot,
      workerId: input.skill.worker.id,
    });
    const agent = await this.ensureCoreAgent(input.skill);
    const agentId = agent?.id ?? null;
    const existing = await readRockyWorkerRecord(paths);
    if (existing) {
      const worker: RockyWorkerRecord = {
        ...existing,
        skillId: input.skill.id,
        domain: input.skill.domain,
        displayName: input.skill.worker.displayName,
        agentId: agentId ?? existing.agentId,
        reason: input.reason.slice(0, 160),
        status: "ready",
        updatedAt: input.timestamp,
      };
      await writeRockyWorkerRecord(paths, worker);
      return { agent, worker };
    }

    const worker: RockyWorkerRecord = {
      id: input.skill.worker.id,
      skillId: input.skill.id,
      domain: input.skill.domain,
      displayName: input.skill.worker.displayName,
      agentId,
      reason: input.reason.slice(0, 160),
      status: "ready",
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    };
    await writeRockyWorkerRecord(paths, worker);
    return { agent, worker };
  }

  private async ensureAgentWorker(input: {
    agent: AgentRecord;
    timestamp: string;
  }): Promise<{ skill: RockyOrchestrationSkill; worker: RockyWorkerRecord }> {
    const skill = buildAgentOrchestrationSkill(input.agent);
    const paths = resolveRockyWorkerPaths({
      stateRoot: this.stateRoot,
      workerId: skill.worker.id,
    });
    const existing = await readRockyWorkerRecord(paths);
    const base = {
      skillId: skill.id,
      domain: skill.domain,
      displayName: input.agent.name,
      agentId: input.agent.id,
      reason: `${input.agent.name} 에이전트 세션에서 처리합니다.`,
      status: "ready" as const,
      updatedAt: input.timestamp,
    };
    const worker: RockyWorkerRecord = existing
      ? {
          ...existing,
          ...base,
        }
      : {
          id: skill.worker.id,
          ...base,
          createdAt: input.timestamp,
        };
    await writeRockyWorkerRecord(paths, worker);
    return { skill, worker };
  }

  private async ensureCoreAgent(
    skill: RockyOrchestrationSkill
  ): Promise<AgentRecord | null> {
    if (!this.agentService) {
      return null;
    }

    const agents = await this.agentService.listAgents();
    const existing = agents.find((agent) => agent.id === skill.agent.id);
    if (existing) {
      await syncRockyAgentSkillWorkspace({
        agent: existing,
        skill,
      });
      return existing;
    }

    const agent = await this.agentService.createAgent({
      id: skill.agent.id,
      name: skill.agent.name,
      description: skill.agent.description,
      defaultRuntime: "codex-cli",
    });
    await syncRockyAgentSkillWorkspace({
      agent,
      skill,
    });
    return agent;
  }

  private findReusableSessionId(chat: RockyChatRecord): string | null {
    const dispatchWithSession = [...chat.dispatches]
      .reverse()
      .find((dispatch) => dispatch.orchestration?.sessionId);

    return dispatchWithSession?.orchestration?.sessionId ?? null;
  }

  private hydrateChat(chat: RockyChatRecord): RockyChatRecord {
    const dispatches = chat.dispatches.map((dispatch) => {
      const persisted = dispatch as Partial<RockyDispatchRecord>;
      const fallbackSkill = getRockySkillByWorkerId(dispatch.workerId);
      return {
        ...dispatch,
        skillId: persisted.skillId ?? fallbackSkill.id,
        orchestration: dispatch.orchestration ?? null,
        executionStarted: Boolean(dispatch.executionStarted),
      };
    });
    const worker = chat.worker
      ? {
          ...chat.worker,
          skillId:
            (chat.worker as Partial<RockyWorkerRecord>).skillId ??
            dispatches.find((dispatch) => dispatch.workerId === chat.worker?.id)
              ?.skillId ??
            getRockySkillByWorkerId(chat.worker.id).id,
        }
      : null;
    const orchestration =
      chat.orchestration ??
      [...dispatches].reverse().find((dispatch) => dispatch.orchestration)
        ?.orchestration ??
      null;
    const messages = chat.messages.map((message) => {
      const persisted = message as Partial<RockyMessageRecord>;
      return {
        ...message,
        usedSkills: persisted.usedSkills ?? [],
      };
    });

    return {
      ...chat,
      worker,
      messages,
      dispatches,
      orchestration,
      executionStarted:
        Boolean(chat.executionStarted) ||
        dispatches.some((dispatch) => dispatch.executionStarted),
    };
  }

  private chatAgentIds(chat: RockyChatRecord): string[] {
    const ids = new Set<string>();
    if (chat.worker?.agentId) {
      ids.add(chat.worker.agentId);
    }
    for (const dispatch of chat.dispatches) {
      if (dispatch.orchestration?.agentId) {
        ids.add(dispatch.orchestration.agentId);
      }
    }
    return [...ids];
  }

  private async currentUsedSkillDisplayNames(
    chat: RockyChatRecord
  ): Promise<Map<string, string>> {
    const displayNames = new Map<string, string>();

    for (const agentId of this.chatAgentIds(chat)) {
      const agent = await this.findAgentById(agentId);
      if (!agent) {
        continue;
      }
      try {
        const skills = await this.agentLocalSkillService.listAgentLocalSkills(agent);
        for (const skill of skills) {
          displayNames.set(skill.id, skill.displayName);
        }
      } catch {
        // Use saved templates below when workspace skill metadata is unavailable.
      }
    }

    const templatesBySkillId = await this.savedSkillTemplateBySkillId();
    for (const [skillId, template] of templatesBySkillId) {
      displayNames.set(skillId, this.savedTemplateDisplayName(template));
    }

    return displayNames;
  }

  private async refreshUsedSkillDisplayNames(
    chat: RockyChatRecord
  ): Promise<{ messages: RockyMessageRecord[]; changed: boolean }> {
    if (!chat.messages.some((message) => message.usedSkills.length > 0)) {
      return { messages: chat.messages, changed: false };
    }

    const currentDisplayNames = await this.currentUsedSkillDisplayNames(chat);
    if (currentDisplayNames.size === 0) {
      return { messages: chat.messages, changed: false };
    }

    let changed = false;
    const messages = chat.messages.map((message) => {
      if (message.usedSkills.length === 0) {
        return message;
      }

      let messageChanged = false;
      const usedSkills = message.usedSkills.map((skill) => {
        const displayName = currentDisplayNames.get(skill.id);
        if (!displayName || displayName === skill.displayName) {
          return skill;
        }
        changed = true;
        messageChanged = true;
        return {
          ...skill,
          displayName,
        };
      });

      return !messageChanged
        ? message
        : {
            ...message,
            usedSkills,
          };
    });

    return { messages, changed };
  }

  private async refreshChat(
    chat: RockyChatRecord,
    options: { persist?: boolean } = {}
  ): Promise<RockyChatRecord> {
    const hydrated = this.hydrateChat(chat);
    let changed = false;
    const messageUpdates = new Map<string, string>();
    const usedSkillUpdates = new Map<string, RockyUsedSkillRecord[]>();
    const dispatches = await Promise.all(
      hydrated.dispatches.map(async (dispatch) => {
        if (!dispatch.orchestration) {
          return dispatch;
        }
        if (
          dispatch.orchestration.output?.includes(TISTORY_DRAFT_PUBLISH_MARKER) ||
          dispatch.orchestration.output?.includes(INSTAGRAM_MEDIA_PUBLISH_MARKER)
        ) {
          return dispatch;
        }

        const refreshedOrchestration = await this.orchestrator.refresh(
          dispatch.orchestration
        );
        const sanitized = this.sanitizeOrchestrationOutput(refreshedOrchestration);
        const orchestration = sanitized.orchestration;
        if (JSON.stringify(orchestration) !== JSON.stringify(dispatch.orchestration)) {
          changed = true;
        }
        if (orchestration.output) {
          messageUpdates.set(dispatch.id, orchestration.output);
        }
        const usedSkills = await this.resolveUsedSkillsByAgentId(
          orchestration.agentId,
          sanitized.usedSkillRefs
        );
        if (usedSkills.length > 0) {
          usedSkillUpdates.set(dispatch.id, usedSkills);
        }

        return {
          ...dispatch,
          orchestration,
          executionStarted: Boolean(orchestration.runId),
        };
      })
    );
    const refreshedMessages =
      messageUpdates.size > 0 || usedSkillUpdates.size > 0
        ? hydrated.messages.map((message) => {
            if (!message.dispatchId) {
              return message;
            }
            const output = messageUpdates.get(message.dispatchId);
            const usedSkills = mergeUsedSkills(
              message.usedSkills,
              usedSkillUpdates.get(message.dispatchId)
            );
            const usedSkillsChanged =
              JSON.stringify(usedSkills) !== JSON.stringify(message.usedSkills);
            if ((!output || message.text === output) && !usedSkillsChanged) {
              return message;
            }
            changed = true;
            return {
              ...message,
              text: output ?? message.text,
              usedSkills,
            };
          })
        : hydrated.messages;
    const orchestration =
      [...dispatches].reverse().find((dispatch) => dispatch.orchestration)
        ?.orchestration ?? null;
    const displayNameRefresh = await this.refreshUsedSkillDisplayNames({
      ...hydrated,
      messages: refreshedMessages,
      dispatches,
      orchestration,
    });
    const metadataChanged = displayNameRefresh.changed;
    const refreshedActivity: RockyChatRecord = {
      ...hydrated,
      messages: displayNameRefresh.messages,
      dispatches,
      orchestration,
      executionStarted: dispatches.some((dispatch) => dispatch.executionStarted),
      updatedAt: hydrated.updatedAt,
    };
    const refreshed: RockyChatRecord = {
      ...refreshedActivity,
      updatedAt: changed
        ? rockyChatActivityUpdatedAt(refreshedActivity)
        : hydrated.updatedAt,
    };

    if ((changed || metadataChanged) && options.persist) {
      await this.writeChat(refreshed);
    }

    return refreshed;
  }

  private async requireChat(chatId: string): Promise<RockyChatRecord> {
    const chat = await readRockyChatRecord(
      resolveRockyChatPaths({
        stateRoot: this.stateRoot,
        chatId,
      })
    );
    if (!chat) {
      throw notFound(`Unknown Rocky chat: ${chatId}`);
    }

    return this.hydrateChat(chat);
  }

  private async toPagedChatWithPreview(
    chat: RockyChatRecord,
    page: RockyChatMessagePageInput = {}
  ): Promise<RockyChatRecord> {
    return this.toPagedChat(
      await this.attachInstagramPublishDraftPreview(chat),
      page
    );
  }

  private toPagedChat(
    chat: RockyChatRecord,
    page: RockyChatMessagePageInput = {}
  ): RockyChatRecord {
    const messagePage = pageRockyMessages(chat.messages, page);

    return {
      ...chat,
      messages: messagePage.messages,
      messagePage,
    };
  }

  private async writeChat(chat: RockyChatRecord): Promise<void> {
    const {
      instagramPublishDraftPreview: _instagramPublishDraftPreview,
      messagePage: _messagePage,
      ...persistedChat
    } = chat;
    await writeRockyChatRecord(
      resolveRockyChatPaths({
        stateRoot: this.stateRoot,
        chatId: chat.id,
      }),
      persistedChat
    );
  }
}
