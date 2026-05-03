import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";
import type { AgentMessengerServiceLike } from "../../src/messenger/messenger-types.js";
import { AsyncEventQueue } from "../../src/runtime/async-event-queue.js";
import { RuntimeAdapter } from "../../src/runtime/runtime-adapter.js";

import type {
  RuntimeEvent,
  RuntimeRequest,
  RuntimeRunResult,
  RuntimeRunStart,
  RuntimeSession,
  RuntimeSessionInput,
} from "../../src/runtime/runtime-types.js";

async function waitForTaskCompletion(server: ReturnType<typeof createAgentEngineServer>) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await server.inject({
      method: "GET",
      url: "/agents/task-agent/tasks",
    });
    const tasks = response.json() as Array<{
      id: string;
      lastRunId: string | null;
      lastRunStatus: string | null;
      ollamaLaunchTarget: string | null;
      schedule: { enabled: boolean };
      eventTrigger: { enabled: boolean };
      messengerDelivery: {
        enabled: boolean;
        chatId: string | null;
      };
    }>;
    if (tasks[0]?.lastRunStatus === "completed") {
      return tasks;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Task completion did not settle in time.");
}

class FakeRuntime extends RuntimeAdapter {
  readonly requests: RuntimeRequest[] = [];

  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly runs = new Map<
    string,
    {
      queue: AsyncEventQueue<RuntimeEvent>;
      result: Promise<RuntimeRunResult>;
    }
  >();

