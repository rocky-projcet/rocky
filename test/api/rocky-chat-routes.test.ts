import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";
import { ROCKY_AGENT_REQUEST_CONTEXT_DIR } from "../../src/rocky-chat/rocky-agent-skill-workspace.js";

import type { AgentRecord } from "../../src/agents/agent-types.js";
import type {
  RockyAbilityCardRecord,
  RockyChatRecord,
} from "../../src/rocky-chat/rocky-chat-types.js";
import type {
  AgentRunRecord,
  AgentSessionMessage,
  AgentSessionRecord,
} from "../../src/sessions/session-types.js";
import type { RuntimeRunResult } from "../../src/runtime/runtime-types.js";

function buildAgent(input: Partial<AgentRecord> = {}): AgentRecord {
  const now = "2026-04-21T00:00:00.000Z";
  return {
    id: input.id ?? "rocky-core",
    name: input.name ?? "Rocky",
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
  kind?: AgentSessionRecord["kind"];
}): AgentSessionRecord {
  const now = "2026-04-21T00:00:00.000Z";
  return {
    id: input.id,
    agentId: input.agentId,
    kind: input.kind ?? "task-request",
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
  const transcriptOverrides = new Map<string, AgentSessionMessage[]>();
  const deletedSessionIds: string[] = [];
  const cancelledRunIds: string[] = [];
  const completedRunSummaries: string[] = [];
  const createSessionCalls: Array<{
    agentId: string;
    title?: string | null;
    kind?: AgentSessionRecord["kind"];
    runtimeKind?: string;
    model?: string | null;
    reasoningEffort?: string | null;
    serviceTier?: string | null;
  }> = [];
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
        const agentId = input?.id ?? "rocky-core";
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
        createSessionCalls.push({
          agentId: input.agentId,
          title: input.title,
          kind: input.kind,
          runtimeKind: input.runtimeKind,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          serviceTier: input.serviceTier,
        });
        const session = buildSession({
          id: `session-${sessions.length + 1}`,
          agentId: input.agentId,
          title: input.title,
          kind: input.kind,
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
      async getTranscript(sessionId) {
        const override = transcriptOverrides.get(sessionId);
        if (override) {
          return override;
        }
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
      async getRunResult(runId) {
        const run = runs.find((entry) => entry.id === runId);
        if (!run) {
          throw new Error(`Unknown run: ${runId}`);
        }
        const lastMessage = run.summary?.trim() || null;
        return {
          runId: run.id,
          sessionId: run.sessionId,
          runtimeSessionId: run.runtimeSessionId,
          sessionBinding: null,
          status: run.status,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
          exitCode: run.status === "completed" ? 0 : null,
          signal: null,
          command: "fake-codex",
          args: [],
          messages: lastMessage
            ? [
                {
                  role: "assistant",
                  text: lastMessage,
                  itemType: "output-last-message",
                  occurredAt: run.endedAt ?? run.startedAt,
                  source: "output-last-message",
                },
              ]
            : [],
          warnings: [],
          errors: run.status === "failed" && run.summary ? [run.summary] : [],
          stderr: [],
          artifactRefs: [],
          lastMessage,
          outputLastMessagePath: run.outputLastMessagePath,
          rawEvents: [],
        } satisfies RuntimeRunResult;
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
        const completedSummary = completedRunSummaries.shift();
        if (completedSummary) {
          run.status = "completed";
          run.endedAt = "2026-04-21T00:00:05.000Z";
          run.summary = completedSummary;
        }
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
      async cancelRun(runId) {
        cancelledRunIds.push(runId);
        const index = runs.findIndex((entry) => entry.id === runId);
        const run = index >= 0 ? runs[index] : null;
        if (run?.status === "running") {
          runs[index] = {
            ...run,
            status: "cancelled",
            endedAt: "2026-04-21T00:00:30.000Z",
            summary: run.summary ?? "cancelled",
          };
        }
      },
      async stopAgentRuns() {
        return [];
      },
    },
  });

  return {
    agents,
    cancelledRunIds,
    createSessionCalls,
    deletedSessionIds,
    completedRunSummaries,
    runs,
    sendTurnCalls,
    server,
    sessions,
    stoppedSessionIds,
    transcriptOverrides,
  };
}

test("rocky abilities expose skill-backed home cards", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { server } = createRockyChatTestServer(stateRoot);

  try {
    const response = await server.inject({
      method: "GET",
      url: "/rocky/abilities",
    });
    assert.equal(response.statusCode, 200);
    const abilities = response.json<RockyAbilityCardRecord[]>();
    const pptAbility = abilities.find(
      (ability) => ability.skillId === "rocky.presentation"
    );
    assert.ok(pptAbility);
    assert.equal(pptAbility.title, "PPT 능력");
    assert.deepEqual(pptAbility.matchedSkillIds, ["slides"]);
    assert.deepEqual(pptAbility.installedSkillIds, []);
    assert.equal(pptAbility.installed, false);
    assert.ok(pptAbility.examples.some((example) => /번역/u.test(example)));
  } finally {
    await server.close();
  }
});

test("rocky abilities mark installed slides skill as matched", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { agents, server } = createRockyChatTestServer(stateRoot);
  const workspaceRoot = path.join(
    stateRoot,
    "agent-workspaces",
    "rocky-core",
    "workspace"
  );
  const runtimeHome = path.join(
    stateRoot,
    "agent-workspaces",
    "rocky-core",
    "runtime-home"
  );
  agents.push(
    buildAgent({
      id: "rocky-core",
      workspaceRoot,
      runtimeHome,
    })
  );
  await mkdir(path.join(workspaceRoot, ".agents", "skills", "slides"), {
    recursive: true,
  });
  await writeFile(
    path.join(workspaceRoot, ".agents", "skills", "slides", "SKILL.md"),
    "---\nname: slides\n---\n"
  );

  try {
    const response = await server.inject({
      method: "GET",
      url: "/rocky/abilities",
    });
    assert.equal(response.statusCode, 200);
    const pptAbility = response
      .json<RockyAbilityCardRecord[]>()
      .find((ability) => ability.skillId === "rocky.presentation");
    assert.ok(pptAbility);
    assert.deepEqual(pptAbility.matchedSkillIds, ["slides"]);
    assert.deepEqual(pptAbility.installedSkillIds, ["slides"]);
    assert.equal(pptAbility.installed, true);

    const managementResponse = await server.inject({
      method: "GET",
      url: "/rocky/core",
    });
    assert.equal(managementResponse.statusCode, 200);
    const managedPptSkill = managementResponse
      .json()
      .skills.find((skill: { id: string }) => skill.id === "rocky.presentation");
    assert.ok(managedPptSkill);
    assert.deepEqual(managedPptSkill.matchedSkillIds, ["slides"]);
    assert.deepEqual(managedPptSkill.installedSkillIds, ["slides"]);
    assert.equal(managedPptSkill.installed, true);
  } finally {
    await server.close();
  }
});

