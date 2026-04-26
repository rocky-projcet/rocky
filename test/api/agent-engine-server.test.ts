import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";

import { AgentManager } from "../../src/agents/agent-manager.js";
import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";
import { AuthProfileService } from "../../src/auth/auth-profile-service.js";
import { AsyncEventQueue } from "../../src/runtime/async-event-queue.js";
import { RuntimeAdapter } from "../../src/runtime/runtime-adapter.js";
import { SessionService } from "../../src/sessions/session-service.js";
import { extractUserPrompt } from "../../src/sessions/session-service-helpers.js";

import type { AgentRecord } from "../../src/agents/agent-types.js";
import type {
  AgentRunRecord,
  AgentSessionMessage,
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
  lastRequest: RuntimeRequest | null = null;

  private now(): string {
    this.counter += 1;
    return new Date(Date.UTC(2026, 2, 13, 0, 0, this.counter)).toISOString();
  }

  async createSession(input: RuntimeSessionInput): Promise<RuntimeSession> {
    const timestamp = this.now();
    const session: RuntimeSession = {
      id: input.id ?? `session-${this.counter}`,
      agentId: input.agentId ?? null,
      runtimeKind: "codex-cli",
      runtimeSessionId: input.runtimeSessionId ?? null,
      workspaceRoot: input.workspaceRoot,
      runtimeHome:
        input.runtimeHome ?? path.join(input.workspaceRoot, ".runtime", "codex"),
      config: {
        codexBin: input.codexBin ?? "codex",
        sandbox: input.sandbox ?? "read-only",
        approval: input.approval ?? null,
        profile: input.profile ?? null,
        authProfileId: input.authProfileId ?? null,
        model: input.model ?? null,
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
    return session;
  }

  async sendTurn(input: RuntimeRequest): Promise<RuntimeRunStart> {
    return this.startRun("exec", input);
  }

  async resumeSession(input: RuntimeRequest): Promise<RuntimeRunStart> {
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
    const runtimeSessionId = session.runtimeSessionId ?? `thread-${session.id}`;
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

      if (input.outputLastMessagePath) {
        await mkdir(path.dirname(input.outputLastMessagePath), { recursive: true });
        await writeFile(input.outputLastMessagePath, assistantText, "utf8");
      }

      return {
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
                kind: "file" as const,
                role: "output-last-message",
                path: input.outputLastMessagePath,
              },
            ]
          : [],
        lastMessage: assistantText,
        outputLastMessagePath: input.outputLastMessagePath ?? null,
        rawEvents: [],
      } satisfies RuntimeRunResult;
    })();

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

async function createFakeOfficeConverter(directory: string): Promise<string> {
  const converterPath = path.join(directory, "fake-office-converter.sh");
  await writeFile(
    converterPath,
    `#!/bin/sh
outdir=""
input=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --outdir)
      shift
      outdir="$1"
      ;;
    --*)
      ;;
    *)
      input="$1"
      ;;
  esac
  shift
done
base="$(basename "$input")"
base="\${base%.*}"
printf '%%PDF-fake-converted' > "$outdir/$base.pdf"
`,
    "utf8"
  );
  await chmod(converterPath, 0o755);

  return converterPath;
}

class BlockingRuntime extends RuntimeAdapter {
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly runs = new Map<
    string,
    {
      sessionId: string;
      queue: AsyncEventQueue<RuntimeEvent>;
      resolveResult: (result: RuntimeRunResult) => void;
      result: Promise<RuntimeRunResult>;
      startedAt: string;
    }
  >();
  private counter = 0;

  private now(): string {
    this.counter += 1;
    return new Date(Date.UTC(2026, 2, 13, 1, 0, this.counter)).toISOString();
  }

