import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import { AgentManager } from "../agents/agent-manager.js";
import { resolveSessionServiceStateRoot, truncateSummary } from "../sessions/session-service-helpers.js";
import {
  listAgentTaskPaths,
  listAgentTaskRunPaths,
  findTaskLocation,
  readTaskRecord,
  readTaskRunRecord,
  resolveAgentTaskPaths,
  resolveAgentTaskRunPaths,
  writeTaskRecord,
  writeTaskRunRecord,
} from "./task-store.js";

import type { AgentRegistryManagerLike } from "../agents/agent-types.js";
import type { AgentMessengerServiceLike } from "../messenger/messenger-types.js";
import type { AgentRunRecord } from "../sessions/session-types.js";
import {
  normalizeRuntimeOllamaLaunchTarget,
  type RuntimeRunResult,
} from "../runtime/runtime-types.js";
import type {
  AgentTaskCreateInput,
  AgentTaskRecord,
  AgentTaskRunInput,
  AgentTaskRunRecord,
  AgentTaskRunStatus,
  AgentTaskUpdateInput,
} from "./task-types.js";

function conflictError(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 409,
  });
}

function addMinutes(isoTimestamp: string, minutes: number): string {
  return new Date(
    new Date(isoTimestamp).getTime() + minutes * 60_000
  ).toISOString();
}

function generateWebhookToken(idGenerator: () => string): string {
  return idGenerator().replaceAll("-", "");
}

function trimOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeIntervalMinutes(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.floor(value);
  return normalized >= 1 ? normalized : null;
}

function normalizeTaskOllamaLaunchTarget(
  runtimeKind: AgentTaskRecord["runtimeKind"],
  value: string | null | undefined
) {
  if (runtimeKind !== "ollama") {
    return null;
  }

  return normalizeRuntimeOllamaLaunchTarget(value);
}

function buildTaskPrompt(
  task: AgentTaskRecord,
  input: AgentTaskRunInput
): string {
  if (input.triggerType !== "event" || input.eventPayload === undefined) {
    return task.prompt;
  }

  let payloadText = "";
  try {
    payloadText = JSON.stringify(input.eventPayload, null, 2);
  } catch {
    payloadText = String(input.eventPayload);
  }

  return [
    task.prompt,
    "",
    "[이벤트 트리거 입력]",
    "```json",
    payloadText,
    "```",
    "",
    "위 이벤트 내용을 반영해서 이번 단일 작업을 처리해줘.",
  ].join("\n");
}

function buildTaskOutputInstructions(): string[] {
  return [
    "Use `outputs/` as the only final deliverable directory for this single task.",
    "Create `outputs/` before writing final deliverable files if it does not already exist.",
    "Do not place final deliverables in the workspace root or unrelated folders.",
    "In the final response, list each generated deliverable with its `outputs/...` relative path.",
  ];
}

