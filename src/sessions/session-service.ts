import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { AgentManager } from "../agents/agent-manager.js";
import { resolveWorkspaceScaffoldPaths } from "../agents/agent-workspace.js";
import { AuthProfileService } from "../auth/auth-profile-service.js";
import type { AuthProfileServiceLike } from "../auth/auth-profile-types.js";
import { AsyncEventQueue } from "../runtime/async-event-queue.js";
import { resolveCodexBin } from "../runtime/codex-bin-resolver.js";
import { OLLAMA_CODEX_PROFILE } from "../runtime/ollama-runtime.js";
import {
  appendJsonLine,
  ensureRunPaths,
  ensureSessionPaths,
  findRunLocation,
  findSessionLocation,
  listAgentRunPaths,
  listAgentSessionPaths,
  readJsonFile,
  readJsonLines,
  resolveAgentRunPaths,
  resolveAgentSessionPaths,
  serializeJson,
  writeJsonLines,
} from "./session-store.js";
import {
  validatePersistedSessionRoots,
  validateSessionCreateInput,
  validateSessionTurnInput,
} from "./session-policy.js";
import { monitorSessionRun } from "./session-run-monitor.js";
import {
  applyStartedRunToSession,
  buildRuntimeRequest,
  buildRunningRunRecord,
  buildSessionRecord,
  buildUserTurnMessage,
  hydrateSessionRecord,
  hydrateSessionMessage,
  resolveSessionServiceStateRoot,
  sessionStatusFromRunStatus,
  runtimeSessionOverridesFromRecord,
  truncateSummary,
} from "./session-service-helpers.js";

import type { AgentRecord } from "../agents/agent-types.js";
import type {
  RuntimeAuthSource,
  RuntimeEvent,
  RuntimeKind,
  RuntimeOllamaLaunchTarget,
  RuntimeReasoningEffort,
  RuntimeRunResult,
  RuntimeServiceTier,
  RuntimeSession,
} from "../runtime/runtime-types.js";
import type {
  AgentRunPaths,
  AgentRunRecord,
  AgentSessionCreateInput,
  AgentSessionLifecycle,
  AgentSessionMessage,
  AgentSessionPaths,
  AgentSessionRecord,
  AgentSessionTurnInput,
  AgentSessionUpdateInput,
  LiveRunState,
  SessionServiceOptions,
} from "./session-types.js";

function mergeSessionWritableDirs(
  agent: AgentRecord,
  requestedDirs: string[] | undefined
): string[] {
  const requiredSkillDir = resolveWorkspaceScaffoldPaths(agent.workspaceRoot).skillsDir;
  return [...new Set([requiredSkillDir, ...(requestedDirs ?? [])].map((entry) => path.resolve(entry)))];
}

function buildAgentSkillAuthoringInstructions(agent: AgentRecord): string[] {
  const baseInstructions = [
    "For explicit user requests to create, add, register, update, or improve a reusable skill, follow the internal skill-creator workflow as authoring guidance, but create only agent-local skill files under `.agents/skills/<skill-id>/`.",
    "After creating or updating an agent-local skill, refresh the generated skill bridge by ensuring the new skill has a valid `SKILL.md`; the platform will treat it as an equipped skill for this agent.",
  ];

  if (!agent.skillPolicy?.automaticSkillCreation) {
    return [
      ...baseInstructions,
      "Automatic skill creation is disabled for this agent. Do not turn ordinary task requests into new skills unless the user explicitly asks for a reusable skill or skill update.",
    ];
  }

  return [
    ...baseInstructions,
    "Automatic skill creation is enabled for this agent. When the user's request is primarily about saving a reusable workflow, repeated operating rule, integration procedure, or future capability, proactively proceed through the skill-creator workflow.",
    "If the request can be completed as a one-off task without a durable reusable workflow, do the task normally instead of creating a skill.",
    "If key skill metadata is missing, ask only for the missing blocking detail; otherwise create the agent-local skill directly.",
  ];
}

export class SessionService {
  private readonly stateRoot: string;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly manager: AgentManager;
  private readonly authProfiles: AuthProfileServiceLike;
  private readonly runtimeRegistry: NonNullable<SessionServiceOptions["runtimeRegistry"]>;
  private readonly idGenerator: () => string;
  private readonly now: () => string;
  private readonly liveRuns = new Map<string, LiveRunState & { queue: AsyncEventQueue<RuntimeEvent> }>();
  private readonly activeSessionRuns = new Map<string, string>();