test("rocky ability guide starts with a Rocky answer, not a user prompt", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { server } = createRockyChatTestServer(stateRoot);

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/abilities/rocky.presentation/guide",
    });
    assert.equal(response.statusCode, 201);
    const chat = response.json<RockyChatRecord>();
    assert.equal(chat.title, "PPT 능력");
    assert.equal(chat.messages.length, 1);
    assert.equal(chat.messages[0]?.role, "rocky");
    assert.match(chat.messages[0]?.text ?? "", /PPT 능력 사용법/u);
    assert.match(chat.messages[0]?.text ?? "", /PPT 텍스트 번역/u);
    assert.equal(
      chat.messages.some((message) =>
        /PPT 능력을 어떻게 쓰면 되는지 알려줘/u.test(message.text)
      ),
      false
    );
    assert.equal(chat.dispatches.length, 0);
    assert.equal(chat.executionStarted, false);
  } finally {
    await server.close();
  }
});

test("rocky template interview turn is dispatched to Rocky Core without early draft", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { runs, sendTurnCalls, server } = createRockyChatTestServer(stateRoot);

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/template-interview/turn",
      payload: {
        stepId: "intent",
        answer: "GS 프로모션 양식에 맞춰 행사 상품 엑셀을 매달 정리하고 싶어",
      },
    });
    assert.equal(response.statusCode, 200);
    const result = response.json();

    assert.equal(result.nextStepId, "inputs");
    assert.equal(result.draft, null);
    assert.equal(result.agent.status, "running");
    assert.equal(result.agent.runId, "run-1");
    assert.equal(sendTurnCalls.length, 1);
    assert.match(sendTurnCalls[0]?.prompt ?? "", /Rocky 템플릿 인터뷰 처리/u);
    assert.match(sendTurnCalls[0]?.prompt ?? "", /GS 프로모션 양식/u);
    assert.equal(runs.length, 1);
  } finally {
    await server.close();
  }
});

