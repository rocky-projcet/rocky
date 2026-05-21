import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";
import {
  ROCKY_AGENT_REQUEST_CONTEXT_DIR,
  rockyTaskOutputDirectory,
} from "../../src/rocky-chat/rocky-agent-skill-workspace.js";

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
import { EcountSettingsService } from "../../src/integrations/ecount-settings-service.js";
import type { EcountLookupServiceLike } from "../../src/integrations/ecount-connection-service.js";
import type {
  ConnectorBrowserDetector,
} from "../../src/connectors/connector-service.js";
import type { ConnectorBrowserDraftPublisher } from "../../src/connectors/browser-draft-publisher.js";
import type {
  ConnectorBrowserFollowerListReader,
  ConnectorBrowserProfileReader,
} from "../../src/connectors/browser-profile-reader.js";

const INSTAGRAM_GRAPH_ENV = {
  ROCKY_CONNECTOR_INSTAGRAM_ACCOUNT_KIND: "professional_creator",
  ROCKY_CONNECTOR_INSTAGRAM_GRAPH_ACCESS_TOKEN: "instagram-graph-secret",
  ROCKY_CONNECTOR_INSTAGRAM_BUSINESS_ACCOUNT_ID: "17841400000000001",
  ROCKY_CONNECTOR_INSTAGRAM_FACEBOOK_PAGE_ID: "112233445566",
  ROCKY_CONNECTOR_INSTAGRAM_META_BUSINESS_ID: "998877665544",
  ROCKY_CONNECTOR_INSTAGRAM_META_APP_ID: "123456789",
  ROCKY_CONNECTOR_INSTAGRAM_GRAPH_PERMISSIONS:
    "instagram_basic pages_show_list instagram_content_publish instagram_manage_insights",
};