  async createSession(input: RuntimeSessionInput): Promise<RuntimeSession> {
    const timestamp = this.now();
    const session: RuntimeSession = {
      id: input.id ?? `blocking-session-${this.counter}`,
      agentId: input.agentId ?? null,
      runtimeKind: "codex-cli",
      runtimeSessionId: input.runtimeSessionId ?? null,
      workspaceRoot: input.workspaceRoot,
      runtimeHome:
        input.runtimeHome ?? path.join(input.workspaceRoot, ".runtime", "codex"),
      config: {
        codexBin: input.codexBin ?? "codex",
        sandbox: input.sandbox ?? "read-only",
        approval: input.approval ?? null,
        profile: input.profile ?? null,
        authProfileId: input.authProfileId ?? null,
        model: input.model ?? null,
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
    return session;
  }

  async sendTurn(input: RuntimeRequest): Promise<RuntimeRunStart> {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }

    const queue = new AsyncEventQueue<RuntimeEvent>();
    const startedAt = this.now();
    let resolveResult!: (result: RuntimeRunResult) => void;
    const result = new Promise<RuntimeRunResult>((resolve) => {
      resolveResult = resolve;
    });
    this.runs.set(input.runId ?? "", {
      sessionId: session.id,
      queue,
      resolveResult,
      result,
      startedAt,
    });

    return {
      runId: input.runId ?? "",
      sessionId: session.id,
      command: "blocking-codex",
      args: ["exec", input.prompt],
      startedAt,
      status: "running",
    };
  }

  async resumeSession(input: RuntimeRequest): Promise<RuntimeRunStart> {
    return this.sendTurn(input);
  }

  async *streamEvents(runId: string): AsyncGenerator<RuntimeEvent> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown run: ${runId}`);
    }

    yield* run.queue;
  }

  async cancelRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown run: ${runId}`);
    }

    run.queue.push({
      source: "blocking-runtime",
      type: "run.completed",
      runId,
      sessionId: run.sessionId,
      runtimeSessionId: null,
      rawType: "process.close",
      occurredAt: this.now(),
      data: { status: "cancelled", exitCode: null, signal: "SIGTERM" },
      raw: { exitCode: null, signal: "SIGTERM" },
    });
    run.queue.close();
    run.resolveResult({
      runId,
      sessionId: run.sessionId,
      runtimeSessionId: null,
      sessionBinding: null,
      status: "cancelled",
      startedAt: run.startedAt,
      endedAt: this.now(),
      exitCode: null,
      signal: "SIGTERM",
      command: "blocking-codex",
      args: ["exec"],
      messages: [],
      warnings: [],
      errors: [],
      stderr: [],
      artifactRefs: [],
      lastMessage: null,
      outputLastMessagePath: null,
      rawEvents: [],
    });
  }

  async getRunResult(runId: string): Promise<RuntimeRunResult> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown run: ${runId}`);
    }

    return run.result;
  }
}

function parseSsePayload(payload: string): Array<{ event: string; data: RuntimeEvent }> {
  return payload
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLine = lines.find((line) => line.startsWith("data: "));

      return {
        event: eventLine?.slice("event: ".length) ?? "",
        data: JSON.parse(dataLine?.slice("data: ".length) ?? "{}") as RuntimeEvent,
      };
    });
}

test("Agent engine server exposes session/run HTTP flow with SSE event streaming", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-engine-api-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const authProfileService = new AuthProfileService({
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
  const runtime = new FakeRuntime();
  const sessionService = new SessionService({
    stateRoot,
    manager,
    runtime,
    authProfiles: authProfileService,
    idGenerator: (() => {
      const ids = ["session-1", "run-1"];
      return () => ids.shift() ?? "";
    })(),
  });

  await manager.createAgent({
    name: "http-agent",
  });
  await authProfileService.createProfile({
    name: "Primary Analyst",
  });

  const server = createAgentEngineServer({
    stateRoot,
    manager,
    sessionService,
    authProfileService,
  });

  await server.listen({
    port: 0,
    host: "127.0.0.1",
  });

  const address = server.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const agentsResponse = await fetch(`${baseUrl}/agents`);
    assert.equal(agentsResponse.status, 200);
    const agents = (await agentsResponse.json()) as AgentRecord[];
    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.id, "agent-1");

    const agentResponse = await fetch(`${baseUrl}/agents/agent-1`);
    assert.equal(agentResponse.status, 200);
    const loadedAgent = (await agentResponse.json()) as AgentRecord;
    assert.equal(loadedAgent.name, "http-agent");

    const authProfilesResponse = await fetch(`${baseUrl}/auth-profiles`);
    assert.equal(authProfilesResponse.status, 200);
    const authProfiles = (await authProfilesResponse.json()) as Array<{
      id: string;
      name: string;
    }>;
    assert.equal(authProfiles.length, 1);
    assert.equal(authProfiles[0]?.id, "profile-1");

    const createSessionResponse = await fetch(`${baseUrl}/agents/agent-1/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "API Session",
        authProfileId: "profile-1",
      }),
    });
    assert.equal(createSessionResponse.status, 201);
    const createdSession = (await createSessionResponse.json()) as AgentSessionRecord;
    assert.equal(createdSession.id, "session-1");
    assert.equal(createdSession.authProfileId, "profile-1");

    const listSessionsResponse = await fetch(`${baseUrl}/agents/agent-1/sessions`);
    assert.equal(listSessionsResponse.status, 200);
    const listedSessions = (await listSessionsResponse.json()) as AgentSessionRecord[];
    assert.equal(listedSessions.length, 1);
    assert.equal(listedSessions[0]?.id, "session-1");

    const sessionResponse = await fetch(`${baseUrl}/sessions/session-1`);
    assert.equal(sessionResponse.status, 200);
    const loadedSession = (await sessionResponse.json()) as AgentSessionRecord;
    assert.equal(loadedSession.title, "API Session");

    const sendTurnResponse = await fetch(`${baseUrl}/sessions/session-1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "hello" }),
    });
    assert.equal(sendTurnResponse.status, 202);
    const createdRun = (await sendTurnResponse.json()) as AgentRunRecord;
    assert.equal(createdRun.id, "run-1");

    const eventsResponse = await fetch(`${baseUrl}/runs/run-1/events`);
    assert.equal(eventsResponse.status, 200);
    assert.match(
      eventsResponse.headers.get("content-type") ?? "",
      /^text\/event-stream/
    );
    const sseEvents = parseSsePayload(await eventsResponse.text());
    assert.deepEqual(
      sseEvents.map((entry) => entry.event),
      ["session.bound", "assistant.message.completed", "run.completed"]
    );

    const resultResponse = await fetch(`${baseUrl}/runs/run-1/result`);
    assert.equal(resultResponse.status, 200);
    const runResult = (await resultResponse.json()) as RuntimeRunResult;
    assert.equal(runResult.status, "completed");
    assert.equal(runResult.sessionBinding?.runtimeSessionId, "thread-session-1");
    assert.equal(runResult.artifactRefs.length, 1);

    const artifactsResponse = await fetch(`${baseUrl}/runs/run-1/artifacts`);
    assert.equal(artifactsResponse.status, 200);
    const artifacts = (await artifactsResponse.json()) as Array<{
      kind: string;
      role: string;
      name: string;
      contentType: string;
      presentation: string;
      size: number | null;
      previewable: boolean;
      previewUrl: string | null;
      downloadUrl: string;
      preferredAction: string;
    }>;
    assert.deepEqual(artifacts, [
      {
        kind: "file",
        role: "output-last-message",
        name: "last-message.txt",
        contentType: "text/plain; charset=utf-8",
        presentation: "file",
        size: "first:hello".length,
        previewable: false,
        previewUrl: null,
        downloadUrl: "/runs/run-1/artifacts/output-last-message",
        preferredAction: "download",
      },
    ]);

    const artifactDownloadResponse = await fetch(
      `${baseUrl}/runs/run-1/artifacts/output-last-message`
    );
    assert.equal(artifactDownloadResponse.status, 200);
    assert.equal(
      artifactDownloadResponse.headers.get("content-type"),
      "text/plain; charset=utf-8"
    );
    assert.match(
      artifactDownloadResponse.headers.get("content-disposition") ?? "",
      /^attachment;/
    );
    assert.equal(await artifactDownloadResponse.text(), "first:hello");

    const artifactPreviewResponse = await fetch(
      `${baseUrl}/runs/run-1/artifacts/output-last-message/preview`
    );
    assert.equal(artifactPreviewResponse.status, 415);
    assert.deepEqual(await artifactPreviewResponse.json(), {
      error: "Artifact type does not support inline preview: output-last-message",
    });

    const transcriptResponse = await fetch(
      `${baseUrl}/sessions/session-1/transcript`
    );
    assert.equal(transcriptResponse.status, 200);
    const transcript = (await transcriptResponse.json()) as AgentSessionMessage[];
    assert.deepEqual(
      transcript.map((message) => [message.role, message.content]),
      [
        ["user", "hello"],
        ["assistant", "first:hello"],
      ]
    );
    assert.deepEqual(transcript[0]?.blocks, [
      {
        type: "text",
        text: "hello",
      },
    ]);
    assert.equal(transcript[1]?.artifacts?.[0]?.role, "output-last-message");
    assert.equal(
      transcript[1]?.artifacts?.[0]?.contentType,
      "text/plain; charset=utf-8"
    );
    assert.equal(transcript[1]?.artifacts?.[0]?.previewable, false);
    assert.equal(transcript[1]?.artifacts?.[0]?.previewUrl, null);
    assert.equal(
      transcript[1]?.artifacts?.[0]?.downloadUrl,
      "/runs/run-1/artifacts/output-last-message"
    );
  } finally {
    await server.close();
  }
});

test("Agent engine server exposes auth profile CRUD routes", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-engine-auth-api-"));
  const server = createAgentEngineServer({
    stateRoot,
  });

  await server.listen({
    port: 0,
    host: "127.0.0.1",
  });

  const address = server.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const createResponse = await fetch(`${baseUrl}/auth-profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: "profile-1",
        name: "Primary Analyst",
        accountLabel: "svc-analyst@example.com",
      }),
    });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()) as {
      id: string;
      name: string;
      accountLabel: string | null;
      login: { defaultMethod: string; status: string };
    };
    assert.equal(created.id, "profile-1");
    assert.equal(created.login.defaultMethod, "device-auth");
    assert.equal(created.login.status, "idle");

    const patchResponse = await fetch(`${baseUrl}/auth-profiles/profile-1`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Primary Analyst Updated",
        accountLabel: null,
      }),
    });
    assert.equal(patchResponse.status, 200);
    const patched = (await patchResponse.json()) as {
      name: string;
      accountLabel: string | null;
    };
    assert.equal(patched.name, "Primary Analyst Updated");
    assert.equal(patched.accountLabel, null);

    const deleteResponse = await fetch(`${baseUrl}/auth-profiles/profile-1`, {
      method: "DELETE",
    });
    assert.equal(deleteResponse.status, 204);

    const getDeletedResponse = await fetch(`${baseUrl}/auth-profiles/profile-1`);
    assert.equal(getDeletedResponse.status, 404);
  } finally {
    await server.close();
  }
});

