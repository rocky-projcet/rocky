import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { AgentManager } from "../../src/agents/agent-manager.js";
import { resolveWorkspaceScaffoldPaths } from "../../src/agents/agent-workspace.js";
import { AuthProfileService } from "../../src/auth/auth-profile-service.js";
import { SessionService } from "../../src/sessions/session-service.js";
import {
  buildMessageRecord,
  buildRuntimePrompt,
  buildRuntimeRequest,
  detectShellExecutionHint,
  extractUserPrompt,
  isSafeReadOnlyShellCommand,
  isSafeWorkspaceInterpreterCommand,
  isSafeWorkspaceNetworkCommand,
  isSafeWorkspacePackageManagerCommand,
  shouldUseBrowserAutomationBypass,
  shouldUseUnsandboxedShellBypass,
} from "../../src/sessions/session-service-helpers.js";
import { AsyncEventQueue } from "../../src/runtime/async-event-queue.js";
import { RuntimeAdapter } from "../../src/runtime/runtime-adapter.js";
import {
  ensureRunPaths,
  resolveAgentRunPaths,
  resolveAgentSessionPaths,
  serializeJson,
} from "../../src/sessions/session-store.js";
import type {
  AgentRunRecord,
  AgentSessionRecord,
} from "../../src/sessions/session-types.js";

import type {
  RuntimeEvent,
  RuntimeRequest,
  RuntimeRunResult,
  RuntimeRunStart,
  RuntimeSession,
  RuntimeSessionInput,
} from "../../src/runtime/runtime-types.js";

class FakeRuntime extends RuntimeAdapter {
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly runs = new Map<
    string,
    {
      queue: AsyncEventQueue<RuntimeEvent>;
      result: Promise<RuntimeRunResult>;
    }
  >();
  private counter = 0;
  sendCalls = 0;
  resumeCalls = 0;
  lastRequest: RuntimeRequest | null = null;
  lastCreatedSession: RuntimeSession | null = null;

  private now(): string {
    this.counter += 1;
    return new Date(Date.UTC(2026, 2, 13, 0, 0, this.counter)).toISOString();
  }

  async createSession(input: RuntimeSessionInput): Promise<RuntimeSession> {
    const timestamp = this.now();
    const runtimeKind = input.runtimeKind ?? "codex-cli";
    const session: RuntimeSession = {
      id: input.id ?? `session-${this.counter}`,
      agentId: input.agentId ?? null,
      runtimeKind,
      runtimeSessionId: input.runtimeSessionId ?? null,
      workspaceRoot: input.workspaceRoot,
      runtimeHome:
        input.runtimeHome ??
        path.join(
          input.workspaceRoot,
          ".runtime",
          runtimeKind === "claude-code" ? "claude" : "codex"
        ),
      config: {
        codexBin: input.codexBin ?? "codex",
        sandbox: input.sandbox ?? "read-only",
        approval: input.approval ?? null,
        profile: input.profile ?? null,
        authProfileId: input.authProfileId ?? null,
        model: input.model ?? null,
        ollamaLaunchTarget: input.ollamaLaunchTarget ?? null,
        reasoningEffort: input.reasoningEffort ?? null,
        serviceTier: input.serviceTier ?? null,
        fullAuto: input.fullAuto ?? false,
        dangerouslyBypassApprovalsAndSandbox:
          input.dangerouslyBypassApprovalsAndSandbox ?? false,
        additionalWritableDirs: input.additionalWritableDirs ?? [],
        configOverrides: input.configOverrides ?? [],
        enableFeatures: input.enableFeatures ?? [],
        disableFeatures: input.disableFeatures ?? [],
        skipGitRepoCheck: input.skipGitRepoCheck ?? true,
        ephemeral: input.ephemeral ?? false,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.sessions.set(session.id, session);
    this.lastCreatedSession = session;
    return session;
  }

  async sendTurn(input: RuntimeRequest): Promise<RuntimeRunStart> {
    this.sendCalls += 1;
    return this.startRun("exec", input);
  }

  async resumeSession(input: RuntimeRequest): Promise<RuntimeRunStart> {
    this.resumeCalls += 1;
    return this.startRun("resume", input);
  }

  async *streamEvents(runId: string): AsyncGenerator<RuntimeEvent> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown run: ${runId}`);
    }

    yield* run.queue;
  }

  async cancelRun(): Promise<void> {}

  async getRunResult(runId: string): Promise<RuntimeRunResult> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown run: ${runId}`);
    }

    return run.result;
  }

  private async startRun(
    mode: "exec" | "resume",
    input: RuntimeRequest
  ): Promise<RuntimeRunStart> {
    this.lastRequest = input;
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }

    const queue = new AsyncEventQueue<RuntimeEvent>();
    const startedAt = this.now();
    const runtimeSessionId =
      session.runtimeSessionId ?? `thread-${session.id}`;
    const userPrompt = extractUserPrompt(input.prompt);
    const assistantText =
      mode === "exec" ? `first:${userPrompt}` : `resume:${userPrompt}`;

    const result = (async () => {
      queueMicrotask(() => {
        if (!session.runtimeSessionId) {
          session.runtimeSessionId = runtimeSessionId;
          queue.push({
            source: "fake-runtime",
            type: "session.bound",
            runId: input.runId ?? null,
            sessionId: session.id,
            runtimeSessionId,
            rawType: "thread.started",
            occurredAt: this.now(),
            data: { runtimeSessionId },
            raw: { runtimeSessionId },
          });
        }

        queue.push({
          source: "fake-runtime",
          type: "assistant.message.completed",
          runId: input.runId ?? null,
          sessionId: session.id,
          runtimeSessionId,
          rawType: "message.completed",
          occurredAt: this.now(),
          data: { text: assistantText, itemType: "message" },
          raw: { text: assistantText },
        });
        queue.push({
          source: "fake-runtime",
          type: "run.completed",
          runId: input.runId ?? null,
          sessionId: session.id,
          runtimeSessionId,
          rawType: "process.close",
          occurredAt: this.now(),
          data: { status: "completed", exitCode: 0, signal: null },
          raw: { exitCode: 0, signal: null },
        });
        queue.close();
      });

      const result: RuntimeRunResult = {
        runId: input.runId ?? "",
        sessionId: session.id,
        runtimeSessionId,
        sessionBinding: {
          runtimeSessionId,
          boundAt: startedAt,
          source: mode === "exec" ? "thread.started" : "existing-session",
        },
        status: "completed",
        startedAt,
        endedAt: this.now(),
        exitCode: 0,
        signal: null,
        command: "fake-codex",
        args: [mode, input.prompt],
        messages: [
          {
            role: "assistant",
            text: assistantText,
            itemType: "message",
            occurredAt: this.now(),
            source: "message.completed",
          },
        ],
        warnings: [],
        errors: [],
        stderr: [],
        artifactRefs: input.outputLastMessagePath
          ? [
              {
                kind: "file",
                role: "output-last-message",
                path: input.outputLastMessagePath,
              },
            ]
          : [],
        lastMessage: assistantText,
        outputLastMessagePath: input.outputLastMessagePath ?? null,
        rawEvents: [],
      };
      return result;
    })();

    if (input.outputLastMessagePath) {
      await mkdir(path.dirname(input.outputLastMessagePath), { recursive: true });
      await writeFile(input.outputLastMessagePath, assistantText, "utf8");
    }

    this.runs.set(input.runId ?? "", {
      queue,
      result,
    });

    return {
      runId: input.runId ?? "",
      sessionId: session.id,
      command: "fake-codex",
      args: [mode, input.prompt],
      startedAt,
      status: "running",
    };
  }
}