function buildAgent(input: Partial<AgentRecord> = {}): AgentRecord {
  const now = "2026-04-21T00:00:00.000Z";
  return {
    id: input.id ?? "rocky-core",
    name: input.name ?? "Rocky",
    description: input.description ?? "",
    soul: input.soul ?? null,
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
    skillPolicy: input.skillPolicy ?? {
      automaticSkillCreation: false,
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

function createRockyChatTestServer(
  stateRoot: string,
  options: {
    ecountLookupService?: EcountLookupServiceLike;
    connectorBrowserDetector?: ConnectorBrowserDetector;
    connectorBrowserDraftPublisher?: ConnectorBrowserDraftPublisher;
    connectorBrowserProfileReader?: ConnectorBrowserProfileReader;
    connectorBrowserFollowerListReader?: ConnectorBrowserFollowerListReader;
    connectorBaseEnv?: NodeJS.ProcessEnv;
  } = {}
) {
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
    now: () => "2026-04-21T00:00:00.000Z",
    ecountLookupService: options.ecountLookupService,
    connectorBaseEnv: options.connectorBaseEnv,
    connectorBrowserDetector: options.connectorBrowserDetector,
    connectorBrowserDraftPublisher: options.connectorBrowserDraftPublisher,
    connectorBrowserProfileReader: options.connectorBrowserProfileReader,
    connectorBrowserFollowerListReader: options.connectorBrowserFollowerListReader,
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
          id: `session-${createSessionCalls.length}`,
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

test("rocky template interview turn waits for Rocky Core without early draft", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { completedRunSummaries, runs, sendTurnCalls, server } =
    createRockyChatTestServer(stateRoot);
  completedRunSummaries.push(
    JSON.stringify({
      summary: "업무 의도를 이해했습니다.",
      nextStepId: "inputs",
      draft: null,
    })
  );

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
    assert.equal(result.source, "agent");
    assert.equal(result.agent.status, "completed");
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

test("rocky template interview final draft preserves video generation intent", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { completedRunSummaries, sendTurnCalls, server } =
    createRockyChatTestServer(stateRoot);
  completedRunSummaries.push(
    JSON.stringify({
      summary: "Rocky가 유튜브 쇼츠 영상 생성 템플릿 초안을 만들었습니다.",
      nextStepId: "review",
      draft: {
        category: "content",
        title: "유튜브 쇼츠 영상 생성",
        description: "콘티를 바탕으로 유튜브 쇼츠용 영상을 생성합니다.",
        triggerLabel: "유튜브 쇼츠 영상 생성",
        requiredInputs: ["콘티", "채널명", "영상 길이", "제품 정보"],
        outputFormatLabel: "쇼츠용 영상 파일",
        defaultInstructions:
          "콘티를 우선 확인하고 쇼츠 규격에 맞는 영상 파일 결과물을 생성합니다.",
      },
    })
  );

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/template-interview/turn",
      payload: {
        stepId: "rules",
        answer: "없음",
        answers: [
          {
            stepId: "intent",
            answer: "유튜브 쇼츠 영상 생성",
          },
          {
            stepId: "inputs",
            answer: "콘티",
          },
          {
            stepId: "output",
            answer: "쇼츠용 영상 파일",
          },
        ],
      },
    });
    assert.equal(response.statusCode, 200);
    const result = response.json();

    assert.equal(result.source, "agent");
    assert.equal(result.draft.title, "유튜브 쇼츠 영상 생성");
    assert.equal(result.draft.triggerLabel, "유튜브 쇼츠 영상 생성");
    assert.equal(result.draft.outputFormatLabel, "쇼츠용 영상 파일");
    assert.deepEqual(result.draft.requiredInputs, [
      "콘티",
      "채널명",
      "영상 길이",
      "제품 정보",
    ]);
    assert.match(sendTurnCalls[0]?.prompt ?? "", /임의로 일반화하거나 다른 업무로 바꾸지 않습니다/u);
    assert.match(sendTurnCalls[0]?.prompt ?? "", /쇼츠용 영상 파일/u);
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
    assert.match(
      chat.attachments[0]?.workspacePath ?? "",
      new RegExp(`^inputs/${chat.id}/attachment-`, "u")
    );
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
    assert.match(requestContext, new RegExp(`task_input_dir: inputs/${chat.id}`, "u"));
    assert.match(
      requestContext,
      new RegExp(`task_output_dir: outputs/${chat.id}`, "u")
    );
    assert.match(
      requestContext,
      new RegExp(`workspace path: inputs/${chat.id}/attachment-`, "u")
    );
    await access(path.join(agents[0]!.workspaceRoot, rockyTaskOutputDirectory(chat.id)));
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

test("rocky chat routes agent detail requests through the selected agent", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const {
    agents,
    createSessionCalls,
    runs,
    sendTurnCalls,
    server,
    sessions,
  } = createRockyChatTestServer(stateRoot);
  const workspaceRoot = path.join(
    stateRoot,
    "agent-workspaces",
    "smart-factory",
    "workspace"
  );
  const runtimeHome = path.join(
    stateRoot,
    "agent-workspaces",
    "smart-factory",
    "runtime-home"
  );
  agents.push(
    buildAgent({
      id: "smart-factory",
      name: "스마트팩토리 비서",
      description: "제조 현장과 특허 리서치 요청을 처리합니다.",
      workspaceRoot,
      runtimeHome,
    })
  );
  const patentSkillRoot = path.join(
    workspaceRoot,
    ".agents",
    "skills",
    "md-document-1rhh6bd"
  );
  await mkdir(patentSkillRoot, { recursive: true });
  await writeFile(
    path.join(patentSkillRoot, "SKILL.md"),
    [
      "---",
      "name: md-document-1rhh6bd",
      'description: "특허 리서치 업무를 정리합니다."',
      "---",
      "",
      "# 특허 리서치",
      "",
    ].join("\n")
  );
  const packagedInputRoot = path.join(
    patentSkillRoot,
    "assets",
    "inputs",
    "datasets",
    "upload-001"
  );
  await mkdir(packagedInputRoot, { recursive: true });
  await writeFile(
    path.join(packagedInputRoot, "prior-art.xlsx"),
    "placeholder"
  );

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "특허 준비하려고 하는데 뭐 부터 해야할까?",
        agentId: "smart-factory",
        skillId: "md-document-1rhh6bd",
      },
    });
    assert.equal(response.statusCode, 201);
    const chat = response.json<RockyChatRecord>();
    assert.equal(chat.worker?.displayName, "스마트팩토리 비서");
    assert.equal(chat.worker?.skillId, "agent.smart-factory");
    assert.equal(chat.worker?.agentId, "smart-factory");
    assert.equal(chat.dispatches.length, 1);
    assert.equal(chat.dispatches[0]?.skillId, "agent.smart-factory");
    assert.equal(chat.dispatches[0]?.orchestration?.agentId, "smart-factory");
    assert.equal(chat.dispatches[0]?.orchestration?.sessionId, "session-1");
    assert.equal(chat.dispatches[0]?.orchestration?.runId, "run-1");
    assert.equal(agents.length, 1);
    assert.deepEqual(agents.map((agent) => agent.id), ["smart-factory"]);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.agentId, "smart-factory");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.agentId, "smart-factory");
    assert.equal(createSessionCalls.length, 1);
    assert.equal(createSessionCalls[0]?.agentId, "smart-factory");
    assert.equal(createSessionCalls[0]?.runtimeKind, undefined);
    assert.equal(sendTurnCalls.length, 1);
    assert.equal(chat.messages[0]?.text, "특허 준비하려고 하는데 뭐 부터 해야할까?");
    assert.doesNotMatch(chat.messages[0]?.text ?? "", /Rocky 스킬 실행|\$/u);
    assert.deepEqual(chat.messages[1]?.usedSkills, [
      {
        id: "md-document-1rhh6bd",
        displayName: "특허 리서치",
      },
    ]);
    assert.match(
      sendTurnCalls[0]?.prompt ?? "",
      /^\$md-document-1rhh6bd\n\n특허 준비하려고 하는데 뭐 부터 해야할까\?/u
    );
    assert.doesNotMatch(
      sendTurnCalls[0]?.prompt ?? "",
      /Rocky 스킬 실행|호출명|목표/u
    );
    assert.match(
      sendTurnCalls[0]?.extraSystemInstructions[0] ?? "",
      /"스마트팩토리 비서" agent/u
    );
    assert.doesNotMatch(
      sendTurnCalls[0]?.extraSystemInstructions.join("\n") ?? "",
      /Rocky Core instructions|rocky\.core/u
    );
    assert.match(
      sendTurnCalls[0]?.extraSystemInstructions.join("\n") ?? "",
      /answer only with this agent's installed skill display names/u
    );
    assert.match(
      sendTurnCalls[0]?.extraSystemInstructions.join("\n") ?? "",
      /rocky-used-skills/u
    );
    const contextPath =
      sendTurnCalls[0]?.extraSystemInstructions
        .find((instruction) => instruction.includes(ROCKY_AGENT_REQUEST_CONTEXT_DIR))
        ?.match(/`([^`]+)`/)?.[1] ??
      `${ROCKY_AGENT_REQUEST_CONTEXT_DIR}/${chat.dispatches[0]!.id}.md`;
    const agentContext = await readFile(
      path.join(workspaceRoot, contextPath),
      "utf8"
    );
    assert.match(agentContext, /Execution mode: agent session/u);
    assert.match(agentContext, /Agent ID: smart-factory/u);
    assert.match(agentContext, /스킬 포함 파일:/u);
    assert.match(agentContext, /prior-art\.xlsx \(스킬: 특허 리서치\)/u);
    assert.doesNotMatch(agentContext, /assets\/inputs/u);

    const followUp = await server.inject({
      method: "POST",
      url: `/rocky/chats/${chat.id}/messages`,
      payload: {
        message: "계속 같은 에이전트에서 이어서 답해줘.",
      },
    });
    assert.equal(followUp.statusCode, 201);
    const updated = followUp.json<RockyChatRecord>();
    assert.equal(updated.worker?.agentId, "smart-factory");
    assert.equal(updated.dispatches[1]?.skillId, "agent.smart-factory");
    assert.equal(updated.dispatches[1]?.orchestration?.agentId, "smart-factory");
    assert.equal(updated.dispatches[1]?.orchestration?.sessionId, "session-1");
    assert.equal(updated.dispatches[1]?.orchestration?.runId, "run-2");
    assert.equal(agents.length, 1);
    assert.equal(sessions.length, 1);
    assert.equal(runs.length, 2);
    assert.equal(sendTurnCalls.length, 2);
    assert.equal(sendTurnCalls[1]?.sessionId, "session-1");
  } finally {
    await server.close();
  }
});

test("rocky chat prepares ECOUNT lookup files for agent ECOUNT skills", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-ecount-"));
  const settings = new EcountSettingsService({
    stateRoot,
    now: () => "2026-04-21T00:00:00.000Z",
  });
  await settings.saveSettings({
    accountLabel: "본사 이카운트",
    comCode: "123456",
    userId: "api-user",
    apiCertKey: "test-secret-key",
    zone: "CC",
    checkedAt: "2026-04-21T00:00:00.000Z",
  });

  const ecountLookupCalls: Array<{ limit?: number | null; offset?: number | null }> = [];
  const {
    agents,
    sendTurnCalls,
    server,
  } = createRockyChatTestServer(stateRoot, {
    ecountLookupService: {
      async getBasicProductsList(_input, options) {
        ecountLookupCalls.push({
          limit: options?.limit ?? null,
          offset: options?.offset ?? null,
        });
        return {
          ok: true,
          status: "connected",
          accountLabel: "본사 이카운트",
          zone: "CC",
          checkedAt: "2026-04-21T00:00:00.000Z",
          api: "InventoryBasic/GetBasicProductsList",
          count: 2,
          returnedCount: 2,
          products: [
            {
              code: "P-001",
              name: "테스트 품목",
              spec: "BOX",
              unit: "EA",
              raw: {
                PROD_CD: "P-001",
                PROD_DES: "테스트 품목",
                SIZE_DES: "BOX",
                UNIT: "EA",
              },
            },
            {
              code: "P-002",
              name: "두번째 품목",
              spec: null,
              unit: null,
              raw: {
                PROD_CD: "P-002",
                PROD_DES: "두번째 품목",
              },
            },
          ],
          message: "ECOUNT product lookup returned 2 product(s).",
        };
      },
    },
  });
  const workspaceRoot = path.join(stateRoot, "agents", "erp-agent", "workspace");
  agents.push(buildAgent({
    id: "erp-agent",
    name: "ERP 비서",
    workspaceRoot,
    runtimeHome: path.join(stateRoot, "agents", "erp-agent", "runtime-home"),
  }));
  const skillRoot = path.join(workspaceRoot, ".agents", "skills", "md-erp-test");
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    path.join(skillRoot, "SKILL.md"),
    [
      "---",
      "name: md-erp-test",
      'description: "ECOUNT ERP 조회와 분석"',
      "---",
      "",
      "# 이카운트 ERP 매출 분석",
      "",
      "## Integration Rules",
      "- ECOUNT ERP는 조회와 분석만 허용합니다.",
      "",
    ].join("\n"),
    "utf8"
  );

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "품목 조회해줘",
        agentId: "erp-agent",
        skillId: "md-erp-test",
      },
    });

    assert.equal(response.statusCode, 201);
    assert.deepEqual(ecountLookupCalls, [{ limit: null, offset: null }]);
    assert.equal(sendTurnCalls.length, 1);
    const instructions = sendTurnCalls[0]?.extraSystemInstructions.join("\n") ?? "";
    assert.match(instructions, /ECOUNT ERP lookup integration is configured/u);
    assert.match(instructions, /Do not call localhost, 127\.0\.0\.1/u);
    assert.doesNotMatch(instructions, /curl -sS -X POST/u);
    assert.doesNotMatch(instructions, /integrations\/ecount\/products/u);
    assert.doesNotMatch(instructions, /test-secret-key|123456|api-user/u);

    const contextPath =
      sendTurnCalls[0]?.extraSystemInstructions
        .find((instruction) => instruction.includes(ROCKY_AGENT_REQUEST_CONTEXT_DIR))
        ?.match(/`([^`]+)`/)?.[1] ??
      `${ROCKY_AGENT_REQUEST_CONTEXT_DIR}/missing.md`;
    const agentContext = await readFile(path.join(workspaceRoot, contextPath), "utf8");
    assert.match(agentContext, /연동 조회 결과:/u);
    assert.match(agentContext, /ECOUNT ERP 품목 조회: ready/u);
    assert.match(agentContext, /inputs\/rocky-chat-/u);
    assert.doesNotMatch(agentContext, /test-secret-key|123456|api-user/u);

    const fileMatch = agentContext.match(/file=([^,)]+)/u);
    assert.ok(fileMatch?.[1]);
    const prepared = JSON.parse(
      await readFile(path.join(workspaceRoot, ...fileMatch[1]!.split("/")), "utf8")
    ) as { count: number; returnedCount: number; records: Array<{ code: string }> };
    assert.equal(prepared.count, 2);
    assert.equal(prepared.returnedCount, 2);
    assert.deepEqual(prepared.records.map((record) => record.code), ["P-001", "P-002"]);
  } finally {
    await server.close();
  }
});

