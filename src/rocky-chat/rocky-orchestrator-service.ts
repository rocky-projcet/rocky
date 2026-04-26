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
  RuntimeKind,
  RuntimeOllamaLaunchTarget,
  RuntimeReasoningEffort,
  RuntimeRunResult,
  RuntimeServiceTier,
} from "../runtime/runtime-types.js";
import type {
  RockyAttachmentRecord,
  RockyChatDomain,
  RockyDispatchRecord,
  RockyOrchestrationRecord,
  RockyOrchestrationStatus,
  RockySkillCandidateRecord,
  RockyWorkerRecord,
} from "./rocky-chat-types.js";
import type { RockyOrchestrationSkill } from "./rocky-skill-registry.js";

export interface RockyAgentServiceLike {
  createAgent(input?: AgentCreateInput): Promise<AgentRecord>;
  listAgents(): Promise<AgentRecord[]>;
}

export interface RockySessionServiceLike {
  createSession(input: {
    agentId: string;
    title?: string | null;
    kind?: AgentSessionKind;
    runtimeKind?: RuntimeKind;
    ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
    model?: string | null;
    reasoningEffort?: RuntimeReasoningEffort | null;
    serviceTier?: RuntimeServiceTier | null;
  }): Promise<AgentSessionRecord>;
  listAgentSessions?(
    agentId: string,
    options?: {
      includeArchived?: boolean;
      kinds?: AgentSessionKind[];
    }
  ): Promise<AgentSessionRecord[]>;
  sendTurn(input: {
    sessionId: string;
    prompt: string;
    triggerType?: "interactive" | "manual_task" | "scheduled" | "event";
    extraSystemInstructions?: string[];
  }): Promise<AgentRunRecord>;
  getRun?(runId: string): Promise<AgentRunRecord>;
  getRunResult?(runId: string): Promise<RuntimeRunResult>;
  getTranscript?(sessionId: string): Promise<AgentSessionMessage[]>;
  cancelRun?(runId: string): Promise<void>;
  deleteSession?(sessionId: string): Promise<void>;
  stopSessionRuns?(sessionId: string): Promise<string[]>;
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
  skill: RockyOrchestrationSkill;
  protectionHints: string[];
  reuseSessionId?: string | null;
  defaultRuntimeKind?: RuntimeKind;
  defaultOllamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
  defaultModel?: string | null;
  defaultReasoningEffort?: RuntimeReasoningEffort | null;
  defaultServiceTier?: RuntimeServiceTier | null;
  timestamp: string;
  extraSystemInstructions?: string[];
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

function isUnknownRuntimeRecordError(error: unknown): boolean {
  return error instanceof Error && /^Unknown (session|run): /u.test(error.message);
}

function missingRuntimeRecordMessage(error: unknown): string {
  const message = errorMessage(error);
  if (/^Unknown session: /u.test(message)) {
    return "연결된 실행 세션이 삭제되었습니다. 새 메시지를 보내면 새 세션으로 이어서 진행합니다.";
  }
  if (/^Unknown run: /u.test(message)) {
    return "연결된 실행 기록이 삭제되었습니다. 새 메시지를 보내면 새 세션으로 이어서 진행합니다.";
  }

  return message;
}

function latestAssistantText(messages: AgentSessionMessage[]): string | null {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  const content = assistant?.content.trim();
  return content || null;
}

function resultAssistantText(result: RuntimeRunResult | null): string | null {
  if (!result) {
    return null;
  }

  const lastMessage = result.lastMessage?.trim();
  if (lastMessage) {
    return lastMessage;
  }

  const assistant = [...result.messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const content = assistant?.text.trim();
  return content || null;
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
          : "Rocky Core agent is unavailable.",
        startedAt: null,
        endedAt: null,
        updatedAt: input.timestamp,
      };
    }

