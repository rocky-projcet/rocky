import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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
  buildAgentTurnSystemInstructions,
  buildRockyTurnSystemInstructions,
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
  buildTemplateInterviewAgentPrompt,
  parseTemplateInterviewAgentResult,
} from "./rocky-template-interview.js";

import type {
  RockyAttachmentInput,
  RockyAttachmentRecord,
  RockyChatCreateInput,
  RockyChatDomain,
  RockyChatMessageInput,
  RockyChatRecord,
  RockyCoreManagementRecord,
  RockyCoreSettingsRecord,
  RockyCoreSettingsUpdateInput,
  RockyCoreSkillRecord,
  RockyDispatchRecord,
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
import type { AgentSessionRecord } from "../sessions/session-types.js";
import { SkillTemplateStore } from "../skills/skill-template-store.js";
import type { RuntimeSkillTemplateRecord } from "../skills/skill-template-store.js";

export interface RockyChatServiceOptions {
  stateRoot?: string;
  now?: () => string;
  idGenerator?: () => string;
  agentService?: RockyAgentServiceLike;
  sessionService?: RockySessionServiceLike;
  skillTemplateStore?: SkillTemplateStore;
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

const DEFAULT_ATTACHMENT_MESSAGE = "Please review the attached file.";
const ROCKY_UPLOADS_DIRECTORY = "uploads/rocky";
const SKILL_DELETE_FOLLOWUP_MARKER = "삭제할 agent-local 스킬을 지정해 주세요.";
const TEMPLATE_INTERVIEW_AGENT_WAIT_TIMEOUT_MS = 60_000;
const TEMPLATE_INTERVIEW_AGENT_POLL_INTERVAL_MS = 750;

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

function formatSkillList(skillIds: string[]): string {
  if (skillIds.length === 0) {
    return "- 없음";
  }

  return skillIds.map((skillId) => `- \`${skillId}\``).join("\n");
}

function usedSkillMarkerPattern(): RegExp {
  return /<!--\s*rocky-used-skills:\s*(\[[\s\S]*?\])\s*-->/giu;
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

  constructor(options: RockyChatServiceOptions = {}) {
    this.stateRoot = options.stateRoot;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.agentService = options.agentService;
    this.sessionService = options.sessionService;
    this.skillTemplateStore =
      options.skillTemplateStore ??
      new SkillTemplateStore({
        stateRoot: options.stateRoot,
        now: this.now,
        idGenerator: this.idGenerator,
      });
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
          runtimeMessage: skillInvocationMessage(message, input.skillId),
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
    return chat;
  }

  async getChat(chatId: string): Promise<RockyChatRecord> {
    return this.refreshChat(await this.requireChat(chatId), { persist: true });
  }

  async listChats(): Promise<RockyChatRecord[]> {
    const paths = await listRockyChatPaths(this.stateRoot);
    const chats = (
      await Promise.all(paths.map((entry) => readRockyChatRecord(entry)))
    ).filter((chat): chat is RockyChatRecord => Boolean(chat));

    const refreshed = await Promise.all(
      chats.map((chat) => this.refreshChat(chat, { persist: true }))
    );

    return refreshed.sort(
      (left, right) =>
        rockyChatActivityUpdatedAt(right).localeCompare(
          rockyChatActivityUpdatedAt(left)
        ) ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id)
    );
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
      return existing;
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
    return chat;
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
    const reusableSessionId = this.findReusableSessionId(existing);
    const routed = targetAgent
      ? await this.handleAgentMessage({
          agent: targetAgent,
          chatId,
          messageId: userMessageId,
          message,
          runtimeMessage: message,
          selectedSkillId: null,
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
    return chat;
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

  private async findAgentById(agentId: string): Promise<AgentRecord | null> {
    if (!this.agentService) {
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
        !markdown.includes("HTML source file")
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
    return {
      orchestration:
        extracted.text === orchestration.output
          ? orchestration
          : {
              ...orchestration,
              output: extracted.text || null,
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
      attachments: input.attachments,
    });
    const selectedUsedSkills = await this.resolveUsedSkills(
      input.agent,
      input.selectedSkillId ? [input.selectedSkillId] : []
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
      }),
    });
    const sanitized = this.sanitizeOrchestrationOutput(startedOrchestration);
    const reportedUsedSkills = await this.resolveUsedSkills(
      input.agent,
      sanitized.usedSkillRefs
    );
    const usedSkills = mergeUsedSkills(selectedUsedSkills, reportedUsedSkills);
    const startedDispatch: RockyDispatchRecord = {
      ...dispatch,
      orchestration: sanitized.orchestration,
      executionStarted: Boolean(sanitized.orchestration.runId),
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
        orchestration: sanitized.orchestration,
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
          addedAt: attachment.addedAt,
        } satisfies RockyAttachmentRecord;

        if (!input.agent || !contentBase64 || existingRecord.workspacePath) {
          return existingRecord;
        }

        const body = Buffer.from(contentBase64, "base64");
        const safeName = sanitizeUploadedFilename(existingRecord.name);
        const workspacePath = path.posix.join(
          ROCKY_UPLOADS_DIRECTORY,
          this.idGenerator(),
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

  private async writeChat(chat: RockyChatRecord): Promise<void> {
    await writeRockyChatRecord(
      resolveRockyChatPaths({
        stateRoot: this.stateRoot,
        chatId: chat.id,
      }),
      chat
    );
  }
}