test("rocky chat prepares selected ECOUNT skill scope on proceed requests", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-ecount-scope-"));
  const settings = new EcountSettingsService({
    stateRoot,
    now: () => "2026-04-21T00:00:00.000Z",
  });
  await settings.saveSettings({
    accountLabel: "본사 이카운트",
    comCode: "123456",
    userId: "api-user",
    apiCertKey: "test-secret-key",
    zone: "CC",
    checkedAt: "2026-04-21T00:00:00.000Z",
  });

  const queriedDatasets: string[] = [];
  const readyDatasets = new Set(["products", "inventory", "warehouseInventory", "purchases"]);
  const {
    agents,
    sendTurnCalls,
    server,
  } = createRockyChatTestServer(stateRoot, {
    ecountLookupService: {
      async getBasicProductsList() {
        throw new Error("standard queryDataset should be used.");
      },
      async queryDataset(_input, query) {
        queriedDatasets.push(String(query.dataset));
        const ready = readyDatasets.has(String(query.dataset));
        return {
          ok: ready,
          provider: "ecount",
          dataset: String(query.dataset),
          title: `ECOUNT ERP ${query.dataset} 조회`,
          status: ready ? "ready" : "unsupported",
          accountLabel: "본사 이카운트",
          zone: "CC",
          checkedAt: "2026-04-21T00:00:00.000Z",
          api:
            query.dataset === "products"
              ? "InventoryBasic/GetBasicProductsList"
              : query.dataset === "purchases"
                ? "Purchases/GetPurchasesOrderList"
                : query.dataset === "inventory" || query.dataset === "warehouseInventory"
                  ? "InventoryBalance/GetListInventoryBalanceStatusByLocation"
                  : null,
          count: ready ? 1 : 0,
          returnedCount: ready ? 1 : 0,
          records:
            query.dataset === "products"
              ? [
                  {
                    code: "P-001",
                    name: "테스트 품목",
                  },
                ]
              : query.dataset === "purchases"
                ? [
                    {
                      orderNo: "PO-001",
                    },
                  ]
                : ready
                  ? [
                      {
                        code: String(query.dataset),
                      },
                    ]
                  : [],
          message:
            query.dataset === "products"
              ? "ECOUNT product lookup returned 1 product(s)."
              : ready
                ? `ECOUNT ${query.dataset} lookup returned 1 record(s).`
                : `ECOUNT ${query.dataset} lookup is not supported by the current read-only backend.`,
          diagnostics:
            ready
              ? undefined
              : {
                  stage: "capability",
                  detail: "not implemented",
                },
        };
      },
    },
  });
  const workspaceRoot = path.join(stateRoot, "agents", "erp-agent", "workspace");
  agents.push(buildAgent({
    id: "erp-agent",
    name: "ERP 비서",
    workspaceRoot,
    runtimeHome: path.join(stateRoot, "agents", "erp-agent", "runtime-home"),
  }));
  const skillRoot = path.join(workspaceRoot, ".agents", "skills", "md-erp-test");
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    path.join(skillRoot, "SKILL.md"),
    [
      "---",
      "name: md-erp-test",
      'description: "ECOUNT ERP 매출 분석"',
      "---",
      "",
      "# 이카운트 ERP 매출 분석",
      "",
      "## Quality Rules",
      "- ERP 데이터 범위: 품목, 재고현황, 거래처, 판매, 창고별 재고, 주문서, 구매, 매출·매입",
      "- 조회 기간 또는 기준: 최근 30일",
      "",
    ].join("\n"),
    "utf8"
  );

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "진행해줘",
        agentId: "erp-agent",
        skillId: "md-erp-test",
      },
    });

    assert.equal(response.statusCode, 201);
    assert.deepEqual(queriedDatasets, [
      "products",
      "inventory",
      "customers",
      "sales",
      "warehouseInventory",
      "orders",
      "purchases",
      "accounting",
    ]);
    assert.equal(sendTurnCalls.length, 1);
    const contextPath =
      sendTurnCalls[0]?.extraSystemInstructions
        .find((instruction) => instruction.includes(ROCKY_AGENT_REQUEST_CONTEXT_DIR))
        ?.match(/`([^`]+)`/)?.[1] ??
      `${ROCKY_AGENT_REQUEST_CONTEXT_DIR}/missing.md`;
    const agentContext = await readFile(path.join(workspaceRoot, contextPath), "utf8");
    assert.match(agentContext, /ECOUNT ERP products 조회: ready/u);
    assert.match(agentContext, /ECOUNT ERP purchases 조회: ready/u);
    assert.match(agentContext, /ECOUNT ERP sales 조회: unsupported/u);
    assert.match(agentContext, /inputs\/rocky-chat-.*\/integrations\/ecount\/products\.json/u);
    assert.match(agentContext, /inputs\/rocky-chat-.*\/integrations\/ecount\/purchases\.json/u);
    assert.match(agentContext, /inputs\/rocky-chat-.*\/integrations\/ecount\/sales\.json/u);

    const preparedProducts = JSON.parse(
      await readFile(
        path.join(
          workspaceRoot,
          "inputs",
          response.json().id,
          "integrations",
          "ecount",
          "products.json"
        ),
        "utf8"
      )
    ) as { status: string; records: Array<{ code: string }> };
    assert.equal(preparedProducts.status, "ready");
    assert.deepEqual(preparedProducts.records.map((record) => record.code), ["P-001"]);
  } finally {
    await server.close();
  }
});

test("rocky chat reports used agent skills without exposing internal ids", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const {
    agents,
    completedRunSummaries,
    sendTurnCalls,
    server,
  } = createRockyChatTestServer(stateRoot);
  const workspaceRoot = path.join(
    stateRoot,
    "agent-workspaces",
    "blog-agent",
    "workspace"
  );
  const runtimeHome = path.join(
    stateRoot,
    "agent-workspaces",
    "blog-agent",
    "runtime-home"
  );
  agents.push(
    buildAgent({
      id: "blog-agent",
      name: "블로그 비서",
      description: "블로그 글 작성을 돕습니다.",
      workspaceRoot,
      runtimeHome,
    })
  );
  const blogSkillRoot = path.join(
    workspaceRoot,
    ".agents",
    "skills",
    "md-content-0m8fbwf"
  );
  await mkdir(blogSkillRoot, { recursive: true });
  await writeFile(
    path.join(blogSkillRoot, "SKILL.md"),
    [
      "---",
      "name: md-content-0m8fbwf",
      'description: "네이버 블로그 콘텐츠 초안을 작성합니다."',
      "---",
      "",
      "# 블로그 · 네이버 블로그 콘텐츠",
      "",
    ].join("\n")
  );
  completedRunSummaries.push(
    [
      "오늘 작업 내용을 보내주시면 블로그 글 구조로 정리해드릴게요.",
      "",
      '<!-- rocky-used-skills: ["블로그 · 네이버 블로그 콘텐츠"] -->',
    ].join("\n")
  );

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "오늘 작업한거 블로그로 작성하려고 하는데 어떻게 하면 될까?",
        agentId: "blog-agent",
      },
    });
    assert.equal(response.statusCode, 201);
    const created = response.json<RockyChatRecord>();
    const refreshedResponse = await server.inject({
      method: "GET",
      url: `/rocky/chats/${created.id}`,
    });
    assert.equal(refreshedResponse.statusCode, 200);
    const chat = refreshedResponse.json<RockyChatRecord>();
    assert.equal(sendTurnCalls.length, 1);
    assert.doesNotMatch(sendTurnCalls[0]?.prompt ?? "", /^\$/u);
    assert.equal(
      chat.messages[1]?.text,
      "오늘 작업 내용을 보내주시면 블로그 글 구조로 정리해드릴게요."
    );
    assert.deepEqual(chat.messages[1]?.usedSkills, [
      {
        id: "md-content-0m8fbwf",
        displayName: "블로그 · 네이버 블로그 콘텐츠",
      },
    ]);
    assert.doesNotMatch(
      chat.messages[1]?.text ?? "",
      /rocky-used-skills|workspace-local|호출 ID|\$md-content|SKILL\.md|read-only|system/u
    );
  } finally {
    await server.close();
  }
});

test("rocky chat ignores stale Tistory context while keeping connected Threads context", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  await mkdir(path.join(stateRoot, "connectors", "tistory"), { recursive: true });
  await mkdir(path.join(stateRoot, "connectors", "threads"), { recursive: true });
  await writeFile(
    path.join(stateRoot, "connectors", "tistory", "browser-session.json"),
    JSON.stringify(
      {
        provider: "tistory",
        accountLabel: "Tistory 계정",
        connectedAt: "2026-05-09T14:09:16.248Z",
        storageStateJson: JSON.stringify({ cookies: [], origins: [] }),
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(stateRoot, "connectors", "threads", "browser-session.json"),
    JSON.stringify(
      {
        provider: "threads",
        accountLabel: "Threads 계정",
        connectedAt: "2026-05-10T11:30:00.000Z",
        storageStateJson: JSON.stringify({ cookies: [], origins: [] }),
      },
      null,
      2,
    ),
  );
  const { agents, completedRunSummaries, sendTurnCalls, server } =
    createRockyChatTestServer(stateRoot);
  const workspaceRoot = path.join(
    stateRoot,
    "agent-workspaces",
    "blog-agent",
    "workspace"
  );
  const runtimeHome = path.join(
    stateRoot,
    "agent-workspaces",
    "blog-agent",
    "runtime-home"
  );
  agents.push(
    buildAgent({
      id: "blog-agent",
      name: "블로그 비서",
      workspaceRoot,
      runtimeHome,
    })
  );
  completedRunSummaries.push("티스토리 임시저장 요청을 보냈습니다.");

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "티스토리에 올려줘",
        agentId: "blog-agent",
      },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(sendTurnCalls.length, 1);
    const contextPath =
      sendTurnCalls[0]?.extraSystemInstructions
        .find((instruction) => instruction.includes(ROCKY_AGENT_REQUEST_CONTEXT_DIR))
        ?.match(/`([^`]+)`/)?.[1] ??
      `${ROCKY_AGENT_REQUEST_CONTEXT_DIR}/missing.md`;
    const agentContext = await readFile(path.join(workspaceRoot, contextPath), "utf8");
    assert.match(agentContext, /계정 연동 상태/u);
    assert.doesNotMatch(agentContext, /Tistory:/u);
    assert.doesNotMatch(agentContext, /draft_publish=server-managed/u);
    assert.match(agentContext, /Threads: connected/u);
    assert.equal(
      sendTurnCalls[0]?.extraSystemInstructions.some((instruction) =>
        instruction.includes("Rocky server submits the Tistory draft after this turn")
      ),
      false
    );
    assert.ok(
      sendTurnCalls[0]?.extraSystemInstructions.some((instruction) =>
        instruction.includes("Rocky-managed account connectors may be connected")
      )
    );
    assert.equal(
      sendTurnCalls[0]?.extraSystemInstructions.some((instruction) =>
        instruction.includes("127.0.0.1:3000/connectors/tistory/publish-draft")
      ),
      false
    );
  } finally {
    await server.close();
  }
});

