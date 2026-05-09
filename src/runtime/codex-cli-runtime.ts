import { spawn as defaultSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { AsyncEventQueue } from "./async-event-queue.js";
import { buildCodexCommand } from "./codex-command.js";
import { createCodexRunCompletion } from "./codex-runtime-completion.js";
import { createWorkspaceSnapshot } from "./codex-runtime-artifacts.js";
import {
  buildLiveRunState,
  buildRunStart,
  buildRuntimeSession,
  type LiveRuntimeRunState,
} from "./codex-runtime-helpers.js";
import { registerCodexRunStreamHandlers } from "./codex-runtime-events.js";
import { prepareWindowsCommandSpawn } from "./windows-command-spawn.js";
import {
  prepareCodexRuntimeEnvironment,
  SHARED_HOME_WRITABLE_SANDBOX_WARNING,
  shouldUseSharedHomeForWritableSandbox,
} from "./codex-runtime-environment.js";
import {
  DEFAULT_RUNTIME_CAPABILITIES,
  RuntimeAdapter,
} from "./runtime-adapter.js";

import type {
  CodexCommandMode,
  RuntimeCapabilities,
  RuntimeChildProcess,
  RuntimeEvent,
  RuntimeOptions,
  RuntimeRequest,
  RuntimeRunResult,
  RuntimeRunStart,
  RuntimeRunState,
  RuntimeSession,
  RuntimeSessionInput,
  SpawnLike,
} from "./runtime-types.js";

export { buildCodexCommand } from "./codex-command.js";
export { prepareCodexRuntimeEnvironment } from "./codex-runtime-environment.js";

export const CODEX_CLI_CAPABILITIES: Readonly<RuntimeCapabilities> =
  Object.freeze({
    ...DEFAULT_RUNTIME_CAPABILITIES,
    streaming: true,
    resumeSession: true,
    shellExecution: true,
    fileMutation: true,
    approvalFlow: true,
    durableSessionState: true,
    structuredEvents: true,
    skillInjection: true,
  });

export const UNSANDBOXED_SHELL_INSPECTION_WARNING =
  "This run used --dangerously-bypass-approvals-and-sandbox because the Codex sandbox on this host blocks live command and file execution.";

export class CodexCliRuntime extends RuntimeAdapter {
  private readonly spawnImpl: SpawnLike;
  private readonly now: () => string;
  private readonly idGenerator: () => string;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly runs = new Map<string, RuntimeRunState>();

  constructor(options: RuntimeOptions = {}) {
    super();
    this.spawnImpl = (options.spawn ??
      (defaultSpawn as unknown as SpawnLike));
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.baseEnv = options.baseEnv ?? process.env;
  }

  async createSession(input: RuntimeSessionInput): Promise<RuntimeSession> {
    if (!input.workspaceRoot) {
      throw new Error("createSession() requires workspaceRoot");
    }

    const session = buildRuntimeSession(input, this.now, this.idGenerator, {
      kind: "codex-cli",
      defaultRuntimeHomeDirname: "codex",
      defaultBin: "codex",
    });

    this.sessions.set(session.id, session);
    return session;
  }

  listCapabilities(): Readonly<RuntimeCapabilities> {
    return CODEX_CLI_CAPABILITIES;
  }

  async sendTurn(input: RuntimeRequest): Promise<RuntimeRunStart> {
    const session = this.requireSession(input.sessionId);

    if (session.runtimeSessionId) {
      throw new Error(
        "sendTurn() only starts the first turn. Use resumeSession() after a runtimeSessionId exists."
      );
    }

    return this.startRun("exec", session, input);
  }

  async resumeSession(input: RuntimeRequest): Promise<RuntimeRunStart> {
    const session = this.requireSession(input.sessionId);
    return this.startRun("resume", session, input);
  }

  async *streamEvents(runId: string): AsyncGenerator<RuntimeEvent> {
    const run = this.requireRun(runId);
    yield* run.eventQueue;
  }

  async cancelRun(runId: string): Promise<void> {
    const run = this.requireRun(runId);
    run.cancelled = true;
    run.child.kill("SIGTERM");
  }

  async getRunResult(runId: string): Promise<RuntimeRunResult> {
    const run = this.requireRun(runId);
    if (!run.completion) {
      throw new Error(`Run has no completion promise: ${runId}`);
    }
    await run.completion;
    if (!run.result) {
      throw new Error(`Run did not produce a result: ${runId}`);
    }
    return run.result;
  }

  private requireSession(sessionId: string): RuntimeSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  private requireRun(runId: string): RuntimeRunState & {
    eventQueue: AsyncEventQueue<RuntimeEvent>;
  } {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown run: ${runId}`);
    }
    return run as LiveRuntimeRunState;
  }

  private async startRun(
    mode: CodexCommandMode,
    session: RuntimeSession,
    request: RuntimeRequest
  ): Promise<RuntimeRunStart> {
    const runId = request.runId ?? this.idGenerator();
    const eventQueue = new AsyncEventQueue<RuntimeEvent>();
    const startedAt = this.now();
    const { command, args } = buildCodexCommand({
      mode,
      session,
      request,
    });
    const shareHomeWithBaseEnv = shouldUseSharedHomeForWritableSandbox({
      session,
      request,
      baseEnv: this.baseEnv,
      authSource: request.authSource ?? null,
    });
    const preparedEnvironment = await prepareCodexRuntimeEnvironment({
      runtimeHome: session.runtimeHome,
      workspaceRoot: session.workspaceRoot,
      baseEnv: this.baseEnv,
      extraEnv: request.extraEnv ?? {},
      authSource: request.authSource ?? null,
      runtimeSessionId: session.runtimeSessionId,
      seedAuthFromCurrentHome: request.seedAuthFromCurrentHome ?? true,
      shareHomeWithBaseEnv,
      reuseBasePlaywrightBrowsers: Boolean(
        request.dangerouslyBypassApprovalsAndSandbox && this.baseEnv.HOME
      ),
    });
    const workspaceSnapshot = await createWorkspaceSnapshot(session.workspaceRoot);

    const preparedSpawn = prepareWindowsCommandSpawn(command, args, {
      cwd: session.workspaceRoot,
      env: preparedEnvironment.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const child = this.spawnImpl(
      preparedSpawn.command,
      preparedSpawn.args,
      preparedSpawn.options
    );

    const run = buildLiveRunState({
      runId,
      session,
      mode,
      command: preparedSpawn.command,
      args: preparedSpawn.args,
      startedAt,
      child: child as RuntimeChildProcess,
      eventQueue,
      workspaceSnapshot,
    });

    this.runs.set(runId, run);

    if (shareHomeWithBaseEnv && preparedEnvironment.sharedHomeFallback) {
      run.warnings.push({
        message: SHARED_HOME_WRITABLE_SANDBOX_WARNING,
        retriable: false,
        occurredAt: startedAt,
      });
      eventQueue.push({
        source: "codex-cli",
        type: "run.warning",
        runId,
        sessionId: session.id,
        runtimeSessionId: session.runtimeSessionId,
        rawType: "runtime.environment",
        occurredAt: startedAt,
        data: {
          message: SHARED_HOME_WRITABLE_SANDBOX_WARNING,
          retriable: false,
          strategy: "shared-home-isolated-xdg",
        },
        raw: {
          runtimeHome: session.runtimeHome,
          effectiveHome: preparedEnvironment.effectiveHome,
          xdgRoot: preparedEnvironment.xdgRoot,
        },
      });
    }

    if (
      request.dangerouslyBypassApprovalsAndSandbox &&
      !session.config.dangerouslyBypassApprovalsAndSandbox
    ) {
      run.warnings.push({
        message: UNSANDBOXED_SHELL_INSPECTION_WARNING,
        retriable: false,
        occurredAt: startedAt,
      });
      eventQueue.push({
        source: "codex-cli",
        type: "run.warning",
        runId,
        sessionId: session.id,
        runtimeSessionId: session.runtimeSessionId,
        rawType: "runtime.policy",
        occurredAt: startedAt,
        data: {
          message: UNSANDBOXED_SHELL_INSPECTION_WARNING,
          retriable: false,
          strategy: "unsandboxed-shell-inspection-bypass",
        },
        raw: {
          sessionSandbox: session.config.sandbox,
          requestedPrompt: request.prompt,
        },
      });
    }

    registerCodexRunStreamHandlers({
      child,
      runId,
      run,
      session,
      eventQueue,
      now: this.now,
    });

    run.completion = createCodexRunCompletion({
      child,
      runId,
      session,
      run,
      command: preparedSpawn.command,
      args: preparedSpawn.args,
      request,
      eventQueue,
      now: this.now,
    });

    return buildRunStart(run);
  }
}