test("SessionService persists session metadata and transcripted runs", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-service-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const service = new SessionService({
    stateRoot,
    manager,
    runtime,
    idGenerator: (() => {
      const ids = ["session-1", "run-1", "run-2"];
      return () => ids.shift() ?? "";
    })(),
  });

  const agent = await manager.createAgent({
    name: "session-agent",
  });
  const session = await service.createSession({
    agentId: agent.id,
    title: "runtime session",
  });

  assert.equal(session.runtimeConfig.skipGitRepoCheck, true);

  const run = await service.sendTurn({
    sessionId: session.id,
    prompt: "hello",
  });
  const firstResult = await service.getRunResult(run.id);
  const firstEvents: string[] = [];
  for await (const event of service.streamRunEvents(run.id)) {
    firstEvents.push(event.type);
  }

  assert.equal(runtime.sendCalls, 1);
  assert.equal(runtime.resumeCalls, 0);
  assert.equal(firstResult.runtimeSessionId, "thread-session-1");
  assert.deepEqual(firstEvents, [
    "session.bound",
    "assistant.message.completed",
    "run.completed",
  ]);

  const updatedSession = await service.getSession(session.id);
  const transcriptAfterFirstRun = await service.getTranscript(session.id);
  const storedRun = await service.getRun(run.id);

  assert.equal(updatedSession.runtimeSessionId, "thread-session-1");
  assert.equal(updatedSession.status, "active");
  assert.equal(runtime.lastRequest?.prompt, buildRuntimePrompt(session, "hello"));
  assert.equal(storedRun.summary, "first:hello");
  assert.deepEqual(
    transcriptAfterFirstRun.map((message) => [message.role, message.content]),
    [
      ["user", "hello"],
      ["assistant", "first:hello"],
    ]
  );
  assert.deepEqual(transcriptAfterFirstRun[0]?.blocks, [
    {
      type: "text",
      text: "hello",
    },
  ]);
  assert.equal(transcriptAfterFirstRun[1]?.artifacts?.[0]?.role, "output-last-message");
  assert.equal(
    transcriptAfterFirstRun[1]?.artifacts?.[0]?.contentType,
    "text/plain; charset=utf-8"
  );
  assert.equal(transcriptAfterFirstRun[1]?.artifacts?.[0]?.previewable, false);
  assert.equal(transcriptAfterFirstRun[1]?.artifacts?.[0]?.previewUrl, null);
  assert.equal(
    transcriptAfterFirstRun[1]?.artifacts?.[0]?.downloadUrl,
    `/runs/${run.id}/artifacts/output-last-message`
  );
  assert.equal(
    transcriptAfterFirstRun[1]?.artifacts?.[0]?.preferredAction,
    "download"
  );
  assert.deepEqual(transcriptAfterFirstRun[1]?.blocks, [
    {
      type: "text",
      text: "first:hello",
    },
  ]);

  const resumedRun = await service.sendTurn({
    sessionId: session.id,
    prompt: "follow up",
  });
  const resumedResult = await service.getRunResult(resumedRun.id);
  const transcriptAfterResume = await service.getTranscript(session.id);

  assert.equal(runtime.resumeCalls, 1);
  assert.equal(
    runtime.lastRequest?.prompt,
    buildRuntimePrompt(updatedSession, "follow up")
  );
  assert.equal(resumedResult.runtimeSessionId, "thread-session-1");
  assert.deepEqual(
    transcriptAfterResume.map((message) => [message.role, message.content]),
    [
      ["user", "hello"],
      ["assistant", "first:hello"],
      ["user", "follow up"],
      ["assistant", "resume:follow up"],
    ]
  );
  assert.equal(
    transcriptAfterResume.at(-1)?.artifacts?.[0]?.role,
    "output-last-message"
  );
});

test("SessionService pins a managed auth profile to the session runtime", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-auth-profile-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const authProfiles = new AuthProfileService({
    stateRoot,
    idGenerator: () => "profile-1",
    now: (() => {
      const timestamps = [
        "2026-03-13T00:00:00.000Z",
        "2026-03-13T00:00:01.000Z",
        "2026-03-13T00:00:02.000Z",
      ];
      return () => timestamps.shift() ?? "2026-03-13T00:00:59.000Z";
    })(),
  });
  const service = new SessionService({
    stateRoot,
    manager,
    runtime,
    authProfiles,
    idGenerator: (() => {
      const ids = ["session-1", "run-1"];
      return () => ids.shift() ?? "";
    })(),
  });

  await manager.createAgent({
    name: "session-agent",
  });
  await authProfiles.createProfile({
    name: "Primary Analyst",
  });

  const session = await service.createSession({
    agentId: "agent-1",
    authProfileId: "profile-1",
  });

  assert.equal(session.authProfileId, "profile-1");
  assert.equal(session.runtimeConfig.authProfileId, "profile-1");

  const run = await service.sendTurn({
    sessionId: session.id,
    prompt: "hello auth profile",
  });
  await service.getRunResult(run.id);

  assert.deepEqual(runtime.lastRequest?.authSource, {
    kind: "managed-home",
    authProfileId: "profile-1",
    homePath: path.join(stateRoot, "auth-profiles", "profile-1", "home"),
  });

  await assert.rejects(
    service.updateSession({
      sessionId: session.id,
      authProfileId: null,
    }),
    /Cannot change authProfileId after the session is bound or running/
  );
});

test("SessionService persists updated model execution settings and records them on new runs", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-model-update-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const service = new SessionService({
    stateRoot,
    manager,
    runtime,
    idGenerator: (() => {
      const ids = ["session-1", "run-1"];
      return () => ids.shift() ?? "";
    })(),
  });

  const agent = await manager.createAgent({
    name: "session-agent",
  });
  const session = await service.createSession({
    agentId: agent.id,
  });

  const updatedSession = await service.updateSession({
    sessionId: session.id,
    model: "gpt-5.4-mini",
    reasoningEffort: "high",
    serviceTier: "fast",
  });

  assert.equal(updatedSession.runtimeConfig.model, "gpt-5.4-mini");
  assert.equal(updatedSession.runtimeConfig.reasoningEffort, "high");
  assert.equal(updatedSession.runtimeConfig.serviceTier, "fast");

  const run = await service.sendTurn({
    sessionId: session.id,
    prompt: "hello",
  });
  await service.getRunResult(run.id);

  const storedRun = await service.getRun(run.id);
  assert.equal(storedRun.model, "gpt-5.4-mini");
  assert.equal(storedRun.reasoningEffort, "high");
  assert.equal(storedRun.serviceTier, "fast");
  assert.equal(runtime.lastCreatedSession?.config.model, "gpt-5.4-mini");
  assert.equal(runtime.lastCreatedSession?.config.reasoningEffort, "high");
  assert.equal(runtime.lastCreatedSession?.config.serviceTier, "fast");
});

test("SessionService clears legacy default service tier before the next run", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-legacy-service-tier-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const service = new SessionService({
    stateRoot,
    manager,
    runtime,
    idGenerator: (() => {
      const ids = ["session-1", "run-1"];
      return () => ids.shift() ?? "";
    })(),
  });

  const agent = await manager.createAgent({
    name: "session-agent",
  });
  const session = await service.createSession({
    agentId: agent.id,
  });

  const sessionPaths = resolveAgentSessionPaths({
    stateRoot,
    agentId: agent.id,
    sessionId: session.id,
  });
  const persisted = JSON.parse(
    await readFile(sessionPaths.metadataPath, "utf8")
  ) as AgentSessionRecord;
  persisted.runtimeConfig.serviceTier = "default" as never;
  await writeFile(sessionPaths.metadataPath, serializeJson(persisted), "utf8");

  const run = await service.sendTurn({
    sessionId: session.id,
    prompt: "hello",
  });
  await service.getRunResult(run.id);

  const updatedSession = await service.getSession(session.id);
  assert.equal(updatedSession.runtimeConfig.serviceTier, null);
  assert.equal(runtime.lastCreatedSession?.config.serviceTier, null);
});