test("rocky chat does not attempt Tistory draft publish for read-only connector checks", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  await mkdir(path.join(stateRoot, "connectors", "tistory"), { recursive: true });
  await writeFile(
    path.join(stateRoot, "connectors", "tistory", "browser-session.json"),
    JSON.stringify(
      {
        provider: "tistory",
        accountLabel: "Tistory 계정",
        connectedAt: "2026-05-09T14:09:16.248Z",
        storageStateJson: JSON.stringify({ cookies: [], origins: [] }),
      },
      null,
      2,
    ),
  );

  const { agents, completedRunSummaries, server } =
    createRockyChatTestServer(stateRoot);
  const workspaceRoot = path.join(
    stateRoot,
    "agent-workspaces",
    "blog-agent",
    "workspace"
  );
  const runtimeHome = path.join(
    stateRoot,
    "agent-workspaces",
    "blog-agent",
    "runtime-home"
  );
  agents.push(
    buildAgent({
      id: "blog-agent",
      name: "블로그 비서",
      workspaceRoot,
      runtimeHome,
    })
  );
  completedRunSummaries.push(
    "Tistory 연동은 연결되어 있고, 게시 기능은 별도 승인 후에만 실행됩니다."
  );

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "티스토리 연동 목록을 확인해줘. 게시나 수정은 하지 마.",
        agentId: "blog-agent",
      },
    });
    assert.equal(response.statusCode, 201);
    const created = response.json<RockyChatRecord>();
    const refreshedResponse = await server.inject({
      method: "GET",
      url: `/rocky/chats/${created.id}`,
    });
    assert.equal(refreshedResponse.statusCode, 200);
    const refreshed = refreshedResponse.json<RockyChatRecord>();

    assert.doesNotMatch(refreshed.messages[1]?.text ?? "", /Tistory 발행 결과/u);
    assert.doesNotMatch(
      refreshed.messages[1]?.text ?? "",
      /rocky-tistory-draft-publish/u,
    );
  } finally {
    await server.close();
  }
});