  async createSession(input: RuntimeSessionInput): Promise<RuntimeSession> {
    const now = new Date().toISOString();
    const session: RuntimeSession = {
      id: input.id ?? randomUUID(),
      agentId: input.agentId ?? null,
      runtimeKind: input.runtimeKind ?? "codex-cli",
      runtimeSessionId: input.runtimeSessionId ?? null,
      workspaceRoot: input.workspaceRoot,
      runtimeHome: input.runtimeHome ?? path.join(input.workspaceRoot, ".runtime", "fake"),
      config: {
        codexBin: input.codexBin ?? "fake-runtime",
        sandbox: input.sandbox ?? "workspace-write",
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
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async sendTurn(input: RuntimeRequest): Promise<RuntimeRunStart> {
    return this.startRun(input);
  }

  async resumeSession(input: RuntimeRequest): Promise<RuntimeRunStart> {
    return this.startRun(input);
  }

  async *streamEvents(runId: string): AsyncGenerator<RuntimeEvent> {
    const run = this.runs.get(runId);
    assert.ok(run);
    yield* run.queue;
  }

  async cancelRun(): Promise<void> {}

  async getRunResult(runId: string): Promise<RuntimeRunResult> {
    const run = this.runs.get(runId);
    assert.ok(run);
    return run.result;
  }

  private async startRun(input: RuntimeRequest): Promise<RuntimeRunStart> {
    this.requests.push(input);
    const session = this.sessions.get(input.sessionId);
    assert.ok(session);
    const runId = input.runId ?? randomUUID();
    const queue = new AsyncEventQueue<RuntimeEvent>();
    const startedAt = new Date().toISOString();
    const prompt =
      input.messages?.at(-1)?.content ??
      input.prompt;
    const assistantText = `done:${prompt.slice(0, 24)}`;

    if (input.outputLastMessagePath) {
      await mkdir(path.dirname(input.outputLastMessagePath), { recursive: true });
      await writeFile(input.outputLastMessagePath, assistantText, "utf8");
    }

    const result = (async () => {
      queueMicrotask(() => {
        queue.push({
          source: "fake-runtime",
          type: "assistant.message.completed",
          runId,
          sessionId: input.sessionId,
          runtimeSessionId: null,
          rawType: "message.completed",
          occurredAt: new Date().toISOString(),
          data: {
            text: assistantText,
            itemType: "message",
          },
          raw: {
            text: assistantText,
          },
        });
        queue.push({
          source: "fake-runtime",
          type: "run.completed",
          runId,
          sessionId: input.sessionId,
          runtimeSessionId: null,
          rawType: "process.close",
          occurredAt: new Date().toISOString(),
          data: {
            status: "completed",
            exitCode: 0,
            signal: null,
          },
          raw: {},
        });
        queue.close();
      });

      return {
        runId,
        sessionId: input.sessionId,
        runtimeSessionId: null,
        sessionBinding: null,
        status: "completed",
        startedAt,
        endedAt: new Date().toISOString(),
        exitCode: 0,
        signal: null,
        command: "fake-runtime",
        args: ["run"],
        messages: [
          {
            role: "assistant",
            text: assistantText,
            itemType: "message",
            occurredAt: new Date().toISOString(),
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

    this.runs.set(runId, {
      queue,
      result,
    });

    return {
      runId,
      sessionId: input.sessionId,
      command: "fake-runtime",
      args: ["run"],
      startedAt,
      status: "running",
    };
  }
}

test("task routes support manual and webhook-triggered one-shot runs without polluting task-request sessions", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "task-routes-"));
  const fakeRuntime = new FakeRuntime();
  const deliveredTaskRuns: Array<{ taskName: string; chatId: string; status: string }> = [];
  const fakeMessengerService: AgentMessengerServiceLike = {
    async listAgentMessengerSlots() {
      return [];
    },
    async upsertTelegramConnection() {
      throw new Error("Not needed for this test.");
    },
    async deleteAgentMessengerConnection() {},
    async deliverTaskResult(input) {
      deliveredTaskRuns.push({
        taskName: input.taskName,
        chatId: input.chatId,
        status: input.status,
      });
    },
  };
  const runtimeRegistry = {
    get(kind: "codex-cli" | "claude-code" | "ollama") {
      return {
        kind,
        adapter: fakeRuntime,
        resolveBin: async () => "fake-runtime",
      };
    },
    async list() {
      return [];
    },
  };
  const server = createAgentEngineServer({
    stateRoot,
    runtimeRegistry,
    agentMessengerService: fakeMessengerService,
  });

  try {
    const createAgentResponse = await server.inject({
      method: "POST",
      url: "/agents",
      payload: {
        id: "task-agent",
        name: "Task Agent",
      },
    });
    assert.equal(createAgentResponse.statusCode, 201);

    const createTaskResponse = await server.inject({
      method: "POST",
      url: "/agents/task-agent/tasks",
      payload: {
        name: "Webhookable Task",
        prompt: "Check the installed skill harness state.",
        runtimeKind: "ollama",
        ollamaLaunchTarget: "claude",
        model: "codex:latest",
        schedule: {
          enabled: true,
          intervalMinutes: 15,
        },
        eventTrigger: {
          enabled: true,
        },
        messengerDelivery: {
          enabled: true,
          chatId: "telegram-chat-1",
        },
      },
    });
    assert.equal(createTaskResponse.statusCode, 201);
    const task = createTaskResponse.json() as {
      id: string;
      eventTrigger: { webhookToken: string };
    };
    assert.equal(typeof task.eventTrigger.webhookToken, "string");

    const manualRunResponse = await server.inject({
      method: "POST",
      url: `/tasks/${task.id}/run`,
    });
    assert.equal(manualRunResponse.statusCode, 202);
    const manualRun = manualRunResponse.json() as {
      taskId: string;
      runId: string;
      triggerType: string;
    };
    assert.equal(manualRun.taskId, task.id);
    assert.equal(manualRun.triggerType, "manual_task");
    assert.match(fakeRuntime.requests[0]?.prompt ?? "", /Use `outputs\/` as the only final deliverable directory/u);
    assert.match(fakeRuntime.requests[0]?.prompt ?? "", /`outputs\/\.\.\.`/u);

    const tasks = await waitForTaskCompletion(server);
    assert.equal(tasks[0]?.id, task.id);
    assert.equal(tasks[0]?.lastRunId, manualRun.runId);
    assert.equal(tasks[0]?.lastRunStatus, "completed");
    assert.equal(tasks[0]?.ollamaLaunchTarget, "claude");
    assert.equal(tasks[0]?.schedule.enabled, true);
    assert.equal(tasks[0]?.eventTrigger.enabled, true);
    assert.equal(tasks[0]?.messengerDelivery.enabled, true);
    assert.equal(tasks[0]?.messengerDelivery.chatId, "telegram-chat-1");
    assert.equal(deliveredTaskRuns.length, 1);
    assert.deepEqual(deliveredTaskRuns[0], {
      taskName: "Webhookable Task",
      chatId: "telegram-chat-1",
      status: "completed",
    });

    const visibleSessionsResponse = await server.inject({
      method: "GET",
      url: "/agents/task-agent/sessions",
    });
    assert.equal(visibleSessionsResponse.statusCode, 200);
    assert.deepEqual(visibleSessionsResponse.json(), []);

    const taskRunHistoryResponse = await server.inject({
      method: "GET",
      url: `/tasks/${task.id}/runs`,
    });
    assert.equal(taskRunHistoryResponse.statusCode, 200);
    const taskRuns = taskRunHistoryResponse.json() as Array<{
      triggerType: string;
      status: string;
      ollamaLaunchTarget: string | null;
      messengerDeliveredAt: string | null;
    }>;
    assert.equal(taskRuns[0]?.triggerType, "manual_task");
    assert.equal(taskRuns[0]?.status, "completed");
    assert.equal(taskRuns[0]?.ollamaLaunchTarget, "claude");
    assert.ok(taskRuns[0]?.messengerDeliveredAt);

    const webhookRunResponse = await server.inject({
      method: "POST",
      url: `/tasks/events/${task.eventTrigger.webhookToken}`,
      payload: {
        ref: "refs/heads/develop",
      },
    });
    assert.equal(webhookRunResponse.statusCode, 202);
    assert.equal(webhookRunResponse.json().triggerType, "event");
  } finally {
    await server.close();
  }
});