test("rocky template interview final turn can use agent JSON draft", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { completedRunSummaries, server } = createRockyChatTestServer(stateRoot);
  completedRunSummaries.push(
    JSON.stringify({
      summary: "Rocky가 인터뷰 내용을 바탕으로 초안을 만들었습니다.",
      nextStepId: "review",
      draft: {
        category: "document",
        title: "GS 프로모션 양식 작성",
        description: "GS 프로모션 양식에 맞춰 행사 상품 엑셀을 정리합니다.",
        triggerLabel: "프로모션 양식 작성",
        requiredInputs: ["GS 양식", "행사 상품 엑셀", "행사 기간"],
        outputFormatLabel: "엑셀",
        defaultInstructions: "GS 제출 양식을 유지하고 누락값은 먼저 질문합니다.",
      },
    })
  );

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/template-interview/turn",
      payload: {
        stepId: "rules",
        answer: "GS 제출 양식을 그대로 유지하고, 누락 가격은 질문해줘.",
        answers: [
          {
            stepId: "intent",
            answer: "GS 프로모션 양식에 맞춰 행사 상품 엑셀을 정리하고 싶어",
          },
          {
            stepId: "inputs",
            answer: "GS 양식, 행사 상품 엑셀, 행사 기간",
          },
          {
            stepId: "output",
            answer: "엑셀",
          },
        ],
      },
    });
    assert.equal(response.statusCode, 200);
    const result = response.json();

    assert.equal(result.source, "agent");
    assert.equal(result.nextStepId, "review");
    assert.equal(result.draft.title, "GS 프로모션 양식 작성");
    assert.deepEqual(result.draft.requiredInputs, [
      "GS 양식",
      "행사 상품 엑셀",
      "행사 기간",
    ]);
  } finally {
    await server.close();
  }
});