test("rocky chat injects Threads skill capabilities for follower requests", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  await mkdir(path.join(stateRoot, "connectors", "threads"), { recursive: true });
  await writeFile(
    path.join(stateRoot, "connectors", "threads", "browser-session.json"),
    JSON.stringify(
      {
        provider: "threads",
        accountLabel: "64342357840",
        connectedAt: "2026-05-10T02:49:54.141Z",
        storageStateJson: JSON.stringify({ cookies: [], origins: [] }),
      },
      null,
      2,
    ),
  );

  let followerReaderCalls = 0;
  const { agents, completedRunSummaries, sendTurnCalls, server } =
    createRockyChatTestServer(stateRoot, {
      connectorBrowserDetector: async () => ({
        available: true,
        channel: "chromium",
        message: "Playwright 번들 Chromium 사용",
      }),
      connectorBrowserFollowerListReader: async (input) => {
        followerReaderCalls += 1;
        assert.equal(input.provider, "threads");
        assert.equal(input.accountLabel, "64342357840");
        assert.equal(input.limit, 200);
        return {
          ok: true,
          provider: "threads",
          status: "followers-read",
          accountLabel: input.accountLabel,
          followers: {
            items: [
              {
                username: "pixelberry",
                displayName: "Pixel Berry",
                profileUrl: "https://www.threads.net/@pixelberry",
                rawText: "Pixel Berry @pixelberry",
              },
            ],
            url: "https://www.threads.net/@rocky_threads/followers",
            rawText: "Pixel Berry\n@pixelberry",
          },
          message: "Threads 팔로워 1명을 연결된 브라우저 세션으로 조회했습니다.",
          checkedAt: input.now(),
        };
      },
    });
  const workspaceRoot = path.join(
    stateRoot,
    "agent-workspaces",
    "threads-agent",
    "workspace"
  );
  const runtimeHome = path.join(
    stateRoot,
    "agent-workspaces",
    "threads-agent",
    "runtime-home"
  );
  agents.push(
    buildAgent({
      id: "threads-agent",
      name: "Threads Agent",
      workspaceRoot,
      runtimeHome,
    })
  );
  const skillRoot = path.join(
    workspaceRoot,
    ".agents",
    "skills",
    "md-sns-threads"
  );
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    path.join(skillRoot, "SKILL.md"),
    "---\nname: md-sns-threads\n---\n# SNS · Threads 콘텐츠\n",
  );
  const templateResponse = await server.inject({
    method: "PUT",
    url: "/skills/template.threads",
    payload: {
      id: "template.threads",
      source: "user",
      category: "content",
      title: "SNS · Threads 콘텐츠",
      description: "Threads 콘텐츠와 계정 상태를 확인합니다.",
      triggerLabel: "Threads",
      requiredInputs: ["요청"],
      outputFormatLabel: "텍스트",
      defaultInstructions: "Threads 요청을 처리합니다.",
      skill: {
        id: "md-sns-threads",
        displayName: "SNS · Threads 콘텐츠",
        description: "Use when the user asks for Threads content or account checks.",
        invocation: "$md-sns-threads",
        skillMarkdown: "---\nname: md-sns-threads\n---\n# SNS · Threads 콘텐츠\n",
        openAiYaml: [
          "interface:",
          '  display_name: "SNS · Threads 콘텐츠"',
          '  short_description: "Threads 콘텐츠와 계정 상태를 확인합니다."',
          '  default_prompt: "Use $md-sns-threads for Threads requests."',
          "",
        ].join("\n"),
        syncStatus: "local",
        workspacePath: null,
      },
      sortOrder: 1,
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:01:00.000Z",
    },
  });
  assert.equal(templateResponse.statusCode, 200);
  completedRunSummaries.push("Threads 팔로워 목록을 확인했습니다.");

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "팔로워 확인해줘",
        agentId: "threads-agent",
      },
    });
    assert.equal(response.statusCode, 201);
    const created = response.json<RockyChatRecord>();
    assert.equal(sendTurnCalls.length, 1);
    const contextPath =
      sendTurnCalls[0]?.extraSystemInstructions
        .find((instruction) => instruction.includes(ROCKY_AGENT_REQUEST_CONTEXT_DIR))
        ?.match(/`([^`]+)`/)?.[1] ??
      `${ROCKY_AGENT_REQUEST_CONTEXT_DIR}/missing.md`;
    const agentContext = await readFile(path.join(workspaceRoot, contextPath), "utf8");
    assert.match(agentContext, /계정 연동 상태/u);
    assert.match(agentContext, /연동 조회 결과/u);
    assert.match(agentContext, /Threads 팔로워 목록: ready/u);
    assert.match(
      agentContext,
      /file=inputs\/rocky-chat-.*\/integrations\/threads\/followers\.json/u,
    );
    assert.match(agentContext, /Threads: connected/u);
    assert.match(agentContext, /threads\.automation\.prepare:read:status=available/u);
    assert.match(agentContext, /usage=node scripts\/threads-crud\.mjs prepare/u);
    assert.match(
      agentContext,
      /threads\.followers\.read:read:status=available:skill_id=md-sns-threads:skill=SNS · Threads 콘텐츠:script=scripts\/threads-crud\.mjs/u,
    );
    await access(path.join(skillRoot, "connector-capabilities.json"));
    await access(path.join(skillRoot, "scripts", "threads-crud.mjs"));
    const followerLookupPath = path.join(
      workspaceRoot,
      "inputs",
      created.id,
      "integrations",
      "threads",
      "followers.json"
    );
    const followerLookup = JSON.parse(await readFile(followerLookupPath, "utf8"));
    assert.equal(followerLookup.followers[0]?.username, "pixelberry");
    assert.equal(followerReaderCalls, 1);
    assert.doesNotMatch(agentContext, /Threads: ready/u);
    assert.ok(
      sendTurnCalls[0]?.extraSystemInstructions.some((instruction) =>
        instruction.includes("Prepared integration lookup or readiness results may be listed")
      )
    );
  } finally {
    await server.close();
  }
});

test("rocky chat prepares Instagram automation readiness for Instagram requests", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  await mkdir(path.join(stateRoot, "connectors", "instagram"), { recursive: true });
  await writeFile(
    path.join(stateRoot, "connectors", "instagram", "browser-session.json"),
    JSON.stringify(
      {
        provider: "instagram",
        accountLabel: "Instagram account",
        connectedAt: "2026-05-11T08:15:00.000Z",
        storageStateJson: JSON.stringify({
          cookies: [
            {
              name: "sessionid",
              value: "instagram-session-secret",
              domain: ".instagram.com",
              path: "/",
            },
          ],
          origins: [],
        }),
      },
      null,
      2,
    ),
  );

  const { agents, completedRunSummaries, sendTurnCalls, server } =
    createRockyChatTestServer(stateRoot, {
      connectorBaseEnv: INSTAGRAM_GRAPH_ENV,
      connectorBrowserDetector: async () => {
        throw new Error("Instagram Graph API readiness must not launch a browser");
      },
    });
  const workspaceRoot = path.join(
    stateRoot,
    "agent-workspaces",
    "instagram-agent",
    "workspace"
  );
  const runtimeHome = path.join(
    stateRoot,
    "agent-workspaces",
    "instagram-agent",
    "runtime-home"
  );
  agents.push(
    buildAgent({
      id: "instagram-agent",
      name: "Instagram Agent",
      workspaceRoot,
      runtimeHome,
    })
  );
  completedRunSummaries.push("Instagram readiness checked.");

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "Prepare Instagram reel automation.",
        agentId: "instagram-agent",
      },
    });
    assert.equal(response.statusCode, 201);
    const created = response.json<RockyChatRecord>();
    assert.equal(sendTurnCalls.length, 1);
    const contextPath =
      sendTurnCalls[0]?.extraSystemInstructions
        .find((instruction) => instruction.includes(ROCKY_AGENT_REQUEST_CONTEXT_DIR))
        ?.match(/`([^`]+)`/)?.[1] ??
      `${ROCKY_AGENT_REQUEST_CONTEXT_DIR}/missing.md`;
    const agentContext = await readFile(path.join(workspaceRoot, contextPath), "utf8");
    assert.match(agentContext, /Instagram automation readiness: ready/u);
    assert.match(
      agentContext,
      /file=inputs\/rocky-chat-.*\/integrations\/instagram\/automation-readiness\.json/u,
    );
    assert.match(agentContext, /Instagram: connected/u);
    assert.match(agentContext, /instagram\.automation\.prepare:read:status=available/u);
    assert.match(agentContext, /instagram\.media\.publish:write:approval:status=available:setup=graph-api/u);
    assert.doesNotMatch(agentContext, /instagram-session-secret|sessionid|browser-profile/u);

    const readinessPath = path.join(
      workspaceRoot,
      "inputs",
      created.id,
      "integrations",
      "instagram",
      "automation-readiness.json"
    );
    const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
    assert.equal(readiness.ok, true);
    assert.equal(readiness.status, "completed");
    assert.equal(readiness.accountLabel, "Instagram Graph account 17841400000000001");
    assert.match(readiness.message, /instagram\.automation\.prepare/u);
    assert.doesNotMatch(JSON.stringify(readiness), /instagram-session-secret|sessionid|instagram-graph-secret/u);
    assert.ok(
      sendTurnCalls[0]?.extraSystemInstructions.some((instruction) =>
        instruction.includes("Prepared integration lookup or readiness results may be listed")
      )
    );
  } finally {
    await server.close();
  }
});

