import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";
import { ROCKY_AGENT_REQUEST_CONTEXT_DIR } from "../../src/rocky-chat/rocky-agent-skill-workspace.js";

import type { AgentRecord } from "../../src/agents/agent-types.js";
import type { RockyChatRecord } from "../../src/rocky-chat/rocky-chat-types.js";
import type {
  AgentRunRecord,
  AgentSessionMessage,
  AgentSessionRecord,
} from "../../src/sessions/session-types.js";

function buildAgent(input: Partial<AgentRecord> = {}): AgentRecord {
  const now = "2026-04-21T00:00:00.000Z";
  return {
    id: input.id ?? "rocky-nutrition-md",
    name: input.name ?? "영양제 MD 담당",
    description: input.description ?? "",
    color: input.color ?? null,
    workspaceRoot: input.workspaceRoot ?? "/tmp/rocky-workspace",
    runtimeHome: input.runtimeHome ?? "/tmp/rocky-runtime",
    defaultRuntime: input.defaultRuntime ?? "codex-cli",
    sandboxPolicy: input.sandboxPolicy ?? "workspace-write",
    approvalPolicy: input.approvalPolicy ?? "on-request",
    modelProfile: input.modelProfile ?? null,
    runtimePolicy: input.runtimePolicy ?? {
      workspaceMode: "managed",
      gitBackedWorkspace: false,
      isolatedHome: true,
      isolatedXdg: true,
    },
    toolPolicy: input.toolPolicy ?? {
      python: {
        enabled: false,
        mode: "disabled",
        venvPath: "",
        interpreterCandidates: [],
        systemFallback: "python3",
      },
      ssh: {
        enabled: false,
        mode: "disabled",
        command: "ssh",
      },
    },
    status: input.status ?? "active",
    lifecycle: input.lifecycle ?? "active",
    archivedAt: input.archivedAt ?? null,
    pythonEnvironment: input.pythonEnvironment ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

function buildSession(input: {
  id: string;
  agentId: string;
  title?: string | null;
}): AgentSessionRecord {
  const now = "2026-04-21T00:00:00.000Z";
  return {
    id: input.id,
    agentId: input.agentId,
    kind: "single-task",
    runtimeKind: "codex-cli",
    runtimeSessionId: null,
    authProfileId: null,
    title: input.title ?? null,
    status: "running",
    lifecycle: "active",
    archivedAt: null,
    workspaceRoot: `/tmp/rocky-workspace/${input.agentId}`,
    runtimeHome: `/tmp/rocky-runtime/${input.agentId}`,
    runtimeConfig: {
      codexBin: "codex",
      sandbox: "workspace-write",
      approval: "on-request",
      profile: null,
      authProfileId: null,
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      ollamaLaunchTarget: null,
      fullAuto: false,
      dangerouslyBypassApprovalsAndSandbox: false,
      additionalWritableDirs: [],
      configOverrides: [],
      enableFeatures: [],
      disableFeatures: [],
      skipGitRepoCheck: true,
      ephemeral: false,
    },
    createdAt: now,
    lastActivityAt: now,
  };
}

function buildRun(input: {
  id: string;
  agentId: string;
  sessionId: string;
  prompt: string;
}): AgentRunRecord {
  const now = "2026-04-21T00:00:00.000Z";
  return {
    id: input.id,
    agentId: input.agentId,
    sessionId: input.sessionId,
    runtimeRunId: `runtime-${input.id}`,
    triggerType: "manual_task",
    status: "running",
    runtimeKind: "codex-cli",
    ollamaLaunchTarget: null,
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    prompt: input.prompt,
    startedAt: now,
    endedAt: null,
    summary: null,
    runtimeSessionId: null,
    outputLastMessagePath: null,
    resultPath: `/tmp/rocky-runs/${input.id}/result.json`,
    eventsPath: `/tmp/rocky-runs/${input.id}/events.jsonl`,
    artifactsDir: `/tmp/rocky-runs/${input.id}/artifacts`,
  };
}

function createRockyChatTestServer(stateRoot: string) {
  const agents: AgentRecord[] = [];
  const sessions: AgentSessionRecord[] = [];
  const runs: AgentRunRecord[] = [];
  const deletedSessionIds: string[] = [];
  const sendTurnCalls: Array<{
    sessionId: string;
    prompt: string;
    extraSystemInstructions: string[];
  }> = [];
  const stoppedSessionIds: string[] = [];

  const server = createAgentEngineServer({
    stateRoot,
    agentService: {
      async createAgent(input) {
        const agentId = input?.id ?? "rocky-nutrition-md";
        const agent = buildAgent({
          ...(input ?? {}),
          workspaceRoot:
            input?.workspaceRoot ??
            path.join(stateRoot, "agent-workspaces", agentId, "workspace"),
          runtimeHome:
            input?.runtimeHome ??
            path.join(stateRoot, "agent-workspaces", agentId, "runtime-home"),
        });
        agents.push(agent);
        return agent;
      },
      async listAgents() {
        return agents;
      },
      async getAgent(agentId) {
        const agent = agents.find((entry) => entry.id === agentId);
        if (!agent) {
          throw new Error(`Unknown agent: ${agentId}`);
        }
        return agent;
      },
      async updateAgent(agentId, patch) {
        const agent = agents.find((entry) => entry.id === agentId);
        if (!agent) {
          throw new Error(`Unknown agent: ${agentId}`);
        }
        Object.assign(agent, patch);
        return agent;
      },
      async deleteAgent(agentId) {
        const index = agents.findIndex((entry) => entry.id === agentId);
        if (index >= 0) {
          agents.splice(index, 1);
        }
      },
    },
    sessionService: {
      async createSession(input) {
        const session = buildSession({
          id: `session-${sessions.length + 1}`,
          agentId: input.agentId,
          title: input.title,
        });
        sessions.push(session);
        return session;
      },
      async listAgentSessions() {
        return [];
      },
      async updateSession() {
        throw new Error("not used");
      },
      async getSession() {
        throw new Error("not used");
      },
      async getTranscript() {
        const completedRun = [...runs].reverse().find((run) => run.status === "completed");
        if (!completedRun) {
          return [];
        }
        return [
          {
            id: `assistant-${completedRun.id}`,
            sessionId: completedRun.sessionId,
            runId: completedRun.id,
            role: "assistant",
            content: completedRun.summary ?? "완료",
            source: "runtime",
            createdAt: completedRun.endedAt ?? completedRun.startedAt,
          } satisfies AgentSessionMessage,
        ];
      },
      async deleteSession(sessionId) {
        deletedSessionIds.push(sessionId);
        const sessionIndex = sessions.findIndex((entry) => entry.id === sessionId);
        if (sessionIndex >= 0) {
          sessions.splice(sessionIndex, 1);
        }
        for (let index = runs.length - 1; index >= 0; index -= 1) {
          if (runs[index]?.sessionId === sessionId) {
            runs.splice(index, 1);
          }
        }
      },
      async stopSessionRuns(sessionId) {
        stoppedSessionIds.push(sessionId);
        runs.forEach((run, index) => {
          if (run.sessionId === sessionId && run.status === "running") {
            runs[index] = {
              ...run,
              status: "cancelled",
              endedAt: "2026-04-21T00:00:30.000Z",
              summary: run.summary ?? "cancelled",
            };
          }
        });
        return [];
      },
      async sendTurn(input) {
        const session = sessions.find((entry) => entry.id === input.sessionId);
        if (!session) {
          throw new Error(`Unknown session: ${input.sessionId}`);
        }
        sendTurnCalls.push({
          sessionId: input.sessionId,
          prompt: input.prompt,
          extraSystemInstructions: input.extraSystemInstructions ?? [],
        });
        const run = buildRun({
          id: `run-${runs.length + 1}`,
          agentId: session.agentId,
          sessionId: session.id,
          prompt: input.prompt,
        });
        runs.push(run);
        return run;
      },
      async *streamRunEvents() {
        throw new Error("not used");
      },
      async getRun(runId) {
        const run = runs.find((entry) => entry.id === runId);
        if (!run) {
          throw new Error(`Unknown run: ${runId}`);
        }
        return run;
      },
      async getRunResult() {
        throw new Error("not used");
      },
      async cancelRun() {},
      async stopAgentRuns() {
        return [];
      },
    },
  });

  return {
    agents,
    deletedSessionIds,
    runs,
    sendTurnCalls,
    server,
    sessions,
    stoppedSessionIds,
  };
}

test("rocky chat detects nutrition MD requests, prepares a worker, and starts an orchestrated run", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { agents, runs, sendTurnCalls, server, sessions } =
    createRockyChatTestServer(stateRoot);

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message:
          "영양제 이벤트 엑셀을 상품명 기준으로 묶고 원가와 마진은 보호해서 정리해줘.",
        attachments: [
          {
            name: "nutrition-event.csv",
            contentType: "text/csv",
            size: 1234,
          },
        ],
      },
    });
    assert.equal(response.statusCode, 201);
    const chat = response.json<RockyChatRecord>();
    assert.equal(chat.intent, "specialized-task");
    assert.equal(chat.domain, "nutrition-md");
    assert.equal(chat.worker?.displayName, "영양제 MD 담당");
    assert.equal(chat.worker?.skillId, "rocky.nutrition-md");
    assert.equal(chat.executionStarted, true);
    assert.equal(chat.attachments.length, 1);
    assert.equal(chat.messages.length, 2);
    assert.ok(chat.skillCandidates.some((candidate) => candidate.title === "상품명 표기 묶기"));
    assert.ok(chat.skillCandidates.some((candidate) => candidate.title === "민감 자료 보호"));
    assert.equal(chat.dispatches.length, 1);
    assert.equal(chat.dispatches[0]?.intent, "specialized-task");
    assert.equal(chat.dispatches[0]?.skillId, "rocky.nutrition-md");
    assert.equal(chat.dispatches[0]?.executionStarted, true);
    assert.equal(chat.dispatches[0]?.orchestration?.status, "running");
    assert.equal(chat.dispatches[0]?.orchestration?.agentId, "rocky-nutrition-md");
    assert.equal(chat.dispatches[0]?.orchestration?.sessionId, "session-1");
    assert.equal(chat.dispatches[0]?.orchestration?.runId, "run-1");
    assert.equal(chat.orchestration?.runId, "run-1");
    assert.equal(agents.length, 1);
    assert.equal(sessions.length, 1);
    assert.equal(runs.length, 1);
    assert.equal(sendTurnCalls.length, 1);
    assert.equal(
      sendTurnCalls[0]?.prompt,
      "영양제 이벤트 엑셀을 상품명 기준으로 묶고 원가와 마진은 보호해서 정리해줘."
    );
    assert.match(
      sendTurnCalls[0]?.extraSystemInstructions[0] ?? "",
      /Use the workspace-local skill `rocky\.nutrition-md`/
    );
    const nutritionSkill = await readFile(
      path.join(agents[0]!.workspaceRoot, "skills", "rocky.nutrition-md", "SKILL.md"),
      "utf8"
    );
    assert.match(nutritionSkill, /Skill ID: rocky\.nutrition-md/);
    const nutritionContextPath =
      sendTurnCalls[0]?.extraSystemInstructions[1]?.match(/`([^`]+)`/)?.[1] ??
      `${ROCKY_AGENT_REQUEST_CONTEXT_DIR}/${chat.dispatches[0]!.id}.md`;
    const nutritionContext = await readFile(
      path.join(agents[0]!.workspaceRoot, nutritionContextPath),
      "utf8"
    );
    assert.match(nutritionContext, /원가\/마진 정보/);
    assert.match(nutritionContext, /상품명 표기 묶기/);

    const followUp = await server.inject({
      method: "POST",
      url: `/rocky/chats/${chat.id}/messages`,
      payload: {
        message: "채널별 성과도 같이 비교해줘.",
      },
    });
    assert.equal(followUp.statusCode, 201);
    const updated = followUp.json<RockyChatRecord>();
    assert.equal(updated.intent, "specialized-task");
    assert.equal(updated.messages.length, 4);
    assert.ok(updated.skillCandidates.some((candidate) => candidate.title === "채널별 성과 비교"));
    assert.equal(agents.length, 1);
    assert.equal(updated.worker?.agentId, "rocky-nutrition-md");
    assert.equal(sessions.length, 2);
    assert.equal(runs.length, 2);
    assert.equal(sendTurnCalls.length, 2);
    assert.equal(updated.dispatches[1]?.orchestration?.runId, "run-2");
  } finally {
    await server.close();
  }
});

test("rocky chat routes simple conversation through rocky core", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { agents, runs, sendTurnCalls, server, sessions } =
    createRockyChatTestServer(stateRoot);

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "안녕",
      },
    });

    assert.equal(response.statusCode, 201);
    const chat = response.json<RockyChatRecord>();
    assert.equal(chat.intent, "conversation");
    assert.equal(chat.worker?.displayName, "Rocky");
    assert.equal(chat.worker?.skillId, "rocky.core");
    assert.equal(chat.dispatches.length, 1);
    assert.equal(chat.dispatches[0]?.intent, "conversation");
    assert.equal(chat.dispatches[0]?.skillId, "rocky.core");
    assert.equal(chat.dispatches[0]?.orchestration?.agentId, "rocky-core");
    assert.equal(chat.dispatches[0]?.orchestration?.sessionId, "session-1");
    assert.equal(chat.dispatches[0]?.orchestration?.runId, "run-1");
    assert.equal(chat.skillCandidates.length, 0);
    assert.equal(chat.orchestration?.agentId, "rocky-core");
    assert.equal(chat.executionStarted, true);
    assert.equal(chat.messages[1]?.intent, "conversation");
    assert.equal(chat.messages[1]?.workerId, "rocky-core-worker");
    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.id, "rocky-core");
    assert.equal(sessions.length, 1);
    assert.equal(runs.length, 1);
    assert.equal(sendTurnCalls.length, 1);
    assert.equal(sendTurnCalls[0]?.prompt, "안녕");
    assert.match(
      sendTurnCalls[0]?.extraSystemInstructions[0] ?? "",
      /Use the workspace-local skill `rocky\.core`/
    );
    const coreSkill = await readFile(
      path.join(agents[0]!.workspaceRoot, "skills", "rocky.core", "SKILL.md"),
      "utf8"
    );
    assert.match(coreSkill, /Skill ID: rocky\.core/);
    assert.match(coreSkill, /사용자 요청은 현재 turn의 원문 user message를 그대로 사용합니다/);
    const coreContextPath =
      sendTurnCalls[0]?.extraSystemInstructions[1]?.match(/`([^`]+)`/)?.[1] ??
      `${ROCKY_AGENT_REQUEST_CONTEXT_DIR}/${chat.dispatches[0]!.id}.md`;
    const coreContext = await readFile(
      path.join(agents[0]!.workspaceRoot, coreContextPath),
      "utf8"
    );
    assert.match(coreContext, /첨부 메타데이터:\n- 없음/);
  } finally {
    await server.close();
  }
});

