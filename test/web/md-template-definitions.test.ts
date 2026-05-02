import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeTemplateWizardAnswer,
  buildTemplateSkillFiles,
  buildTemplateRunPrompt,
  createTemplateDraft,
  createUserTemplateRecord,
  normalizeTemplateDraft,
  requiredInputsFromText,
} from "../../web/src/domains/template/lib/md-template-definitions.js";

test("md template draft uses category defaults for empty fields", () => {
  const draft = createTemplateDraft("data");
  const normalized = normalizeTemplateDraft({
    ...draft,
    title: "",
    description: "",
    requiredInputs: [],
  });

  assert.equal(normalized.title, "데이터 업무 스킬");
  assert.equal(normalized.triggerLabel, "데이터 분석");
  assert.ok(normalized.requiredInputs.some((input) => /엑셀/u.test(input)));
});

test("requiredInputsFromText parses checklist-style answers", () => {
  assert.deepEqual(
    requiredInputsFromText("1. 레퍼런스 문서\n- 제품 정보\n* 결과물 형식"),
    ["레퍼런스 문서", "제품 정보", "결과물 형식"]
  );
});

test("createUserTemplateRecord preserves ids while editing", () => {
  const existing = createUserTemplateRecord({
    draft: {
      ...createTemplateDraft("document"),
      title: "견적서 추출",
    },
    id: "template.quote",
    now: "2026-04-26T00:00:00.000Z",
  });

  const edited = createUserTemplateRecord({
    draft: {
      ...createTemplateDraft("document"),
      title: "견적서 자동 작성",
    },
    existing,
    now: "2026-04-26T01:00:00.000Z",
  });

  assert.equal(edited.id, "template.quote");
  assert.equal(edited.skill.id, existing.skill.id);
  assert.equal(edited.title, "견적서 자동 작성");
  assert.equal(edited.createdAt, "2026-04-26T00:00:00.000Z");
  assert.equal(edited.updatedAt, "2026-04-26T01:00:00.000Z");
});

test("analyzeTemplateWizardAnswer infers MD workflow intent", () => {
  const analysis = analyzeTemplateWizardAnswer({
    stepId: "intent",
    answer: "GS 프로모션 양식에 맞춰 행사 상품 엑셀을 매달 정리하고 싶어",
    draft: createTemplateDraft("document"),
  });

  assert.equal(analysis.draft.category, "document");
  assert.equal(analysis.draft.title, "GS 프로모션 양식 작성");
  assert.equal(analysis.draft.triggerLabel, "프로모션 양식 작성");
  assert.ok(
    analysis.draft.requiredInputs.some((input) => /채널별 제출 양식/u.test(input))
  );
  assert.equal(analysis.nextStepId, "inputs");
});

test("template intent analysis flows into skill and run prompt", () => {
  const intentAnalysis = analyzeTemplateWizardAnswer({
    stepId: "intent",
    answer: "GS 프로모션 양식에 맞춰 행사 상품 엑셀을 매달 정리하고 싶어",
    draft: createTemplateDraft("document"),
  });
  const template = createUserTemplateRecord({
    draft: intentAnalysis.draft,
    id: "template.intent-gs",
    now: "2026-04-26T00:00:00.000Z",
  });
  const files = buildTemplateSkillFiles(template);
  const runPrompt = buildTemplateRunPrompt(template);

  assert.match(template.description, /GS 프로모션 양식/u);
  assert.match(files[0]?.content ?? "", /GS 프로모션 양식/u);
  assert.match(files[0]?.content ?? "", /행사 상품/u);
  assert.match(runPrompt, /템플릿: GS 프로모션 양식 작성/u);
  assert.match(runPrompt, /프로모션 양식 작성/u);
});

test("createUserTemplateRecord generates OpenAI skill files", () => {
  const template = createUserTemplateRecord({
    draft: {
      ...createTemplateDraft("content"),
      title: "상세페이지 문구 작성",
      description: "페르소나에 맞춰 상세페이지 스토리와 문구를 만든다.",
      requiredInputs: ["제품 정보", "타깃 페르소나"],
      outputFormatLabel: "텍스트",
    },
    id: "template.content",
    now: "2026-04-26T00:00:00.000Z",
  });
  const files = buildTemplateSkillFiles(template);

  assert.match(template.skill.id, /^md-/u);
  assert.equal(template.skill.invocation, `$${template.skill.id}`);
  assert.ok(files.some((file) => file.path === "SKILL.md"));
  assert.ok(files.some((file) => file.path === "agents/openai.yaml"));
  assert.match(files[0]?.content ?? "", /name: md-/u);
});

test("generated skill instructions list packaged input files", () => {
  const template = createUserTemplateRecord({
    draft: {
      ...createTemplateDraft("data"),
      title: "매출 분석",
      requiredInputs: ["공구_CEO-OFFICE.xlsx"],
      inputFiles: ["공구_CEO-OFFICE.xlsx"],
      inputArtifacts: [
        {
          id: "upload-001",
          runId: "run-001",
          fieldId: "datasets",
          fileName: "공구_CEO-OFFICE.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: 123,
          runtimePath: "skill-template-runs/run-001/inputs/datasets/upload-001/공구_CEO-OFFICE.xlsx",
          skillPath: "assets/inputs/datasets/upload-001/공구_CEO-OFFICE.xlsx",
          uploadedAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      outputFormatLabel: "PDF 보고서",
    },
    id: "template.sales",
    now: "2026-05-01T00:00:00.000Z",
  });
  const files = buildTemplateSkillFiles(template);
  const prompt = buildTemplateRunPrompt(template);
  const skillMarkdown = files.find((file) => file.path === "SKILL.md")?.content ?? "";

  assert.match(skillMarkdown, /Packaged Input Files/u);
  assert.match(
    skillMarkdown,
    /assets\/inputs\/datasets\/upload-001\/공구_CEO-OFFICE\.xlsx/u
  );
  assert.match(skillMarkdown, /already available inputs/u);
  assert.match(prompt, /스킬에 묶인 파일/u);
  assert.match(prompt, /공구_CEO-OFFICE\.xlsx/u);
});

test("buildTemplateRunPrompt asks Rocky to guide the user step by step", () => {
  const template = createUserTemplateRecord({
    draft: {
      ...createTemplateDraft("document"),
      title: "GS 프로모션 양식",
      requiredInputs: ["GS 양식", "프로모션 상품 엑셀"],
      outputFormatLabel: "엑셀",
    },
    id: "template.gs",
    now: "2026-04-26T00:00:00.000Z",
  });
  const prompt = buildTemplateRunPrompt(template, {
    selectedFileNames: ["gs.xlsx"],
    userBrief: "4월 행사 기준",
  });

  assert.match(prompt, /템플릿: GS 프로모션 양식/u);
  assert.match(prompt, /연결된 Codex Skill/u);
  assert.match(prompt, /\$md-/u);
  assert.match(prompt, /gs\.xlsx/u);
  assert.match(prompt, /4월 행사 기준/u);
  assert.match(prompt, /1\. GS 양식/u);
  assert.match(prompt, /한 번에 하나씩 짧게 질문/u);
  assert.match(prompt, /다음으로 필요한 한 가지 질문/u);
});
