import test from "node:test";
import assert from "node:assert/strict";

import {
  isRockyTaskForTemplateSkill,
} from "../../web/src/domains/rocky/lib/rocky-task-model.js";

import type {
  RockyChatRecord,
  RockyMessageRecord,
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
