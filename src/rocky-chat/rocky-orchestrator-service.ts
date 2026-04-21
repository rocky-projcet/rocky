import { randomUUID } from "node:crypto";

import type { AgentCreateInput, AgentRecord } from "../agents/agent-types.js";
import type {
  AgentRunRecord,
  AgentRunStatus,
  AgentSessionKind,
  AgentSessionMessage,
  AgentSessionRecord,
} from "../sessions/session-types.js";
import type {
  RockyAttachmentRecord,
  RockyChatDomain,
  RockyDispatchRecord,
  RockyOrchestrationRecord,
  RockyOrchestrationStatus,
  RockyRoutingIntent,
  RockySkillCandidateRecord,
  RockyWorkerRecord,
} from "./rocky-chat-types.js";

export interface RockyAgentServiceLike {
  createAgent(input?: AgentCreateInput): Promise<AgentRecord>;
  listAgents(): Promise<AgentRecord[]>;
}

export interface RockySessionServiceLike {
  createSession(input: {
    agentId: string;
    title?: string | null;
    kind?: AgentSessionKind;
  }): Promise<AgentSessionRecord>;
  sendTurn(input: {
    sessionId: string;
    prompt: string;
    triggerType?: "interactive" | "manual_task" | "scheduled" | "event";
  }): Promise<AgentRunRecord>;
  getRun?(runId: string): Promise<AgentRunRecord>;
  getTranscript?(sessionId: string): Promise<AgentSessionMessage[]>;
}

export interface RockyOrchestratorServiceOptions {
  sessionService?: RockySessionServiceLike;
  now?: () => string;
  idGenerator?: () => string;
}

export interface RockyOrchestrationStartInput {
  chatId: string;
  domain: RockyChatDomain;
  message: string;
  worker: RockyWorkerRecord;
  dispatch: RockyDispatchRecord;
  attachments: RockyAttachmentRecord[];
  skillCandidates: RockySkillCandidateRecord[];
  protectionHints: string[];
  reuseSessionId?: string | null;
  timestamp: string;
}

function runStatusToOrchestrationStatus(
  status: AgentRunStatus
): RockyOrchestrationStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "running":
    default:
      return "running";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function formatAttachments(attachments: RockyAttachmentRecord[]): string {
  if (attachments.length === 0) {
    return "- 없음";
  }

  return attachments
    .map((attachment) => {
      const size =
        typeof attachment.size === "number" ? `${attachment.size} bytes` : "size unknown";
      const contentType = attachment.contentType ?? "content type unknown";
      return `- ${attachment.name} (${contentType}, ${size})`;
    })
    .join("\n");
}

function formatSkillCandidates(candidates: RockySkillCandidateRecord[]): string {
  if (candidates.length === 0) {
    return "- 없음";
  }

  return candidates
    .map(
      (candidate) =>
        `- ${candidate.title}: ${candidate.description} (trigger: ${candidate.trigger})`
    )
    .join("\n");
}

function formatProtectionHints(hints: string[]): string {
  if (hints.length === 0) {
    return "- 없음";
  }

  return hints.map((hint) => `- ${hint}`).join("\n");
}

function latestAssistantText(messages: AgentSessionMessage[]): string | null {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  const content = assistant?.content.trim();
  return content || null;
}

function isCoreIntent(intent: RockyRoutingIntent): boolean {
  return intent === "conversation" || intent === "clarification";
}

function buildCorePrompt(input: RockyOrchestrationStartInput): string {
  const mode =
    input.dispatch.intent === "clarification"
      ? "사용자의 요청이 아직 모호합니다. 실행을 시작하지 말고 필요한 확인 질문을 짧게 하세요."
      : "사용자와 자연스럽게 대화하고, Rocky가 할 수 있는 일을 구체적으로 설명하세요.";

  return [
    "당신은 Rocky 홈 채팅의 코어 오케스트레이터입니다.",
    "한국어로 짧고 실용적으로 답하세요.",
    "",
    "역할:",
    "- 사용자의 질문에는 직접 답합니다.",
    "- 실행이 필요한 작업이 보이면 어떤 담당 에이전트가 처리할 수 있는지 설명합니다.",
    "- 모호한 요청은 바로 실행하지 말고 필요한 정보를 묻습니다.",
    "- 파일 본문을 받지 못한 상태에서 파일 내용을 읽었다고 말하지 않습니다.",
    "",
    `현재 모드: ${mode}`,
    "",
    "사용자 메시지:",
    input.message,
  ].join("\n");
}