test("SessionService cancels a stale persisted running run without a live handle", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-stale-cancel-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  await manager.createAgent({
    name: "session-agent",
  });

  const service = new SessionService({
    stateRoot,
    manager,
    runtime,
    now: () => "2026-03-13T00:00:10.000Z",
    idGenerator: (() => {
      const ids = ["session-1"];
      return () => ids.shift() ?? "";
    })(),
  });

  const session = await service.createSession({
    agentId: "agent-1",
    title: "stale run session",
  });
  const sessionPaths = resolveAgentSessionPaths({
    stateRoot,
    agentId: "agent-1",
    sessionId: session.id,
  });
  const runPaths = resolveAgentRunPaths({
    stateRoot,
    agentId: "agent-1",
    runId: "run-stale",
  });

  await ensureRunPaths(runPaths);
  await writeFile(
    sessionPaths.metadataPath,
    serializeJson({
      ...session,
      status: "running",
      lastActivityAt: "2026-03-13T00:00:01.000Z",
    } satisfies AgentSessionRecord),
    "utf8"
  );
  await writeFile(
    runPaths.metadataPath,
    serializeJson({
      id: "run-stale",
      agentId: "agent-1",
      sessionId: session.id,
      runtimeRunId: "run-stale",
      triggerType: "interactive",
      status: "running",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      prompt: "hello",
      startedAt: "2026-03-13T00:00:01.000Z",
      endedAt: null,
      summary: null,
      runtimeSessionId: null,
      outputLastMessagePath: runPaths.outputLastMessagePath,
      resultPath: runPaths.resultPath,
      eventsPath: runPaths.eventsPath,
      artifactsDir: runPaths.artifactsDir,
    } satisfies AgentRunRecord),
    "utf8"
  );

  await service.cancelRun("run-stale");

  const updatedRun = await service.getRun("run-stale");
  const updatedSession = await service.getSession(session.id);
  const result = await service.getRunResult("run-stale");

  assert.equal(updatedRun.status, "cancelled");
  assert.equal(updatedRun.endedAt, "2026-03-13T00:00:10.000Z");
  assert.equal(updatedSession.status, "cancelled");
  assert.equal(result.status, "cancelled");
  assert.match(
    result.warnings[0]?.message ?? "",
    /live runtime handle was no longer available/
  );
});

test("SessionService marks a stale persisted running run as failed when read", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-stale-read-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  await manager.createAgent({
    name: "session-agent",
  });

  const service = new SessionService({
    stateRoot,
    manager,
    runtime,
    now: () => "2026-03-13T00:00:12.000Z",
    idGenerator: (() => {
      const ids = ["session-1"];
      return () => ids.shift() ?? "";
    })(),
  });

  const session = await service.createSession({
    agentId: "agent-1",
    title: "stale run session",
  });
  const sessionPaths = resolveAgentSessionPaths({
    stateRoot,
    agentId: "agent-1",
    sessionId: session.id,
  });
  const runPaths = resolveAgentRunPaths({
    stateRoot,
    agentId: "agent-1",
    runId: "run-stale",
  });

  await ensureRunPaths(runPaths);
  await writeFile(
    sessionPaths.metadataPath,
    serializeJson({
      ...session,
      status: "running",
      lastActivityAt: "2026-03-13T00:00:02.000Z",
    } satisfies AgentSessionRecord),
    "utf8"
  );
  await writeFile(
    runPaths.metadataPath,
    serializeJson({
      id: "run-stale",
      agentId: "agent-1",
      sessionId: session.id,
      runtimeRunId: "run-stale",
      triggerType: "interactive",
      status: "running",
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      prompt: "hello",
      startedAt: "2026-03-13T00:00:02.000Z",
      endedAt: null,
      summary: null,
      runtimeSessionId: null,
      outputLastMessagePath: runPaths.outputLastMessagePath,
      resultPath: runPaths.resultPath,
      eventsPath: runPaths.eventsPath,
      artifactsDir: runPaths.artifactsDir,
    } satisfies AgentRunRecord),
    "utf8"
  );

  const updatedRun = await service.getRun("run-stale");
  const updatedSession = await service.getSession(session.id);
  const result = await service.getRunResult("run-stale");

  assert.equal(updatedRun.status, "failed");
  assert.equal(updatedRun.endedAt, "2026-03-13T00:00:12.000Z");
  assert.equal(updatedSession.status, "failed");
  assert.equal(result.status, "failed");
  assert.match(
    result.errors[0] ?? "",
    /lost its live runtime handle/
  );
});

test("SessionService deletes a session even when unrelated orphan run directories exist", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-delete-orphan-run-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  await manager.createAgent({
    name: "session-agent",
  });

  const service = new SessionService({
    stateRoot,
    manager,
    runtime,
    now: () => "2026-03-13T00:00:20.000Z",
    idGenerator: (() => {
      const ids = ["session-1"];
      return () => ids.shift() ?? "";
    })(),
  });

  const session = await service.createSession({
    agentId: "agent-1",
    title: "delete with orphan run",
  });
  const orphanRunPaths = resolveAgentRunPaths({
    stateRoot,
    agentId: "agent-1",
    runId: "run-orphan",
  });

  await ensureRunPaths(orphanRunPaths);

  await service.deleteSession(session.id);

  await assert.rejects(() => service.getSession(session.id), /Unknown session: session-1/);
});

test("SessionService resolves bare codex binaries on session creation", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-codex-bin-"));
  const fakeBinDir = path.join(stateRoot, "bin");
  const fakeCodexPath = path.join(fakeBinDir, "codex");
  await mkdir(fakeBinDir, { recursive: true });
  await writeFile(fakeCodexPath, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(fakeCodexPath, 0o755);

  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const service = new SessionService({
    stateRoot,
    manager,
    runtime,
    baseEnv: {
      ...process.env,
      PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    idGenerator: () => "session-1",
  });

  const agent = await manager.createAgent({
    name: "session-agent",
  });
  const session = await service.createSession({
    agentId: agent.id,
  });

  assert.equal(session.runtimeConfig.codexBin, fakeCodexPath);
});

test("SessionService resolves bare Claude binaries on session creation", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-claude-bin-"));
  const fakeBinDir = path.join(stateRoot, "bin");
  const fakeClaudePath = path.join(fakeBinDir, "claude");
  await mkdir(fakeBinDir, { recursive: true });
  await writeFile(fakeClaudePath, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(fakeClaudePath, 0o755);

  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const service = new SessionService({
    stateRoot,
    manager,
    runtimeRegistry: {
      get(kind) {
        return {
          kind,
          adapter: runtime,
          resolveBin: async () =>
            kind === "claude-code" ? fakeClaudePath : path.join(fakeBinDir, "codex"),
        };
      },
    },
    idGenerator: () => "session-1",
  });

  const agent = await manager.createAgent({
    name: "claude-agent",
    defaultRuntime: "claude-code",
  });
  const session = await service.createSession({
    agentId: agent.id,
  });

  assert.equal(session.runtimeKind, "claude-code");
  assert.equal(session.runtimeConfig.codexBin, fakeClaudePath);
});

test("SessionService keeps explicit Ollama launch targets on session creation", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-ollama-launch-target-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const service = new SessionService({
    stateRoot,
    manager,
    runtimeRegistry: {
      get(kind) {
        return {
          kind,
          adapter: runtime,
          resolveBin: async () =>
            kind === "ollama" ? "/resolved/bin/ollama" : "/resolved/bin/codex",
        };
      },
    },
    idGenerator: () => "session-1",
  });

  const agent = await manager.createAgent({
    name: "ollama-agent",
  });
  const session = await service.createSession({
    agentId: agent.id,
    runtimeKind: "ollama",
    ollamaLaunchTarget: "claude",
    model: "qwen3-coder",
  });

  assert.equal(session.runtimeKind, "ollama");
  assert.equal(session.runtimeConfig.codexBin, "/resolved/bin/ollama");
  assert.equal(session.runtimeConfig.ollamaLaunchTarget, "claude");
  assert.equal(runtime.lastCreatedSession?.config.ollamaLaunchTarget, "claude");
  assert.equal(session.runtimeConfig.profile, null);
});

