import { randomUUID } from "node:crypto";

import {
  listRockyChatPaths,
  readRockyChatRecord,
  readRockyWorkerRecord,
  resolveRockyChatPaths,
  resolveRockyWorkerPaths,
  writeRockyChatRecord,
  writeRockyWorkerRecord,
} from "./rocky-chat-store.js";
import {
  GENERAL_AGENT_ID,
  GENERAL_WORKER_ID,
  NUTRITION_AGENT_ID,
  NUTRITION_WORKER_ID,
} from "./rocky-chat-constants.js";
import {
  RockyOrchestratorService,
  type RockyAgentServiceLike,
  type RockySessionServiceLike,
} from "./rocky-orchestrator-service.js";

import type {
  RockyAttachmentInput,
  RockyAttachmentRecord,
  RockyChatCreateInput,
  RockyChatDomain,
  RockyChatMessageInput,
  RockyChatRecord,
  RockyDispatchRecord,
  RockyMessageRecord,
  RockyOrchestrationRecord,
  RockyRoutingIntent,
  RockySkillCandidateRecord,
  RockyWorkerRecord,
} from "./rocky-chat-types.js";

type RockyTaskIntent = Extract<
  RockyRoutingIntent,
  "general-task" | "specialized-task"
>;

export interface RockyChatServiceOptions {
  stateRoot?: string;
  now?: () => string;
  idGenerator?: () => string;
  agentService?: RockyAgentServiceLike;
  sessionService?: RockySessionServiceLike;
}

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