test("rocky chat asks for clarification on vague requests and routes later general tasks through an agent", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { agents, runs, sendTurnCalls, server, sessions } =
    createRockyChatTestServer(stateRoot);

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "이거 봐줘",
        attachments: [
          {
            name: "meeting-notes.txt",
            contentType: "text/plain",
            size: 320,
          },
        ],
      },
    });

    assert.equal(response.statusCode, 201);
    const chat = response.json<RockyChatRecord>();
    assert.equal(chat.intent, "clarification");
    assert.equal(chat.worker?.displayName, "Rocky");
    assert.equal(chat.dispatches.length, 1);
    assert.equal(chat.dispatches[0]?.intent, "clarification");
    assert.equal(chat.dispatches[0]?.skillId, "rocky.core");
    assert.equal(chat.dispatches[0]?.orchestration?.agentId, "rocky-core");
    assert.equal(chat.executionStarted, true);
    assert.equal(chat.messages[1]?.intent, "clarification");

    const followUp = await server.inject({
      method: "POST",
      url: `/rocky/chats/${chat.id}/messages`,
      payload: {
        message: "회의록으로 요약해서 액션 아이템을 정리해줘.",
      },
    });

    assert.equal(followUp.statusCode, 201);
    const updated = followUp.json<RockyChatRecord>();
    assert.equal(updated.intent, "general-task");
    assert.equal(updated.worker?.displayName, "자료 정리 담당");
    assert.equal(updated.worker?.skillId, "rocky.general-task");
    assert.equal(updated.worker?.agentId, "rocky-general-task");
    assert.equal(updated.dispatches.length, 2);
    assert.equal(updated.dispatches[0]?.intent, "clarification");
    assert.equal(updated.dispatches[1]?.intent, "general-task");
    assert.equal(updated.dispatches[1]?.skillId, "rocky.general-task");
    assert.equal(updated.dispatches[1]?.orchestration?.status, "running");
    assert.equal(updated.dispatches[1]?.orchestration?.sessionId, "session-2");
    assert.equal(updated.dispatches[1]?.orchestration?.runId, "run-2");
    assert.equal(updated.executionStarted, true);
    assert.equal(agents.length, 2);
    assert.deepEqual(agents.map((agent) => agent.id), [
      "rocky-core",
      "rocky-general-task",
    ]);
    assert.equal(sessions.length, 2);
    assert.equal(runs.length, 2);
    assert.equal(sendTurnCalls.length, 2);
  } finally {
    await server.close();
  }
});