test("SessionService stamps the internal ollama codex profile and drops stale legacy runtime sessions", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-ollama-codex-profile-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const service = new SessionService({
    stateRoot,
    manager,
    runtimeRegistry: {
      get(kind) {
        return {
          kind,
          adapter: runtime,
          resolveBin: async () =>
            kind === "ollama" ? "/resolved/bin/ollama" : "/resolved/bin/codex",
        };
      },
    },
    idGenerator: (() => {
      const ids = ["session-1", "run-1"];
      return () => ids.shift() ?? "";
    })(),
  });

  const agent = await manager.createAgent({
    name: "ollama-agent",
  });
  const session = await service.createSession({
    agentId: agent.id,
    runtimeKind: "ollama",
    ollamaLaunchTarget: "codex",
    model: "gemma4:31b-cloud",
  });

  assert.equal(session.runtimeConfig.profile, "ollama-launch");

  const sessionPath = path.join(
    stateRoot,
    "agents",
    agent.id,
    "sessions",
    session.id,
    "session.json"
  );
  const persisted = JSON.parse(await readFile(sessionPath, "utf8")) as AgentSessionRecord;
  persisted.runtimeSessionId = "legacy-openai-thread";
  persisted.runtimeConfig.profile = null;
  await writeFile(sessionPath, JSON.stringify(persisted, null, 2), "utf8");

  const run = await service.sendTurn({
    sessionId: session.id,
    prompt: "hello",
  });
  await service.getRunResult(run.id);

  assert.equal(runtime.sendCalls, 1);
  assert.equal(
    runtime.resumeCalls,
    0,
    "legacy ollama codex sessions should start a fresh thread instead of resuming"
  );
  const updated = await service.getSession(session.id);
  assert.equal(updated.runtimeConfig.profile, "ollama-launch");
});

test("SessionService runtime-only mode rejects Claude sessions", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-runtime-only-claude-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const service = new SessionService({
    stateRoot,
    manager,
    runtime: new FakeRuntime(),
    idGenerator: () => "session-1",
  });

  const agent = await manager.createAgent({
    name: "claude-agent",
    defaultRuntime: "claude-code",
  });

  await assert.rejects(
    service.createSession({
      agentId: agent.id,
    }),
    /runtime-only mode does not support claude-code/
  );
});

test("SessionService repairs persisted session roots and codex binary before sendTurn", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-repair-"));
  const fakeBinDir = path.join(stateRoot, "bin");
  const fakeCodexPath = path.join(fakeBinDir, "codex");
  await mkdir(fakeBinDir, { recursive: true });
  await writeFile(fakeCodexPath, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(fakeCodexPath, 0o755);

  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const service = new SessionService({
    stateRoot,
    manager,
    runtime,
    baseEnv: {
      ...process.env,
      PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    idGenerator: (() => {
      const ids = ["session-1", "run-1"];
      return () => ids.shift() ?? "";
    })(),
  });

  const agent = await manager.createAgent({
    name: "repair-agent",
  });
  const session = await service.createSession({
    agentId: agent.id,
  });
  const sessionPath = path.join(
    stateRoot,
    "agents",
    agent.id,
    "sessions",
    session.id,
    "session.json"
  );
  const persisted = JSON.parse(await readFile(sessionPath, "utf8")) as AgentSessionRecord;

  persisted.workspaceRoot = path.join(stateRoot, "legacy-workspace");
  persisted.runtimeHome = path.join(stateRoot, "legacy-runtime-home");
  persisted.runtimeConfig.codexBin = "codex";
  persisted.runtimeConfig.additionalWritableDirs = [];
  await writeFile(sessionPath, JSON.stringify(persisted, null, 2), "utf8");

  const run = await service.sendTurn({
    sessionId: session.id,
    prompt: "repair me",
  });
  await service.getRunResult(run.id);

  const repaired = await service.getSession(session.id);
  assert.equal(repaired.workspaceRoot, agent.workspaceRoot);
  assert.equal(repaired.runtimeHome, agent.runtimeHome);
  assert.equal(repaired.runtimeConfig.codexBin, fakeCodexPath);
  assert.deepEqual(repaired.runtimeConfig.additionalWritableDirs, [
    resolveWorkspaceScaffoldPaths(agent.workspaceRoot).skillsDir,
  ]);
});

test("SessionService repairs mismatched Claude runtime binaries before sendTurn", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-claude-bin-repair-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const service = new SessionService({
    stateRoot,
    manager,
    runtimeRegistry: {
      get(kind) {
        return {
          kind,
          adapter: runtime,
          resolveBin: async () =>
            kind === "claude-code" ? "/resolved/bin/claude" : "/resolved/bin/codex",
        };
      },
    },
    idGenerator: (() => {
      const ids = ["session-1", "run-1"];
      return () => ids.shift() ?? "";
    })(),
  });

  const agent = await manager.createAgent({
    name: "claude-agent",
    defaultRuntime: "claude-code",
  });
  const session = await service.createSession({
    agentId: agent.id,
    model: "claude-sonnet-4-6",
  });
  const sessionPath = path.join(
    stateRoot,
    "agents",
    agent.id,
    "sessions",
    session.id,
    "session.json"
  );
  const persisted = JSON.parse(await readFile(sessionPath, "utf8")) as AgentSessionRecord;

  persisted.runtimeConfig.codexBin = "/opt/homebrew/bin/codex";
  await writeFile(sessionPath, JSON.stringify(persisted, null, 2), "utf8");

  const run = await service.sendTurn({
    sessionId: session.id,
    prompt: "repair claude runtime",
  });
  await service.getRunResult(run.id);

  const repaired = await service.getSession(session.id);
  assert.equal(repaired.runtimeConfig.codexBin, "/resolved/bin/claude");
  assert.equal(runtime.lastCreatedSession?.runtimeKind, "claude-code");
  assert.equal(runtime.lastCreatedSession?.config.codexBin, "/resolved/bin/claude");
  assert.equal((await service.getRun(run.id)).model, "claude-sonnet-4-6");
});

test("SessionService applies per-turn runtime overrides and resets the runtime session when the engine changes", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-turn-runtime-overrides-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const service = new SessionService({
    stateRoot,
    manager,
    runtimeRegistry: {
      get(kind) {
        return {
          kind,
          adapter: runtime,
          resolveBin: async () =>
            kind === "ollama"
              ? "/resolved/bin/ollama"
              : kind === "claude-code"
                ? "/resolved/bin/claude"
                : "/resolved/bin/codex",
        };
      },
    },
    idGenerator: (() => {
      const ids = ["session-1", "run-1", "run-2"];
      return () => ids.shift() ?? "";
    })(),
  });

  const agent = await manager.createAgent({
    name: "dynamic-runtime-agent",
  });
  const session = await service.createSession({
    agentId: agent.id,
  });

  const firstRun = await service.sendTurn({
    sessionId: session.id,
    prompt: "first",
    runtimeKind: "ollama",
    ollamaLaunchTarget: "claude",
    model: "qwen3-coder",
  });
  await service.getRunResult(firstRun.id);

  const afterFirstRun = await service.getSession(session.id);
  assert.equal(afterFirstRun.runtimeKind, "ollama");
  assert.equal(afterFirstRun.runtimeConfig.codexBin, "/resolved/bin/ollama");
  assert.equal(afterFirstRun.runtimeConfig.ollamaLaunchTarget, "claude");
  assert.ok(afterFirstRun.runtimeSessionId);
  assert.equal(runtime.sendCalls, 1);
  assert.equal(runtime.resumeCalls, 0);

  const secondRun = await service.sendTurn({
    sessionId: session.id,
    prompt: "second",
    runtimeKind: "codex-cli",
    model: "gpt-5.4-mini",
    reasoningEffort: "high",
    serviceTier: "fast",
  });
  await service.getRunResult(secondRun.id);

  const updatedRun = await service.getRun(secondRun.id);
  const updatedSession = await service.getSession(session.id);
  assert.equal(updatedRun.runtimeKind, "codex-cli");
  assert.equal(updatedRun.ollamaLaunchTarget, null);
  assert.equal(updatedRun.model, "gpt-5.4-mini");
  assert.equal(updatedRun.reasoningEffort, "high");
  assert.equal(updatedRun.serviceTier, "fast");
  assert.equal(updatedSession.runtimeKind, "codex-cli");
  assert.equal(updatedSession.runtimeConfig.codexBin, "/resolved/bin/codex");
  assert.equal(updatedSession.runtimeConfig.model, "gpt-5.4-mini");
  assert.equal(updatedSession.runtimeConfig.reasoningEffort, "high");
  assert.equal(updatedSession.runtimeConfig.serviceTier, "fast");
  assert.equal(runtime.sendCalls, 2);
  assert.equal(
    runtime.resumeCalls,
    0,
    "changing the engine should start a fresh runtime session instead of resume"
  );
});

