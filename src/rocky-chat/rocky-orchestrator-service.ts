import { randomUUID } from "node:crypto";

import type { AgentCreateInput, AgentRecord } from "../agents/agent-types.js";
import type {
  AgentRunRecord,
  AgentRunStatus,
  AgentSessionKind,
  AgentSessionRecord,
} from "../sessions/session-types.js";
import type {
  RockyAttachmentRecord,
  RockyChatDomain,
  RockyDispatchRecord,
  RockyOrchestrationRecord,
  RockyOrchestrationStatus,
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

function buildOrchestrationPrompt(input: RockyOrchestrationStartInput): string {
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
        error: !this.sessionService
          ? "Rocky session service is unavailable."
          : "Rocky worker has no executable agent.",
        startedAt: null,
        endedAt: null,
        updatedAt: input.timestamp,
      };
    }

    try {
      const session = await this.sessionService.createSession({
        agentId,
        title: input.message.slice(0, 80),
        kind: "single-task",
      });
      const run = await this.sessionService.sendTurn({
        sessionId: session.id,
        prompt: buildOrchestrationPrompt(input),
        triggerType: "manual_task",
      });

      return {
        id: orchestrationId,
        status: runStatusToOrchestrationStatus(run.status),
        agentId,
        sessionId: session.id,
        runId: run.id,
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
    if (!this.sessionService?.getRun || !orchestration.runId) {
      return orchestration;
    }
    if (
      orchestration.status === "completed" ||
      orchestration.status === "failed" ||
      orchestration.status === "cancelled"
    ) {
      return orchestration;
    }

    try {
      const run = await this.sessionService.getRun(orchestration.runId);
      return {
        ...orchestration,
        status: runStatusToOrchestrationStatus(run.status),
        error: run.status === "failed" ? run.summary ?? orchestration.error : null,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        updatedAt: this.now(),
      };
    } catch {
      return orchestration;
    }
  }
}