test("rocky chat injects Facebook profile capability for account checks", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  await mkdir(path.join(stateRoot, "connectors", "facebook"), { recursive: true });
  await writeFile(
    path.join(stateRoot, "connectors", "facebook", "browser-session.json"),
    JSON.stringify(
      {
        provider: "facebook",
        accountLabel: "Facebook account",
        connectedAt: "2026-05-12T10:00:00.000Z",
        storageStateJson: JSON.stringify({ cookies: [], origins: [] }),
      },
      null,
      2,
    ),
  );

  let profileReaderCalls = 0;
  const { completedRunSummaries, sendTurnCalls, server } =
    createRockyChatTestServer(stateRoot, {
      connectorBrowserDetector: async () => ({
        available: true,
        channel: "chromium",
        message: "Playwright bundled Chromium available",
      }),
      connectorBrowserProfileReader: async (input) => {
        profileReaderCalls += 1;
        assert.equal(input.provider, "facebook");
        assert.equal(input.accountLabel, "Facebook account");
        return {
          ok: true,
          provider: "facebook",
          status: "profile-read",
          accountLabel: input.accountLabel,
          profile: {
            id: "1234567890",
            username: "rocky.facebook",
            displayName: "Rocky Facebook",
            bio: "Facebook connector test profile",
            followersText: null,
            url: "https://www.facebook.com/rocky.facebook",
            rawText: null,
          },
          message: "Facebook profile read from the connected browser session.",
          checkedAt: input.now(),
        };
      },
    });

  try {
    const createAgentResponse = await server.inject({
      method: "POST",
      url: "/agents",
      payload: {
        id: "facebook-agent",
        name: "Facebook Agent",
      },
    });
    assert.equal(createAgentResponse.statusCode, 201);
    const agent = createAgentResponse.json<AgentRecord>();

    const installSkillResponse = await server.inject({
      method: "PUT",
      url: "/agents/facebook-agent/skills/md-sns-facebook",
      payload: {
        replace: true,
        files: [
          {
            path: "SKILL.md",
            content:
              "---\nname: md-sns-facebook\n---\n# SNS · Facebook 콘텐츠\nUse when the user asks for Facebook content or account checks.\n",
          },
        ],
      },
    });
    assert.equal(installSkillResponse.statusCode, 200);
    completedRunSummaries.push("Facebook account status checked.");

    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "Facebook 계정 상태 확인해줘",
        agentId: "facebook-agent",
      },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(sendTurnCalls.length, 1);
    const contextPath =
      sendTurnCalls[0]?.extraSystemInstructions
        .find((instruction) => instruction.includes(ROCKY_AGENT_REQUEST_CONTEXT_DIR))
        ?.match(/`([^`]+)`/)?.[1] ??
      `${ROCKY_AGENT_REQUEST_CONTEXT_DIR}/missing.md`;
    const created = response.json<RockyChatRecord>();
    const agentContext = await readFile(path.join(agent.workspaceRoot, contextPath), "utf8");
    assert.match(agentContext, /Facebook: connected/u);
    assert.match(agentContext, /Facebook.*ready/u);
    assert.match(agentContext, /display_name=Rocky Facebook/u);
    assert.match(
      agentContext,
      /facebook\.profile\.read:read:status=available:skill_id=md-sns-facebook:skill=SNS · Facebook 콘텐츠:script=scripts\/facebook-crud\.mjs/u,
    );
    assert.equal(profileReaderCalls, 1);
    assert.ok(created.messages.length > 0);
    assert.ok(
      sendTurnCalls[0]?.extraSystemInstructions.some((instruction) =>
        instruction.includes("Connector profile read results may be listed")
      )
    );
  } finally {
    await server.close();
  }
});

test("rocky chat does not submit Tistory drafts while connector is planned", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  await mkdir(path.join(stateRoot, "connectors", "tistory"), { recursive: true });
  await writeFile(
    path.join(stateRoot, "connectors", "tistory", "browser-session.json"),
    JSON.stringify(
      {
        provider: "tistory",
        accountLabel: "Tistory 계정",
        connectedAt: "2026-05-09T14:09:16.248Z",
        storageStateJson: JSON.stringify({ cookies: [], origins: [] }),
      },
      null,
      2,
    ),
  );

  const publishedDrafts: Array<{
    title: string;
    contentMarkdown: string;
    tags: string[];
  }> = [];
  const { agents, completedRunSummaries, server } = createRockyChatTestServer(
    stateRoot,
    {
      connectorBrowserDetector: async () => ({
        available: true,
        channel: "chromium",
        message: "Playwright 번들 Chromium 사용",
      }),
      connectorBrowserDraftPublisher: async (input) => {
        publishedDrafts.push({
          title: input.draft.title,
          contentMarkdown: input.draft.contentMarkdown,
          tags: input.draft.tags ?? [],
        });
        return {
          ok: true,
          provider: "tistory",
          status: "draft-saved",
          accountLabel: input.accountLabel,
          url: "https://example.tistory.com/manage/newpost/",
          message: "Tistory 글쓰기 화면에 원고를 입력하고 임시저장했습니다.",
          checkedAt: input.now(),
        };
      },
    }
  );
  const workspaceRoot = path.join(
    stateRoot,
    "agent-workspaces",
    "blog-agent",
    "workspace"
  );
  const runtimeHome = path.join(
    stateRoot,
    "agent-workspaces",
    "blog-agent",
    "runtime-home"
  );
  agents.push(
    buildAgent({
      id: "blog-agent",
      name: "블로그 비서",
      workspaceRoot,
      runtimeHome,
    })
  );
  await mkdir(path.join(workspaceRoot, "outputs", "manual"), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, "outputs", "manual", "tistory_publish_ready.md"),
    [
      "# 티스토리 발행용 제목",
      "샘플 티스토리 제목",
      "",
      "---",
      "",
      "# 티스토리 발행용 본문",
      "본문 첫 문단입니다.",
      "",
      "본문 둘째 문단입니다.",
      "",
      "---",
      "",
      "# 티스토리 태그",
      "샘플, 티스토리, 자동화",
      "",
    ].join("\n")
  );
  completedRunSummaries.push(
    [
      "티스토리 발행용 원고를 만들었습니다.",
      "",
      "outputs/manual/tistory_publish_ready.md",
    ].join("\n")
  );

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "티스토리에 다시 발행해줘",
        agentId: "blog-agent",
      },
    });
    assert.equal(response.statusCode, 201);
    const created = response.json<RockyChatRecord>();
    const refreshedResponse = await server.inject({
      method: "GET",
      url: `/rocky/chats/${created.id}`,
    });
    assert.equal(refreshedResponse.statusCode, 200);
    const refreshed = refreshedResponse.json<RockyChatRecord>();

    assert.equal(publishedDrafts.length, 0);
    assert.doesNotMatch(refreshed.messages[1]?.text ?? "", /Tistory 발행 결과/u);
    assert.doesNotMatch(refreshed.messages[1]?.text ?? "", /임시저장 완료/u);

    const secondRefreshResponse = await server.inject({
      method: "GET",
      url: `/rocky/chats/${created.id}`,
    });
    assert.equal(secondRefreshResponse.statusCode, 200);
    assert.equal(publishedDrafts.length, 0);
  } finally {
    await server.close();
  }
});

test("rocky chat refreshes used skill names from renamed saved templates", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { agents, server } = createRockyChatTestServer(stateRoot);
  const workspaceRoot = path.join(
    stateRoot,
    "agent-workspaces",
    "sales-agent",
    "workspace"
  );
  const runtimeHome = path.join(
    stateRoot,
    "agent-workspaces",
    "sales-agent",
    "runtime-home"
  );
  agents.push(
    buildAgent({
      id: "sales-agent",
      name: "매출 분석 에이전트",
      workspaceRoot,
      runtimeHome,
    })
  );
  const skillRoot = path.join(
    workspaceRoot,
    ".agents",
    "skills",
    "md-sales-123"
  );
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    path.join(skillRoot, "SKILL.md"),
    [
      "---",
      "name: md-sales-123",
      'description: "매출 분석 업무를 처리합니다."',
      "---",
      "",
      "# 매출 분석",
      "",
    ].join("\n")
  );

  try {
    const createdResponse = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "지난달 매출 분석해줘",
        agentId: "sales-agent",
        skillId: "md-sales-123",
      },
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.json<RockyChatRecord>();
    assert.deepEqual(created.messages[1]?.usedSkills, [
      {
        id: "md-sales-123",
        displayName: "매출 분석",
      },
    ]);

    const renamedTemplate = {
      id: "template.sales",
      source: "user",
      category: "data",
      title: "매출 분석짱",
      description: "매출 데이터를 분석해 보고서를 만듭니다.",
      triggerLabel: "데이터 분석",
      requiredInputs: ["매출 데이터"],
      outputFormatLabel: "PDF 보고서",
      defaultInstructions: "매출 지표와 추천 액션을 분리합니다.",
      skill: {
        id: "md-sales-123",
        displayName: "매출 분석짱",
        description: "Use when the user wants Rocky to run sales analysis.",
        invocation: "$md-sales-123",
        skillMarkdown: [
          "---",
          "name: md-sales-123",
          'description: "Use when the user wants Rocky to run sales analysis."',
          "---",
          "",
          "# 매출 분석짱",
          "",
          "## Output",
          "- Preferred output: PDF 보고서",
          "",
          "## Quality Rules",
          "매출 지표와 추천 액션을 분리합니다.",
          "",
        ].join("\n"),
        openAiYaml: [
          "interface:",
          '  display_name: "매출 분석짱"',
          '  short_description: "매출 데이터를 분석해 보고서를 만듭니다."',
          '  default_prompt: "Use $md-sales-123 to run the sales analysis workflow."',
          "",
        ].join("\n"),
        syncStatus: "local",
        workspacePath: null,
      },
      sortOrder: 1,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:01:00.000Z",
    };
    const renameResponse = await server.inject({
      method: "PUT",
      url: "/skills/template.sales",
      payload: renamedTemplate,
    });
    assert.equal(renameResponse.statusCode, 200);

    const refreshedResponse = await server.inject({
      method: "GET",
      url: `/rocky/chats/${created.id}`,
    });
    assert.equal(refreshedResponse.statusCode, 200);
    const refreshed = refreshedResponse.json<RockyChatRecord>();
    assert.deepEqual(refreshed.messages[1]?.usedSkills, [
      {
        id: "md-sales-123",
        displayName: "매출 분석짱",
      },
    ]);

    const nextResponse = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "이번달도 같은 방식으로 분석해줘",
        agentId: "sales-agent",
        skillId: "md-sales-123",
      },
    });
    assert.equal(nextResponse.statusCode, 201);
    const next = nextResponse.json<RockyChatRecord>();
    assert.deepEqual(next.messages[1]?.usedSkills, [
      {
        id: "md-sales-123",
        displayName: "매출 분석짱",
      },
    ]);
    assert.match(
      await readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
      /# 매출 분석짱/u
    );
  } finally {
    await server.close();
  }
});

test("rocky chat routes agent skill inventory questions through the selected agent", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const {
    agents,
    completedRunSummaries,
    sendTurnCalls,
    server,
  } = createRockyChatTestServer(stateRoot);
  const workspaceRoot = path.join(
    stateRoot,
    "agent-workspaces",
    "blog-agent",
    "workspace"
  );
  const runtimeHome = path.join(
    stateRoot,
    "agent-workspaces",
    "blog-agent",
    "runtime-home"
  );
  agents.push(
    buildAgent({
      id: "blog-agent",
      name: "블로그 비서",
      description: "블로그 글 작성을 돕습니다.",
      workspaceRoot,
      runtimeHome,
    })
  );
  const blogSkillRoot = path.join(
    workspaceRoot,
    ".agents",
    "skills",
    "md-content-0m8fbwf"
  );
  const emailSkillRoot = path.join(
    workspaceRoot,
    ".agents",
    "skills",
    "md-content-0obltu7"
  );
  await mkdir(blogSkillRoot, { recursive: true });
  await mkdir(emailSkillRoot, { recursive: true });
  await writeFile(
    path.join(blogSkillRoot, "SKILL.md"),
    [
      "---",
      "name: md-content-0m8fbwf",
      'description: "네이버 블로그 콘텐츠 초안을 작성합니다."',
      "---",
      "",
      "# 블로그 · 네이버 블로그 콘텐츠",
      "",
    ].join("\n")
  );
  await writeFile(
    path.join(emailSkillRoot, "SKILL.md"),
    [
      "---",
      "name: md-content-0obltu7",
      'description: "외부 영업 이메일을 작성합니다."',
      "---",
      "",
      "# 이메일 · 외부 영업·아웃리치 작성",
      "",
    ].join("\n")
  );
  completedRunSummaries.push(
    [
      "사용 가능한 스킬은 2개입니다.",
      "",
      "- 블로그 · 네이버 블로그 콘텐츠",
      "- 이메일 · 외부 영업·아웃리치 작성",
    ].join("\n")
  );

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "사용할 수 있는 스킬 알려줘",
        agentId: "blog-agent",
      },
    });
    assert.equal(response.statusCode, 201);
    const created = response.json<RockyChatRecord>();
    assert.equal(sendTurnCalls.length, 1);
    assert.equal(created.dispatches.length, 1);
    assert.equal(sendTurnCalls[0]?.prompt, "사용할 수 있는 스킬 알려줘");
    assert.match(
      sendTurnCalls[0]?.extraSystemInstructions.join("\n") ?? "",
      /answer only with this agent's installed skill display names/u
    );

    const refreshedResponse = await server.inject({
      method: "GET",
      url: `/rocky/chats/${created.id}`,
    });
    assert.equal(refreshedResponse.statusCode, 200);
    const chat = refreshedResponse.json<RockyChatRecord>();
    assert.match(chat.messages[1]?.text ?? "", /사용 가능한 스킬은 2개입니다/u);
    assert.match(
      chat.messages[1]?.text ?? "",
      /블로그 · 네이버 블로그 콘텐츠/u
    );
    assert.match(
      chat.messages[1]?.text ?? "",
      /이메일 · 외부 영업·아웃리치 작성/u
    );
    assert.doesNotMatch(
      chat.messages[1]?.text ?? "",
      /workspace-local|호출 ID|\$md-content|SKILL\.md|\.agents\/skills|read-only|system/u
    );
  } finally {
    await server.close();
  }
});

test("rocky chat starts a fresh Core session when the reusable session was deleted", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const {
    createSessionCalls,
    runs,
    sendTurnCalls,
    server,
    sessions,
  } = createRockyChatTestServer(stateRoot);

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "회의록을 요약해줘.",
      },
    });
    assert.equal(response.statusCode, 201);
    const chat = response.json<RockyChatRecord>();
    assert.equal(chat.dispatches[0]?.orchestration?.sessionId, "session-1");

    sessions.splice(0, sessions.length);
    runs.splice(0, runs.length);

    const followUp = await server.inject({
      method: "POST",
      url: `/rocky/chats/${chat.id}/messages`,
      payload: {
        message: "액션 아이템도 덧붙여줘.",
      },
    });
    assert.equal(followUp.statusCode, 201);
    const updated = followUp.json<RockyChatRecord>();
    assert.equal(createSessionCalls.length, 2);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.id, "session-2");
    assert.equal(runs.length, 1);
    assert.equal(sendTurnCalls.at(-1)?.sessionId, "session-2");
    assert.equal(updated.dispatches[1]?.orchestration?.status, "running");
    assert.equal(updated.dispatches[1]?.orchestration?.sessionId, "session-2");
    assert.equal(updated.dispatches[1]?.orchestration?.runId, "run-1");
    assert.equal(updated.dispatches[1]?.orchestration?.error, null);
  } finally {
    await server.close();
  }
});

test("rocky chat refresh marks an active task failed when its backing run was deleted", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-chat-api-"));
  const { runs, server, sessions } = createRockyChatTestServer(stateRoot);

  try {
    const response = await server.inject({
      method: "POST",
      url: "/rocky/chats",
      payload: {
        message: "삭제된 세션 상태를 확인해줘.",
      },
    });
    assert.equal(response.statusCode, 201);
    const chat = response.json<RockyChatRecord>();
    assert.equal(chat.orchestration?.status, "running");

    sessions.splice(0, sessions.length);
    runs.splice(0, runs.length);

    const refreshedResponse = await server.inject({
      method: "GET",
      url: `/rocky/chats/${chat.id}`,
    });
    assert.equal(refreshedResponse.statusCode, 200);
    const refreshed = refreshedResponse.json<RockyChatRecord>();
    assert.equal(refreshed.orchestration?.status, "failed");
    assert.match(refreshed.orchestration?.error ?? "", /연결된 실행 기록이 삭제되었습니다/u);
    assert.equal(refreshed.dispatches[0]?.orchestration?.status, "failed");
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
    assert.match(coreContext, new RegExp(`task_output_dir: outputs/${chat.id}`, "u"));
    assert.match(coreContext, /첨부 메타데이터:\n- 없음/);
    assert.match(
      sendTurnCalls[0]?.extraSystemInstructions.join("\n") ?? "",
      new RegExp(`outputs/${chat.id}`, "u")
    );
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
    assert.equal(refreshed.dispatches[0]?.orchestration?.updatedAt, "2026-04-21T00:01:00.000Z");
    assert.equal(refreshed.updatedAt, "2026-04-21T00:01:00.000Z");
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