test("SessionService reruns an existing user message without appending a duplicate user bubble", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-rerun-reuse-message-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const service = new SessionService({
    stateRoot,
    manager,
    runtime,
    idGenerator: (() => {
      const ids = ["session-1", "run-1", "run-2"];
      return () => ids.shift() ?? "";
    })(),
  });

  const agent = await manager.createAgent({
    name: "rerun-agent",
  });
  const session = await service.createSession({
    agentId: agent.id,
  });

  const firstRun = await service.sendTurn({
    sessionId: session.id,
    prompt: "rerun this",
  });
  await service.getRunResult(firstRun.id);

  const initialTranscript = await service.getTranscript(session.id);
  const firstUserMessage = initialTranscript.find((message) => message.role === "user");
  assert.ok(firstUserMessage);

  const rerun = await service.sendTurn({
    sessionId: session.id,
    prompt: "rerun this",
    reuseMessageId: firstUserMessage!.id,
  });
  await service.getRunResult(rerun.id);

  const transcript = await service.getTranscript(session.id);
  assert.equal(
    transcript.filter((message) => message.role === "user").length,
    1,
    "rerun should not append a second user message"
  );
  assert.equal(transcript[0]?.id, firstUserMessage!.id);
  assert.equal(transcript[0]?.runId, rerun.id);
  assert.equal(
    transcript.filter((message) => message.role === "assistant").length,
    1,
    "rerun should replace the previous assistant response for the reused user message"
  );
  assert.equal(
    transcript.find((message) => message.role === "assistant")?.runId,
    rerun.id
  );
});

test("SessionService hydrates legacy transcript messages into structured blocks", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-legacy-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const service = new SessionService({
    stateRoot,
    manager,
    runtime,
  });

  const agent = await manager.createAgent({
    name: "legacy-agent",
  });
  const session = await service.createSession({
    agentId: agent.id,
    title: "legacy",
  });

  const transcriptPath = path.join(
    stateRoot,
    "agents",
    agent.id,
    "sessions",
    session.id,
    "transcript.jsonl"
  );

  await writeFile(
    transcriptPath,
    `${JSON.stringify({
      id: "legacy-1",
      sessionId: session.id,
      runId: "run-legacy",
      role: "assistant",
      content: "Before code\n```python\nprint('hi')\n```\nAfter code",
      source: "legacy",
      createdAt: "2026-03-13T00:00:05.000Z",
    })}\n`,
    "utf8"
  );

  const transcript = await service.getTranscript(session.id);
  assert.deepEqual(transcript[0]?.blocks, [
    {
      type: "text",
      text: "Before code\n",
    },
    {
      type: "code",
      code: "print('hi')",
      language: "python",
    },
    {
      type: "text",
      text: "\nAfter code",
    },
  ]);
  assert.deepEqual(transcript[0]?.artifacts, []);
});

test("SessionService refreshes legacy transcript artifact preview metadata on read", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-legacy-artifacts-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const service = new SessionService({
    stateRoot,
    manager,
    runtime,
  });

  const agent = await manager.createAgent({
    name: "legacy-artifacts-agent",
  });
  const session = await service.createSession({
    agentId: agent.id,
    title: "legacy-artifacts",
  });

  const transcriptPath = path.join(
    stateRoot,
    "agents",
    agent.id,
    "sessions",
    session.id,
    "transcript.jsonl"
  );

  await writeFile(
    transcriptPath,
    `${JSON.stringify({
      id: "legacy-artifacts-1",
      sessionId: session.id,
      runId: "run-legacy-artifacts",
      role: "assistant",
      content: "Legacy media artifacts",
      artifacts: [
        {
          kind: "file",
          role: "sample-audio",
          name: "sample-audio.wav",
          contentType: "audio/wav",
          presentation: "file",
          size: 123,
          previewable: false,
          previewUrl: null,
          downloadUrl: "/runs/run-legacy-artifacts/artifacts/sample-audio",
          preferredAction: "download",
        },
        {
          kind: "file",
          role: "sample-video",
          name: "sample-video.mp4",
          contentType: "video/mp4",
          presentation: "file",
          size: 456,
          previewable: false,
          previewUrl: null,
          downloadUrl: "/runs/run-legacy-artifacts/artifacts/sample-video",
          preferredAction: "download",
        },
      ],
      source: "legacy",
      createdAt: "2026-03-13T00:00:05.000Z",
    })}\n`,
    "utf8"
  );

  const transcript = await service.getTranscript(session.id);
  assert.equal(transcript[0]?.artifacts?.[0]?.previewable, true);
  assert.equal(
    transcript[0]?.artifacts?.[0]?.previewUrl,
    "/runs/run-legacy-artifacts/artifacts/sample-audio/preview"
  );
  assert.equal(
    transcript[0]?.artifacts?.[0]?.preferredAction,
    "preview"
  );
  assert.equal(transcript[0]?.artifacts?.[1]?.previewable, true);
  assert.equal(
    transcript[0]?.artifacts?.[1]?.previewUrl,
    "/runs/run-legacy-artifacts/artifacts/sample-video/preview"
  );
  assert.equal(
    transcript[0]?.artifacts?.[1]?.preferredAction,
    "preview"
  );
});

test("buildMessageRecord can express image, chart, and file transcript blocks", () => {
  const message = buildMessageRecord({
    id: "assistant-1",
    sessionId: "session-1",
    runId: "run-1",
    role: "assistant",
    content: "Artifacts attached",
    artifacts: [
      {
        kind: "file",
        role: "chart-preview",
        name: "chart.png",
        contentType: "image/png",
        presentation: "image",
        size: 128,
        previewable: true,
        previewUrl: "/runs/run-1/artifacts/chart-preview/preview",
        downloadUrl: "/runs/run-1/artifacts/chart-preview",
        preferredAction: "preview",
      },
      {
        kind: "file",
        role: "analysis-chart",
        name: "analysis.json",
        contentType: "application/json; charset=utf-8",
        presentation: "chart",
        size: 256,
        previewable: false,
        previewUrl: null,
        downloadUrl: "/runs/run-1/artifacts/analysis-chart",
        preferredAction: "download",
      },
      {
        kind: "file",
        role: "supporting-file",
        name: "notes.csv",
        contentType: "text/csv; charset=utf-8",
        presentation: "file",
        size: 64,
        previewable: false,
        previewUrl: null,
        downloadUrl: "/runs/run-1/artifacts/supporting-file",
        preferredAction: "download",
      },
    ],
    source: "test",
    createdAt: "2026-03-13T00:00:00.000Z",
  });

  assert.deepEqual(message.blocks, [
    {
      type: "text",
      text: "Artifacts attached",
    },
    {
      type: "image",
      artifactRole: "chart-preview",
      alt: "chart.png",
    },
    {
      type: "chart",
      artifactRole: "analysis-chart",
      title: "analysis.json",
    },
    {
      type: "file",
      artifactRole: "supporting-file",
      label: "notes.csv",
    },
  ]);
});