test("rocky chat accepts attachment-only PPT requests with a default prompt", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { agents, sendTurnCalls, server } = createRockyChatTestServer(stateRoot);
  const pptBody = Buffer.alloc(1_100_000, "p");

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "",
        attachments: [
          {
            name: "deck.pptx",
            contentType:
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            size: 2048,
            contentBase64: pptBody.toString("base64"),
          },
        ],
      },
    });
    assert.equal(response.statusCode, 201);
    const chat = response.json<RockyChatRecord>();
    assert.equal(chat.worker?.skillId, "rocky.presentation");
    assert.equal(chat.messages[0]?.role, "user");
    assert.equal(chat.messages[0]?.text, "Please review the attached file.");
    assert.match(chat.attachments[0]?.workspacePath ?? "", /^uploads\/rocky\//u);
    const uploadedBody = await readFile(
      path.join(agents[0]!.workspaceRoot, chat.attachments[0]!.workspacePath!)
    );
    assert.equal(uploadedBody.byteLength, pptBody.byteLength);
    assert.equal(chat.dispatches[0]?.skillId, "rocky.presentation");
    assert.equal(
      chat.dispatches[0]?.originalRequest,
      "Please review the attached file."
    );
    assert.equal(sendTurnCalls.length, 1);
    assert.equal(sendTurnCalls[0]?.prompt, "Please review the attached file.");
    assert.match(
      sendTurnCalls[0]?.extraSystemInstructions.find((instruction) =>
        instruction.includes(".agents/skills/slides/SKILL.md")
      ) ?? "",
      /linked skill instructions/u
    );
    assert.match(
      sendTurnCalls[0]?.extraSystemInstructions.find((instruction) =>
        instruction.includes(ROCKY_AGENT_REQUEST_CONTEXT_DIR)
      ) ?? "",
      /\.agents\/rocky\/requests\//u
    );
    const contextPath =
      sendTurnCalls[0]?.extraSystemInstructions
        .find((instruction) => instruction.includes(ROCKY_AGENT_REQUEST_CONTEXT_DIR))
        ?.match(/`([^`]+)`/)?.[1] ??
      `${ROCKY_AGENT_REQUEST_CONTEXT_DIR}/${chat.dispatches[0]!.id}.md`;
    const requestContext = await readFile(
      path.join(agents[0]!.workspaceRoot, contextPath),
      "utf8"
    );
    assert.match(requestContext, /workspace path: uploads\/rocky\//u);
    const presentationSkill = await readFile(
      path.join(
        agents[0]!.workspaceRoot,
        ".agents",
        "skills",
        "rocky.presentation",
        "SKILL.md"
      ),
      "utf8"
    );
    assert.match(presentationSkill, /연결된 workspace-local skill:/u);
    assert.match(presentationSkill, /\.agents\/skills\/slides\/SKILL\.md/u);
  } finally {
    await server.close();
  }
});

test("rocky chat keeps task requests on Rocky Core", async () => {
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
    assert.equal(chat.intent, "conversation");
    assert.equal(chat.domain, "general");
    assert.equal(chat.worker?.displayName, "Rocky");
    assert.equal(chat.worker?.skillId, "rocky.core");
    assert.equal(chat.worker?.agentId, "rocky-core");
    assert.equal(chat.executionStarted, true);
    assert.equal(chat.attachments.length, 1);
    assert.equal(chat.messages.length, 2);
    assert.equal(chat.skillCandidates.length, 0);
    assert.equal(chat.dispatches.length, 1);
    assert.equal(chat.dispatches[0]?.intent, "conversation");
    assert.equal(chat.dispatches[0]?.skillId, "rocky.core");
    assert.deepEqual(chat.dispatches[0]?.protectionHints, []);
    assert.equal(chat.dispatches[0]?.executionStarted, true);
    assert.equal(chat.dispatches[0]?.orchestration?.status, "running");
    assert.equal(chat.dispatches[0]?.orchestration?.agentId, "rocky-core");
    assert.equal(chat.dispatches[0]?.orchestration?.sessionId, "session-1");
    assert.equal(chat.dispatches[0]?.orchestration?.runId, "run-1");
    assert.equal(chat.orchestration?.runId, "run-1");
    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.id, "rocky-core");
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.kind, "task-request");
    assert.equal(runs.length, 1);
    assert.equal(sendTurnCalls.length, 1);
    assert.equal(
      sendTurnCalls[0]?.prompt,
      "영양제 이벤트 엑셀을 상품명 기준으로 묶고 원가와 마진은 보호해서 정리해줘."
    );
    assert.match(
      sendTurnCalls[0]?.extraSystemInstructions[0] ?? "",
      /Use the workspace-local Rocky Core instructions in `.agents\/skills\/rocky\.core\/SKILL\.md`/
    );
    const coreSkill = await readFile(
      path.join(
        agents[0]!.workspaceRoot,
        ".agents",
        "skills",
        "rocky.core",
        "SKILL.md"
      ),
      "utf8"
    );
    assert.match(coreSkill, /Skill ID: rocky\.core/);
    assert.doesNotMatch(coreSkill, /delegated|위임|내부 에이전트|라우터/);
    const nutritionContextPath =
      sendTurnCalls[0]?.extraSystemInstructions[1]?.match(/`([^`]+)`/)?.[1] ??
      `${ROCKY_AGENT_REQUEST_CONTEXT_DIR}/${chat.dispatches[0]!.id}.md`;
    const coreContext = await readFile(
      path.join(agents[0]!.workspaceRoot, nutritionContextPath),
      "utf8"
    );
    assert.match(coreContext, /첨부 메타데이터:/);
    assert.doesNotMatch(coreContext, /반복 기준 후보|보호해서 다룰 항목|delegated|위임|내부 에이전트|라우터/);

    const followUp = await server.inject({
      method: "POST",
      url: `/rocky/chats/${chat.id}/messages`,
      payload: {
        message: "채널별 성과도 같이 비교해줘.",
      },
    });
    assert.equal(followUp.statusCode, 201);
    const updated = followUp.json<RockyChatRecord>();
    assert.equal(updated.intent, "conversation");
    assert.equal(updated.messages.length, 4);
    assert.equal(updated.skillCandidates.length, 0);
    assert.equal(agents.length, 1);
    assert.equal(updated.worker?.agentId, "rocky-core");
    assert.equal(sessions.length, 1);
    assert.equal(runs.length, 2);
    assert.equal(sendTurnCalls.length, 2);
    assert.equal(sendTurnCalls[1]?.sessionId, "session-1");
    assert.equal(updated.dispatches[1]?.orchestration?.runId, "run-2");
    assert.equal(updated.dispatches[1]?.orchestration?.sessionId, "session-1");
  } finally {
    await server.close();
  }
});