function hydrateTaskRecord(
  task: AgentTaskRecord
): AgentTaskRecord {
  return {
    ...task,
    description: task.description ?? "",
    prompt: task.prompt ?? "",
    runtimeKind: task.runtimeKind ?? "codex-cli",
    ollamaLaunchTarget: normalizeTaskOllamaLaunchTarget(
      task.runtimeKind ?? "codex-cli",
      task.ollamaLaunchTarget
    ),
    model: task.model ?? null,
    reasoningEffort: task.reasoningEffort ?? null,
    serviceTier: task.serviceTier ?? null,
    enabled: task.enabled !== false,
    lifecycle: task.lifecycle === "archived" ? "archived" : "active",
    archivedAt: task.lifecycle === "archived" ? task.archivedAt ?? task.updatedAt : null,
    sourceSessionId: task.sourceSessionId ?? null,
    schedule: {
      enabled: task.schedule?.enabled === true,
      intervalMinutes: normalizeIntervalMinutes(task.schedule?.intervalMinutes),
      nextRunAt: task.schedule?.nextRunAt ?? null,
      lastTriggeredAt: task.schedule?.lastTriggeredAt ?? null,
    },
    eventTrigger: {
      enabled: task.eventTrigger?.enabled === true,
      webhookToken: task.eventTrigger?.webhookToken ?? "",
      lastTriggeredAt: task.eventTrigger?.lastTriggeredAt ?? null,
    },
    messengerDelivery: {
      enabled: task.messengerDelivery?.enabled === true,
      chatId: trimOptionalString(task.messengerDelivery?.chatId),
      threadId: trimOptionalString(task.messengerDelivery?.threadId),
      lastDeliveredAt: task.messengerDelivery?.lastDeliveredAt ?? null,
      lastError: task.messengerDelivery?.lastError ?? null,
    },
    lastRunId: task.lastRunId ?? null,
    lastSessionId: task.lastSessionId ?? null,
    lastRunStatus: task.lastRunStatus ?? null,
    lastRunSummary: task.lastRunSummary ?? null,
    lastRunAt: task.lastRunAt ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function hydrateTaskRunRecord(taskRun: AgentTaskRunRecord): AgentTaskRunRecord {
  return {
    ...taskRun,
    triggerSource: taskRun.triggerSource ?? null,
    endedAt: taskRun.endedAt ?? null,
    summary: taskRun.summary ?? null,
    ollamaLaunchTarget: normalizeTaskOllamaLaunchTarget(
      taskRun.runtimeKind,
      taskRun.ollamaLaunchTarget
    ),
    model: taskRun.model ?? null,
    reasoningEffort: taskRun.reasoningEffort ?? null,
    serviceTier: taskRun.serviceTier ?? null,
    messengerDeliveredAt: taskRun.messengerDeliveredAt ?? null,
    messengerDeliveryError: taskRun.messengerDeliveryError ?? null,
  };
}

export interface TaskServiceOptions {
  stateRoot?: string;
  manager?: AgentRegistryManagerLike & {
    getAgent(agentId: string): Promise<{ id: string; defaultRuntime: AgentTaskRecord["runtimeKind"] }>;
  };
  sessionService: {
    createSession(input: {
      agentId: string;
      title?: string | null;
      runtimeKind?: AgentTaskRecord["runtimeKind"];
      ollamaLaunchTarget?: AgentTaskRecord["ollamaLaunchTarget"];
      model?: string | null;
      reasoningEffort?: AgentTaskRecord["reasoningEffort"];
      serviceTier?: AgentTaskRecord["serviceTier"];
      kind?: "single-task";
    }): Promise<{ id: string }>;
    sendTurn(input: {
      sessionId: string;
      prompt: string;
      extraSystemInstructions?: string[];
      triggerType?: AgentRunRecord["triggerType"];
    }): Promise<AgentRunRecord>;
    getRunResult(runId: string): Promise<RuntimeRunResult>;
  };
  messengerService?: AgentMessengerServiceLike;
  now?: () => string;
  idGenerator?: () => string;
  schedulePollIntervalMs?: number;
}

export class TaskService {
  private readonly stateRoot: string;
  private readonly manager: TaskServiceOptions["manager"];
  private readonly sessionService: TaskServiceOptions["sessionService"];
  private readonly messengerService: TaskServiceOptions["messengerService"];
  private readonly now: () => string;
  private readonly idGenerator: () => string;
  private readonly activeTaskRuns = new Map<string, string>();
  private readonly schedulePollIntervalMs: number;
  private scheduleTimer: NodeJS.Timeout | null = null;

  constructor(options: TaskServiceOptions) {
    this.stateRoot = resolveSessionServiceStateRoot(options.stateRoot);
    this.manager =
      options.manager ??
      new AgentManager({
        stateRoot: this.stateRoot,
      });
    this.sessionService = options.sessionService;
    this.messengerService = options.messengerService;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.schedulePollIntervalMs = options.schedulePollIntervalMs ?? 30_000;
  }

  async start(): Promise<void> {
    if (this.scheduleTimer) {
      return;
    }

    this.scheduleTimer = setInterval(() => {
      void this.runDueSchedules();
    }, this.schedulePollIntervalMs);
  }

  async close(): Promise<void> {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  async createTask(agentId: string, input: AgentTaskCreateInput): Promise<AgentTaskRecord> {
    const agent = await this.manager!.getAgent(agentId);
    const now = this.now();
    const taskId = input.id?.trim() || this.idGenerator();
    if (await findTaskLocation(this.stateRoot, taskId)) {
      throw conflictError(`Task already exists: ${taskId}`);
    }
    const scheduleIntervalMinutes = normalizeIntervalMinutes(
      input.schedule?.intervalMinutes ?? null
    );
    const task: AgentTaskRecord = hydrateTaskRecord({
      id: taskId,
      agentId,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      prompt: input.prompt.trim(),
      runtimeKind: input.runtimeKind ?? agent.defaultRuntime,
      ollamaLaunchTarget: normalizeTaskOllamaLaunchTarget(
        input.runtimeKind ?? agent.defaultRuntime,
        input.ollamaLaunchTarget ?? null
      ),
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      serviceTier: input.serviceTier ?? null,
      enabled: input.enabled !== false,
      lifecycle: "active",
      archivedAt: null,
      sourceSessionId: input.sourceSessionId ?? null,
      schedule: {
        enabled: input.schedule?.enabled === true && scheduleIntervalMinutes !== null,
        intervalMinutes: scheduleIntervalMinutes,
        nextRunAt:
          input.schedule?.enabled === true && scheduleIntervalMinutes !== null
            ? addMinutes(now, scheduleIntervalMinutes)
            : null,
        lastTriggeredAt: null,
      },
      eventTrigger: {
        enabled: input.eventTrigger?.enabled === true,
        webhookToken: generateWebhookToken(this.idGenerator),
        lastTriggeredAt: null,
      },
      messengerDelivery: {
        enabled: input.messengerDelivery?.enabled === true,
        chatId: trimOptionalString(input.messengerDelivery?.chatId),
        threadId: trimOptionalString(input.messengerDelivery?.threadId),
        lastDeliveredAt: null,
        lastError: null,
      },
      lastRunId: null,
      lastSessionId: null,
      lastRunStatus: null,
      lastRunSummary: null,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now,
    } as AgentTaskRecord);

    await writeTaskRecord(
      resolveAgentTaskPaths({
        stateRoot: this.stateRoot,
        agentId,
        taskId: task.id,
      }),
      task
    );

    return task;
  }

  async listAgentTasks(
    agentId: string,
    options: {
      includeArchived?: boolean;
    } = {}
  ): Promise<AgentTaskRecord[]> {
    const taskPaths = await listAgentTaskPaths(this.stateRoot, agentId);
    const tasks = await Promise.all(
      taskPaths.map(async (entry) => hydrateTaskRecord(await readTaskRecord(entry.taskPath)))
    );
    const visibleTasks = options.includeArchived
      ? tasks
      : tasks.filter((task) => task.lifecycle !== "archived");

    return visibleTasks.sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id)
    );
  }

  async getTask(taskId: string): Promise<AgentTaskRecord> {
    const location = await findTaskLocation(this.stateRoot, taskId);
    if (!location) {
      throw new Error(`Unknown task: ${taskId}`);
    }

    return hydrateTaskRecord(await readTaskRecord(location.paths.taskPath));
  }

  async updateTask(input: AgentTaskUpdateInput): Promise<AgentTaskRecord> {
    const location = await findTaskLocation(this.stateRoot, input.taskId);
    if (!location) {
      throw new Error(`Unknown task: ${input.taskId}`);
    }

    const task = hydrateTaskRecord(await readTaskRecord(location.paths.taskPath));
    const now = this.now();

    if (typeof input.name === "string") {
      task.name = input.name.trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, "description")) {
      task.description = input.description?.trim() ?? "";
    }
    if (typeof input.prompt === "string") {
      task.prompt = input.prompt.trim();
    }
    if (input.runtimeKind) {
      task.runtimeKind = input.runtimeKind;
    }
    if (Object.prototype.hasOwnProperty.call(input, "ollamaLaunchTarget")) {
      task.ollamaLaunchTarget = normalizeTaskOllamaLaunchTarget(
        input.runtimeKind ?? task.runtimeKind,
        input.ollamaLaunchTarget ?? null
      );
    } else if (input.runtimeKind && input.runtimeKind !== "ollama") {
      task.ollamaLaunchTarget = null;
    }
    if (Object.prototype.hasOwnProperty.call(input, "model")) {
      task.model = input.model ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(input, "reasoningEffort")) {
      task.reasoningEffort = input.reasoningEffort ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(input, "serviceTier")) {
      task.serviceTier = input.serviceTier ?? null;
    }
    if (typeof input.enabled === "boolean") {
      task.enabled = input.enabled;
    }
    if (input.lifecycle) {
      task.lifecycle = input.lifecycle;
      task.archivedAt = input.lifecycle === "archived" ? now : null;
    }
    if (input.schedule) {
      const intervalMinutes = normalizeIntervalMinutes(input.schedule.intervalMinutes);
      task.schedule.enabled = input.schedule.enabled === true && intervalMinutes !== null;
      task.schedule.intervalMinutes = intervalMinutes;
      task.schedule.nextRunAt =
        task.schedule.enabled && intervalMinutes !== null
          ? addMinutes(now, intervalMinutes)
          : null;
    }
    if (input.eventTrigger) {
      task.eventTrigger.enabled = input.eventTrigger.enabled === true;
      if (input.eventTrigger.regenerateWebhookToken) {
        task.eventTrigger.webhookToken = generateWebhookToken(this.idGenerator);
      }
    }
    if (input.messengerDelivery) {
      task.messengerDelivery.enabled = input.messengerDelivery.enabled === true;
      if (Object.prototype.hasOwnProperty.call(input.messengerDelivery, "chatId")) {
        task.messengerDelivery.chatId = trimOptionalString(input.messengerDelivery.chatId);
      }
      if (Object.prototype.hasOwnProperty.call(input.messengerDelivery, "threadId")) {
        task.messengerDelivery.threadId = trimOptionalString(input.messengerDelivery.threadId);
      }
      if (!task.messengerDelivery.enabled) {
        task.messengerDelivery.lastError = null;
      }
    }

    task.updatedAt = now;
    await writeTaskRecord(location.paths, task);
    return task;
  }

  async deleteTask(taskId: string): Promise<void> {
    const location = await findTaskLocation(this.stateRoot, taskId);
    if (!location) {
      throw new Error(`Unknown task: ${taskId}`);
    }

    if (this.activeTaskRuns.has(taskId)) {
      throw conflictError(`Cannot delete task while it is running: ${taskId}`);
    }

    await rm(location.paths.taskPath, {
      force: false,
    });

    const runPaths = await listAgentTaskRunPaths(this.stateRoot, location.agentId);
    await Promise.all(
      runPaths.map(async (entry) => {
        const taskRun = await readTaskRunRecord(entry.taskRunPath);
        if (taskRun.taskId !== taskId) {
          return;
        }

        await rm(entry.taskRunPath, {
          force: false,
        });
      })
    );
  }

  async listTaskRuns(taskId: string): Promise<AgentTaskRunRecord[]> {
    const task = await this.getTask(taskId);
    const runPaths = await listAgentTaskRunPaths(this.stateRoot, task.agentId);
    const runs = await Promise.all(
      runPaths.map(async (entry) => hydrateTaskRunRecord(await readTaskRunRecord(entry.taskRunPath)))
    );

    return runs
      .filter((run) => run.taskId === taskId)
      .sort(
        (left, right) =>
          right.startedAt.localeCompare(left.startedAt) ||
          left.id.localeCompare(right.id)
      );
  }

  async runTask(input: AgentTaskRunInput): Promise<AgentTaskRunRecord> {
    const location = await findTaskLocation(this.stateRoot, input.taskId);
    if (!location) {
      throw new Error(`Unknown task: ${input.taskId}`);
    }

    const task = hydrateTaskRecord(await readTaskRecord(location.paths.taskPath));
    if (task.lifecycle === "archived") {
      throw conflictError(`Archived tasks are read-only: ${task.id}`);
    }
    if (this.activeTaskRuns.has(task.id)) {
      throw conflictError(`Task already has a running execution: ${task.id}`);
    }

    const session = await this.sessionService.createSession({
      agentId: task.agentId,
      title: task.name,
      runtimeKind: task.runtimeKind,
      ollamaLaunchTarget: task.ollamaLaunchTarget,
      model: task.model,
      reasoningEffort: task.reasoningEffort,
      serviceTier: task.serviceTier,
      kind: "single-task",
    });
    const run = await this.sessionService.sendTurn({
      sessionId: session.id,
      prompt: buildTaskPrompt(task, input),
      extraSystemInstructions: buildTaskOutputInstructions(),
      triggerType: input.triggerType ?? "manual_task",
    });
    const now = this.now();
    if (input.triggerType === "scheduled") {
      task.schedule.lastTriggeredAt = now;
      task.schedule.nextRunAt =
        task.schedule.enabled && task.schedule.intervalMinutes !== null
          ? addMinutes(now, task.schedule.intervalMinutes)
          : null;
    }
    if (input.triggerType === "event") {
      task.eventTrigger.lastTriggeredAt = now;
    }

    const taskRun: AgentTaskRunRecord = hydrateTaskRunRecord({
      id: this.idGenerator(),
      taskId: task.id,
      agentId: task.agentId,
      sessionId: session.id,
      runId: run.id,
      triggerType: input.triggerType ?? "manual_task",
      triggerSource: input.triggerSource ?? null,
      status: "running",
      runtimeKind: task.runtimeKind,
      ollamaLaunchTarget: task.ollamaLaunchTarget,
      model: task.model,
      reasoningEffort: task.reasoningEffort,
      serviceTier: task.serviceTier,
      prompt: task.prompt,
      startedAt: run.startedAt,
      endedAt: null,
      summary: null,
      messengerDeliveredAt: null,
      messengerDeliveryError: null,
      createdAt: now,
      updatedAt: now,
    } as AgentTaskRunRecord);

    await writeTaskRunRecord(
      resolveAgentTaskRunPaths({
        stateRoot: this.stateRoot,
        agentId: task.agentId,
        taskRunId: taskRun.id,
      }),
      taskRun
    );

    task.lastRunId = taskRun.runId;
    task.lastSessionId = taskRun.sessionId;
    task.lastRunStatus = "running";
    task.lastRunSummary = null;
    task.lastRunAt = run.startedAt;
    task.updatedAt = now;
    await writeTaskRecord(location.paths, task);

    this.activeTaskRuns.set(task.id, taskRun.id);
    void this.finalizeTaskRun(task, taskRun);

    return taskRun;
  }

  async runTaskByWebhookToken(
    webhookToken: string,
    payload: unknown
  ): Promise<AgentTaskRunRecord> {
    const task = await this.findTaskByWebhookToken(webhookToken);
    if (!task) {
      throw new Error(`Unknown task webhook token: ${webhookToken}`);
    }
    if (!task.enabled || !task.eventTrigger.enabled) {
      throw conflictError(`Webhook trigger is disabled for task: ${task.id}`);
    }

    return this.runTask({
      taskId: task.id,
      triggerType: "event",
      triggerSource: "webhook",
      eventPayload: payload,
    });
  }

  async runDueSchedules(): Promise<AgentTaskRunRecord[]> {
    const tasks = await this.listAllTasks();
    const now = this.now();
    const startedRuns: AgentTaskRunRecord[] = [];

    for (const task of tasks) {
      if (
        task.lifecycle === "archived" ||
        !task.enabled ||
        !task.schedule.enabled ||
        !task.schedule.nextRunAt ||
        task.schedule.nextRunAt > now
      ) {
        continue;
      }

      if (this.activeTaskRuns.has(task.id)) {
        if (task.schedule.intervalMinutes !== null) {
          task.schedule.nextRunAt = addMinutes(now, task.schedule.intervalMinutes);
          task.updatedAt = now;
          await writeTaskRecord(
            resolveAgentTaskPaths({
              stateRoot: this.stateRoot,
              agentId: task.agentId,
              taskId: task.id,
            }),
            task
          );
        }
        continue;
      }

      startedRuns.push(
        await this.runTask({
          taskId: task.id,
          triggerType: "scheduled",
          triggerSource: "scheduler",
        })
      );
    }

    return startedRuns;
  }

  private async finalizeTaskRun(
    task: AgentTaskRecord,
    taskRun: AgentTaskRunRecord
  ): Promise<void> {
    try {
      const result = await this.sessionService.getRunResult(taskRun.runId);
      await this.persistTaskRunCompletion(task, taskRun, result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Task run completion failed.";
      await this.persistTaskRunCompletion(task, taskRun, {
        runId: taskRun.runId,
        sessionId: taskRun.sessionId,
        runtimeSessionId: null,
        sessionBinding: null,
        status: "failed",
        startedAt: taskRun.startedAt,
        endedAt: this.now(),
        exitCode: null,
        signal: null,
        command: "",
        args: [],
        messages: [],
        warnings: [],
        errors: [message],
        stderr: [message],
        artifactRefs: [],
        lastMessage: null,
        outputLastMessagePath: null,
        rawEvents: [],
      });
    } finally {
      this.activeTaskRuns.delete(task.id);
    }
  }

  private async persistTaskRunCompletion(
    task: AgentTaskRecord,
    taskRun: AgentTaskRunRecord,
    result: RuntimeRunResult
  ): Promise<void> {
    const location = await findTaskLocation(this.stateRoot, task.id);
    if (!location) {
      return;
    }

    const nextTask = hydrateTaskRecord(await readTaskRecord(location.paths.taskPath));
    const nextTaskRun = hydrateTaskRunRecord(taskRun);
    const nextStatus = result.status as AgentTaskRunStatus;
    const nextSummary = truncateSummary(
      result.lastMessage ??
        result.messages.at(-1)?.text ??
        result.errors.at(-1) ??
        null
    );

    nextTaskRun.status = nextStatus;
    nextTaskRun.endedAt = result.endedAt ?? this.now();
    nextTaskRun.summary = nextSummary;
    nextTaskRun.updatedAt = this.now();

    nextTask.lastRunId = nextTaskRun.runId;
    nextTask.lastSessionId = nextTaskRun.sessionId;
    nextTask.lastRunStatus = nextStatus;
    nextTask.lastRunSummary = nextSummary;
    nextTask.lastRunAt = nextTaskRun.endedAt ?? nextTaskRun.startedAt;
    nextTask.updatedAt = this.now();

    if (
      task.messengerDelivery.enabled &&
      task.messengerDelivery.chatId &&
      this.messengerService?.deliverTaskResult
    ) {
      try {
        await this.messengerService.deliverTaskResult({
          agentId: nextTask.agentId,
          taskName: nextTask.name,
          sessionId: nextTaskRun.sessionId,
          runId: nextTaskRun.runId,
          status:
            nextStatus === "completed" || nextStatus === "cancelled"
              ? nextStatus
              : "failed",
          chatId: task.messengerDelivery.chatId,
          threadId: task.messengerDelivery.threadId,
          lastMessage:
            result.lastMessage ??
            result.messages.at(-1)?.text ??
            null,
          errors: result.errors,
          stderr: result.stderr,
        });
        const deliveredAt = this.now();
        nextTask.messengerDelivery.lastDeliveredAt = deliveredAt;
        nextTask.messengerDelivery.lastError = null;
        nextTaskRun.messengerDeliveredAt = deliveredAt;
        nextTaskRun.messengerDeliveryError = null;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to deliver the task result to messenger.";
        nextTask.messengerDelivery.lastError = message;
        nextTaskRun.messengerDeliveredAt = null;
        nextTaskRun.messengerDeliveryError = message;
      }
    }

    await Promise.all([
      writeTaskRunRecord(
        resolveAgentTaskRunPaths({
          stateRoot: this.stateRoot,
          agentId: nextTask.agentId,
          taskRunId: nextTaskRun.id,
        }),
        nextTaskRun
      ),
      writeTaskRecord(location.paths, nextTask),
    ]);
  }

  private async listAllTasks(): Promise<AgentTaskRecord[]> {
    const agents = await this.manager!.listAgents();
    const taskLists = await Promise.all(
      agents.map((agent) =>
        this.listAgentTasks(agent.id, {
          includeArchived: true,
        })
      )
    );

    return taskLists.flat();
  }

  private async findTaskByWebhookToken(
    webhookToken: string
  ): Promise<AgentTaskRecord | null> {
    const tasks = await this.listAllTasks();
    return (
      tasks.find(
        (task) =>
          task.eventTrigger.webhookToken === webhookToken &&
          task.eventTrigger.enabled
      ) ?? null
    );
  }
}
