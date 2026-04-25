import { randomUUID } from "node:crypto";

import type { AgentRecord } from "../agents/agent-types.js";
import {
  deleteRockyChatRecord,
  listRockyChatPaths,
  readRockyChatRecord,
  readRockyWorkerRecord,
  resolveRockyChatPaths,
  resolveRockyWorkerPaths,
  writeRockyChatRecord,
  writeRockyWorkerRecord,
} from "./rocky-chat-store.js";
import {
  extractRockyProtectionHints,
  getRockySkillByWorkerId,
  selectRockySkill,
  type RockyOrchestrationSkill,
} from "./rocky-skill-registry.js";
import {
  buildRockyTurnSystemInstructions,
  syncRockyAgentSkillWorkspace,
  writeRockyTurnContextFile,
} from "./rocky-agent-skill-workspace.js";
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

function titleFromMessage(message: string): string {
  const compact = message.replace(/\s+/gu, " ").trim();
  if (!compact) {
    return "Rocky와 새 대화";
  }

  return compact.length > 32 ? `${compact.slice(0, 32)}...` : compact;
}

function isUnknownSessionError(error: unknown): boolean {
  return error instanceof Error && /^Unknown session: /u.test(error.message);
}

export class RockyChatService {
  private readonly stateRoot: string | undefined;
  private readonly now: () => string;
  private readonly idGenerator: () => string;
  private readonly agentService: RockyAgentServiceLike | undefined;
  private readonly sessionService: RockySessionServiceLike | undefined;
  private readonly orchestrator: RockyOrchestratorService;

  constructor(options: RockyChatServiceOptions = {}) {
    this.stateRoot = options.stateRoot;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.agentService = options.agentService;
    this.sessionService = options.sessionService;
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
    const selection = selectRockySkill({ message, attachments });
    const { domain, intent, skill } = selection;
    const userMessage = this.buildUserMessage({
      chatId,
      message,
      attachments,
      domain,
      intent,
      createdAt: timestamp,
    });
    const routed = await this.handleRockyCoreMessage({
      chatId,
      messageId: userMessage.id,
      message,
      attachments,
      domain,
      intent,
      skill,
      selectionReason: selection.reason,
      reuseCoreSessionId: null,
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
    const selection = selectRockySkill({
      message,
      attachments,
      contextDomain: existing.domain,
    });
    const { domain, intent, skill } = selection;
    const userMessage = this.buildUserMessage({
      chatId,
      message,
      attachments,
      domain,
      intent,
      createdAt: timestamp,
    });
    const reuseCoreSessionId = this.findReusableCoreSessionId(existing);
    const routed = await this.handleRockyCoreMessage({
      chatId,
      messageId: userMessage.id,
      message,
      attachments: [...existing.attachments, ...attachments],
      domain,
      intent,
      skill,
      selectionReason: selection.reason,
      reuseCoreSessionId,
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

  private async handleRockyCoreMessage(input: {
    chatId: string;
    messageId: string;
    message: string;
    attachments: RockyAttachmentRecord[];
    domain: RockyChatDomain;
    intent: RockyRoutingIntent;
    skill: RockyOrchestrationSkill;
    selectionReason: string;
    reuseCoreSessionId: string | null;
    timestamp: string;
  }): Promise<{
    worker: RockyWorkerRecord | null;
    skillCandidates: RockySkillCandidateRecord[];
    dispatch: RockyDispatchRecord | null;
    rockyMessage: RockyMessageRecord;
  }> {
    const { agent, worker } = await this.ensureCoreWorker({
      skill: input.skill,
      reason: input.selectionReason,
      timestamp: input.timestamp,
    });
    const skillCandidates: RockySkillCandidateRecord[] = [];
    const dispatch = this.buildDispatch({
      chatId: input.chatId,
      messageId: input.messageId,
      skill: input.skill,
      intent: input.intent,
      domain: input.domain,
      workerId: worker.id,
      attachments: input.attachments,
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
      attachments: input.attachments,
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
      skill: input.skill,
      protectionHints: dispatch.protectionHints,
      reuseSessionId: input.reuseCoreSessionId,
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
    timestamp: string;
  }): RockyMessageRecord {
    const text =
      input.orchestration.output ??
      (input.orchestration.status === "failed"
        ? "Rocky Core 실행을 시작하지 못했습니다."
        : "Rocky가 답변을 작성하고 있어요.");

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

  private findReusableCoreSessionId(chat: RockyChatRecord): string | null {
    const coreDispatch = [...chat.dispatches]
      .reverse()
      .find(
        (dispatch) =>
          dispatch.skillId === "rocky.core" &&
          dispatch.orchestration?.sessionId
      );

    return coreDispatch?.orchestration?.sessionId ?? null;
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

    return {
      ...chat,
      worker,
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
    const messageUpdates = new Map<string, string>();
    const dispatches = await Promise.all(
      hydrated.dispatches.map(async (dispatch) => {
        if (!dispatch.orchestration) {
          return dispatch;
        }

        const orchestration = await this.orchestrator.refresh(dispatch.orchestration);
        if (JSON.stringify(orchestration) !== JSON.stringify(dispatch.orchestration)) {
          changed = true;
        }
        if (orchestration.output) {
          messageUpdates.set(dispatch.id, orchestration.output);
        }

        return {
          ...dispatch,
          orchestration,
          executionStarted: Boolean(orchestration.runId),
        };
      })
    );
    const messages =
      messageUpdates.size > 0
        ? hydrated.messages.map((message) => {
            if (!message.dispatchId) {
              return message;
            }
            const output = messageUpdates.get(message.dispatchId);
            if (!output || message.text === output) {
              return message;
            }
            changed = true;
            return {
              ...message,
              text: output,
            };
          })
        : hydrated.messages;
    const orchestration =
      [...dispatches].reverse().find((dispatch) => dispatch.orchestration)
        ?.orchestration ?? null;
    const refreshed: RockyChatRecord = {
      ...hydrated,
      messages,
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