test("rocky chat routes chart and report requests through the visualization worker", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { agents, runs, sendTurnCalls, server, sessions } =
    createRockyChatTestServer(stateRoot);

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message:
          "매출 csv를 보고 월별 추이 그래프랑 핵심 지표 리포트를 만들어줘.",
        attachments: [
          {
            name: "monthly-sales.csv",
            contentType: "text/csv",
            size: 2048,
          },
        ],
      },
    });

    assert.equal(response.statusCode, 201);
    const chat = response.json<RockyChatRecord>();
    assert.equal(chat.intent, "general-task");
    assert.equal(chat.worker?.displayName, "시각화 리포트 담당");
    assert.equal(chat.worker?.skillId, "rocky.visual-report");
    assert.equal(chat.worker?.agentId, "rocky-visual-report");
    assert.equal(chat.dispatches[0]?.skillId, "rocky.visual-report");
    assert.equal(chat.dispatches[0]?.orchestration?.agentId, "rocky-visual-report");
    assert.equal(chat.dispatches[0]?.orchestration?.sessionId, "session-1");
    assert.equal(chat.dispatches[0]?.orchestration?.runId, "run-1");
    assert.ok(chat.skillCandidates.some((candidate) => candidate.title === "추이 차트 템플릿"));
    assert.ok(chat.skillCandidates.some((candidate) => candidate.title === "지표 요약 카드"));
    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.id, "rocky-visual-report");
    assert.equal(sessions.length, 1);
    assert.equal(runs.length, 1);
    assert.equal(sendTurnCalls.length, 1);
    assert.match(
      sendTurnCalls[0]?.extraSystemInstructions[0] ?? "",
      /Use the workspace-local skill `rocky\.visual-report`/
    );
    assert.match(
      sendTurnCalls[0]?.extraSystemInstructions.join("\n") ?? "",
      /requires at least one Rocky-previewable chart JSON artifact/
    );
    assert.match(
      sendTurnCalls[0]?.extraSystemInstructions.join("\n") ?? "",
      /Do not substitute ASCII charts, unicode sparklines, or fenced-code diagrams/
    );

    const visualSkill = await readFile(
      path.join(agents[0]!.workspaceRoot, "skills", "rocky.visual-report", "SKILL.md"),
      "utf8"
    );
    assert.match(visualSkill, /Skill ID: rocky\.visual-report/);
    assert.match(visualSkill, /chart 또는 graph를 포함한 JSON 아티팩트/);
    assert.match(visualSkill, /Python으로 집계나 전처리/);
  } finally {
    await server.close();
  }
});

