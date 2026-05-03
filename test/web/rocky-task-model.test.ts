import test from "node:test";
import assert from "node:assert/strict";

import {
  getRockyTaskEndedAt,
  getRockyTaskLastActivityAt,
  isRockyTaskForTemplateSkill,
} from "../../web/src/domains/rocky/lib/rocky-task-model.js";

import type {
  RockyChatRecord,
  RockyDispatchRecord,
  RockyMessageRecord,
  RockyOrchestrationRecord,
} from "../../web/src/shared/lib/agent-engine-client.js";
import type { MdTemplateDefinition } from "../../web/src/domains/template/types.js";

function template(
  overrides: Partial<MdTemplateDefinition> = {}
): MdTemplateDefinition {
  const base: MdTemplateDefinition = {
    id: "template.sales",
    source: "user",
    category: "data",
    title: "매출 분석",
    description: "매출 분석 보고서를 만든다.",
    triggerLabel: "매출 분석",
    requiredInputs: [],
    outputFormatLabel: "PDF 보고서",
    defaultInstructions: "",
    skill: {
      id: "md-data-06awd68",
      displayName: "매출 분석",
      description: "매출 분석 보고서를 만든다.",
      invocation: "$md-data-06awd68",
      skillMarkdown: "",
      openAiYaml: "",
      syncStatus: "synced",
      workspacePath: null,
    },
    sortOrder: 0,
  };

  return {
    ...base,
    ...overrides,
    skill: {
      ...base.skill,
      ...overrides.skill,
    },
  };
}

function message(overrides: Partial<RockyMessageRecord>): RockyMessageRecord {
  return {
    id: overrides.id ?? "message-1",
    chatId: overrides.chatId ?? "chat-1",
    role: overrides.role ?? "user",
    intent: overrides.intent ?? "conversation",
    text: overrides.text ?? "",
    attachmentIds: overrides.attachmentIds ?? [],
    domain: overrides.domain ?? "general",
    workerId: overrides.workerId ?? null,
    skillCandidateIds: overrides.skillCandidateIds ?? [],
    usedSkills: overrides.usedSkills ?? [],
    dispatchId: overrides.dispatchId ?? null,
    createdAt: overrides.createdAt ?? "2026-05-02T00:00:00.000Z",
  };
}

function orchestration(
  overrides: Partial<RockyOrchestrationRecord> = {}
): RockyOrchestrationRecord {
  return {
    id: overrides.id ?? "orchestration-1",
    status: overrides.status ?? "running",
    agentId: overrides.agentId ?? "agent-1",
    sessionId: overrides.sessionId ?? "session-1",
    runId: overrides.runId ?? "run-1",
    output: overrides.output ?? null,
    error: overrides.error ?? null,
    startedAt: overrides.startedAt ?? "2026-05-02T00:00:00.000Z",
    endedAt: overrides.endedAt ?? null,
    updatedAt: overrides.updatedAt ?? "2026-05-02T00:00:00.000Z",
  };
}

function dispatch(overrides: Partial<RockyDispatchRecord> = {}): RockyDispatchRecord {
  return {
    id: overrides.id ?? "dispatch-1",
    chatId: overrides.chatId ?? "chat-1",
    messageId: overrides.messageId ?? "message-1",
    skillId: overrides.skillId ?? "rocky.core",
    intent: overrides.intent ?? "conversation",
    domain: overrides.domain ?? "general",
    workerId: overrides.workerId ?? "worker-1",
    attachmentIds: overrides.attachmentIds ?? [],
    originalRequest: overrides.originalRequest ?? "매출 분석해줘.",
    skillCandidateIds: overrides.skillCandidateIds ?? [],
    protectionHints: overrides.protectionHints ?? [],
    orchestration: overrides.orchestration ?? null,
    executionStarted: overrides.executionStarted ?? Boolean(overrides.orchestration),
    createdAt: overrides.createdAt ?? "2026-05-02T00:00:00.000Z",
  };
}