test("Agent engine server creates agents over HTTP with validation-friendly errors", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-engine-agent-create-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "generated-agent",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const sessionService = new SessionService({
    stateRoot,
    manager,
    runtime: new FakeRuntime(),
  });
  const server = createAgentEngineServer({
    stateRoot,
    manager,
    sessionService,
  });

  await server.listen({
    port: 0,
    host: "127.0.0.1",
  });

  const address = server.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const createResponse = await fetch(`${baseUrl}/agents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "UI Agent",
        description: "Created from HTTP",
      }),
    });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()) as AgentRecord;
    assert.equal(created.id, "generated-agent");
    assert.equal(created.name, "UI Agent");
    assert.equal(created.description, "Created from HTTP");
    assert.equal(created.lifecycle, "active");
    assert.equal(created.archivedAt, null);

    const duplicateResponse = await fetch(`${baseUrl}/agents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: "generated-agent",
        name: "Duplicate",
      }),
    });
    assert.equal(duplicateResponse.status, 409);
    assert.deepEqual(await duplicateResponse.json(), {
      error: "Agent already exists: generated-agent",
    });

    const missingNameResponse = await fetch(`${baseUrl}/agents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    assert.equal(missingNameResponse.status, 400);
    assert.deepEqual(await missingNameResponse.json(), {
      error: "A non-empty agent name is required.",
    });

    const invalidDescriptionResponse = await fetch(`${baseUrl}/agents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Bad agent",
        description: 123,
      }),
    });
    assert.equal(invalidDescriptionResponse.status, 400);
    assert.deepEqual(await invalidDescriptionResponse.json(), {
      error: "Agent description must be a string when provided.",
    });
  } finally {
    await server.close();
  }
});

