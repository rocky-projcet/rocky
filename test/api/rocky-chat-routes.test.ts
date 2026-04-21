import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";

import type { AgentRecord } from "../../src/agents/agent-types.js";
import type { RockyChatRecord } from "../../src/rocky-chat/rocky-chat-types.js";

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

test("rocky chat detects nutrition MD requests, prepares a worker, and does not start runs", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const agents: AgentRecord[] = [];
  const sendTurnCalls: string[] = [];

  const server = createAgentEngineServer({
    stateRoot,
    agentService: {
      async createAgent(input) {
        const agent = buildAgent(input ?? {});
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
      async createSession() {
        throw new Error("createSession should not be called by rocky chat");
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
        return [];
      },
      async deleteSession() {},
      async stopSessionRuns() {
        return [];
      },
      async sendTurn(input) {
        sendTurnCalls.push(input.sessionId);
        throw new Error("sendTurn should not be called by rocky chat");
      },
      async *streamRunEvents() {
        throw new Error("not used");
      },
      async getRun() {
        throw new Error("not used");
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
    assert.equal(chat.domain, "nutrition-md");
    assert.equal(chat.worker?.displayName, "영양제 MD 담당");
    assert.equal(chat.executionStarted, false);
    assert.equal(chat.attachments.length, 1);
    assert.equal(chat.messages.length, 2);
    assert.ok(chat.skillCandidates.some((candidate) => candidate.title === "상품명 표기 묶기"));
    assert.ok(chat.skillCandidates.some((candidate) => candidate.title === "민감 자료 보호"));
    assert.equal(chat.dispatches.length, 1);
    assert.equal(agents.length, 1);
    assert.deepEqual(sendTurnCalls, []);

    agents.splice(0, agents.length);
    const followUp = await server.inject({
      method: "POST",
      url: `/rocky/chats/${chat.id}/messages`,
      payload: {
        message: "채널별 성과도 같이 비교해줘.",
      },
    });
    assert.equal(followUp.statusCode, 201);
    const updated = followUp.json<RockyChatRecord>();
    assert.equal(updated.messages.length, 4);
    assert.ok(updated.skillCandidates.some((candidate) => candidate.title === "채널별 성과 비교"));
    assert.equal(agents.length, 1);
    assert.equal(updated.worker?.agentId, "rocky-nutrition-md");
    assert.deepEqual(sendTurnCalls, []);
  } finally {
    await server.close();
  }
});