function chat(overrides: Partial<RockyChatRecord> = {}): RockyChatRecord {
  return {
    id: overrides.id ?? "chat-1",
    title: overrides.title ?? "매출 분석 작업",
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
    updatedAt: overrides.updatedAt ?? "2026-05-02T00:00:00.000Z",
  };
}

test("getRockyTaskLastActivityAt ignores wall-clock terminal updatedAt", () => {
  const completed = orchestration({
    status: "completed",
    startedAt: "2026-05-02T00:00:00.000Z",
    endedAt: "2026-05-02T00:02:00.000Z",
    updatedAt: "2026-05-02T09:00:00.000Z",
  });
  const salesChat = chat({
    updatedAt: "2026-05-02T09:00:00.000Z",
    messages: [
      message({ id: "message-1", createdAt: "2026-05-02T00:00:00.000Z" }),
      message({
        id: "message-2",
        role: "rocky",
        text: "매출 분석 보고서를 생성했습니다.",
        dispatchId: "dispatch-1",
        createdAt: "2026-05-02T00:01:00.000Z",
      }),
    ],
    dispatches: [
      dispatch({
        id: "dispatch-1",
        orchestration: completed,
        createdAt: "2026-05-02T00:00:00.000Z",
      }),
    ],
    orchestration: completed,
  });

  assert.equal(
    getRockyTaskLastActivityAt(salesChat),
    "2026-05-02T00:02:00.000Z"
  );
  assert.equal(getRockyTaskEndedAt(salesChat), "2026-05-02T00:02:00.000Z");
});

test("getRockyTaskLastActivityAt keeps active orchestration updates", () => {
  const running = orchestration({
    status: "running",
    startedAt: "2026-05-02T00:00:00.000Z",
    endedAt: null,
    updatedAt: "2026-05-02T00:03:00.000Z",
  });
  const salesChat = chat({
    updatedAt: "2026-05-02T09:00:00.000Z",
    messages: [message({ createdAt: "2026-05-02T00:00:00.000Z" })],
    dispatches: [dispatch({ orchestration: running })],
    orchestration: running,
  });

  assert.equal(
    getRockyTaskLastActivityAt(salesChat),
    "2026-05-02T00:03:00.000Z"
  );
  assert.equal(getRockyTaskEndedAt(salesChat), null);
});

test("isRockyTaskForTemplateSkill matches modern usedSkills metadata", () => {
  const salesTemplate = template();
  const salesChat = chat({
    messages: [
      message({
        role: "rocky",
        text: "매출 분석 보고서를 생성했습니다.",
        usedSkills: [{ id: "md-data-06awd68", displayName: "매출 분석" }],
      }),
    ],
  });

  assert.equal(
    isRockyTaskForTemplateSkill(salesChat, salesTemplate, [salesTemplate]),
    true
  );
});

test("isRockyTaskForTemplateSkill preserves legacy template-run matching", () => {
  const salesTemplate = template();
  const salesChat = chat({
    messages: [
      message({
        text: "[Rocky 템플릿 실행]\n템플릿: 매출 분석",
      }),
    ],
  });

  assert.equal(
    isRockyTaskForTemplateSkill(salesChat, salesTemplate, [salesTemplate]),
    true
  );
});

test("isRockyTaskForTemplateSkill matches direct skill invocation prompts", () => {
  const salesTemplate = template();
  const salesChat = chat({
    messages: [
      message({
        text: "$md-data-06awd68 매출 분석로 진행해줘.",
      }),
    ],
  });

  assert.equal(
    isRockyTaskForTemplateSkill(salesChat, salesTemplate, [salesTemplate]),
    true
  );
});

test("isRockyTaskForTemplateSkill ignores unrelated skill usage", () => {
  const salesTemplate = template();
  const unrelatedChat = chat({
    messages: [
      message({
        role: "rocky",
        text: "다른 작업을 완료했습니다.",
        usedSkills: [{ id: "md-doc-123", displayName: "문서 작성" }],
      }),
    ],
  });

  assert.equal(
    isRockyTaskForTemplateSkill(unrelatedChat, salesTemplate, [salesTemplate]),
    false
  );
});