test("Agent engine server archives agents with non-running sessions, hides archived agents by default, and blocks new sessions", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-engine-agent-lifecycle-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: (() => {
      const timestamps = [
        "2026-03-13T00:00:00.000Z",
        "2026-03-13T00:10:00.000Z",
        "2026-03-13T00:11:00.000Z",
      ];
      return () => timestamps.shift() ?? "2026-03-13T00:12:00.000Z";
    })(),
  });
  const sessionService = new SessionService({
    stateRoot,
    manager,
    runtime: new FakeRuntime(),
  });

  await manager.createAgent({
    name: "http-agent",
  });

  const server = createAgentEngineServer({
    stateRoot,
    manager,
    sessionService,
  });

  await server.listen({
    port: 0,
    host: "127.0.0.1",
  });

  const address = server.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const createHistorySessionResponse = await fetch(`${baseUrl}/agents/agent-1/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "History session" }),
    });
    assert.equal(createHistorySessionResponse.status, 201);

    const archiveResponse = await fetch(`${baseUrl}/agents/agent-1`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lifecycle: "archived" }),
    });
    assert.equal(archiveResponse.status, 200);
    const archivedAgent = (await archiveResponse.json()) as AgentRecord;
    assert.equal(archivedAgent.lifecycle, "archived");
    assert.equal(archivedAgent.archivedAt, "2026-03-13T00:10:00.000Z");

    const activeOnlyResponse = await fetch(`${baseUrl}/agents`);
    assert.equal(activeOnlyResponse.status, 200);
    assert.deepEqual(await activeOnlyResponse.json(), []);

    const allAgentsResponse = await fetch(`${baseUrl}/agents?includeArchived=true`);
    assert.equal(allAgentsResponse.status, 200);
    const allAgents = (await allAgentsResponse.json()) as AgentRecord[];
    assert.equal(allAgents.length, 1);
    assert.equal(allAgents[0]?.lifecycle, "archived");

    const blockedSessionResponse = await fetch(`${baseUrl}/agents/agent-1/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Blocked" }),
    });
    assert.equal(blockedSessionResponse.status, 409);
    assert.deepEqual(await blockedSessionResponse.json(), {
      error: "Archived agents are read-only: agent-1",
    });

    const restoreResponse = await fetch(`${baseUrl}/agents/agent-1`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lifecycle: "active" }),
    });
    assert.equal(restoreResponse.status, 200);
    const restoredAgent = (await restoreResponse.json()) as AgentRecord;
    assert.equal(restoredAgent.lifecycle, "active");
    assert.equal(restoredAgent.archivedAt, null);

    const renameResponse = await fetch(`${baseUrl}/agents/agent-1`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "renamed-http-agent",
        description: "updated agent description",
      }),
    });
    assert.equal(renameResponse.status, 200);
    const renamedAgent = (await renameResponse.json()) as AgentRecord;
    assert.equal(renamedAgent.name, "renamed-http-agent");
    assert.equal(renamedAgent.description, "updated agent description");

    await manager.createAgent({
      id: "agent-2",
      name: "delete-agent",
    });

    const createDeleteSessionResponse = await fetch(`${baseUrl}/agents/agent-2/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Deletable session" }),
    });
    assert.equal(createDeleteSessionResponse.status, 201);

    const deleteResponse = await fetch(`${baseUrl}/agents/agent-2`, {
      method: "DELETE",
    });
    assert.equal(deleteResponse.status, 204);
  } finally {
    await server.close();
  }
});

test("Agent engine server stops running sessions before archive/delete when explicitly requested", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-engine-agent-delete-"));
  const manager = new AgentManager({
    stateRoot,
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const sessionService = new SessionService({
    stateRoot,
    manager,
    runtime: new BlockingRuntime(),
    now: () => "2026-03-13T00:05:00.000Z",
    idGenerator: (() => {
      const ids = ["session-1", "run-1", "session-2", "run-2", "session-3", "run-3"];
      return () => ids.shift() ?? "";
    })(),
  });

  await manager.createAgent({
    id: "agent-1",
    name: "http-agent",
  });
  await manager.createAgent({
    id: "agent-2",
    name: "delete-agent",
  });

  const server = createAgentEngineServer({
    stateRoot,
    manager,
    sessionService,
  });

  await server.listen({
    port: 0,
    host: "127.0.0.1",
  });

  const address = server.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const createSessionResponse = await fetch(`${baseUrl}/agents/agent-1/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Running session" }),
    });
    assert.equal(createSessionResponse.status, 201);
    const createdSession = (await createSessionResponse.json()) as AgentSessionRecord;
    assert.equal(createdSession.id, "session-1");

    const runResponse = await fetch(`${baseUrl}/sessions/session-1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "hold" }),
    });
    assert.equal(runResponse.status, 202);
    const createdRun = (await runResponse.json()) as AgentRunRecord;
    assert.equal(createdRun.id, "run-1");

    const archiveAgentResponse = await fetch(`${baseUrl}/agents/agent-1`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lifecycle: "archived" }),
    });
    assert.equal(archiveAgentResponse.status, 409);
    assert.deepEqual(await archiveAgentResponse.json(), {
      error: "Cannot archive an agent with running sessions until they are stopped: agent-1",
    });

    const archiveWithStopResponse = await fetch(`${baseUrl}/agents/agent-1`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lifecycle: "archived",
        stopRunningSessions: true,
      }),
    });
    assert.equal(archiveWithStopResponse.status, 200);
    const archivedAgent = (await archiveWithStopResponse.json()) as AgentRecord;
    assert.equal(archivedAgent.lifecycle, "archived");

    const cancelledSessionResponse = await fetch(`${baseUrl}/sessions/session-1`);
    assert.equal(cancelledSessionResponse.status, 200);
    const cancelledSession = (await cancelledSessionResponse.json()) as AgentSessionRecord;
    assert.equal(cancelledSession.status, "cancelled");

    const createDeleteSessionResponse = await fetch(`${baseUrl}/agents/agent-2/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Delete me" }),
    });
    assert.equal(createDeleteSessionResponse.status, 201);

    const deleteRunResponse = await fetch(`${baseUrl}/sessions/session-2/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "hold delete" }),
    });
    assert.equal(deleteRunResponse.status, 202);

    const deleteSessionWhileRunningResponse = await fetch(`${baseUrl}/sessions/session-2`, {
      method: "DELETE",
    });
    assert.equal(deleteSessionWhileRunningResponse.status, 409);
    assert.deepEqual(await deleteSessionWhileRunningResponse.json(), {
      error: "Cannot delete a session with an active run: session-2",
    });

    const deleteSessionResponse = await fetch(
      `${baseUrl}/sessions/session-2?stopRunningRuns=true`,
      {
        method: "DELETE",
      }
    );
    assert.equal(deleteSessionResponse.status, 204);

    const missingSessionResponse = await fetch(`${baseUrl}/sessions/session-2`);
    assert.equal(missingSessionResponse.status, 404);
    assert.deepEqual(await missingSessionResponse.json(), {
      error: "Unknown session: session-2",
    });

    const missingRunResponse = await fetch(`${baseUrl}/runs/run-2`);
    assert.equal(missingRunResponse.status, 404);
    assert.deepEqual(await missingRunResponse.json(), {
      error: "Unknown run: run-2",
    });

    const createDeleteAgentSessionResponse = await fetch(`${baseUrl}/agents/agent-2/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Delete agent with active run" }),
    });
    assert.equal(createDeleteAgentSessionResponse.status, 201);

    const deleteAgentRunResponse = await fetch(`${baseUrl}/sessions/session-3/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "hold delete agent" }),
    });
    assert.equal(deleteAgentRunResponse.status, 202);

    const deleteWhileRunningResponse = await fetch(`${baseUrl}/agents/agent-2`, {
      method: "DELETE",
    });
    assert.equal(deleteWhileRunningResponse.status, 409);
    assert.deepEqual(await deleteWhileRunningResponse.json(), {
      error: "Cannot delete an agent with running sessions until they are stopped: agent-2",
    });

    const deleteResponse = await fetch(
      `${baseUrl}/agents/agent-2?stopRunningSessions=true`,
      {
        method: "DELETE",
      }
    );
    assert.equal(deleteResponse.status, 204);

    const missingAgentResponse = await fetch(`${baseUrl}/agents/agent-2`);
    assert.equal(missingAgentResponse.status, 404);
    assert.deepEqual(await missingAgentResponse.json(), {
      error: "Unknown agent: agent-2",
    });
  } finally {
    await server.close();
  }
});

test("Agent engine server updates session title, archives sessions, and hides archived sessions by default", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-engine-session-lifecycle-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const sessionService = new SessionService({
    stateRoot,
    manager,
    runtime,
    now: (() => {
      const timestamps = [
        "2026-03-13T00:10:00.000Z",
        "2026-03-13T00:11:00.000Z",
        "2026-03-13T00:12:00.000Z",
      ];
      return () => timestamps.shift() ?? "2026-03-13T00:13:00.000Z";
    })(),
    idGenerator: (() => {
      const ids = ["session-1", "run-1"];
      return () => ids.shift() ?? "";
    })(),
  });

  await manager.createAgent({
    name: "http-agent",
  });

  const server = createAgentEngineServer({
    stateRoot,
    manager,
    sessionService,
  });

  await server.listen({
    port: 0,
    host: "127.0.0.1",
  });

  const address = server.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const createSessionResponse = await fetch(`${baseUrl}/agents/agent-1/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Original title" }),
    });
    assert.equal(createSessionResponse.status, 201);
    const createdSession = (await createSessionResponse.json()) as AgentSessionRecord;
    assert.equal(createdSession.lifecycle, "active");
    assert.equal(createdSession.archivedAt, null);

    const renameResponse = await fetch(`${baseUrl}/sessions/session-1`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Renamed session" }),
    });
    assert.equal(renameResponse.status, 200);
    const renamedSession = (await renameResponse.json()) as AgentSessionRecord;
    assert.equal(renamedSession.title, "Renamed session");
    assert.equal(renamedSession.lifecycle, "active");

    const archiveResponse = await fetch(`${baseUrl}/sessions/session-1`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lifecycle: "archived" }),
    });
    assert.equal(archiveResponse.status, 200);
    const archivedSession = (await archiveResponse.json()) as AgentSessionRecord;
    assert.equal(archivedSession.lifecycle, "archived");
    assert.equal(archivedSession.archivedAt, "2026-03-13T00:10:00.000Z");

    const activeOnlySessionsResponse = await fetch(`${baseUrl}/agents/agent-1/sessions`);
    assert.equal(activeOnlySessionsResponse.status, 200);
    assert.deepEqual(await activeOnlySessionsResponse.json(), []);

    const allSessionsResponse = await fetch(
      `${baseUrl}/agents/agent-1/sessions?includeArchived=true`
    );
    assert.equal(allSessionsResponse.status, 200);
    const allSessions = (await allSessionsResponse.json()) as AgentSessionRecord[];
    assert.equal(allSessions.length, 1);
    assert.equal(allSessions[0]?.lifecycle, "archived");

    const directSessionResponse = await fetch(`${baseUrl}/sessions/session-1`);
    assert.equal(directSessionResponse.status, 200);
    const directSession = (await directSessionResponse.json()) as AgentSessionRecord;
    assert.equal(directSession.lifecycle, "archived");

    const archivedSendResponse = await fetch(`${baseUrl}/sessions/session-1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "hello" }),
    });
    assert.equal(archivedSendResponse.status, 409);
    assert.deepEqual(await archivedSendResponse.json(), {
      error: "Archived sessions are read-only: session-1",
    });

    const restoreResponse = await fetch(`${baseUrl}/sessions/session-1`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lifecycle: "active" }),
    });
    assert.equal(restoreResponse.status, 200);
    const restoredSession = (await restoreResponse.json()) as AgentSessionRecord;
    assert.equal(restoredSession.lifecycle, "active");
    assert.equal(restoredSession.archivedAt, null);

    const sendTurnResponse = await fetch(`${baseUrl}/sessions/session-1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "finish and delete" }),
    });
    assert.equal(sendTurnResponse.status, 202);

    const runResultResponse = await fetch(`${baseUrl}/runs/run-1/result`);
    assert.equal(runResultResponse.status, 200);

    const deleteResponse = await fetch(`${baseUrl}/sessions/session-1`, {
      method: "DELETE",
    });
    assert.equal(deleteResponse.status, 204);

    const deletedSessionResponse = await fetch(`${baseUrl}/sessions/session-1`);
    assert.equal(deletedSessionResponse.status, 404);
    assert.deepEqual(await deletedSessionResponse.json(), {
      error: "Unknown session: session-1",
    });

    const deletedRunResponse = await fetch(`${baseUrl}/runs/run-1`);
    assert.equal(deletedRunResponse.status, 404);
    assert.deepEqual(await deletedRunResponse.json(), {
      error: "Unknown run: run-1",
    });
  } finally {
    await server.close();
  }
});

test("Agent engine server rejects session archive while a run is active", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-engine-session-active-run-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new BlockingRuntime();
  const sessionService = new SessionService({
    stateRoot,
    manager,
    runtime,
    idGenerator: (() => {
      const ids = ["session-1", "run-1"];
      return () => ids.shift() ?? "";
    })(),
  });

  await manager.createAgent({
    name: "http-agent",
  });

  const server = createAgentEngineServer({
    stateRoot,
    manager,
    sessionService,
  });

  await server.listen({
    port: 0,
    host: "127.0.0.1",
  });

  const address = server.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const createSessionResponse = await fetch(`${baseUrl}/agents/agent-1/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Busy session" }),
    });
    assert.equal(createSessionResponse.status, 201);

    const sendTurnResponse = await fetch(`${baseUrl}/sessions/session-1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "keep running" }),
    });
    assert.equal(sendTurnResponse.status, 202);

    const archiveResponse = await fetch(`${baseUrl}/sessions/session-1`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lifecycle: "archived" }),
    });
    assert.equal(archiveResponse.status, 409);
    assert.deepEqual(await archiveResponse.json(), {
      error: "Cannot archive a session with an active run: session-1",
    });
  } finally {
    await server.close();
  }
});

