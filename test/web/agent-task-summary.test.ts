import test from "node:test";
import assert from "node:assert/strict";

import {
  countCompletedRockyTasksForAgent,
  isRockyChatForAgent,
  listRockyChatsForAgent,
} from "../../web/src/domains/agent/lib/agent-task-summary.js";

import type {
  RockyChatRecord,
  RockyDispatchRecord,
  RockyOrchestrationRecord,
  RockyWorkerRecord,
} from "../../web/src/shared/lib/agent-engine-client.js";

function orchestration(
  overrides: Partial<RockyOrchestrationRecord> = {},
): RockyOrchestrationRecord {
  return {
    id: overrides.id ?? "orchestration-1",
    status: overrides.status ?? "completed",
    agentId: overrides.agentId ?? "agent-target",
    sessionId: overrides.sessionId ?? "session-1",
    runId: overrides.runId ?? "run-1",
    output: overrides.output ?? null,
    error: overrides.error ?? null,
    startedAt: overrides.startedAt ?? "2026-05-02T00:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-05-02T00:01:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-02T00:01:00.000Z",
  };
}

function worker(agentId: string | null): RockyWorkerRecord {
  return {
    id: `worker-${agentId ?? "core"}`,
    skillId: agentId ? `agent.${agentId}` : "rocky.core",
    domain: "general",
    displayName: agentId ?? "Rocky Core",
    agentId,
    reason: "test worker",
    status: "ready",
    createdAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
  };
}

function dispatch(
  overrides: Partial<RockyDispatchRecord> = {},
): RockyDispatchRecord {
  return {
    id: overrides.id ?? "dispatch-1",
    chatId: overrides.chatId ?? "chat-1",
    messageId: overrides.messageId ?? "message-1",
    skillId: overrides.skillId ?? "agent.agent-target",
    intent: overrides.intent ?? "conversation",
    domain: overrides.domain ?? "general",
    workerId: overrides.workerId ?? "worker-agent-target",
    attachmentIds: overrides.attachmentIds ?? [],
    originalRequest: overrides.originalRequest ?? "작업해줘",
    skillCandidateIds: overrides.skillCandidateIds ?? [],
    protectionHints: overrides.protectionHints ?? [],
    orchestration:
      "orchestration" in overrides
        ? overrides.orchestration ?? null
        : orchestration(),
    executionStarted: overrides.executionStarted ?? true,
    createdAt: overrides.createdAt ?? "2026-05-02T00:00:00.000Z",
  };
}

function chat(overrides: Partial<RockyChatRecord> = {}): RockyChatRecord {
  return {
    id: overrides.id ?? "chat-1",
    title: overrides.title ?? "작업",
    intent: overrides.intent ?? "conversation",
    domain: overrides.domain ?? "general",
    worker: overrides.worker ?? null,
    attachments: overrides.attachments ?? [],
    messages: overrides.messages ?? [],
    skillCandidates: overrides.skillCandidates ?? [],
    dispatches: overrides.dispatches ?? [],
    orchestration: overrides.orchestration ?? null,
    executionStarted: overrides.executionStarted ?? false,
    createdAt: overrides.createdAt ?? "2026-05-02T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-02T00:01:00.000Z",
  };
}

test("countCompletedRockyTasksForAgent ignores global chats and unfinished agent chats", () => {
  const targetAgentId = "agent-target";
  const chats = [
    chat({
      id: "target-completed",
      worker: worker(targetAgentId),
      orchestration: orchestration({ agentId: targetAgentId, status: "completed" }),
    }),
    chat({
      id: "target-running",
      worker: worker(targetAgentId),
      orchestration: orchestration({ agentId: targetAgentId, status: "running" }),
    }),
    chat({
      id: "other-completed",
      worker: worker("agent-other"),
      orchestration: orchestration({ agentId: "agent-other", status: "completed" }),
    }),
    chat({
      id: "locally-mapped-completed",
      orchestration: orchestration({ agentId: "agent-other", status: "completed" }),
    }),
  ];

  assert.equal(
    countCompletedRockyTasksForAgent(chats, targetAgentId, {
      "locally-mapped-completed": targetAgentId,
    }),
    2,
  );
});

test("agent task summary counts one chat once even when it has multiple completed dispatches", () => {
  const targetAgentId = "agent-target";
  const multiTurnChat = chat({
    id: "multi-turn",
    worker: worker(targetAgentId),
    dispatches: [
      dispatch({
        id: "dispatch-1",
        orchestration: orchestration({
          id: "orchestration-1",
          agentId: targetAgentId,
          runId: "run-1",
          updatedAt: "2026-05-02T00:01:00.000Z",
        }),
      }),
      dispatch({
        id: "dispatch-2",
        orchestration: orchestration({
          id: "orchestration-2",
          agentId: targetAgentId,
          runId: "run-2",
          updatedAt: "2026-05-02T00:02:00.000Z",
        }),
      }),
    ],
    orchestration: orchestration({
      id: "orchestration-2",
      agentId: targetAgentId,
      runId: "run-2",
      updatedAt: "2026-05-02T00:02:00.000Z",
    }),
  });

  assert.equal(listRockyChatsForAgent([multiTurnChat], targetAgentId).length, 1);
  assert.equal(countCompletedRockyTasksForAgent([multiTurnChat], targetAgentId), 1);
});

test("isRockyChatForAgent preserves legacy agent skill dispatch matching", () => {
  const targetAgentId = "agent-target";
  const legacyDispatchChat = chat({
    id: "legacy-dispatch",
    dispatches: [
      dispatch({
        skillId: `agent.${targetAgentId}`,
        orchestration: null,
      }),
    ],
  });

  assert.equal(isRockyChatForAgent(legacyDispatchChat, targetAgentId), true);
});