test("rocky chat cancellation stops the active home run and persists chat state", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-cancel-"));
  const { cancelledRunIds, runs, server } = createRockyChatTestServer(stateRoot);

  try {
    const createResponse = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "첨부한 PPT를 슬라이드별로 요약해줘.",
      },
    });
    assert.equal(createResponse.statusCode, 201);
    const chat = createResponse.json<RockyChatRecord>();
    assert.equal(chat.dispatches[0]?.orchestration?.status, "running");
    assert.equal(chat.dispatches[0]?.orchestration?.runId, "run-1");

    const cancelResponse = await server.inject({
      method: "POST",
      url: `/rocky/chats/${chat.id}/cancel`,
    });
    assert.equal(cancelResponse.statusCode, 200);
    const cancelled = cancelResponse.json<RockyChatRecord>();
    assert.deepEqual(cancelledRunIds, ["run-1"]);
    assert.equal(runs[0]?.status, "cancelled");
    assert.equal(cancelled.orchestration?.status, "cancelled");
    assert.equal(cancelled.dispatches[0]?.orchestration?.status, "cancelled");

    const persistedResponse = await server.inject({
      method: "GET",
      url: `/rocky/chats/${chat.id}`,
    });
    assert.equal(persistedResponse.statusCode, 200);
    const persisted = persistedResponse.json<RockyChatRecord>();
    assert.equal(persisted.orchestration?.status, "cancelled");
    assert.equal(persisted.dispatches[0]?.orchestration?.status, "cancelled");
  } finally {
    await server.close();
  }
});