test("buildRuntimePrompt carries sandbox ground truth and preserves the user request", () => {
  const session: AgentSessionRecord = {
    id: "session-1",
    agentId: "agent-1",
    kind: "task-request",
    runtimeKind: "codex-cli",
    runtimeSessionId: null,
    authProfileId: null,
    title: "sandbox-check",
    status: "active",
    lifecycle: "active",
    archivedAt: null,
    workspaceRoot: "/workspace/agent",
    runtimeHome: "/runtime/agent",
    runtimeConfig: {
      codexBin: "codex",
      sandbox: "workspace-write",
      approval: "on-request",
      profile: null,
      authProfileId: null,
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      fullAuto: false,
      dangerouslyBypassApprovalsAndSandbox: false,
      additionalWritableDirs: [],
      configOverrides: [],
      enableFeatures: [],
      disableFeatures: [],
      skipGitRepoCheck: true,
      ephemeral: false,
    },
    createdAt: "2026-03-13T00:00:00.000Z",
    lastActivityAt: "2026-03-13T00:00:00.000Z",
  };

  const runtimePrompt = buildRuntimePrompt(
    session,
    "hello.txt 파일을 만들어줘"
  );

  assert.match(runtimePrompt, /sandbox=workspace-write/);
  assert.match(
    runtimePrompt,
    /User-facing agent skills are the agent's installed local skills only/
  );
  assert.match(
    runtimePrompt,
    /Read-only system skills may exist for platform support, but they are internal and must not be listed/
  );
  assert.match(
    runtimePrompt,
    /When asked to list available, installed, or equipped skills, report only the display names/
  );
  assert.match(
    runtimePrompt,
    /Do not expose internal skill identifiers, invocation strings, file paths/
  );
  assert.match(
    runtimePrompt,
    /In writable managed sessions, `.agents\/skills\/` is the allowed authoring directory for agent-local skills/
  );
  assert.match(
    runtimePrompt,
    /inspect the matching skill directory under `.agents\/skills\/`, read its `SKILL\.md`/
  );
  assert.match(
    runtimePrompt,
    /Generic file searches can skip hidden skill directories/
  );
  assert.match(
    runtimePrompt,
    /Repository-root developer skills from parent directories are unavailable in this agent session/
  );
  assert.match(
    runtimePrompt,
    /attempt the write directly before claiming the filesystem is read-only/
  );
  assert.match(
    runtimePrompt,
    /Only create agent-local skills under `.agents\/skills\/<skill-id>\/` using a non-system skill id/
  );
  assert.match(
    runtimePrompt,
    /Do not create or modify `\.agents\/skills\/\.system`, `skills\/\.system`, `system`, `system-\*`, `openai-docs`, `skill-creator`, or `skill-installer`/
  );
  assert.match(
    runtimePrompt,
    /The current working directory for shell commands is already the workspace root/
  );
  assert.match(
    runtimePrompt,
    /Only inspect, reference, or modify files and directories under workspace_root/
  );
  assert.match(
    runtimePrompt,
    /Do not inspect, mention, or reason from parent directories, sibling repositories, or any absolute path outside workspace_root/
  );
  assert.match(
    runtimePrompt,
    /If relevant information appears to be outside workspace_root, say that it is unavailable from the current session instead of claiming you checked it/
  );
  assert.match(
    runtimePrompt,
    /Do not cite bwrap, sandbox, permission, or missing stdout unless a command_execution step or runtime stderr actually produced that evidence/
  );
  assert.doesNotMatch(runtimePrompt, /<required_command_execution>/);
  assert.doesNotMatch(
    runtimePrompt,
    /Prefer concrete inspection commands like pwd, ls -la, rg --files, and sed -n/
  );
  assert.equal(extractUserPrompt(runtimePrompt), "hello.txt 파일을 만들어줘");
});

test("buildRuntimePrompt keeps read-only sessions inspection-first and evidence-based", () => {
  const session: AgentSessionRecord = {
    id: "session-read-only",
    agentId: "agent-1",
    kind: "task-request",
    runtimeKind: "codex-cli",
    runtimeSessionId: null,
    authProfileId: null,
    title: "read-only-check",
    status: "active",
    lifecycle: "active",
    archivedAt: null,
    workspaceRoot: "/workspace/agent",
    runtimeHome: "/runtime/agent",
    runtimeConfig: {
      codexBin: "codex",
      sandbox: "read-only",
      approval: null,
      profile: null,
      authProfileId: null,
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      fullAuto: false,
      dangerouslyBypassApprovalsAndSandbox: false,
      additionalWritableDirs: [],
      configOverrides: [],
      enableFeatures: [],
      disableFeatures: [],
      skipGitRepoCheck: true,
      ephemeral: false,
    },
    createdAt: "2026-03-13T00:00:00.000Z",
    lastActivityAt: "2026-03-13T00:00:00.000Z",
  };

  const runtimePrompt = buildRuntimePrompt(
    session,
    "파일 목록 보여줘"
  );

  assert.match(runtimePrompt, /sandbox=read-only/);
  assert.match(runtimePrompt, /<required_command_execution>/);
  assert.match(runtimePrompt, /mode=suggested/);
  assert.match(runtimePrompt, /suggested_command=ls -la/);
  assert.match(
    runtimePrompt,
    /answer in the user-facing format requested instead of dumping raw directory metadata/
  );
  assert.doesNotMatch(
    runtimePrompt,
    /return the real stdout in a fenced text block before any extra commentary/
  );
  assert.match(
    runtimePrompt,
    /Do not create, modify, shadow, or copy the read-only system skills `openai-docs`, `skill-creator`, or `skill-installer`/
  );
  assert.match(
    runtimePrompt,
    /Reserved system skill namespaces are read-only platform assets/
  );
  assert.match(
    runtimePrompt,
    /Only inspect, reference, or modify files and directories under workspace_root/
  );
  assert.match(
    runtimePrompt,
    /Read-only shell inspection is allowed/
  );
  assert.match(
    runtimePrompt,
    /Prefer concrete inspection commands like pwd, ls -la, rg --files, and sed -n/
  );
  assert.match(
    runtimePrompt,
    /Do not cite bwrap, sandbox, permission, or missing stdout unless a command_execution step or runtime stderr actually produced that evidence/
  );
  assert.equal(extractUserPrompt(runtimePrompt), "파일 목록 보여줘");
});

test("buildRuntimePrompt keeps non-shell read-only turns minimal", () => {
  const session: AgentSessionRecord = {
    id: "session-read-only-minimal",
    agentId: "agent-1",
    kind: "task-request",
    runtimeKind: "codex-cli",
    runtimeSessionId: null,
    authProfileId: null,
    title: "read-only-minimal",
    status: "active",
    lifecycle: "active",
    archivedAt: null,
    workspaceRoot: "/workspace/agent",
    runtimeHome: "/runtime/agent",
    runtimeConfig: {
      codexBin: "codex",
      sandbox: "read-only",
      approval: null,
      profile: null,
      authProfileId: null,
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      fullAuto: false,
      dangerouslyBypassApprovalsAndSandbox: false,
      additionalWritableDirs: [],
      configOverrides: [],
      enableFeatures: [],
      disableFeatures: [],
      skipGitRepoCheck: true,
      ephemeral: false,
    },
    createdAt: "2026-03-13T00:00:00.000Z",
    lastActivityAt: "2026-03-13T00:00:00.000Z",
  };

  const runtimePrompt = buildRuntimePrompt(
    session,
    "이 답변을 한 줄 한국어로 요약해줘"
  );

  assert.match(runtimePrompt, /sandbox=read-only/);
  assert.doesNotMatch(runtimePrompt, /<required_command_execution>/);
  assert.doesNotMatch(runtimePrompt, /Read-only shell inspection is allowed/);
  assert.doesNotMatch(
    runtimePrompt,
    /Prefer concrete inspection commands like pwd, ls -la, rg --files, and sed -n/
  );
  assert.equal(
    extractUserPrompt(runtimePrompt),
    "이 답변을 한 줄 한국어로 요약해줘"
  );
});