  constructor(options: SessionServiceOptions) {
    if (!options.runtimeRegistry && !options.runtime) {
      throw new Error("SessionService requires a runtime adapter or registry");
    }

    this.stateRoot = resolveSessionServiceStateRoot(options.stateRoot);
    this.baseEnv = options.baseEnv ?? process.env;
    this.manager =
      (options.manager as AgentManager | undefined) ??
      new AgentManager({
        stateRoot: this.stateRoot,
      });
    this.authProfiles =
      options.authProfiles ??
      new AuthProfileService({
        stateRoot: this.stateRoot,
        now: options.now,
        idGenerator: options.idGenerator,
      });
    this.runtimeRegistry =
      options.runtimeRegistry ?? {
        get: (kind) => {
          if (kind !== "codex-cli") {
            throw new Error(
              `SessionService runtime-only mode does not support ${kind}; provide a runtimeRegistry.`
            );
          }

          return {
            kind: "codex-cli" as const,
            adapter: options.runtime!,
            resolveBin: (requestedBin: string | undefined, env = this.baseEnv) =>
              resolveCodexBin(requestedBin, env),
          };
        },
      };
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async createSession(
    input: AgentSessionCreateInput
  ): Promise<AgentSessionRecord> {
    const agent = await this.manager.getAgent(input.agentId);
    if (agent.lifecycle === "archived") {
      throw this.conflictError(`Archived agents are read-only: ${input.agentId}`);
    }
    validateSessionCreateInput(agent, input);
    if (input.authProfileId) {
      await this.authProfiles.getProfile(input.authProfileId);
    }
    const additionalWritableDirs = mergeSessionWritableDirs(
      agent,
      input.additionalWritableDirs
    );
    const runtimeKind = input.runtimeKind ?? agent.defaultRuntime;
    const ollamaLaunchTarget =
      runtimeKind === "ollama"
        ? input.ollamaLaunchTarget ??
          (agent.defaultRuntime === "claude-code" ? "claude" : "codex")
        : null;
    const profile =
      runtimeKind === "ollama" && ollamaLaunchTarget === "codex"
        ? OLLAMA_CODEX_PROFILE
        : input.profile;
    const runtimeEntry = this.runtimeRegistry.get(runtimeKind);
    const codexBin = await this.resolveRuntimeBinary(
      runtimeKind,
      input.codexBin
    );
    const runtimeSession = (await this.manager.createRuntimeSession(
      runtimeEntry.adapter,
      agent,
      {
        sessionId: input.sessionId ?? this.idGenerator(),
        runtimeKind,
        runtimeSessionId: null,
        workspaceRoot: input.workspaceRoot,
        runtimeHome: input.runtimeHome,
        codexBin,
        sandbox: input.sandbox,
        approval: input.approval,
        profile,
        authProfileId: input.authProfileId ?? null,
        model: input.model,
        reasoningEffort: input.reasoningEffort ?? null,
        serviceTier: input.serviceTier ?? null,
        ollamaLaunchTarget,
        fullAuto: input.fullAuto,
        dangerouslyBypassApprovalsAndSandbox:
          input.dangerouslyBypassApprovalsAndSandbox,
        additionalWritableDirs,
        configOverrides: input.configOverrides,
        enableFeatures: input.enableFeatures,
        disableFeatures: input.disableFeatures,
        skipGitRepoCheck: input.skipGitRepoCheck,
        ephemeral: input.ephemeral,
      }
    )) as RuntimeSession;

    const session = buildSessionRecord(
      agent.id,
      runtimeSession,
      input.title ?? null,
      input.kind ?? "task-request"
    );
    const sessionPaths = resolveAgentSessionPaths({
      stateRoot: this.stateRoot,
      agentId: agent.id,
      sessionId: session.id,
    });

    await ensureSessionPaths(sessionPaths);
    await this.writeSessionRecord(sessionPaths, session);

    return session;
  }

  async getSession(sessionId: string): Promise<AgentSessionRecord> {
    const location = await findSessionLocation(this.stateRoot, sessionId);
    if (!location) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    return this.readSessionRecord(location.paths.metadataPath);
  }

  async listAgentSessions(
    agentId: string,
    options: {
      includeArchived?: boolean;
      kinds?: AgentSessionRecord["kind"][];
    } = {}
  ): Promise<AgentSessionRecord[]> {
    const sessionPaths = await listAgentSessionPaths(this.stateRoot, agentId);
    const sessions = await Promise.all(sessionPaths.map((entry) => this.readSessionRecord(entry.metadataPath)));

    const lifecycleFiltered = options.includeArchived
      ? sessions
      : sessions.filter((session) => session.lifecycle !== "archived");
    const visibleSessions =
      options.kinds && options.kinds.length > 0
        ? lifecycleFiltered.filter((session) => options.kinds!.includes(session.kind))
        : lifecycleFiltered;

    return visibleSessions.sort(
      (left, right) =>
        right.lastActivityAt.localeCompare(left.lastActivityAt) ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id)
    );
  }

