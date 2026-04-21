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

import type {
  RockyAttachmentInput,
  RockyAttachmentRecord,
  RockyChatCreateInput,
  RockyChatDomain,
  RockyChatMessageInput,
  RockyChatRecord,
  RockyDispatchRecord,
  RockyMessageRecord,
  RockySkillCandidateRecord,
  RockyWorkerRecord,
} from "./rocky-chat-types.js";
import type {
  AgentCreateInput,
  AgentRecord,
} from "../agents/agent-types.js";

const NUTRITION_WORKER_ID = "nutrition-md-worker";
const NUTRITION_AGENT_ID = "rocky-nutrition-md";

interface AgentServiceForRockyChat {
  createAgent(input?: AgentCreateInput): Promise<AgentRecord>;
  listAgents(): Promise<AgentRecord[]>;
}

export interface RockyChatServiceOptions {
  stateRoot?: string;
  now?: () => string;
  idGenerator?: () => string;
  agentService?: AgentServiceForRockyChat;
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
  if (
    includesAny(target, [
      "영양제",
      "건기식",
      "md",
      "상품 기획",
      "이벤트",
      "행사",
      "원가",
      "마진",
      "거래처",
      "판매량",
      "재구매",
      "제품명",
    ])
  ) {
    return "nutrition-md";
  }

  return "general";
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
  private readonly agentService: AgentServiceForRockyChat | undefined;

  constructor(options: RockyChatServiceOptions = {}) {
    this.stateRoot = options.stateRoot;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.agentService = options.agentService;
  }

  async createChat(input: RockyChatCreateInput): Promise<RockyChatRecord> {
    const message = input.message.trim();
    if (!message) {
      throw badRequest("message is required.");
    }

    const timestamp = this.now();
    const chatId = `rocky-chat-${this.idGenerator()}`;
    const attachments = this.normalizeAttachments(input.attachments ?? [], timestamp);
    const userMessage = this.buildUserMessage(chatId, message, attachments, timestamp);
    const domain = detectDomain(message, attachments);
    const worker = await this.ensureWorker(domain, message, timestamp);
    const skillCandidates = this.extractSkillCandidates(message, userMessage.id, timestamp);
    const dispatch = this.buildDispatch({
      chatId,
      messageId: userMessage.id,
      domain,
      workerId: worker.id,
      attachments,
      message,
      skillCandidates,
      timestamp,
    });
    const rockyMessage = this.buildRockyMessage({
      chatId,
      domain,
      worker,
      skillCandidates,
      dispatchId: dispatch.id,
      protectionHints: dispatch.protectionHints,
      timestamp,
    });

    const chat: RockyChatRecord = {
      id: chatId,
      title: titleFromMessage(message),
      domain,
      worker,
      attachments,
      messages: [userMessage, rockyMessage],
      skillCandidates,
      dispatches: [dispatch],
      executionStarted: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.writeChat(chat);
    return chat;
  }

  async getChat(chatId: string): Promise<RockyChatRecord> {
    return this.requireChat(chatId);
  }

  async listChats(): Promise<RockyChatRecord[]> {
    const paths = await listRockyChatPaths(this.stateRoot);
    const chats = (
      await Promise.all(paths.map((entry) => readRockyChatRecord(entry)))
    ).filter((chat): chat is RockyChatRecord => Boolean(chat));

    return chats.sort(
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
    const userMessage = this.buildUserMessage(chatId, message, attachments, timestamp);
    const detectedDomain = detectDomain(message, [...existing.attachments, ...attachments]);
    const domain = detectedDomain === "general" ? existing.domain : detectedDomain;
    const worker = await this.ensureWorker(domain, message, timestamp);
    const skillCandidates = this.mergeSkillCandidates(
      existing.skillCandidates,
      this.extractSkillCandidates(message, userMessage.id, timestamp)
    );
    const newCandidates = skillCandidates.filter(
      (candidate) =>
        !existing.skillCandidates.some((existingCandidate) => existingCandidate.id === candidate.id)
    );
    const dispatch = this.buildDispatch({
      chatId,
      messageId: userMessage.id,
      domain,
      workerId: worker.id,
      attachments: [...existing.attachments, ...attachments],
      message,
      skillCandidates: newCandidates,
      timestamp,
    });
    const rockyMessage = this.buildRockyMessage({
      chatId,
      domain,
      worker,
      skillCandidates: newCandidates,
      dispatchId: dispatch.id,
      protectionHints: dispatch.protectionHints,
      timestamp,
    });

    const chat: RockyChatRecord = {
      ...existing,
      title: existing.title || titleFromMessage(message),
      domain,
      worker,
      attachments: [...existing.attachments, ...attachments],
      messages: [...existing.messages, userMessage, rockyMessage],
      skillCandidates,
      dispatches: [...existing.dispatches, dispatch],
      executionStarted: false,
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

  private buildUserMessage(
    chatId: string,
    message: string,
    attachments: RockyAttachmentRecord[],
    createdAt: string
  ): RockyMessageRecord {
    return {
      id: `message-${this.idGenerator()}`,
      chatId,
      role: "user",
      text: message,
      attachmentIds: attachments.map((attachment) => attachment.id),
      domain: "general",
      workerId: null,
      skillCandidateIds: [],
      dispatchId: null,
      createdAt,
    };
  }

  private buildRockyMessage(input: {
    chatId: string;
    domain: RockyChatDomain;
    worker: RockyWorkerRecord;
    skillCandidates: RockySkillCandidateRecord[];
    dispatchId: string;
    protectionHints: string[];
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

    return {
      id: `message-${this.idGenerator()}`,
      chatId: input.chatId,
      role: "rocky",
      text: `${domainText}\n${input.worker.displayName}을 준비했고, 요청과 자료를 바로 넘길 수 있게 묶어뒀어요.\n${candidateText}\n${protectionText}`,
      attachmentIds: [],
      domain: input.domain,
      workerId: input.worker.id,
      skillCandidateIds: input.skillCandidates.map((candidate) => candidate.id),
      dispatchId: input.dispatchId,
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
      domain: input.domain,
      workerId: input.workerId,
      attachmentIds: input.attachments.map((attachment) => attachment.id),
      originalRequest: input.message,
      skillCandidateIds: input.skillCandidates.map((candidate) => candidate.id),
      protectionHints: protectionHints(input.message, input.attachments),
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
      return {
        id: "general-worker",
        domain,
        displayName: "자료 정리 담당",
        agentId: null,
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
    const agentId = await this.ensureInternalAgent();
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

  private async ensureInternalAgent(): Promise<string | null> {
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

    return chat;
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