test("Agent engine server exposes browser-safe inline preview metadata for previewable artifacts", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-engine-artifact-preview-"));
  const artifactsDir = path.join(stateRoot, "runs", "run-preview", "artifacts");
  const imagePath = path.join(artifactsDir, "chart.png");
  const audioPath = path.join(artifactsDir, "sample-audio.wav");
  const videoPath = path.join(artifactsDir, "sample-video.mp4");
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(imagePath, Buffer.from("fake-png-binary"), "utf8");
  await writeFile(audioPath, Buffer.from("fake-wav-binary"), "utf8");
  await writeFile(videoPath, Buffer.from("fake-mp4-binary"), "utf8");

  const run: AgentRunRecord = {
    id: "run-preview",
    agentId: "agent-preview",
    sessionId: "session-preview",
    runtimeRunId: "run-preview",
    triggerType: "interactive",
    status: "completed",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    prompt: "show chart",
    startedAt: "2026-03-13T00:00:00.000Z",
    endedAt: "2026-03-13T00:00:05.000Z",
    summary: "chart",
    runtimeSessionId: "thread-preview",
    outputLastMessagePath: null,
    resultPath: path.join(stateRoot, "runs", "run-preview", "result.json"),
    eventsPath: path.join(stateRoot, "runs", "run-preview", "events.jsonl"),
    artifactsDir,
  };

  const result: RuntimeRunResult = {
    runId: "run-preview",
    sessionId: "session-preview",
    runtimeSessionId: "thread-preview",
    sessionBinding: null,
    status: "completed",
    startedAt: "2026-03-13T00:00:00.000Z",
    endedAt: "2026-03-13T00:00:05.000Z",
    exitCode: 0,
    signal: null,
    command: "fake-codex",
    args: ["show chart"],
    messages: [],
    warnings: [],
    errors: [],
    stderr: [],
    artifactRefs: [
      {
        kind: "file",
        role: "chart-image",
        path: imagePath,
      },
      {
        kind: "file",
        role: "sample-audio",
        path: audioPath,
      },
      {
        kind: "file",
        role: "sample-video",
        path: videoPath,
      },
    ],
    lastMessage: "chart ready",
    outputLastMessagePath: null,
    rawEvents: [],
  };

  const sessionService = {
    createSession: async () => {
      throw new Error("not used");
    },
    listAgentSessions: async () => {
      throw new Error("not used");
    },
    updateSession: async () => {
      throw new Error("not used");
    },
    deleteSession: async () => {
      throw new Error("not used");
    },
    stopSessionRuns: async () => {
      throw new Error("not used");
    },
    getSession: async () => {
      throw new Error("not used");
    },
    getTranscript: async () => {
      throw new Error("not used");
    },
    sendTurn: async () => {
      throw new Error("not used");
    },
    streamRunEvents: async function* () {
      throw new Error("not used");
    },
    getRun: async () => run,
    getRunResult: async () => result,
    cancelRun: async () => {
      throw new Error("not used");
    },
    stopAgentRuns: async () => {
      throw new Error("not used");
    },
  };
  const agentService = {
    createAgent: async () => {
      throw new Error("not used");
    },
    listAgents: async () => [],
    getAgent: async () => {
      throw new Error("not used");
    },
    updateAgent: async () => {
      throw new Error("not used");
    },
    deleteAgent: async () => {
      throw new Error("not used");
    },
  };
  const server = createAgentEngineServer({
    stateRoot,
    sessionService,
    agentService,
  });

  await server.listen({
    port: 0,
    host: "127.0.0.1",
  });

  const address = server.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const artifactsResponse = await fetch(`${baseUrl}/runs/run-preview/artifacts`);
    assert.equal(artifactsResponse.status, 200);
    const artifacts = (await artifactsResponse.json()) as Array<{
      role: string;
      contentType: string;
      presentation: string;
      previewable: boolean;
      previewUrl: string | null;
      downloadUrl: string;
      preferredAction: string;
    }>;
    assert.deepEqual(artifacts, [
      {
        kind: "file",
        role: "chart-image",
        name: "chart.png",
        contentType: "image/png",
        presentation: "image",
        size: "fake-png-binary".length,
        previewable: true,
        previewUrl: "/runs/run-preview/artifacts/chart-image/preview",
        downloadUrl: "/runs/run-preview/artifacts/chart-image",
        preferredAction: "preview",
      },
      {
        kind: "file",
        role: "sample-audio",
        name: "sample-audio.wav",
        contentType: "audio/wav",
        presentation: "file",
        size: "fake-wav-binary".length,
        previewable: true,
        previewUrl: "/runs/run-preview/artifacts/sample-audio/preview",
        downloadUrl: "/runs/run-preview/artifacts/sample-audio",
        preferredAction: "preview",
      },
      {
        kind: "file",
        role: "sample-video",
        name: "sample-video.mp4",
        contentType: "video/mp4",
        presentation: "file",
        size: "fake-mp4-binary".length,
        previewable: true,
        previewUrl: "/runs/run-preview/artifacts/sample-video/preview",
        downloadUrl: "/runs/run-preview/artifacts/sample-video",
        preferredAction: "preview",
      },
    ]);

    const previewResponse = await fetch(
      `${baseUrl}/runs/run-preview/artifacts/chart-image/preview`
    );
    assert.equal(previewResponse.status, 200);
    assert.equal(previewResponse.headers.get("content-type"), "image/png");
    assert.match(
      previewResponse.headers.get("content-disposition") ?? "",
      /^inline;/
    );
    const previewBody = Buffer.from(await previewResponse.arrayBuffer()).toString("utf8");
    assert.equal(previewBody, "fake-png-binary");

    const audioPreviewResponse = await fetch(
      `${baseUrl}/runs/run-preview/artifacts/sample-audio/preview`
    );
    assert.equal(audioPreviewResponse.status, 200);
    assert.equal(audioPreviewResponse.headers.get("content-type"), "audio/wav");
    assert.match(
      audioPreviewResponse.headers.get("content-disposition") ?? "",
      /^inline;/
    );
    const audioPreviewBody = Buffer.from(await audioPreviewResponse.arrayBuffer()).toString("utf8");
    assert.equal(audioPreviewBody, "fake-wav-binary");

    const videoPreviewResponse = await fetch(
      `${baseUrl}/runs/run-preview/artifacts/sample-video/preview`
    );
    assert.equal(videoPreviewResponse.status, 200);
    assert.equal(videoPreviewResponse.headers.get("content-type"), "video/mp4");
    assert.match(
      videoPreviewResponse.headers.get("content-disposition") ?? "",
      /^inline;/
    );
    const videoPreviewBody = Buffer.from(await videoPreviewResponse.arrayBuffer()).toString("utf8");
    assert.equal(videoPreviewBody, "fake-mp4-binary");

    const downloadResponse = await fetch(
      `${baseUrl}/runs/run-preview/artifacts/chart-image`
    );
    assert.equal(downloadResponse.status, 200);
    assert.match(
      downloadResponse.headers.get("content-disposition") ?? "",
      /^attachment;/
    );
  } finally {
    await server.close();
  }
});