test("rocky core management stores default model settings for new home sessions", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { createSessionCalls, server } = createRockyChatTestServer(stateRoot);

  try {
    const initialResponse = await server.inject({
      method: "GET",
      url: "/rocky/core",
    });
    assert.equal(initialResponse.statusCode, 200);
    assert.equal(initialResponse.json().settings.defaultRuntimeKind, "codex-cli");
    assert.equal(initialResponse.json().settings.defaultModel, null);

    const settingsResponse = await server.inject({
      method: "PATCH",
      url: "/rocky/core/settings",
      payload: {
        defaultRuntimeKind: "codex-cli",
        defaultModel: "gpt-5.5",
        defaultReasoningEffort: "xhigh",
        defaultServiceTier: "fast",
      },
    });
    assert.equal(settingsResponse.statusCode, 200);
    assert.equal(settingsResponse.json().settings.defaultModel, "gpt-5.5");
    assert.equal(settingsResponse.json().settings.defaultReasoningEffort, "xhigh");
    assert.equal(settingsResponse.json().settings.defaultServiceTier, "fast");

    const chatResponse = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "새 기본 모델로 답해줘.",
      },
    });
    assert.equal(chatResponse.statusCode, 201);
    assert.equal(createSessionCalls.length, 1);
    assert.equal(createSessionCalls[0]?.runtimeKind, "codex-cli");
    assert.equal(createSessionCalls[0]?.model, "gpt-5.5");
    assert.equal(createSessionCalls[0]?.reasoningEffort, "xhigh");
    assert.equal(createSessionCalls[0]?.serviceTier, "fast");

    const syncResponse = await server.inject({
      method: "POST",
      url: "/rocky/core/skills/sync",
    });
    assert.equal(syncResponse.statusCode, 200);
    assert.equal(syncResponse.json().skills[0]?.synchronized, true);
    assert.ok(
      syncResponse
        .json()
        .skills.some(
          (skill: { id: string; synchronized: boolean }) =>
            skill.id === "rocky.presentation" && skill.synchronized
        )
    );
  } finally {
    await server.close();
  }
});

test("rocky chat deletes agent-local skills through server management without a codex run", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { agents, sendTurnCalls, server } = createRockyChatTestServer(stateRoot);
  const workspaceRoot = path.join(
    stateRoot,
    "agent-workspaces",
    "rocky-core",
    "workspace"
  );
  const runtimeHome = path.join(
    stateRoot,
    "agent-workspaces",
    "rocky-core",
    "runtime-home"
  );
  agents.push(
    buildAgent({
      id: "rocky-core",
      workspaceRoot,
      runtimeHome,
    })
  );
  await mkdir(path.join(workspaceRoot, ".agents", "skills", "slides"), {
    recursive: true,
  });
  await writeFile(
    path.join(workspaceRoot, ".agents", "skills", "slides", "SKILL.md"),
    "---\nname: slides\n---\n"
  );

  try {
    const promptResponse = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "스킬 삭제해줘",
      },
    });
    assert.equal(promptResponse.statusCode, 201);
    const promptChat = promptResponse.json<RockyChatRecord>();
    assert.equal(sendTurnCalls.length, 0);
    assert.equal(promptChat.executionStarted, false);
    assert.match(promptChat.messages[1]?.text ?? "", /slides/u);

    const deleteResponse = await server.inject({
      method: "POST",
      url: `/rocky/chats/${promptChat.id}/messages`,
      payload: {
        message: "slides",
      },
    });
    assert.equal(deleteResponse.statusCode, 201);
    const deletedChat = deleteResponse.json<RockyChatRecord>();
    assert.equal(sendTurnCalls.length, 0);
    assert.equal(deletedChat.executionStarted, false);
    assert.match(deletedChat.messages.at(-1)?.text ?? "", /삭제했습니다/u);
    await assert.rejects(
      access(path.join(workspaceRoot, ".agents", "skills", "slides"))
    );
    await access(
      path.join(workspaceRoot, ".agents", "skills", "rocky.core", "SKILL.md")
    );
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
    assert.equal(sessions[0]?.kind, "task-request");
    assert.equal(runs.length, 1);
    assert.equal(sendTurnCalls.length, 1);
    assert.equal(sendTurnCalls[0]?.prompt, "안녕");
    assert.match(
      sendTurnCalls[0]?.extraSystemInstructions[0] ?? "",
      /Use the workspace-local Rocky Core instructions in `.agents\/skills\/rocky\.core\/SKILL\.md`/
    );
    const coreSkill = await readFile(
      path.join(
        agents[0]!.workspaceRoot,
        ".agents",
        "skills",
        "rocky.core",
        "SKILL.md"
      ),
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

test("rocky chat asks for clarification and keeps later tasks on Rocky Core", async () => {
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
    assert.equal(updated.intent, "conversation");
    assert.equal(updated.worker?.displayName, "Rocky");
    assert.equal(updated.worker?.skillId, "rocky.core");
    assert.equal(updated.worker?.agentId, "rocky-core");
    assert.equal(updated.dispatches.length, 2);
    assert.equal(updated.dispatches[0]?.intent, "clarification");
    assert.equal(updated.dispatches[1]?.intent, "conversation");
    assert.equal(updated.dispatches[1]?.skillId, "rocky.core");
    assert.equal(updated.dispatches[1]?.orchestration?.status, "running");
    assert.equal(updated.dispatches[1]?.orchestration?.agentId, "rocky-core");
    assert.equal(updated.dispatches[1]?.orchestration?.sessionId, "session-1");
    assert.equal(updated.dispatches[1]?.orchestration?.runId, "run-2");
    assert.equal(updated.executionStarted, true);
    assert.equal(agents.length, 1);
    assert.deepEqual(agents.map((agent) => agent.id), ["rocky-core"]);
    assert.equal(sessions.length, 1);
    assert.equal(runs.length, 2);
    assert.equal(sendTurnCalls.length, 2);
    assert.deepEqual(
      sendTurnCalls.map((call) => call.sessionId),
      ["session-1", "session-1"]
    );
  } finally {
    await server.close();
  }
});