  async updateSession(input: AgentSessionUpdateInput): Promise<AgentSessionRecord> {
    const location = await findSessionLocation(this.stateRoot, input.sessionId);
    if (!location) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }

    const session = await this.readSessionRecord(location.paths.metadataPath);
    const agent = await this.manager.getAgent(session.agentId);
    const nextLifecycle = input.lifecycle ?? session.lifecycle;
    const shouldArchive = session.lifecycle !== "archived" && nextLifecycle === "archived";
    const shouldRestore = session.lifecycle === "archived" && nextLifecycle === "active";

    if (shouldArchive && this.isSessionMutating(session.id, session.status)) {
      throw this.conflictError(
        `Cannot archive a session with an active run: ${session.id}`
      );
    }

    if (shouldRestore && agent.lifecycle === "archived") {
      throw this.conflictError(
        `Cannot restore a session while its agent is archived: ${session.agentId}`
      );
    }

    if (Object.prototype.hasOwnProperty.call(input, "title")) {
      session.title = input.title ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "authProfileId")) {
      if (
        input.authProfileId !== session.authProfileId &&
        (this.isSessionMutating(session.id, session.status) ||
          session.runtimeSessionId !== null)
      ) {
        throw this.conflictError(
          `Cannot change authProfileId after the session is bound or running: ${session.id}`
        );
      }

      if (input.authProfileId) {
        await this.authProfiles.getProfile(input.authProfileId);
      }

      session.authProfileId = input.authProfileId ?? null;
      session.runtimeConfig.authProfileId = session.authProfileId;
    }

    if (Object.prototype.hasOwnProperty.call(input, "model")) {
      if (this.isSessionMutating(session.id, session.status)) {
        throw this.conflictError(
          `Cannot change model while a session run is active: ${session.id}`
        );
      }

      session.runtimeConfig.model = input.model ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "reasoningEffort")) {
      if (this.isSessionMutating(session.id, session.status)) {
        throw this.conflictError(
          `Cannot change reasoning effort while a session run is active: ${session.id}`
        );
      }

      session.runtimeConfig.reasoningEffort = input.reasoningEffort ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(input, "serviceTier")) {
      if (this.isSessionMutating(session.id, session.status)) {
        throw this.conflictError(
          `Cannot change service tier while a session run is active: ${session.id}`
        );
      }

      session.runtimeConfig.serviceTier = input.serviceTier ?? null;
    }

    if (input.lifecycle) {
      session.lifecycle = input.lifecycle;
      session.archivedAt =
        input.lifecycle === "archived" ? this.now() : null;
    }

    await this.writeSessionRecord(location.paths, session);
    return session;
  }

  async getTranscript(sessionId: string): Promise<AgentSessionMessage[]> {
    const location = await findSessionLocation(this.stateRoot, sessionId);
    if (!location) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    const messages = await readJsonLines<AgentSessionMessage>(
      location.paths.transcriptPath
    );
    return messages.map(hydrateSessionMessage);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const location = await findSessionLocation(this.stateRoot, sessionId);
    if (!location) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    const session = await this.readSessionRecord(location.paths.metadataPath);
    if (this.isSessionMutating(session.id, session.status)) {
      throw this.conflictError(
        `Cannot delete a session with an active run: ${session.id}`
      );
    }

    const runPaths = await listAgentRunPaths(this.stateRoot, location.agentId);
    const runRootsToDelete: string[] = [];

    for (const runPath of runPaths) {
      const run = await this.readRunRecordIfPresent(runPath.metadataPath);
      if (!run) {
        continue;
      }

      if (run.sessionId === sessionId) {
        runRootsToDelete.push(runPath.runRoot);
      }
    }

    await rm(location.paths.sessionRoot, {
      recursive: true,
      force: false,
    });

    for (const runRoot of runRootsToDelete) {
      await rm(runRoot, {
        recursive: true,
        force: false,
      });
    }
  }

  async stopSessionRuns(sessionId: string): Promise<string[]> {
    const session = await this.getSession(sessionId);
    const runIds = new Set<string>();
    const activeRunId = this.activeSessionRuns.get(sessionId);
    if (activeRunId) {
      runIds.add(activeRunId);
    }

    const runPaths = await listAgentRunPaths(this.stateRoot, session.agentId);
    for (const runPath of runPaths) {
      const run = await this.readRunRecordIfPresent(runPath.metadataPath);
      if (!run) {
        continue;
      }

      if (run.sessionId === sessionId && run.status === "running") {
        runIds.add(run.id);
      }
    }

    if (runIds.size === 0) {
      return [];
    }

    const completions = [...runIds].map((runId) => ({
      runId,
      completion: this.liveRuns.get(runId)?.completion ?? Promise.resolve(null),
    }));

    await Promise.all([...runIds].map((runId) => this.cancelRun(runId)));
    await Promise.all(completions.map(({ completion }) => completion));

    return [...runIds];
  }

  async sendTurn(input: AgentSessionTurnInput): Promise<AgentRunRecord> {
    if (this.activeSessionRuns.has(input.sessionId)) {
      throw new Error(`Session already has a running turn: ${input.sessionId}`);
    }

    const session = await this.getSession(input.sessionId);
    const agent = await this.manager.getAgent(session.agentId);
    if (agent.lifecycle === "archived") {
      throw this.conflictError(`Archived agents are read-only: ${session.agentId}`);
    }
    if (session.lifecycle === "archived") {
      throw this.conflictError(`Archived sessions are read-only: ${input.sessionId}`);
    }
    const sessionPaths = resolveAgentSessionPaths({
      stateRoot: this.stateRoot,
      agentId: session.agentId,
      sessionId: session.id,
    });
    await this.reconcileSessionRuntimeState(agent, session, sessionPaths);
    validatePersistedSessionRoots(agent, session);
    validateSessionTurnInput(session, input);
    const reusedMessageContext = input.reuseMessageId
      ? await this.prepareReusedMessageContext(sessionPaths.transcriptPath, {
        messageId: input.reuseMessageId,
        sessionId: session.id,
      })
      : null;
    await this.applyTurnOverrides(agent, session, input);
    await this.reconcileSessionRuntimeState(agent, session, sessionPaths);
    const runId = input.runId ?? this.idGenerator();
    const runPaths = resolveAgentRunPaths({
      stateRoot: this.stateRoot,
      agentId: session.agentId,
      runId,
    });

    await ensureSessionPaths(sessionPaths);
    await ensureRunPaths(runPaths);
    await this.hydrateRuntimeSession(agent, session);
    const authSource = await this.resolveRuntimeAuthSource(session, input);
    const turnInput: AgentSessionTurnInput = {
      ...input,
      extraSystemInstructions: [
        ...buildAgentSkillAuthoringInstructions(agent),
        ...(input.extraSystemInstructions ?? []),
      ],
    };

    const runtimeRequest = buildRuntimeRequest({
      session,
      input: turnInput,
      runId,
      runPaths,
      authSource,
    });
    const runtime = this.getRuntimeAdapter(session.runtimeKind);
    const started = session.runtimeSessionId
      ? await runtime.resumeSession(runtimeRequest)
      : await runtime.sendTurn(runtimeRequest);

    const run = buildRunningRunRecord({
      session,
      input: turnInput,
      runId,
      started,
      runPaths,
    });

    applyStartedRunToSession(session, turnInput.prompt, started.startedAt);

    await this.writeSessionRecord(sessionPaths, session);
    await this.writeRunRecord(runPaths, run);
    await this.persistUserTurnMessage({
      sessionPaths,
      sessionId: session.id,
      runId,
      prompt: turnInput.prompt,
      createdAt: started.startedAt,
      reusedMessageContext,
    });

    const queue = new AsyncEventQueue<RuntimeEvent>();
    const completion = monitorSessionRun({
      runtime,
      session,
      sessionPaths,
      run,
      runPaths,
      queue,
      onSettled: () => {
        this.activeSessionRuns.delete(session.id);
        this.liveRuns.delete(run.id);
      },
    });

    this.activeSessionRuns.set(session.id, run.id);
    this.liveRuns.set(run.id, {
      sessionId: session.id,
      runtimeKind: session.runtimeKind,
      eventQueue: queue,
      queue,
      completion,
    });

    return run;
  }

  private async readSessionRecord(metadataPath: string): Promise<AgentSessionRecord> {
    const persisted = await readJsonFile<
      AgentSessionRecord & {
        lifecycle?: AgentSessionLifecycle;
        archivedAt?: string | null;
      }
    >(metadataPath);

    return hydrateSessionRecord(persisted);
  }

  private async readRunRecordIfPresent(
    metadataPath: string
  ): Promise<AgentRunRecord | null> {
    try {
      return await readJsonFile<AgentRunRecord>(metadataPath);
    } catch (error) {
      if (this.isMissingPathError(error)) {
        return null;
      }

      throw error;
    }
  }

  private isSessionMutating(
    sessionId: string,
    status: AgentSessionRecord["status"]
  ): boolean {
    return this.activeSessionRuns.has(sessionId) || status === "running";
  }

  private isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    );
  }

  private conflictError(message: string): Error & { statusCode: number } {
    return Object.assign(new Error(message), {
      statusCode: 409,
    });
  }

  async *streamRunEvents(runId: string): AsyncGenerator<RuntimeEvent> {
    const liveRun = this.liveRuns.get(runId);
    if (liveRun) {
      yield* liveRun.queue;
      return;
    }

    const location = await findRunLocation(this.stateRoot, runId);
    if (!location) {
      throw new Error(`Unknown run: ${runId}`);
    }

    for (const event of await readJsonLines<RuntimeEvent>(location.paths.eventsPath)) {
      yield event;
    }
  }

  async getRun(runId: string): Promise<AgentRunRecord> {
    const location = await findRunLocation(this.stateRoot, runId);
    if (!location) {
      throw new Error(`Unknown run: ${runId}`);
    }

    const run = await readJsonFile<AgentRunRecord>(location.paths.metadataPath);
    if (run.status === "running" && !this.liveRuns.has(runId)) {
      return (
        await this.recoverDetachedRun(location.paths, run, {
          status: "failed",
          message:
            "Run lost its live runtime handle before a terminal result was recorded.",
        })
      ).run;
    }

    return run;
  }

  async getRunResult(runId: string): Promise<RuntimeRunResult> {
    const liveRun = this.liveRuns.get(runId);
    if (liveRun) {
      await liveRun.completion;
    }

    const location = await findRunLocation(this.stateRoot, runId);
    if (!location) {
      throw new Error(`Unknown run: ${runId}`);
    }

    const run = await readJsonFile<AgentRunRecord>(location.paths.metadataPath);
    if (run.status === "running") {
      return (
        await this.recoverDetachedRun(location.paths, run, {
          status: "failed",
          message:
            "Run lost its live runtime handle before a terminal result was recorded.",
        })
      ).result;
    }

    return readJsonFile<RuntimeRunResult>(location.paths.resultPath);
  }

  async cancelRun(runId: string): Promise<void> {
    const liveRun = this.liveRuns.get(runId);
    if (liveRun) {
      await this.getRuntimeAdapterForRun(runId).cancelRun(runId);
      return;
    }

    const location = await findRunLocation(this.stateRoot, runId);
    if (!location) {
      throw new Error(`Unknown run: ${runId}`);
    }

    const run = await readJsonFile<AgentRunRecord>(location.paths.metadataPath);
    if (run.status !== "running") {
      return;
    }

    await this.recoverDetachedRun(location.paths, run, {
      status: "cancelled",
      message:
        "Run was cancelled after the live runtime handle was no longer available.",
    });
  }

  async stopAgentRuns(agentId: string): Promise<string[]> {
    const sessions = await this.listAgentSessions(agentId, {
      includeArchived: true,
    });
    const runningSessions = sessions.filter((session) => session.status === "running");
    const unresolvedSessions = runningSessions.filter(
      (session) => !this.activeSessionRuns.has(session.id)
    );
    if (unresolvedSessions.length > 0) {
      throw this.conflictError(
        `Cannot stop running sessions without active run handles: ${unresolvedSessions
          .map((session) => session.id)
          .join(", ")}`
      );
    }

    const runIds = [
      ...new Set(
        runningSessions
          .map((session) => this.activeSessionRuns.get(session.id))
          .filter((runId): runId is string => Boolean(runId))
      ),
    ];

    const completions = runIds.map((runId) => ({
      runId,
      completion: this.liveRuns.get(runId)?.completion ?? Promise.resolve(null),
    }));

    await Promise.all(
      runIds.map((runId) => this.getRuntimeAdapterForRun(runId).cancelRun(runId))
    );
    await Promise.all(completions.map(({ completion }) => completion));

    return runIds;
  }

  private async hydrateRuntimeSession(
    agent: AgentRecord,
    session: AgentSessionRecord
  ): Promise<RuntimeSession> {
    const runtimeEntry = this.runtimeRegistry.get(session.runtimeKind);
    return (await this.manager.createRuntimeSession(
      runtimeEntry.adapter,
      agent,
      runtimeSessionOverridesFromRecord(session)
    )) as RuntimeSession;
  }

  private async reconcileSessionRuntimeState(
    agent: AgentRecord,
    session: AgentSessionRecord,
    sessionPaths: {
      metadataPath: string;
    }
  ): Promise<void> {
    let changed = false;
    const normalizedWritableDirs = mergeSessionWritableDirs(
      agent,
      session.runtimeConfig.additionalWritableDirs
    );
    const resolvedCodexBin = await this.resolveRuntimeBinary(
      session.runtimeKind,
      session.runtimeConfig.codexBin
    );

    if (session.workspaceRoot !== agent.workspaceRoot) {
      session.workspaceRoot = agent.workspaceRoot;
      changed = true;
    }

    if (session.runtimeHome !== agent.runtimeHome) {
      session.runtimeHome = agent.runtimeHome;
      changed = true;
    }

    if (session.runtimeConfig.codexBin !== resolvedCodexBin) {
      session.runtimeConfig.codexBin = resolvedCodexBin;
      changed = true;
    }

    if (session.runtimeConfig.authProfileId !== session.authProfileId) {
      session.runtimeConfig.authProfileId = session.authProfileId;
      changed = true;
    }

    if (
      JSON.stringify(session.runtimeConfig.additionalWritableDirs) !==
      JSON.stringify(normalizedWritableDirs)
    ) {
      session.runtimeConfig.additionalWritableDirs = normalizedWritableDirs;
      changed = true;
    }

    if (!changed) {
      return;
    }

    await this.writeSessionRecord(sessionPaths, session);
  }

  private async resolveRuntimeBinary(
    runtimeKind: RuntimeKind,
    requestedBin: string | undefined
  ): Promise<string> {
    const runtimeEntry = this.runtimeRegistry.get(runtimeKind);
    const normalizedRequestedBin = requestedBin?.trim() || undefined;
    const effectiveRequestedBin = this.isRuntimeBinMismatch(runtimeKind, normalizedRequestedBin)
      ? undefined
      : normalizedRequestedBin;

    return runtimeEntry.resolveBin(effectiveRequestedBin, this.baseEnv);
  }

  private isRuntimeBinMismatch(
    runtimeKind: RuntimeKind,
    requestedBin: string | undefined
  ): boolean {
    if (!requestedBin) {
      return false;
    }

    const binName = path.basename(requestedBin).toLowerCase();
    if (runtimeKind === "ollama") {
      return (
        binName === "codex" ||
        binName === "codex.exe" ||
        binName === "claude" ||
        binName === "claude.exe"
      );
    }

    if (runtimeKind === "claude-code") {
      return (
        binName === "codex" ||
        binName === "codex.exe" ||
        binName === "ollama" ||
        binName === "ollama.exe"
      );
    }

    return (
      binName === "claude" ||
      binName === "claude.exe" ||
      binName === "ollama" ||
      binName === "ollama.exe"
    );
  }

  private async recoverDetachedRun(
    runPaths: AgentRunPaths,
    run: AgentRunRecord,
    options: {
      status: "failed" | "cancelled";
      message: string;
    }
  ): Promise<{
    run: AgentRunRecord;
    result: RuntimeRunResult;
  }> {
    const sessionLocation = await findSessionLocation(this.stateRoot, run.sessionId);
    if (!sessionLocation) {
      throw new Error(`Unknown session for run: ${run.id}`);
    }

    const session = await this.readSessionRecord(sessionLocation.paths.metadataPath);
    const persistedResult = await this.readStoredRunResult(runPaths.resultPath);
    const endedAt = persistedResult?.endedAt ?? this.now();
    const result =
      persistedResult ??
      ({
        runId: run.id,
        sessionId: run.sessionId,
        runtimeSessionId: run.runtimeSessionId ?? session.runtimeSessionId,
        sessionBinding:
          run.runtimeSessionId ?? session.runtimeSessionId
            ? {
                runtimeSessionId:
                  run.runtimeSessionId ?? session.runtimeSessionId ?? "",
                boundAt: run.startedAt,
                source: "session-service.recovered",
              }
            : null,
        status: options.status,
        startedAt: run.startedAt,
        endedAt,
        exitCode: null,
        signal: null,
        command: session.runtimeConfig.codexBin,
        args: [],
        messages: [],
        warnings: [
          {
            message: options.message,
            retriable: false,
            occurredAt: endedAt,
          },
        ],
        errors: options.status === "failed" ? [options.message] : [],
        stderr: [],
        artifactRefs: [],
        lastMessage: null,
        outputLastMessagePath: run.outputLastMessagePath,
        rawEvents: [],
      } satisfies RuntimeRunResult);

    run.status = result.status as AgentRunRecord["status"];
    run.endedAt = result.endedAt;
    run.summary = truncateSummary(
      result.lastMessage ??
        result.messages.at(-1)?.text ??
        options.message
    );
    run.runtimeSessionId = result.runtimeSessionId;

    session.runtimeSessionId = result.runtimeSessionId;
    session.status = sessionStatusFromRunStatus(result.status);
    session.lastActivityAt = result.endedAt ?? run.startedAt;

    await this.writeSessionRecord(sessionLocation.paths, session);
    await this.writeRunRecord(runPaths, run);

    if (!persistedResult) {
      await writeFile(runPaths.resultPath, serializeJson(result), "utf8");
      await appendJsonLine(runPaths.eventsPath, {
        source: "session-service",
        type: "run.completed",
        runId: run.id,
        sessionId: run.sessionId,
        runtimeSessionId: result.runtimeSessionId,
        rawType: "session.recovered",
        occurredAt: endedAt,
        data: {
          status: result.status,
          recovered: true,
          message: options.message,
        },
        raw: {
          status: result.status,
          message: options.message,
        },
      } satisfies RuntimeEvent);
    }

    return { run, result };
  }

  private async readStoredRunResult(
    resultPath: string
  ): Promise<RuntimeRunResult | null> {
    try {
      return await readJsonFile<RuntimeRunResult>(resultPath);
    } catch {
      return null;
    }
  }

  private async writeSessionRecord(
    sessionPaths: {
      metadataPath: string;
    },
    session: AgentSessionRecord
  ): Promise<void> {
    await writeFile(sessionPaths.metadataPath, serializeJson(session), "utf8");
  }

  private async writeRunRecord(
    runPaths: {
      metadataPath: string;
    },
    run: AgentRunRecord
  ): Promise<void> {
    await writeFile(runPaths.metadataPath, serializeJson(run), "utf8");
  }

  private async applyTurnOverrides(
    agent: AgentRecord,
    session: AgentSessionRecord,
    input: AgentSessionTurnInput
  ): Promise<void> {
    const hasOwn = (key: keyof AgentSessionTurnInput): boolean =>
      Object.prototype.hasOwnProperty.call(input, key);
    const nextRuntimeKind = input.runtimeKind ?? session.runtimeKind;
    const runtimeChanged = nextRuntimeKind !== session.runtimeKind;
    const nextAuthProfileId = hasOwn("authProfileId")
      ? input.authProfileId ?? null
      : session.authProfileId;
    const nextModel = hasOwn("model")
      ? input.model ?? null
      : runtimeChanged
        ? null
        : session.runtimeConfig.model ?? null;
    const nextReasoningEffort =
      nextRuntimeKind === "ollama"
        ? null
        : hasOwn("reasoningEffort")
          ? this.normalizeReasoningEffort(input.reasoningEffort)
          : runtimeChanged
            ? null
            : session.runtimeConfig.reasoningEffort ?? null;
    const nextServiceTier =
      nextRuntimeKind === "ollama"
        ? null
        : hasOwn("serviceTier")
          ? this.normalizeServiceTier(input.serviceTier)
          : runtimeChanged
            ? null
            : session.runtimeConfig.serviceTier ?? null;
    const nextOllamaLaunchTarget =
      nextRuntimeKind === "ollama"
        ? this.normalizeOllamaLaunchTarget(
          hasOwn("ollamaLaunchTarget")
            ? input.ollamaLaunchTarget
            : session.runtimeConfig.ollamaLaunchTarget ?? null
        ) ?? this.defaultOllamaLaunchTarget(agent, session)
        : null;
    const nextProfile =
      nextRuntimeKind === "ollama" && nextOllamaLaunchTarget === "codex"
        ? OLLAMA_CODEX_PROFILE
        : hasOwn("profile")
          ? input.profile ?? null
          : runtimeChanged
            ? null
            : session.runtimeConfig.profile ?? null;

    const runtimeSelectionChanged =
      runtimeChanged ||
      nextAuthProfileId !== session.authProfileId ||
      nextModel !== (session.runtimeConfig.model ?? null) ||
      nextReasoningEffort !== (session.runtimeConfig.reasoningEffort ?? null) ||
      nextServiceTier !== (session.runtimeConfig.serviceTier ?? null) ||
      nextOllamaLaunchTarget !== (session.runtimeConfig.ollamaLaunchTarget ?? null) ||
      nextProfile !== (session.runtimeConfig.profile ?? null);

    session.runtimeKind = nextRuntimeKind;
    session.authProfileId = nextAuthProfileId;
    session.runtimeConfig.authProfileId = nextAuthProfileId;
    session.runtimeConfig.model = nextModel;
    session.runtimeConfig.reasoningEffort = nextReasoningEffort;
    session.runtimeConfig.serviceTier = nextServiceTier;
    session.runtimeConfig.ollamaLaunchTarget = nextOllamaLaunchTarget;
    session.runtimeConfig.profile = nextProfile;

    if (runtimeSelectionChanged) {
      session.runtimeSessionId = null;
    }

    if (runtimeChanged || this.isRuntimeBinMismatch(nextRuntimeKind, session.runtimeConfig.codexBin)) {
      session.runtimeConfig.codexBin = await this.resolveRuntimeBinary(
        nextRuntimeKind,
        session.runtimeConfig.codexBin
      );
    }
  }

  private defaultOllamaLaunchTarget(
    agent: AgentRecord,
    session: AgentSessionRecord
  ): RuntimeOllamaLaunchTarget {
    if (session.runtimeKind === "ollama") {
      const currentTarget = this.normalizeOllamaLaunchTarget(
        session.runtimeConfig.ollamaLaunchTarget ?? null
      );
      if (currentTarget) {
        return currentTarget;
      }
    }

    return agent.defaultRuntime === "claude-code" ? "claude" : "codex";
  }

  private normalizeReasoningEffort(
    value: string | null | undefined
  ): RuntimeReasoningEffort | null {
    return value === "low" ||
      value === "medium" ||
      value === "high" ||
      value === "xhigh" ||
      value === "max"
      ? value
      : null;
  }

  private normalizeServiceTier(
    value: string | null | undefined
  ): RuntimeServiceTier | null {
    return value === "fast" ? value : null;
  }

  private normalizeOllamaLaunchTarget(
    value: string | null | undefined
  ): RuntimeOllamaLaunchTarget | null {
    return value === "claude" || value === "codex" ? value : null;
  }

  private async prepareReusedMessageContext(
    transcriptPath: string,
    input: {
      messageId: string;
      sessionId: string;
    }
  ): Promise<{
    index: number;
    messages: AgentSessionMessage[];
    replacedRunId: string | null;
  }> {
    const messages = await readJsonLines<AgentSessionMessage>(transcriptPath);
    const index = messages.findIndex((message) => message.id === input.messageId);
    const message = index >= 0 ? messages[index] : null;

    if (!message || message.sessionId !== input.sessionId || message.role !== "user") {
      throw Object.assign(
        new Error(`Cannot reuse missing user message: ${input.messageId}`),
        {
          statusCode: 404,
        }
      );
    }

    return {
      index,
      messages,
      replacedRunId:
        typeof message.runId === "string" && message.runId.length > 0
          ? message.runId
          : null,
    };
  }

  private async persistUserTurnMessage({
    sessionPaths,
    sessionId,
    runId,
    prompt,
    createdAt,
    reusedMessageContext,
  }: {
    sessionPaths: AgentSessionPaths;
    sessionId: string;
    runId: string;
    prompt: string;
    createdAt: string;
    reusedMessageContext: {
      index: number;
      messages: AgentSessionMessage[];
      replacedRunId: string | null;
    } | null;
  }): Promise<void> {
    if (!reusedMessageContext) {
      await appendJsonLine(
        sessionPaths.transcriptPath,
        buildUserTurnMessage(sessionId, runId, prompt, createdAt)
      );
      return;
    }

    const messageId = reusedMessageContext.messages[reusedMessageContext.index]?.id;
    const nextMessages = reusedMessageContext.messages
      .filter((message) =>
        !(
          reusedMessageContext.replacedRunId &&
          message.role === "assistant" &&
          message.runId === reusedMessageContext.replacedRunId
        )
      );
    const nextIndex = nextMessages.findIndex((message) => message.id === messageId);
    if (nextIndex < 0) {
      throw new Error(`Cannot reuse missing user message: ${messageId ?? "unknown"}`);
    }

    nextMessages[nextIndex] = {
      ...nextMessages[nextIndex],
      runId,
    };
    await writeJsonLines(sessionPaths.transcriptPath, nextMessages);
  }

  private async resolveRuntimeAuthSource(
    session: AgentSessionRecord,
    input: AgentSessionTurnInput
  ): Promise<RuntimeAuthSource> {
    if (session.authProfileId) {
      await this.authProfiles.markProfileUsed(session.authProfileId);
      return this.authProfiles.resolveRuntimeAuthSource(session.authProfileId);
    }

    if (input.seedAuthFromCurrentHome === false) {
      return {
        kind: "none",
      };
    }

    return {
      kind: "current-home",
    };
  }

  private getRuntimeAdapter(kind: RuntimeKind) {
    return this.runtimeRegistry.get(kind).adapter;
  }

  private getRuntimeAdapterForRun(runId: string) {
    const liveRun = this.liveRuns.get(runId);
    if (!liveRun) {
      throw new Error(`Run is not active: ${runId}`);
    }

    return {
      cancelRun: async (targetRunId: string) => {
        await this.getRuntimeAdapter(liveRun.runtimeKind).cancelRun(targetRunId);
      },
    };
  }
}