test("Agent engine server converts PowerPoint artifacts to PDF previews", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-engine-ppt-preview-"));
  const artifactsDir = path.join(stateRoot, "runs", "run-ppt", "artifacts");
  const deckPath = path.join(artifactsDir, "project-proposal.pptx");
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(deckPath, Buffer.from("fake-pptx-binary"), "utf8");

  const previousConverter = process.env.ROCKY_OFFICE_CONVERTER;
  process.env.ROCKY_OFFICE_CONVERTER = await createFakeOfficeConverter(stateRoot);

  const run: AgentRunRecord = {
    id: "run-ppt",
    agentId: "agent-ppt",
    sessionId: "session-ppt",
    runtimeRunId: "run-ppt",
    triggerType: "interactive",
    status: "completed",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    prompt: "show deck",
    startedAt: "2026-03-13T00:00:00.000Z",
    endedAt: "2026-03-13T00:00:05.000Z",
    summary: "deck",
    runtimeSessionId: "thread-ppt",
    outputLastMessagePath: null,
    resultPath: path.join(stateRoot, "runs", "run-ppt", "result.json"),
    eventsPath: path.join(stateRoot, "runs", "run-ppt", "events.jsonl"),
    artifactsDir,
  };

  const result: RuntimeRunResult = {
    runId: "run-ppt",
    sessionId: "session-ppt",
    runtimeSessionId: "thread-ppt",
    sessionBinding: null,
    status: "completed",
    startedAt: "2026-03-13T00:00:00.000Z",
    endedAt: "2026-03-13T00:00:05.000Z",
    exitCode: 0,
    signal: null,
    command: "fake-codex",
    args: ["show deck"],
    messages: [],
    warnings: [],
    errors: [],
    stderr: [],
    artifactRefs: [
      {
        kind: "file",
        role: "proposal-deck",
        path: deckPath,
      },
    ],
    lastMessage: "deck ready",
    outputLastMessagePath: null,
    rawEvents: [],
  };

  const sessionService = {
    createSession: async () => {
      throw new Error("not used");
    },
    listAgentSessions: async () => {
      throw new Error("not used");
    },
    updateSession: async () => {
      throw new Error("not used");
    },
    deleteSession: async () => {
      throw new Error("not used");
    },
    stopSessionRuns: async () => {
      throw new Error("not used");
    },
    getSession: async () => {
      throw new Error("not used");
    },
    getTranscript: async () => {
      throw new Error("not used");
    },
    sendTurn: async () => {
      throw new Error("not used");
    },
    streamRunEvents: async function* () {
      throw new Error("not used");
    },
    getRun: async () => run,
    getRunResult: async () => result,
    cancelRun: async () => {
      throw new Error("not used");
    },
    stopAgentRuns: async () => {
      throw new Error("not used");
    },
  };
  const agentService = {
    createAgent: async () => {
      throw new Error("not used");
    },
    listAgents: async () => [],
    getAgent: async () => {
      throw new Error("not used");
    },
    updateAgent: async () => {
      throw new Error("not used");
    },
    deleteAgent: async () => {
      throw new Error("not used");
    },
  };
  const nativeOpenPaths: string[] = [];

  const server = createAgentEngineServer({
    stateRoot,
    sessionService,
    agentService,
    nativeFileOpener: async (filePath) => {
      nativeOpenPaths.push(filePath);
      return {
        status: "opened",
        application: "Microsoft PowerPoint",
        fileName: path.basename(filePath),
        platform: "test",
      };
    },
  });

  await server.listen({
    port: 0,
    host: "127.0.0.1",
  });

  const address = server.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const artifactsResponse = await fetch(`${baseUrl}/runs/run-ppt/artifacts`);
    assert.equal(artifactsResponse.status, 200);
    const artifacts = (await artifactsResponse.json()) as Array<{
      contentType: string;
      previewable: boolean;
      previewUrl: string | null;
      preferredAction: string;
    }>;
    assert.equal(
      artifacts[0]?.contentType,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
    assert.equal(artifacts[0]?.previewable, true);
    assert.equal(artifacts[0]?.previewUrl, "/runs/run-ppt/artifacts/proposal-deck/preview");
    assert.equal(artifacts[0]?.preferredAction, "preview");

    const previewResponse = await fetch(
      `${baseUrl}/runs/run-ppt/artifacts/proposal-deck/preview`
    );
    assert.equal(previewResponse.status, 200);
    assert.equal(previewResponse.headers.get("content-type"), "application/pdf");
    assert.match(
      previewResponse.headers.get("content-disposition") ?? "",
      /^inline;/
    );
    assert.equal(
      Buffer.from(await previewResponse.arrayBuffer()).toString("utf8"),
      "%PDF-fake-converted"
    );

    const nativeOpenResponse = await fetch(
      `${baseUrl}/runs/run-ppt/artifacts/proposal-deck/open-native`,
      {
        method: "POST",
      }
    );
    assert.equal(nativeOpenResponse.status, 200);
    assert.deepEqual(await nativeOpenResponse.json(), {
      status: "opened",
      application: "Microsoft PowerPoint",
      fileName: "project-proposal.pptx",
      platform: "test",
    });
    assert.deepEqual(nativeOpenPaths, [deckPath]);
  } finally {
    await server.close();
    if (previousConverter === undefined) {
      delete process.env.ROCKY_OFFICE_CONVERTER;
    } else {
      process.env.ROCKY_OFFICE_CONVERTER = previousConverter;
    }
  }
});

