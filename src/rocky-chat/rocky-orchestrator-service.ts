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

    try {
      const sessionId = input.reuseSessionId ?? null;
      const session = sessionId
        ? null
        : await this.sessionService.createSession({
            agentId,
            title: input.message.slice(0, 80),
            kind: "task-request",
            runtimeKind: input.defaultRuntimeKind,
            ollamaLaunchTarget: input.defaultOllamaLaunchTarget,
            model: input.defaultModel,
            reasoningEffort: input.defaultReasoningEffort,
            serviceTier: input.defaultServiceTier,
          });
      const run = await this.sessionService.sendTurn({
        sessionId: session?.id ?? sessionId!,
        prompt: input.message,
        triggerType: "interactive",
        extraSystemInstructions: input.extraSystemInstructions,
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

    try {
      const run =
        !isTerminal && this.sessionService.getRun
          ? await this.sessionService.getRun(orchestration.runId)
          : null;
      const result =
        this.sessionService.getRunResult &&
        ((run && run.status !== "running") ||
          isTerminal)
          ? await this.sessionService.getRunResult(orchestration.runId)
          : null;
      const transcriptOutput =
        orchestration.sessionId && this.sessionService.getTranscript
          ? latestAssistantText(await this.sessionService.getTranscript(orchestration.sessionId))
          : orchestration.output;
      const terminalRunSummary =
        run && run.status !== "running" ? run.summary?.trim() || null : null;
      const output =
        resultAssistantText(result) ??
        terminalRunSummary ??
        transcriptOutput ??
        orchestration.output;
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