function includesAny(input: string, keywords: string[]): boolean {
  const normalized = input.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function compactMessage(message: string): string {
  return message.replace(/\s+/gu, " ").trim().toLowerCase();
}

function titleFromMessage(message: string): string {
  const compact = message.replace(/\s+/gu, " ").trim();
  if (!compact) {
    return "Rocky와 새 대화";
  }

  return compact.length > 32 ? `${compact.slice(0, 32)}...` : compact;
}

function detectDomain(message: string, attachments: RockyAttachmentRecord[]): RockyChatDomain {
  const attachmentNames = attachments.map((attachment) => attachment.name).join(" ");
  const target = `${message} ${attachmentNames}`;
  const nutritionSignals = ["영양제", "건기식", "건강기능식품"];
  const commerceSignals = [
    "상품",
    "제품",
    "제품명",
    "상품명",
    "상품 기획",
    "판매",
    "판매량",
    "재구매",
    "채널",
    "쿠팡",
    "네이버",
    "자사몰",
  ];
  const mdOperationSignals = [
    "원가",
    "마진",
    "공급가",
    "거래처",
    "벤더",
    "이벤트",
    "행사",
    "프로모션",
  ];

  if (includesAny(target, nutritionSignals)) {
    return "nutrition-md";
  }
  if (includesAny(target, commerceSignals) && includesAny(target, mdOperationSignals)) {
    return "nutrition-md";
  }

  return "general";
}

function hasGeneralTaskSignal(message: string, attachments: RockyAttachmentRecord[]): boolean {
  const attachmentNames = attachments.map((attachment) => attachment.name).join(" ");
  const target = `${message} ${attachmentNames}`;

  const explicitFileTask =
    attachments.length > 0 &&
    includesAny(message, ["정리", "요약", "분석", "작성", "만들", "추출", "비교", "변환"]);

  return (
    explicitFileTask ||
    includesAny(target, [
      "정리",
      "요약",
      "분석",
      "작성",
      "만들",
      "찾아",
      "비교",
      "추출",
      "변환",
      "분류",
      "계산",
      "검토",
      "수정",
      "번역",
      "보고서",
      "회의록",
      "표로",
      "엑셀",
      "csv",
      "파일",
      "리스트",
      "목록",
      "초안",
      "기획",
      "계획",
      "액션 아이템",
      "자동화",
      "코드",
    ])
  );
}

function isConversationMessage(message: string): boolean {
  const compact = compactMessage(message);
  const bare = compact.replace(/[!?.,~\s]/gu, "");
  if (
    ["안녕", "안녕하세요", "하이", "hi", "hello", "헬로", "ㅎㅇ", "테스트"].includes(bare)
  ) {
    return true;
  }

  return includesAny(compact, [
    "뭐 할 수",
    "무엇을 할 수",
    "사용법",
    "도움말",
    "에이전트가 뭐",
    "rocky가 뭐",
    "로키가 뭐",
    "너는 뭐",
  ]);
}

function needsClarification(message: string): boolean {
  const compact = compactMessage(message);
  return [
    /^(이거|요거|저거)?\s*(봐줘|봐 줄래|확인해줘|확인해 줄래|확인 가능|어때|가능해|가능|될까|되나)\??$/u,
    /^(정리|분석|요약|검토)\s*(가능|가능해|될까|해줄 수 있어)\??$/u,
    /^(도와줘|뭐 해야 해|어떻게 해)\??$/u,
  ].some((pattern) => pattern.test(compact));
}

function detectRoutingIntent(
  message: string,
  attachments: RockyAttachmentRecord[],
  detectedDomain: RockyChatDomain,
  contextDomain: RockyChatDomain = "general"
): RockyRoutingIntent {
  if (isConversationMessage(message)) {
    return "conversation";
  }
  if (needsClarification(message)) {
    return "clarification";
  }

  const taskSignal = hasGeneralTaskSignal(message, attachments);
  if (
    (detectedDomain === "nutrition-md" || contextDomain === "nutrition-md") &&
    taskSignal
  ) {
    return "specialized-task";
  }
  if (taskSignal) {
    return "general-task";
  }

  return "conversation";
}

function isTaskIntent(intent: RockyRoutingIntent): intent is RockyTaskIntent {
  return intent === "general-task" || intent === "specialized-task";
}

function protectionHints(message: string, attachments: RockyAttachmentRecord[]): string[] {
  const target = `${message} ${attachments.map((attachment) => attachment.name).join(" ")}`;
  const hints: string[] = [];
  if (includesAny(target, ["원가", "마진", "공급가"])) {
    hints.push("원가/마진 정보");
  }
  if (includesAny(target, ["거래처", "벤더", "계약"])) {
    hints.push("거래처/계약 정보");
  }
  if (includesAny(target, ["고객", "개인정보", "전화번호", "이메일"])) {
    hints.push("고객 정보");
  }

  return hints;
}

export class RockyChatService {
  private readonly stateRoot: string | undefined;
  private readonly now: () => string;
  private readonly idGenerator: () => string;
  private readonly agentService: RockyAgentServiceLike | undefined;
  private readonly orchestrator: RockyOrchestratorService;

  constructor(options: RockyChatServiceOptions = {}) {
    this.stateRoot = options.stateRoot;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.agentService = options.agentService;
    this.orchestrator = new RockyOrchestratorService({
      sessionService: options.sessionService,
      now: this.now,
      idGenerator: this.idGenerator,
    });
  }

  async createChat(input: RockyChatCreateInput): Promise<RockyChatRecord> {
    const message = input.message.trim();
    if (!message) {
      throw badRequest("message is required.");
    }

    const timestamp = this.now();
    const chatId = `rocky-chat-${this.idGenerator()}`;
    const attachments = this.normalizeAttachments(input.attachments ?? [], timestamp);
    const domain = detectDomain(message, attachments);
    const intent = detectRoutingIntent(message, attachments, domain);
    const userMessage = this.buildUserMessage({
      chatId,
      message,
      attachments,
      domain,
      intent,
      createdAt: timestamp,
    });
    const routed = await this.routeRockyMessage({
      chatId,
      messageId: userMessage.id,
      message,
      attachments,
      domain,
      intent,
      timestamp,
    });

    const chat: RockyChatRecord = {
      id: chatId,
      title: titleFromMessage(message),
      intent,
      domain,
      worker: routed.worker,
      attachments,
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
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id)
    );
  }

  async addMessage(
    chatId: string,
    input: RockyChatMessageInput
  ): Promise<RockyChatRecord> {
    const message = input.message.trim();
    if (!message) {
      throw badRequest("message is required.");
    }

    const existing = await this.requireChat(chatId);
    const timestamp = this.now();
    const attachments = this.normalizeAttachments(input.attachments ?? [], timestamp);
    const detectedDomain = detectDomain(message, attachments);
    const intent = detectRoutingIntent(message, attachments, detectedDomain, existing.domain);
    const domain =
      detectedDomain === "general" && intent !== "general-task"
        ? existing.domain
        : detectedDomain;
    const userMessage = this.buildUserMessage({
      chatId,
      message,
      attachments,
      domain,
      intent,
      createdAt: timestamp,
    });
    const routed = await this.routeRockyMessage({
      chatId,
      messageId: userMessage.id,
      message,
      attachments: [...existing.attachments, ...attachments],
      domain,
      intent,
      timestamp,
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
      attachments: [...existing.attachments, ...attachments],
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

  private normalizeAttachments(
    attachments: RockyAttachmentInput[],
    addedAt: string
  ): RockyAttachmentRecord[] {
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
        addedAt,
      }));
  }

  private buildUserMessage(input: {
    chatId: string;
    message: string;
    attachments: RockyAttachmentRecord[];
    domain: RockyChatDomain;
    intent: RockyRoutingIntent;
    createdAt: string;
  }): RockyMessageRecord {
    return {
      id: `message-${this.idGenerator()}`,
      chatId: input.chatId,
      role: "user",
      intent: input.intent,
      text: input.message,
      attachmentIds: input.attachments.map((attachment) => attachment.id),
      domain: input.domain,
      workerId: null,
      skillCandidateIds: [],
      dispatchId: null,
      createdAt: input.createdAt,
    };
  }

  private async routeRockyMessage(input: {
    chatId: string;
    messageId: string;
    message: string;
    attachments: RockyAttachmentRecord[];
    domain: RockyChatDomain;
    intent: RockyRoutingIntent;
    timestamp: string;
  }): Promise<{
    worker: RockyWorkerRecord | null;
    skillCandidates: RockySkillCandidateRecord[];
    dispatch: RockyDispatchRecord | null;
    rockyMessage: RockyMessageRecord;
  }> {
    if (!isTaskIntent(input.intent)) {
      return {
        worker: null,
        skillCandidates: [],
        dispatch: null,
        rockyMessage: this.buildNonTaskRockyMessage(input),
      };
    }

    const worker = await this.ensureWorker(input.domain, input.message, input.timestamp);
    const skillCandidates = this.extractSkillCandidates(
      input.message,
      input.messageId,
      input.timestamp
    );
    const dispatch = this.buildDispatch({
      chatId: input.chatId,
      messageId: input.messageId,
      intent: input.intent,
      domain: input.domain,
      workerId: worker.id,
      attachments: input.attachments,
      message: input.message,
      skillCandidates,
      timestamp: input.timestamp,
    });
    const orchestration = await this.orchestrator.start({
      chatId: input.chatId,
      domain: input.domain,
      message: input.message,
      worker,
      dispatch,
      attachments: input.attachments,
      skillCandidates,
      protectionHints: dispatch.protectionHints,
      timestamp: input.timestamp,
    });
    const startedDispatch: RockyDispatchRecord = {
      ...dispatch,
      orchestration,
      executionStarted: Boolean(orchestration.runId),
    };

    return {
      worker,
      skillCandidates,
      dispatch: startedDispatch,
      rockyMessage: this.buildTaskRockyMessage({
        chatId: input.chatId,
        domain: input.domain,
        intent: input.intent,
        worker,
        skillCandidates,
        dispatchId: startedDispatch.id,
        protectionHints: startedDispatch.protectionHints,
        orchestration,
        timestamp: input.timestamp,
      }),
    };
  }

  private buildTaskRockyMessage(input: {
    chatId: string;
    domain: RockyChatDomain;
    intent: RockyTaskIntent;
    worker: RockyWorkerRecord;
    skillCandidates: RockySkillCandidateRecord[];
    dispatchId: string;
    protectionHints: string[];
    orchestration: RockyOrchestrationRecord;
    timestamp: string;
  }): RockyMessageRecord {
    const domainText =
      input.domain === "nutrition-md"
        ? "영양제 MD 자료로 보고 정리할게요."
        : "자료 정리 요청으로 보고 시작할게요.";
    const candidateText =
      input.skillCandidates.length > 0
        ? `반복해서 쓸 기준 후보 ${input.skillCandidates.length}개를 찾았어요.`
        : "아직 반복 기준 후보는 없지만, 대화하면서 찾을게요.";
    const protectionText =
      input.protectionHints.length > 0
        ? `보호해서 볼 항목도 표시해둘게요: ${input.protectionHints.join(", ")}.`
        : "민감해 보이는 항목은 발견되면 따로 표시할게요.";
    const executionText =
      input.orchestration.status === "running"
        ? "실제 에이전트 세션을 만들고 실행을 시작했어요."
        : input.orchestration.status === "planned"
          ? "실행 준비는 했지만 아직 시작하지 못했어요."
          : input.orchestration.status === "failed"
            ? "실행을 시작하려 했지만 실패했어요."
            : "실행 상태를 기록해뒀어요.";

    return {
      id: `message-${this.idGenerator()}`,
      chatId: input.chatId,
      role: "rocky",
      intent: input.intent,
      text: `${domainText}\n${input.worker.displayName}을 준비했고, 요청과 자료를 바로 넘길 수 있게 묶어뒀어요.\n${executionText}\n${candidateText}\n${protectionText}`,
      attachmentIds: [],
      domain: input.domain,
      workerId: input.worker.id,
      skillCandidateIds: input.skillCandidates.map((candidate) => candidate.id),
      dispatchId: input.dispatchId,
      createdAt: input.timestamp,
    };
  }

  private buildNonTaskRockyMessage(input: {
    chatId: string;
    domain: RockyChatDomain;
    intent: RockyRoutingIntent;
    timestamp: string;
  }): RockyMessageRecord {
    const text =
      input.intent === "clarification"
        ? "어떤 방식으로 볼지 먼저 정하면 좋아요. 요약, 문제점 점검, 표 정리, 실행 가능한 작업 중 원하는 방향을 알려주세요."
        : "편하게 말씀해 주세요. 파일 정리, 요약, 분석처럼 실행이 필요한 일이 보이면 그때 담당을 준비하겠습니다.";

    return {
      id: `message-${this.idGenerator()}`,
      chatId: input.chatId,
      role: "rocky",
      intent: input.intent,
      text,
      attachmentIds: [],
      domain: input.domain,
      workerId: null,
      skillCandidateIds: [],
      dispatchId: null,
      createdAt: input.timestamp,
    };
  }

  private extractSkillCandidates(
    message: string,
    sourceMessageId: string,
    createdAt: string
  ): RockySkillCandidateRecord[] {
    const candidates: RockySkillCandidateRecord[] = [];
    const addCandidate = (
      title: string,
      description: string,
      trigger: string,
      confidence: number
    ) => {
      candidates.push({
        id: `skill-${this.idGenerator()}`,
        title,
        description,
        trigger,
        confidence,
        sourceMessageId,
        status: "candidate",
        createdAt,
      });
    };

    if (includesAny(message, ["상품명", "제품명", "같은 상품", "다르게 적힌"])) {
      addCandidate(
        "상품명 표기 묶기",
        "같은 상품이 여러 이름으로 적힌 경우 대표 이름 기준으로 묶는 기준입니다.",
        "상품명/제품명 표기 차이",
        0.86
      );
    }
    if (includesAny(message, ["원가", "마진", "공급가", "거래처", "벤더"])) {
      addCandidate(
        "민감 자료 보호",
        "원가, 마진, 공급가, 거래처 정보는 보호해서 볼 항목으로 다룹니다.",
        "원가/마진/거래처 언급",
        0.9
      );
    }
    if (includesAny(message, ["이벤트", "행사", "프로모션", "기획"])) {
      addCandidate(
        "이벤트 기획 기준 정리",
        "행사 성과를 다음 기획에 재사용할 수 있는 기준으로 정리합니다.",
        "이벤트/기획 언급",
        0.78
      );
    }
    if (includesAny(message, ["채널", "쿠팡", "네이버", "자사몰"])) {
      addCandidate(
        "채널별 성과 비교",
        "판매 채널별 성과를 따로 비교해 다음 운영 판단에 사용합니다.",
        "채널 언급",
        0.72
      );
    }

    return candidates;
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
    intent: RockyTaskIntent;
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
      intent: input.intent,
      domain: input.domain,
      workerId: input.workerId,
      attachmentIds: input.attachments.map((attachment) => attachment.id),
      originalRequest: input.message,
      skillCandidateIds: input.skillCandidates.map((candidate) => candidate.id),
      protectionHints: protectionHints(input.message, input.attachments),
      orchestration: null,
      executionStarted: false,
      createdAt: input.timestamp,
    };
  }

  private async ensureWorker(
    domain: RockyChatDomain,
    reason: string,
    timestamp: string
  ): Promise<RockyWorkerRecord> {
    if (domain !== "nutrition-md") {
      const agentId = await this.ensureGeneralAgent();
      return {
        id: GENERAL_WORKER_ID,
        domain,
        displayName: "자료 정리 담당",
        agentId,
        reason: "일반 자료 정리 요청",
        status: "ready",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    }

    const paths = resolveRockyWorkerPaths({
      stateRoot: this.stateRoot,
      workerId: NUTRITION_WORKER_ID,
    });
    const agentId = await this.ensureNutritionAgent();
    const existing = await readRockyWorkerRecord(paths);
    if (existing) {
      const worker: RockyWorkerRecord = {
        ...existing,
        agentId: agentId ?? existing.agentId,
        reason: reason.slice(0, 160),
        status: "ready",
        updatedAt: timestamp,
      };
      await writeRockyWorkerRecord(paths, worker);
      return worker;
    }

    const worker: RockyWorkerRecord = {
      id: NUTRITION_WORKER_ID,
      domain,
      displayName: "영양제 MD 담당",
      agentId,
      reason: reason.slice(0, 160),
      status: "ready",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await writeRockyWorkerRecord(paths, worker);
    return worker;
  }

  private async ensureGeneralAgent(): Promise<string | null> {
    if (!this.agentService) {
      return null;
    }

    const agents = await this.agentService.listAgents();
    const existing = agents.find((agent) => agent.id === GENERAL_AGENT_ID);
    if (existing) {
      return existing.id;
    }

    const agent = await this.agentService.createAgent({
      id: GENERAL_AGENT_ID,
      name: "자료 정리 담당",
      description:
        "Rocky 홈 채팅에서 일반 자료 정리와 단일 작업 요청을 맡기 위한 담당입니다.",
      defaultRuntime: "codex-cli",
    });
    return agent.id;
  }

  private async ensureNutritionAgent(): Promise<string | null> {
    if (!this.agentService) {
      return null;
    }

    const agents = await this.agentService.listAgents();
    const existing = agents.find((agent) => agent.id === NUTRITION_AGENT_ID);
    if (existing) {
      return existing.id;
    }

    const agent = await this.agentService.createAgent({
      id: NUTRITION_AGENT_ID,
      name: "영양제 MD 담당",
      description:
        "Rocky 단일 채팅에서 영양제 MD 자료 요청을 내부적으로 맡기 위한 담당입니다.",
      defaultRuntime: "codex-cli",
    });
    return agent.id;
  }

  private hydrateChat(chat: RockyChatRecord): RockyChatRecord {
    const dispatches = chat.dispatches.map((dispatch) => ({
      ...dispatch,
      orchestration: dispatch.orchestration ?? null,
      executionStarted: Boolean(dispatch.executionStarted),
    }));
    const orchestration =
      chat.orchestration ??
      [...dispatches].reverse().find((dispatch) => dispatch.orchestration)
        ?.orchestration ??
      null;

    return {
      ...chat,
      dispatches,
      orchestration,
      executionStarted:
        Boolean(chat.executionStarted) ||
        dispatches.some((dispatch) => dispatch.executionStarted),
    };
  }

  private async refreshChat(
    chat: RockyChatRecord,
    options: { persist?: boolean } = {}
  ): Promise<RockyChatRecord> {
    const hydrated = this.hydrateChat(chat);
    let changed = false;
    const dispatches = await Promise.all(
      hydrated.dispatches.map(async (dispatch) => {
        if (!dispatch.orchestration) {
          return dispatch;
        }

        const orchestration = await this.orchestrator.refresh(dispatch.orchestration);
        if (JSON.stringify(orchestration) !== JSON.stringify(dispatch.orchestration)) {
          changed = true;
        }

        return {
          ...dispatch,
          orchestration,
          executionStarted: Boolean(orchestration.runId),
        };
      })
    );
    const orchestration =
      [...dispatches].reverse().find((dispatch) => dispatch.orchestration)
        ?.orchestration ?? null;
    const refreshed: RockyChatRecord = {
      ...hydrated,
      dispatches,
      orchestration,
      executionStarted: dispatches.some((dispatch) => dispatch.executionStarted),
      updatedAt: changed ? this.now() : hydrated.updatedAt,
    };

    if (changed && options.persist) {
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