    const startRun = async (reuseSessionId: string | null) => {
      const session = reuseSessionId
        ? null
        : await this.sessionService!.createSession({
            agentId,
            title: input.message.slice(0, 80),
            kind: "task-request",
            runtimeKind: input.defaultRuntimeKind,
            ollamaLaunchTarget: input.defaultOllamaLaunchTarget,
            model: input.defaultModel,
            reasoningEffort: input.defaultReasoningEffort,
            serviceTier: input.defaultServiceTier,
          });
      const sessionId = session?.id ?? reuseSessionId;
      if (!sessionId) {
        throw new Error("Rocky Core session id is required.");
      }

      const run = await this.sessionService!.sendTurn({
        sessionId,
        prompt: input.message,
        triggerType: "interactive",
        extraSystemInstructions: input.extraSystemInstructions,
      });

      return { run, sessionId };
    };

    try {
      const started = await startRun(input.reuseSessionId ?? null);
      return {
        id: orchestrationId,
        status: runStatusToOrchestrationStatus(started.run.status),
        agentId,
        sessionId: started.sessionId,
        runId: started.run.id,
        output: null,
        error: null,
        startedAt: started.run.startedAt,
        endedAt: started.run.endedAt,
        updatedAt: this.now(),
      };
    } catch (error) {
      let finalError = error;
      if (input.reuseSessionId && isUnknownRuntimeRecordError(error)) {
        try {
          const started = await startRun(null);
          return {
            id: orchestrationId,
            status: runStatusToOrchestrationStatus(started.run.status),
            agentId,
            sessionId: started.sessionId,
            runId: started.run.id,
            output: null,
            error: null,
            startedAt: started.run.startedAt,
            endedAt: started.run.endedAt,
            updatedAt: this.now(),
          };
        } catch (retryError) {
          finalError = retryError;
        }
      }

      return {
        id: orchestrationId,
        status: "failed",
        agentId,
        sessionId: null,
        runId: null,
        output: null,
        error: errorMessage(finalError),
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
    const canHydrateResult = Boolean(this.sessionService.getRunResult);
    if (isTerminal && !canHydrateOutput && !canHydrateResult) {
      return orchestration;
    }
    if (
      !this.sessionService.getRun &&
      !this.sessionService.getRunResult &&
      !canHydrateOutput
    ) {
      return orchestration;
    }

    const missingActiveOrchestration = (
      error: unknown
    ): RockyOrchestrationRecord | null => {
      if (!isTerminal && isUnknownRuntimeRecordError(error)) {
        return {
          ...orchestration,
          status: "failed",
          error: missingRuntimeRecordMessage(error),
          endedAt: orchestration.endedAt ?? this.now(),
          updatedAt: this.now(),
        };
      }

      return null;
    };

    let run: AgentRunRecord | null = null;
    if (!isTerminal && this.sessionService.getRun) {
      try {
        run = await this.sessionService.getRun(orchestration.runId);
      } catch (error) {
        return missingActiveOrchestration(error) ?? orchestration;
      }
    }

    let result: RuntimeRunResult | null = null;
    if (
      this.sessionService.getRunResult &&
      ((run && run.status !== "running") || isTerminal)
    ) {
      try {
        result = await this.sessionService.getRunResult(orchestration.runId);
      } catch (error) {
        const missing = missingActiveOrchestration(error);
        if (missing && !run) {
          return missing;
        }
      }
    }

    let transcriptOutput = orchestration.output;
    const status = run ? runStatusToOrchestrationStatus(run.status) : orchestration.status;
    const shouldHydrateTranscript = Boolean(
      orchestration.sessionId &&
        this.sessionService.getTranscript &&
        (!orchestration.output || !isTerminal)
    );
    if (shouldHydrateTranscript) {
      try {
        transcriptOutput =
          latestAssistantText(
            await this.sessionService.getTranscript(orchestration.sessionId!)
          ) ?? orchestration.output;
      } catch (error) {
        const missing = missingActiveOrchestration(error);
        if (missing && status === "running") {
          return missing;
        }
      }
    }

    const terminalRunSummary =
      run && run.status !== "running" ? run.summary?.trim() || null : null;
    const output =
      resultAssistantText(result) ??
      terminalRunSummary ??
      transcriptOutput ??
      orchestration.output;
    return {
      ...orchestration,
      status,
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
  }
}