test("Agent engine server exposes agent workspace browsing and file preview APIs", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-engine-workspace-browser-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-workspace",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const sessionService = new SessionService({
    stateRoot,
    manager,
    runtime: new FakeRuntime(),
  });
  const agent = await manager.createAgent({
    name: "Workspace Agent",
  });

  const notesDir = path.join(agent.workspaceRoot, "notes");
  const notePath = path.join(notesDir, "summary.md");
  const envTemplatePath = path.join(agent.workspaceRoot, ".env.template");
  const htmlPath = path.join(agent.workspaceRoot, "report.html");
  const imagePath = path.join(agent.workspaceRoot, "diagram.png");
  const pdfPath = path.join(agent.workspaceRoot, "manual.pdf");
  const pptxPath = path.join(agent.workspaceRoot, "proposal.pptx");
  const koreanPptxPath = path.join(
    agent.workspaceRoot,
    "uploads",
    "rocky",
    "input",
    "플로깅-줍깅-플랫폼-해커톤-PPT.pptx"
  );
  const audioPath = path.join(agent.workspaceRoot, "voice.mp3");
  const videoPath = path.join(agent.workspaceRoot, "clip.mp4");
  await mkdir(notesDir, { recursive: true });
  await mkdir(path.dirname(koreanPptxPath), { recursive: true });
  await writeFile(notePath, "# Summary\nline two\n", "utf8");
  await writeFile(envTemplatePath, "OPENAI_API_KEY=\nMODEL=gpt-5.4\n", "utf8");
  await writeFile(htmlPath, "<!doctype html><title>Report</title><h1>Workspace</h1>", "utf8");
  await writeFile(imagePath, Buffer.from("fake-png-binary"), "utf8");
  await writeFile(pdfPath, Buffer.from("%PDF-fake"), "utf8");
  await writeFile(pptxPath, Buffer.from("fake-pptx-binary"), "utf8");
  await writeFile(koreanPptxPath, Buffer.from("fake-korean-pptx-binary"), "utf8");
  await writeFile(audioPath, Buffer.from("fake-mp3-binary"), "utf8");
  await writeFile(videoPath, Buffer.from("fake-mp4-binary"), "utf8");

  const workspaceNativeOpenPaths: string[] = [];
  const server = createAgentEngineServer({
    stateRoot,
    manager,
    sessionService,
    nativeFileOpener: async (filePath) => {
      workspaceNativeOpenPaths.push(filePath);
      return {
        status: "opened",
        application: "Microsoft PowerPoint",
        fileName: path.basename(filePath),
        platform: "test",
      };
    },
  });

  await server.listen({
    port: 0,
    host: "127.0.0.1",
  });

  const address = server.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const workspaceResponse = await fetch(`${baseUrl}/agents/${agent.id}/workspace`);
    assert.equal(workspaceResponse.status, 200);
    const workspace = (await workspaceResponse.json()) as {
      agentId: string;
      workspaceRoot: string;
      path: string;
      parentPath: string | null;
      entries: Array<{
        kind: string;
        name: string;
        path: string;
        previewKind: string | null;
      }>;
    };
    assert.equal(workspace.agentId, agent.id);
    assert.equal(workspace.path, "");
    assert.equal(workspace.parentPath, null);
    assert.equal(workspace.workspaceRoot, agent.workspaceRoot);
    assert.ok(workspace.entries.some((entry) => entry.kind === "directory" && entry.name === "notes"));
    assert.ok(
      workspace.entries.some(
        (entry) =>
          entry.kind === "file" &&
          entry.name === ".env.template" &&
          entry.previewKind === "code"
      )
    );
    assert.ok(
      workspace.entries.some(
        (entry) =>
          entry.kind === "file" &&
          entry.name === "diagram.png" &&
          entry.previewKind === "image"
      )
    );
    assert.ok(
      workspace.entries.some(
        (entry) =>
          entry.kind === "file" &&
          entry.name === "report.html" &&
          entry.previewKind === "html"
      )
    );
    assert.ok(
      workspace.entries.some(
        (entry) =>
          entry.kind === "file" &&
          entry.name === "manual.pdf" &&
          entry.previewKind === "document"
      )
    );
    assert.ok(
      workspace.entries.some(
        (entry) =>
          entry.kind === "file" &&
          entry.name === "proposal.pptx" &&
          entry.previewKind === "document"
      )
    );
    assert.ok(
      workspace.entries.some(
        (entry) =>
          entry.kind === "file" &&
          entry.name === "voice.mp3" &&
          entry.previewKind === "audio"
      )
    );
    assert.ok(
      workspace.entries.some(
        (entry) =>
          entry.kind === "file" &&
          entry.name === "clip.mp4" &&
          entry.previewKind === "video"
      )
    );

    const nestedWorkspaceResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace?path=notes`
    );
    assert.equal(nestedWorkspaceResponse.status, 200);
    const nestedWorkspace = (await nestedWorkspaceResponse.json()) as {
      path: string;
      parentPath: string | null;
      entries: Array<{ name: string; path: string; kind: string }>;
    };
    assert.equal(nestedWorkspace.path, "notes");
    assert.equal(nestedWorkspace.parentPath, "");
    assert.equal(nestedWorkspace.entries.length, 1);
    assert.equal(nestedWorkspace.entries[0]?.kind, "file");
    assert.equal(nestedWorkspace.entries[0]?.name, "summary.md");
    assert.equal(nestedWorkspace.entries[0]?.path, "notes/summary.md");

    const textPreviewResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file?path=notes%2Fsummary.md`
    );
    assert.equal(textPreviewResponse.status, 200);
    const textPreview = (await textPreviewResponse.json()) as {
      path: string;
      contentType: string;
      previewKind: string;
      text: string | null;
      lineCount: number | null;
      truncated: boolean;
      downloadUrl: string;
      inlinePreviewUrl: string | null;
    };
    assert.equal(textPreview.path, "notes/summary.md");
    assert.equal(textPreview.contentType, "text/markdown; charset=utf-8");
    assert.equal(textPreview.previewKind, "markdown");
    assert.equal(textPreview.text, "# Summary\nline two\n");
    assert.equal(textPreview.lineCount, 3);
    assert.equal(textPreview.truncated, false);
    assert.equal(
      textPreview.downloadUrl,
      `/agents/${agent.id}/workspace/file/content?path=notes%2Fsummary.md`
    );
    assert.equal(textPreview.inlinePreviewUrl, null);

    const envTemplatePreviewResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file?path=.env.template`
    );
    assert.equal(envTemplatePreviewResponse.status, 200);
    const envTemplatePreview = (await envTemplatePreviewResponse.json()) as {
      contentType: string;
      previewKind: string;
      text: string | null;
      inlinePreviewUrl: string | null;
    };
    assert.equal(envTemplatePreview.contentType, "text/plain; charset=utf-8");
    assert.equal(envTemplatePreview.previewKind, "code");
    assert.match(envTemplatePreview.text ?? "", /OPENAI_API_KEY=/);
    assert.equal(envTemplatePreview.inlinePreviewUrl, null);

    const htmlPreviewResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file?path=report.html`
    );
    assert.equal(htmlPreviewResponse.status, 200);
    const htmlPreview = (await htmlPreviewResponse.json()) as {
      contentType: string;
      previewKind: string;
      text: string | null;
      inlinePreviewUrl: string | null;
    };
    assert.equal(htmlPreview.contentType, "text/html; charset=utf-8");
    assert.equal(htmlPreview.previewKind, "html");
    assert.match(htmlPreview.text ?? "", /<h1>Workspace<\/h1>/);
    assert.equal(htmlPreview.inlinePreviewUrl, null);

    const textDownloadResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file/content?path=notes%2Fsummary.md`
    );
    assert.equal(textDownloadResponse.status, 200);
    assert.equal(
      textDownloadResponse.headers.get("content-type"),
      "text/markdown; charset=utf-8"
    );
    assert.match(
      textDownloadResponse.headers.get("content-disposition") ?? "",
      /^attachment;/
    );
    assert.equal(await textDownloadResponse.text(), "# Summary\nline two\n");

    const imagePreviewMetadataResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file?path=diagram.png`
    );
    assert.equal(imagePreviewMetadataResponse.status, 200);
    const imagePreviewMetadata = (await imagePreviewMetadataResponse.json()) as {
      previewKind: string;
      text: string | null;
      inlinePreviewUrl: string | null;
    };
    assert.equal(imagePreviewMetadata.previewKind, "image");
    assert.equal(imagePreviewMetadata.text, null);
    assert.equal(
      imagePreviewMetadata.inlinePreviewUrl,
      `/agents/${agent.id}/workspace/file/preview?path=diagram.png`
    );

    const documentPreviewMetadataResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file?path=manual.pdf`
    );
    assert.equal(documentPreviewMetadataResponse.status, 200);
    const documentPreviewMetadata = (await documentPreviewMetadataResponse.json()) as {
      previewKind: string;
      inlinePreviewUrl: string | null;
    };
    assert.equal(documentPreviewMetadata.previewKind, "document");
    assert.equal(
      documentPreviewMetadata.inlinePreviewUrl,
      `/agents/${agent.id}/workspace/file/preview?path=manual.pdf`
    );

    const pptxPreviewMetadataResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file?path=proposal.pptx`
    );
    assert.equal(pptxPreviewMetadataResponse.status, 200);
    const pptxPreviewMetadata = (await pptxPreviewMetadataResponse.json()) as {
      previewKind: string;
      inlinePreviewUrl: string | null;
    };
    assert.equal(pptxPreviewMetadata.previewKind, "document");
    assert.equal(
      pptxPreviewMetadata.inlinePreviewUrl,
      `/agents/${agent.id}/workspace/file/preview?path=proposal.pptx`
    );

    const koreanPptxDownloadResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file/content?path=${encodeURIComponent(
        "uploads/rocky/input/플로깅-줍깅-플랫폼-해커톤-PPT.pptx"
      )}`
    );
    assert.equal(koreanPptxDownloadResponse.status, 200);
    assert.match(
      koreanPptxDownloadResponse.headers.get("content-disposition") ?? "",
      /^attachment;/
    );
    assert.match(
      koreanPptxDownloadResponse.headers.get("content-disposition") ?? "",
      /filename\*=UTF-8''%ED%94%8C%EB%A1%9C%EA%B9%85/u
    );
    assert.equal(
      Buffer.from(await koreanPptxDownloadResponse.arrayBuffer()).toString("utf8"),
      "fake-korean-pptx-binary"
    );

    const pptxNativeOpenResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file/open-native?path=proposal.pptx`,
      {
        method: "POST",
      }
    );
    assert.equal(pptxNativeOpenResponse.status, 200);
    assert.deepEqual(await pptxNativeOpenResponse.json(), {
      status: "opened",
      application: "Microsoft PowerPoint",
      fileName: "proposal.pptx",
      platform: "test",
    });
    assert.deepEqual(workspaceNativeOpenPaths, [pptxPath]);

    const audioPreviewMetadataResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file?path=voice.mp3`
    );
    assert.equal(audioPreviewMetadataResponse.status, 200);
    const audioPreviewMetadata = (await audioPreviewMetadataResponse.json()) as {
      previewKind: string;
      inlinePreviewUrl: string | null;
    };
    assert.equal(audioPreviewMetadata.previewKind, "audio");
    assert.equal(
      audioPreviewMetadata.inlinePreviewUrl,
      `/agents/${agent.id}/workspace/file/preview?path=voice.mp3`
    );

    const videoPreviewMetadataResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file?path=clip.mp4`
    );
    assert.equal(videoPreviewMetadataResponse.status, 200);
    const videoPreviewMetadata = (await videoPreviewMetadataResponse.json()) as {
      previewKind: string;
      inlinePreviewUrl: string | null;
    };
    assert.equal(videoPreviewMetadata.previewKind, "video");
    assert.equal(
      videoPreviewMetadata.inlinePreviewUrl,
      `/agents/${agent.id}/workspace/file/preview?path=clip.mp4`
    );

    const imagePreviewResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file/preview?path=diagram.png`
    );
    assert.equal(imagePreviewResponse.status, 200);
    assert.equal(imagePreviewResponse.headers.get("content-type"), "image/png");
    assert.match(
      imagePreviewResponse.headers.get("content-disposition") ?? "",
      /^inline;/
    );
    assert.equal(
      Buffer.from(await imagePreviewResponse.arrayBuffer()).toString("utf8"),
      "fake-png-binary"
    );

    const documentPreviewResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file/preview?path=manual.pdf`
    );
    assert.equal(documentPreviewResponse.status, 200);
    assert.equal(documentPreviewResponse.headers.get("content-type"), "application/pdf");

    const audioPreviewResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file/preview?path=voice.mp3`
    );
    assert.equal(audioPreviewResponse.status, 200);
    assert.equal(audioPreviewResponse.headers.get("content-type"), "audio/mpeg");

    const videoPreviewResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file/preview?path=clip.mp4`
    );
    assert.equal(videoPreviewResponse.status, 200);
    assert.equal(videoPreviewResponse.headers.get("accept-ranges"), "bytes");
    assert.equal(videoPreviewResponse.headers.get("content-type"), "video/mp4");

    const rangedVideoPreviewResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace/file/preview?path=clip.mp4`,
      {
        headers: {
          Range: "bytes=0-3",
        },
      }
    );
    assert.equal(rangedVideoPreviewResponse.status, 206);
    assert.equal(
      rangedVideoPreviewResponse.headers.get("content-range"),
      `bytes 0-3/${Buffer.from("fake-mp4-binary").byteLength}`
    );
    assert.equal(
      Buffer.from(await rangedVideoPreviewResponse.arrayBuffer()).toString("utf8"),
      "fake"
    );

    const escapedPathResponse = await fetch(
      `${baseUrl}/agents/${agent.id}/workspace?path=..%2F..`
    );
    assert.equal(escapedPathResponse.status, 400);
    assert.deepEqual(await escapedPathResponse.json(), {
      error: "Workspace path escapes agent root: ../..",
    });
  } finally {
    await server.close();
  }
});

test("Agent engine server stores uploaded workspace files and allows previewing them", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-engine-workspace-upload-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-upload",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const sessionService = new SessionService({
    stateRoot,
    manager,
    runtime: new FakeRuntime(),
  });
  const agent = await manager.createAgent({
    name: "Upload Agent",
  });

  const server = createAgentEngineServer({
    stateRoot,
    manager,
    sessionService,
  });

  await server.listen({
    port: 0,
    host: "127.0.0.1",
  });

  const address = server.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const uploadResponse = await fetch(`${baseUrl}/agents/${agent.id}/workspace/file`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: "diagram.png",
        contentBase64: Buffer.from("fake-png-binary").toString("base64"),
      }),
    });

    assert.equal(uploadResponse.status, 201);
    const uploaded = (await uploadResponse.json()) as {
      path: string;
      name: string;
      previewKind: string;
      inlinePreviewUrl: string | null;
      downloadUrl: string;
    };
    assert.match(uploaded.path, /^uploads\/[^/]+\/diagram\.png$/);
    assert.equal(uploaded.name, "diagram.png");
    assert.equal(uploaded.previewKind, "image");
    assert.equal(
      uploaded.inlinePreviewUrl,
      `/agents/${agent.id}/workspace/file/preview?path=${encodeURIComponent(uploaded.path)}`
    );
    assert.equal(
      uploaded.downloadUrl,
      `/agents/${agent.id}/workspace/file/content?path=${encodeURIComponent(uploaded.path)}`
    );

    const previewResponse = await fetch(`${baseUrl}${uploaded.inlinePreviewUrl}`);
    assert.equal(previewResponse.status, 200);
    assert.equal(previewResponse.headers.get("content-type"), "image/png");
    assert.equal(
      Buffer.from(await previewResponse.arrayBuffer()).toString("utf8"),
      "fake-png-binary"
    );
  } finally {
    await server.close();
  }
});

test("Agent engine server forwards uploaded image paths on the first session message", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-engine-message-images-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-message",
    now: () => "2026-03-13T00:00:00.000Z",
  });
  const runtime = new FakeRuntime();
  const sessionService = new SessionService({
    stateRoot,
    manager,
    runtime,
    idGenerator: (() => {
      const ids = ["session-1", "run-1"];
      return () => ids.shift() ?? "";
    })(),
  });
  const agent = await manager.createAgent({
    name: "Message Agent",
  });

  const uploadedImagePath = path.join(agent.workspaceRoot, "uploads", "fixture", "diagram.png");
  await mkdir(path.dirname(uploadedImagePath), { recursive: true });
  await writeFile(uploadedImagePath, Buffer.from("fake-png-binary"), "utf8");

  const session = await sessionService.createSession({
    agentId: agent.id,
  });
  const server = createAgentEngineServer({
    stateRoot,
    manager,
    sessionService,
  });

  await server.listen({
    port: 0,
    host: "127.0.0.1",
  });

  const address = server.server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "diagram 확인해줘",
        images: ["uploads/fixture/diagram.png"],
      }),
    });

    assert.equal(response.status, 202);
    assert.deepEqual(runtime.lastRequest?.images, ["uploads/fixture/diagram.png"]);
  } finally {
    await server.close();
  }
});