test("buildRuntimePrompt turns natural-language uv bootstrap intents into suggested command execution", () => {
  const session: AgentSessionRecord = {
    id: "session-uv-intent",
    agentId: "agent-1",
    kind: "task-request",
    runtimeKind: "codex-cli",
    runtimeSessionId: null,
    authProfileId: null,
    title: "uv-intent",
    status: "active",
    lifecycle: "active",
    archivedAt: null,
    workspaceRoot: "/workspace/agent",
    runtimeHome: "/runtime/agent",
    runtimeConfig: {
      codexBin: "codex",
      sandbox: "workspace-write",
      approval: "on-request",
      profile: null,
      authProfileId: null,
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      fullAuto: false,
      dangerouslyBypassApprovalsAndSandbox: false,
      additionalWritableDirs: [],
      configOverrides: [],
      enableFeatures: [],
      disableFeatures: [],
      skipGitRepoCheck: true,
      ephemeral: false,
    },
    createdAt: "2026-03-13T00:00:00.000Z",
    lastActivityAt: "2026-03-13T00:00:00.000Z",
  };

  const runtimePrompt = buildRuntimePrompt(session, "uv로 가상환경 만들어줘");

  assert.match(runtimePrompt, /<required_command_execution>/);
  assert.match(runtimePrompt, /mode=suggested/);
  assert.match(runtimePrompt, /suggested_command=uv venv --seed \.venv/);
  assert.equal(extractUserPrompt(runtimePrompt), "uv로 가상환경 만들어줘");
});

test("detectShellExecutionHint extracts exact and suggested shell commands", () => {
  assert.deepEqual(
    detectShellExecutionHint("Run 'ls -la' in the current workspace."),
    {
      mode: "exact",
      command: "ls -la",
    }
  );

  assert.deepEqual(
    detectShellExecutionHint("```bash\n/bin/bash -lc 'pwd'\n```"),
    {
      mode: "exact",
      command: "/bin/bash -lc 'pwd'",
    }
  );

  assert.deepEqual(
    detectShellExecutionHint("파일 목록 보여줘"),
    {
      mode: "suggested",
      suggestedCommand: "ls -la",
    }
  );

  assert.deepEqual(
    detectShellExecutionHint(
      "Create hello.py and then run python3 hello.py in the current workspace."
    ),
    {
      mode: "exact",
      command: "python3 hello.py",
    }
  );

  assert.deepEqual(
    detectShellExecutionHint("uv로 가상환경 만들어줘"),
    {
      mode: "suggested",
      suggestedCommand: "uv venv --seed .venv",
    }
  );

  assert.deepEqual(
    detectShellExecutionHint("npm 의존성 설치해줘"),
    {
      mode: "suggested",
      suggestedCommand: "npm install",
    }
  );
});

test("safe read-only shell command detection only allows inspection commands", () => {
  assert.equal(isSafeReadOnlyShellCommand("ls -la"), true);
  assert.equal(isSafeReadOnlyShellCommand("find . -maxdepth 2 -type f"), true);
  assert.equal(isSafeReadOnlyShellCommand("/bin/bash -lc 'pwd'"), true);
  assert.equal(isSafeReadOnlyShellCommand("sed -n '1,20p' README.md"), true);
  assert.equal(isSafeReadOnlyShellCommand("touch hello.txt"), false);
  assert.equal(isSafeReadOnlyShellCommand("ls -la && pwd"), false);
  assert.equal(isSafeReadOnlyShellCommand("cat /etc/passwd"), false);
  assert.equal(isSafeReadOnlyShellCommand("curl https://example.com"), false);
  assert.equal(isSafeWorkspaceInterpreterCommand("python3 hello.py"), true);
  assert.equal(isSafeWorkspaceInterpreterCommand("./.venv/bin/python script.py"), true);
  assert.equal(isSafeWorkspaceInterpreterCommand("node scripts/demo.mjs"), true);
  assert.equal(isSafeWorkspaceInterpreterCommand("python3 -m pytest"), false);
  assert.equal(isSafeWorkspaceNetworkCommand("curl -o data.json https://example.com/data.json"), true);
  assert.equal(isSafeWorkspaceNetworkCommand("wget https://example.com/data.json"), true);
  assert.equal(isSafeWorkspaceNetworkCommand("curl --data foo=bar https://example.com"), false);
  assert.equal(isSafeWorkspacePackageManagerCommand("npm install react"), true);
  assert.equal(isSafeWorkspacePackageManagerCommand("npm install -g typescript"), false);
  assert.equal(isSafeWorkspacePackageManagerCommand("pip install -r requirements.txt"), true);
  assert.equal(
    isSafeWorkspacePackageManagerCommand("./.venv/bin/python -m pip install ./deps/local-pypkg"),
    true
  );
  assert.equal(isSafeWorkspacePackageManagerCommand("pip install --user requests"), false);
  assert.equal(isSafeWorkspacePackageManagerCommand("uv pip install pandas"), true);
  assert.equal(isSafeWorkspacePackageManagerCommand("uv tool install ruff"), false);
});