test("rocky chat keeps chart and report requests on Rocky Core", async () => {
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
    assert.equal(chat.intent, "conversation");
    assert.equal(chat.worker?.displayName, "Rocky");
    assert.equal(chat.worker?.skillId, "rocky.core");
    assert.equal(chat.worker?.agentId, "rocky-core");
    assert.equal(chat.dispatches[0]?.skillId, "rocky.core");
    assert.equal(chat.dispatches[0]?.orchestration?.agentId, "rocky-core");
    assert.equal(chat.dispatches[0]?.orchestration?.sessionId, "session-1");
    assert.equal(chat.dispatches[0]?.orchestration?.runId, "run-1");
    assert.equal(chat.skillCandidates.length, 0);
    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.id, "rocky-core");
    assert.equal(sessions.length, 1);
    assert.equal(runs.length, 1);
    assert.equal(sendTurnCalls.length, 1);
    assert.match(
      sendTurnCalls[0]?.extraSystemInstructions[0] ?? "",
      /Use the workspace-local Rocky Core instructions in `.agents\/skills\/rocky\.core\/SKILL\.md`/
    );
    assert.doesNotMatch(
      sendTurnCalls[0]?.extraSystemInstructions.join("\n") ?? "",
      /requires at least one Rocky-previewable chart JSON artifact|visual-report|delegated|위임/
    );

    const coreSkill = await readFile(
      path.join(
        agents[0]!.workspaceRoot,
        ".agents",
        "skills",
        "rocky.core",
        "SKILL.md"
      ),
      "utf8"
    );
    assert.match(coreSkill, /Skill ID: rocky\.core/);
    assert.doesNotMatch(coreSkill, /visual-report|delegated|위임|내부 에이전트|라우터/);
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

test("rocky chat refreshes Rocky Core status from the backing run", async () => {
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
      summary: "Rocky Core가 작업을 정리했습니다.",
    };

    const refreshedResponse = await server.inject({
      method: "GET",
      url: `/rocky/chats/${chat.id}`,
    });
    assert.equal(refreshedResponse.statusCode, 200);
    const refreshed = refreshedResponse.json<RockyChatRecord>();
    assert.equal(refreshed.orchestration?.status, "completed");
    assert.equal(refreshed.orchestration?.output, "Rocky Core가 작업을 정리했습니다.");
    assert.equal(refreshed.messages[1]?.text, "Rocky Core가 작업을 정리했습니다.");
    assert.equal(refreshed.dispatches[0]?.orchestration?.status, "completed");
    assert.equal(refreshed.dispatches[0]?.orchestration?.endedAt, "2026-04-21T00:01:00.000Z");
  } finally {
    await server.close();
  }
});