test("rocky chat deletes the current chat and associated sessions", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const {
    deletedSessionIds,
    sendTurnCalls,
    server,
    sessions,
    stoppedSessionIds,
  } = createRockyChatTestServer(stateRoot);

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "회의록을 보고 액션 아이템 위주로 정리해줘.",
      },
    });
    assert.equal(response.statusCode, 201);
    const chat = response.json<RockyChatRecord>();
    assert.equal(sessions.length, 1);
    assert.equal(sendTurnCalls.length, 1);

    const deleteResponse = await server.inject({
      method: "DELETE",
      url: `/rocky/chats/${chat.id}`,
    });
    assert.equal(deleteResponse.statusCode, 204);
    assert.deepEqual(stoppedSessionIds, ["session-1"]);
    assert.deepEqual(deletedSessionIds, ["session-1"]);
    assert.equal(sessions.length, 0);

    const missingResponse = await server.inject({
      method: "GET",
      url: `/rocky/chats/${chat.id}`,
    });
    assert.equal(missingResponse.statusCode, 404);
  } finally {
    await server.close();
  }
});

test("rocky chat refreshes orchestration status from the backing run", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { runs, server } = createRockyChatTestServer(stateRoot);

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message:
          "영양제 이벤트 자료를 상품명 기준으로 묶고 원가와 마진은 보호해서 정리해줘.",
      },
    });
    assert.equal(response.statusCode, 201);
    const chat = response.json<RockyChatRecord>();
    assert.equal(chat.orchestration?.status, "running");

    runs[0] = {
      ...runs[0]!,
      status: "completed",
      endedAt: "2026-04-21T00:01:00.000Z",
      summary: "영양제 MD 작업을 정리했습니다.",
    };

    const refreshedResponse = await server.inject({
      method: "GET",
      url: `/rocky/chats/${chat.id}`,
    });
    assert.equal(refreshedResponse.statusCode, 200);
    const refreshed = refreshedResponse.json<RockyChatRecord>();
    assert.equal(refreshed.orchestration?.status, "completed");
    assert.equal(refreshed.orchestration?.output, "영양제 MD 작업을 정리했습니다.");
    assert.equal(refreshed.messages[1]?.text, "영양제 MD 작업을 정리했습니다.");
    assert.equal(refreshed.dispatches[0]?.orchestration?.status, "completed");
    assert.equal(refreshed.dispatches[0]?.orchestration?.endedAt, "2026-04-21T00:01:00.000Z");
  } finally {
    await server.close();
  }
});