function buildOrchestrationPrompt(input: RockyOrchestrationStartInput): string {
  if (isCoreIntent(input.dispatch.intent)) {
    return buildCorePrompt(input);
  }

  const domainLabel =
    input.domain === "nutrition-md" ? "영양제 MD 작업" : "일반 자료 작업";

  return [
    "Rocky 홈 채팅에서 위임된 작업입니다.",
    "",
    `작업 영역: ${domainLabel}`,
    `담당: ${input.worker.displayName}`,
    "",
    "사용자 요청:",
    input.message,
    "",
    "첨부 메타데이터:",
    formatAttachments(input.attachments),
    "",
    "반복 기준 후보:",
    formatSkillCandidates(input.skillCandidates),
    "",
    "보호해서 다룰 항목:",
    formatProtectionHints(input.protectionHints),
    "",
    "응답 지침:",
    "- 사용자의 요청을 실제 작업으로 처리하세요.",
    "- 첨부 파일 본문이 현재 작업공간에 없으면, 없는 파일을 읽었다고 가정하지 말고 필요한 파일을 요청하세요.",
    "- 원가, 마진, 거래처, 고객 정보는 노출 범위를 조심해서 다루세요.",
    "- 결과는 한국어로 간결하게 정리하고, 다음 액션이 필요하면 명확히 적으세요.",
  ].join("\n");
}

export class RockyOrchestratorService {
  private readonly sessionService: RockySessionServiceLike | undefined;
  private readonly now: () => string;
  private readonly idGenerator: () => string;

  constructor(options: RockyOrchestratorServiceOptions = {}) {
    this.sessionService = options.sessionService;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
  }

  async start(input: RockyOrchestrationStartInput): Promise<RockyOrchestrationRecord> {
    const orchestrationId = `orchestration-${this.idGenerator()}`;
    const agentId = input.worker.agentId;
    if (!this.sessionService || !agentId) {
      return {
        id: orchestrationId,
        status: "planned",
        agentId,
        sessionId: null,
        runId: null,
        output: null,
        error: !this.sessionService
          ? "Rocky session service is unavailable."
          : "Rocky worker has no executable agent.",
        startedAt: null,
        endedAt: null,
        updatedAt: input.timestamp,
      };
    }

    try {
      const sessionId = input.reuseSessionId ?? null;
      const session = sessionId
        ? null
        : await this.sessionService.createSession({
            agentId,
            title: input.message.slice(0, 80),
            kind: isCoreIntent(input.dispatch.intent) ? "task-request" : "single-task",
          });
      const run = await this.sessionService.sendTurn({
        sessionId: session?.id ?? sessionId!,
        prompt: buildOrchestrationPrompt(input),
        triggerType: isCoreIntent(input.dispatch.intent) ? "interactive" : "manual_task",
      });

      return {
        id: orchestrationId,
        status: runStatusToOrchestrationStatus(run.status),
        agentId,
        sessionId: session?.id ?? sessionId,
        runId: run.id,
        output: null,
        error: null,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        updatedAt: this.now(),
      };
    } catch (error) {
      return {
        id: orchestrationId,
        status: "failed",
        agentId,
        sessionId: null,
        runId: null,
        output: null,
        error: errorMessage(error),
        startedAt: null,
        endedAt: this.now(),
        updatedAt: this.now(),
      };
    }
  }

  async refresh(
    orchestration: RockyOrchestrationRecord
  ): Promise<RockyOrchestrationRecord> {
    if (!this.sessionService || !orchestration.runId) {
      return orchestration;
    }
    const isTerminal =
      orchestration.status === "completed" ||
      orchestration.status === "failed" ||
      orchestration.status === "cancelled";
    const canHydrateOutput = Boolean(
      !orchestration.output &&
        orchestration.sessionId &&
        this.sessionService.getTranscript
    );
    if (isTerminal && !canHydrateOutput) {
      return orchestration;
    }
    if (!this.sessionService.getRun && !canHydrateOutput) {
      return orchestration;
    }

    try {
      const run =
        !isTerminal && this.sessionService.getRun
          ? await this.sessionService.getRun(orchestration.runId)
          : null;
      const output =
        orchestration.sessionId && this.sessionService.getTranscript
          ? latestAssistantText(await this.sessionService.getTranscript(orchestration.sessionId))
          : orchestration.output;
      return {
        ...orchestration,
        status: run ? runStatusToOrchestrationStatus(run.status) : orchestration.status,
        output,
        error: run
          ? run.status === "failed"
            ? run.summary ?? orchestration.error
            : null
          : orchestration.error,
        startedAt: run?.startedAt ?? orchestration.startedAt,
        endedAt: run?.endedAt ?? orchestration.endedAt,
        updatedAt: this.now(),
      };
    } catch {
      return orchestration;
    }
  }
}