test("rocky chat refresh prefers final run result over interim assistant transcript", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { runs, server, transcriptOverrides } =
    createRockyChatTestServer(stateRoot);

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "요청 파일을 확인해서 최종 답변해줘.",
      },
    });
    assert.equal(response.statusCode, 201);
    const chat = response.json<RockyChatRecord>();
    const runId = chat.dispatches[0]?.orchestration?.runId;
    const sessionId = chat.dispatches[0]?.orchestration?.sessionId;
    assert.ok(runId);
    assert.ok(sessionId);

    transcriptOverrides.set(sessionId, [
      {
        id: "assistant-interim",
        sessionId,
        runId,
        role: "assistant",
        content:
          "요청 파일만 확인해서 이 턴의 메타데이터와 원문 요청을 맞춘 뒤 답하겠습니다.",
        source: "item.completed",
        createdAt: "2026-04-21T00:00:30.000Z",
      },
    ]);
    runs[0] = {
      ...runs[0]!,
      status: "completed",
      endedAt: "2026-04-21T00:01:00.000Z",
      summary: "최종 답변입니다.",
    };

    const refreshedResponse = await server.inject({
      method: "GET",
      url: `/rocky/chats/${chat.id}`,
    });
    assert.equal(refreshedResponse.statusCode, 200);
    const refreshed = refreshedResponse.json<RockyChatRecord>();
    assert.equal(refreshed.orchestration?.status, "completed");
    assert.equal(refreshed.orchestration?.output, "최종 답변입니다.");
    assert.equal(refreshed.messages[1]?.text, "최종 답변입니다.");
  } finally {
    await server.close();
  }
});

test("rocky chat refresh repairs terminal interim output from the run result", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { runs, server, transcriptOverrides } =
    createRockyChatTestServer(stateRoot);

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "최종 답변을 저장해줘.",
      },
    });
    assert.equal(response.statusCode, 201);
    const chat = response.json<RockyChatRecord>();
    const runId = chat.dispatches[0]?.orchestration?.runId;
    const sessionId = chat.dispatches[0]?.orchestration?.sessionId;
    assert.ok(runId);
    assert.ok(sessionId);

    transcriptOverrides.set(sessionId, [
      {
        id: "assistant-interim",
        sessionId,
        runId,
        role: "assistant",
        content: "중간 진행 내용입니다.",
        source: "item.completed",
        createdAt: "2026-04-21T00:00:30.000Z",
      },
    ]);
    runs[0] = {
      ...runs[0]!,
      status: "completed",
      endedAt: "2026-04-21T00:01:00.000Z",
      summary: "진짜 최종 답변입니다.",
    };

    const staleChat: RockyChatRecord = {
      ...chat,
      messages: chat.messages.map((message) =>
        message.role === "rocky"
          ? { ...message, text: "중간 진행 내용입니다." }
          : message
      ),
      dispatches: chat.dispatches.map((dispatch) =>
        dispatch.orchestration
          ? {
              ...dispatch,
              orchestration: {
                ...dispatch.orchestration,
                status: "completed",
                output: "중간 진행 내용입니다.",
                endedAt: "2026-04-21T00:01:00.000Z",
                updatedAt: "2026-04-21T00:01:00.000Z",
              },
            }
          : dispatch
      ),
      orchestration: chat.orchestration
        ? {
            ...chat.orchestration,
            status: "completed",
            output: "중간 진행 내용입니다.",
            endedAt: "2026-04-21T00:01:00.000Z",
            updatedAt: "2026-04-21T00:01:00.000Z",
          }
        : null,
    };
    await writeFile(
      path.join(stateRoot, "rocky-chat", "chats", chat.id, "chat.json"),
      JSON.stringify(staleChat, null, 2),
      "utf8"
    );

    const refreshedResponse = await server.inject({
      method: "GET",
      url: `/rocky/chats/${chat.id}`,
    });
    assert.equal(refreshedResponse.statusCode, 200);
    const refreshed = refreshedResponse.json<RockyChatRecord>();
    assert.equal(refreshed.orchestration?.status, "completed");
    assert.equal(refreshed.orchestration?.output, "진짜 최종 답변입니다.");
    assert.equal(refreshed.messages[1]?.text, "진짜 최종 답변입니다.");
  } finally {
    await server.close();
  }
});