test("buildRuntimeRequest inherits the managed session bypass policy", () => {
  const session: AgentSessionRecord = {
    id: "session-shell-bypass",
    agentId: "agent-1",
    kind: "task-request",
    runtimeKind: "codex-cli",
    runtimeSessionId: null,
    authProfileId: null,
    title: "shell-bypass",
    status: "active",
    lifecycle: "active",
    archivedAt: null,
    workspaceRoot: "/workspace/agent",
    runtimeHome: "/runtime/agent",
    runtimeConfig: {
      codexBin: "codex",
      sandbox: "read-only",
      approval: null,
      profile: null,
      authProfileId: null,
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      fullAuto: false,
      dangerouslyBypassApprovalsAndSandbox: false,
      additionalWritableDirs: [],
      configOverrides: [],
      enableFeatures: [],
      disableFeatures: [],
      skipGitRepoCheck: true,
      ephemeral: false,
    },
    createdAt: "2026-03-13T00:00:00.000Z",
    lastActivityAt: "2026-03-13T00:00:00.000Z",
  };

  const runPaths = {
    runRoot: "/runs/run-1",
    metadataPath: "/runs/run-1/metadata.json",
    resultPath: "/runs/run-1/result.json",
    eventsPath: "/runs/run-1/events.jsonl",
    artifactsDir: "/runs/run-1/artifacts",
    outputLastMessagePath: "/runs/run-1/artifacts/last-message.txt",
  };

  assert.equal(
    shouldUseUnsandboxedShellBypass("Run 'ls -la' in the current workspace."),
    true
  );
  assert.equal(
    shouldUseUnsandboxedShellBypass(
      "Run 'find . -maxdepth 2 -type f' in the current workspace."
    ),
    true
  );
  assert.equal(shouldUseUnsandboxedShellBypass("파일 목록 보여줘"), true);
  assert.equal(
    shouldUseUnsandboxedShellBypass(
      "Create hello.py in the current workspace, then run python3 hello.py."
    ),
    true
  );
  assert.equal(
    shouldUseUnsandboxedShellBypass("Run 'curl https://example.com' in the current workspace."),
    true
  );
  assert.equal(
    shouldUseUnsandboxedShellBypass(
      "Run 'npm install react' in the current workspace."
    ),
    true
  );
  assert.equal(
    shouldUseUnsandboxedShellBypass(
      "Run './.venv/bin/python -m pip install ./deps/local-pypkg' in the current workspace."
    ),
    true
  );
  assert.equal(shouldUseUnsandboxedShellBypass("uv로 가상환경 만들어줘"), true);
  assert.equal(shouldUseUnsandboxedShellBypass("npm 의존성 설치해줘"), true);
  assert.equal(
    shouldUseUnsandboxedShellBypass("Run 'touch hello.txt' in the current workspace."),
    false
  );
  assert.equal(
    shouldUseBrowserAutomationBypass("Run 'npm run login:threads' in the current workspace."),
    true
  );
  assert.equal(
    shouldUseBrowserAutomationBypass(
      "브라우저를 열어서 Threads에 로그인하고 Playwright 세션을 유지해줘"
    ),
    true
  );
  assert.equal(shouldUseBrowserAutomationBypass("파일 목록 보여줘"), false);

  const inspectionRequest = buildRuntimeRequest({
    session,
    input: {
      sessionId: session.id,
      prompt: "Run 'ls -la' in the current workspace.",
    },
    runId: "run-1",
    runPaths,
  });
  assert.equal(inspectionRequest.dangerouslyBypassApprovalsAndSandbox, false);

  const pythonExecutionRequest = buildRuntimeRequest({
    session,
    input: {
      sessionId: session.id,
      prompt: "Create hello.py in the current workspace, then run python3 hello.py.",
    },
    runId: "run-python",
    runPaths: {
      ...runPaths,
      runRoot: "/runs/run-python",
      metadataPath: "/runs/run-python/metadata.json",
      resultPath: "/runs/run-python/result.json",
      eventsPath: "/runs/run-python/events.jsonl",
      artifactsDir: "/runs/run-python/artifacts",
      outputLastMessagePath: "/runs/run-python/artifacts/last-message.txt",
    },
  });
  assert.equal(
    pythonExecutionRequest.dangerouslyBypassApprovalsAndSandbox,
    false
  );

  const uvBootstrapRequest = buildRuntimeRequest({
    session,
    input: {
      sessionId: session.id,
      prompt: "uv로 가상환경 만들어줘",
    },
    runId: "run-uv-bootstrap",
    runPaths: {
      ...runPaths,
      runRoot: "/runs/run-uv-bootstrap",
      metadataPath: "/runs/run-uv-bootstrap/metadata.json",
      resultPath: "/runs/run-uv-bootstrap/result.json",
      eventsPath: "/runs/run-uv-bootstrap/events.jsonl",
      artifactsDir: "/runs/run-uv-bootstrap/artifacts",
      outputLastMessagePath: "/runs/run-uv-bootstrap/artifacts/last-message.txt",
    },
  });
  assert.equal(
    uvBootstrapRequest.dangerouslyBypassApprovalsAndSandbox,
    false
  );

  const npmInstallRequest = buildRuntimeRequest({
    session,
    input: {
      sessionId: session.id,
      prompt: "npm 의존성 설치해줘",
    },
    runId: "run-npm-install",
    runPaths: {
      ...runPaths,
      runRoot: "/runs/run-npm-install",
      metadataPath: "/runs/run-npm-install/metadata.json",
      resultPath: "/runs/run-npm-install/result.json",
      eventsPath: "/runs/run-npm-install/events.jsonl",
      artifactsDir: "/runs/run-npm-install/artifacts",
      outputLastMessagePath: "/runs/run-npm-install/artifacts/last-message.txt",
    },
  });
  assert.equal(
    npmInstallRequest.dangerouslyBypassApprovalsAndSandbox,
    false
  );

  const browserLoginRequest = buildRuntimeRequest({
    session,
    input: {
      sessionId: session.id,
      prompt: "Run 'npm run login:threads' in the current workspace.",
    },
    runId: "run-browser-login",
    runPaths: {
      ...runPaths,
      runRoot: "/runs/run-browser-login",
      metadataPath: "/runs/run-browser-login/metadata.json",
      resultPath: "/runs/run-browser-login/result.json",
      eventsPath: "/runs/run-browser-login/events.jsonl",
      artifactsDir: "/runs/run-browser-login/artifacts",
      outputLastMessagePath: "/runs/run-browser-login/artifacts/last-message.txt",
    },
  });
  assert.equal(
    browserLoginRequest.dangerouslyBypassApprovalsAndSandbox,
    true
  );

  const writeRequest = buildRuntimeRequest({
    session,
    input: {
      sessionId: session.id,
      prompt: "Run 'touch hello.txt' in the current workspace.",
    },
    runId: "run-2",
    runPaths: {
      ...runPaths,
      runRoot: "/runs/run-2",
      metadataPath: "/runs/run-2/metadata.json",
      resultPath: "/runs/run-2/result.json",
      eventsPath: "/runs/run-2/events.jsonl",
      artifactsDir: "/runs/run-2/artifacts",
      outputLastMessagePath: "/runs/run-2/artifacts/last-message.txt",
    },
  });
  assert.equal(writeRequest.dangerouslyBypassApprovalsAndSandbox, false);

  const explicitSandboxedRequest = buildRuntimeRequest({
    session,
    input: {
      sessionId: session.id,
      prompt: "Run 'ls -la' in the current workspace.",
      dangerouslyBypassApprovalsAndSandbox: false,
    },
    runId: "run-3",
    runPaths: {
      ...runPaths,
      runRoot: "/runs/run-3",
      metadataPath: "/runs/run-3/metadata.json",
      resultPath: "/runs/run-3/result.json",
      eventsPath: "/runs/run-3/events.jsonl",
      artifactsDir: "/runs/run-3/artifacts",
      outputLastMessagePath: "/runs/run-3/artifacts/last-message.txt",
    },
  });
  assert.equal(explicitSandboxedRequest.dangerouslyBypassApprovalsAndSandbox, false);
});

test("SessionService keeps session roots fixed to the agent layout", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-policy-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
  });
  const service = new SessionService({
    stateRoot,
    manager,
    runtime: new FakeRuntime(),
  });

  const agent = await manager.createAgent({
    name: "policy-agent",
  });

  await assert.rejects(
    service.createSession({
      agentId: agent.id,
      workspaceRoot: path.join(stateRoot, "..", "outside-workspace"),
    }),
    /workspaceRoot must stay fixed/
  );

  await assert.rejects(
    service.createSession({
      agentId: agent.id,
      runtimeHome: path.join(stateRoot, "..", "outside-runtime-home"),
    }),
    /runtimeHome must stay fixed/
  );
});

test("SessionService rejects managed sessions that request sandbox bypass", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-policy-bypass-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
  });
  const service = new SessionService({
    stateRoot,
    manager,
    runtime: new FakeRuntime(),
  });

  const agent = await manager.createAgent({
    name: "policy-agent",
  });

  await assert.rejects(
    service.createSession({
      agentId: agent.id,
      dangerouslyBypassApprovalsAndSandbox: true,
    }),
    /dangerouslyBypassApprovalsAndSandbox is not allowed for managed agent sessions/
  );

  const session = await service.createSession({
    agentId: agent.id,
  });

  await assert.rejects(
    service.sendTurn({
      sessionId: session.id,
      prompt: "hello",
      dangerouslyBypassApprovalsAndSandbox: true,
    }),
    /dangerouslyBypassApprovalsAndSandbox is not allowed for managed agent sessions/
  );
});

test("SessionService rejects writable dirs outside the agent workspace or runtime-home", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-writable-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
  });
  const runtime = new FakeRuntime();
  const service = new SessionService({
    stateRoot,
    manager,
    runtime,
    idGenerator: (() => {
      const ids = ["session-1", "run-1", "run-2"];
      return () => ids.shift() ?? "";
    })(),
  });

  const agent = await manager.createAgent({
    name: "writable-agent",
  });
  const session = await service.createSession({
    agentId: agent.id,
  });

  const allowedRun = await service.sendTurn({
    sessionId: session.id,
    prompt: "hello",
    additionalWritableDirs: [
      path.join(agent.workspaceRoot, "reports"),
      path.join(agent.runtimeHome, "scratch"),
    ],
  });

  await service.getRunResult(allowedRun.id);

  await assert.rejects(
    service.sendTurn({
      sessionId: session.id,
      prompt: "blocked",
      additionalWritableDirs: [path.join(os.tmpdir(), "outside-agent-root")],
    }),
    /additionalWritableDirs entry is outside allowed roots/
  );
});

test("SessionService creates new sessions with workspace-local skill authoring enabled", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "session-skill-writable-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
  });
  const runtime = new FakeRuntime();
  const service = new SessionService({
    stateRoot,
    manager,
    runtime,
    idGenerator: () => "session-1",
  });

  const agent = await manager.createAgent({
    name: "skill-agent",
  });
  const skillDir = resolveWorkspaceScaffoldPaths(agent.workspaceRoot).skillsDir;
  const session = await service.createSession({
    agentId: agent.id,
    additionalWritableDirs: [
      path.join(agent.workspaceRoot, "reports"),
      skillDir,
    ],
  });

  assert.deepEqual(session.runtimeConfig.additionalWritableDirs, [
    skillDir,
    path.join(agent.workspaceRoot, "reports"),
  ]);
  assert.deepEqual(runtime.lastCreatedSession?.config.additionalWritableDirs, [
    skillDir,
    path.join(agent.workspaceRoot, "reports"),
  ]);
});
