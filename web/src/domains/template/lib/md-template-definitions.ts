import type {
  MdTemplateCategory,
  MdTemplateCategoryOption,
  MdTemplateDefinition,
  MdTemplateDraft,
  MdTemplateOpenAiSkill,
  MdTemplateWizardAnalysis,
  MdTemplateWizardStep,
  MdTemplateWizardStepId,
} from "../types.js";

export const MD_TEMPLATE_CATEGORY_OPTIONS: MdTemplateCategoryOption[] = [
  {
    id: "document",
    title: "문서 업무",
    description: "레퍼런스 양식에 맞춰 견적서, 인보이스, 제안서, 보고서를 만듭니다.",
    triggerLabel: "문서 자동화",
    requiredInputs: [
      "기준이 되는 레퍼런스 문서나 양식",
      "추출할 원본 파일이나 제품 정보",
      "반드시 포함할 항목과 제외할 항목",
      "엑셀, PDF, PPT 등 최종 산출물 형식",
    ],
    outputFormatLabel: "엑셀/PDF/PPT",
    defaultInstructions:
      "레퍼런스 문서와 원본 자료를 구분해서 확인하고, 누락값은 먼저 질문한 뒤 기존 양식에 맞춰 결과물을 작성합니다.",
  },
  {
    id: "content",
    title: "콘텐츠 업무",
    description: "페르소나, 채널, 제품 맥락에 맞춘 글과 영상 콘티를 만듭니다.",
    triggerLabel: "콘텐츠 제작",
    requiredInputs: [
      "제품명과 핵심 특징",
      "타깃 페르소나와 구매 상황",
      "사용 채널과 원하는 톤",
      "상세페이지, 숏폼 콘티, 마케팅 문구 등 결과물 종류",
    ],
    outputFormatLabel: "텍스트/PPT",
    defaultInstructions:
      "제품 정보와 페르소나를 먼저 정리하고, 채널 목적에 맞춰 스토리 구조, 문구, 콘티를 단계별로 제안합니다.",
  },
  {
    id: "data",
    title: "데이터 업무",
    description: "엑셀, DB, JSON 데이터를 분석해 결론과 다음 액션을 정리합니다.",
    triggerLabel: "데이터 분석",
    requiredInputs: [
      "분석할 엑셀, CSV, DB, JSON 파일",
      "보고 싶은 기간과 기준 지표",
      "비교 대상이나 의사결정 질문",
      "보고서, 표, 추천안 등 최종 정리 방식",
    ],
    outputFormatLabel: "표/보고서/추천안",
    defaultInstructions:
      "데이터 구조와 분석 질문을 먼저 확인하고, 매출, 프로모션, 품목 기준으로 결론과 추천 액션을 분리해 제시합니다.",
  },
];

export const MD_TEMPLATE_WIZARD_STEPS: MdTemplateWizardStep[] = [
  {
    id: "intent",
    title: "업무 의도",
    prompt: "Rocky에게 어떤 반복 업무를 맡기고 싶나요?",
    helper: "예: GS 프로모션 양식에 맞춰 행사 상품 엑셀을 매달 정리하고 싶어.",
  },
  {
    id: "inputs",
    title: "필요 자료",
    prompt: "이 일을 실행할 때 보통 어떤 파일이나 값이 필요하나요?",
    helper: "레퍼런스 문서, 원본 엑셀, 채널명, 기간, 제품 정보처럼 떠오르는 대로 적어도 됩니다.",
  },
  {
    id: "output",
    title: "결과물",
    prompt: "최종 결과물은 어떤 형태로 나오면 좋나요?",
    helper: "엑셀, PPT, PDF, 표, 보고서, 마케팅 문구, 영상 콘티처럼 업무자가 받는 형태를 적어주세요.",
  },
  {
    id: "rules",
    title: "업무 기준",
    prompt: "Rocky가 꼭 지켜야 할 기준이나 검수 방식이 있나요?",
    helper: "없으면 '없음'이라고 적어도 됩니다. Rocky가 저장 전에 업무 기준으로 정리합니다.",
  },
  {
    id: "review",
    title: "저장 확인",
    prompt: "Rocky가 만든 스킬 초안을 확인하고 저장합니다.",
    helper: "저장하면 Rocky가 실행할 업무 기준으로 연결합니다.",
  },
];

const STEP_ORDER = MD_TEMPLATE_WIZARD_STEPS.map((step) => step.id);

function compactText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function trimSentence(value: string, maxLength: number): string {
  const compact = compactText(value);
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1).trim()}...`;
}

function includesAny(value: string, keywords: string[]): boolean {
  const lower = value.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function uniqueList(values: string[]): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => compactText(value))
    .filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
}

function nextStepId(stepId: MdTemplateWizardStepId): MdTemplateWizardStepId {
  const index = STEP_ORDER.indexOf(stepId);
  return STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)] ?? "review";
}

export function getTemplateCategoryOption(
  category: MdTemplateCategory
): MdTemplateCategoryOption {
  return (
    MD_TEMPLATE_CATEGORY_OPTIONS.find((option) => option.id === category) ??
    MD_TEMPLATE_CATEGORY_OPTIONS[0]
  );
}

export function createTemplateDraft(
  category: MdTemplateCategory = "document"
): MdTemplateDraft {
  const option = getTemplateCategoryOption(category);

  return {
    category: option.id,
    title: "",
    description: "",
    triggerLabel: option.triggerLabel,
    requiredInputs: [],
    outputFormatLabel: "",
    defaultInstructions: "",
  };
}

export function templateToDraft(template: MdTemplateDefinition): MdTemplateDraft {
  return {
    category: template.category,
    title: template.title,
    description: template.description,
    triggerLabel: template.triggerLabel,
    requiredInputs: template.requiredInputs,
    inputFiles: template.inputFiles,
    inputArtifacts: template.inputArtifacts,
    sourceRunId: template.sourceRunId,
    outputFormatLabel: template.outputFormatLabel,
    defaultInstructions: template.defaultInstructions,
  };
}

export function requiredInputsFromText(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.replace(/^[-*\d.)\s]+/u, "").trim())
    .filter(Boolean);
}

export function requiredInputsToText(values: string[]): string {
  return values.join("\n");
}

function inferCategory(answer: string, fallback: MdTemplateCategory): MdTemplateCategory {
  const compact = compactText(answer);
  const scores: Record<MdTemplateCategory, number> = {
    document: 0,
    content: 0,
    data: 0,
  };

  if (
    includesAny(compact, [
      "견적서",
      "인보이스",
      "패킹",
      "수출",
      "제안서",
      "품목신고",
      "양식",
      "레퍼런스",
      "문서",
      "추출",
      "ppt",
      "pdf",
    ])
  ) {
    scores.document += 2;
  }
  if (
    includesAny(compact, [
      "상세페이지",
      "콘텐츠",
      "카피",
      "문구",
      "스토리",
      "콘티",
      "영상",
      "페르소나",
      "마케팅",
      "글",
    ])
  ) {
    scores.content += 2;
  }
  if (
    includesAny(compact, [
      "분석",
      "결론",
      "추천",
      "매출",
      "db",
      "json",
      "csv",
      "데이터",
      "지표",
      "리포트",
    ])
  ) {
    scores.data += 2;
  }
  if (includesAny(compact, ["엑셀", "excel", "xlsx"])) {
    scores.document += includesAny(compact, ["양식", "채널", "gs", "cj"]) ? 2 : 0;
    scores.data += includesAny(compact, ["분석", "결론", "추천", "지표"]) ? 2 : 1;
  }

  const best = (Object.keys(scores) as MdTemplateCategory[]).sort(
    (left, right) => scores[right] - scores[left]
  )[0];

  return scores[best] > 0 ? best : fallback;
}

function inferTriggerLabel(answer: string, category: MdTemplateCategory): string {
  const compact = compactText(answer);
  if (includesAny(compact, ["견적서"])) return "견적서 작성";
  if (includesAny(compact, ["인보이스"])) return "인보이스 작성";
  if (includesAny(compact, ["패킹"])) return "패킹리스트 작성";
  if (includesAny(compact, ["수출"])) return "수출 문서 작성";
  if (includesAny(compact, ["품목신고"])) return "품목신고 정리";
  if (includesAny(compact, ["프로모션", "gs", "cj"])) return "프로모션 양식 작성";
  if (includesAny(compact, ["상세페이지"])) return "상세페이지 문구";
  if (includesAny(compact, ["콘티", "영상"])) return "영상 콘티 작성";
  if (includesAny(compact, ["매출", "분석", "데이터"])) return "데이터 분석";
  return getTemplateCategoryOption(category).triggerLabel;
}

function inferTitle(answer: string, category: MdTemplateCategory): string {
  const triggerLabel = inferTriggerLabel(answer, category);
  const compact = compactText(answer);
  const channel = compact.match(/\b(GS|CJ|쿠팡|네이버|올리브영|Amazon|아마존)\b/iu)?.[1];
  if (channel && triggerLabel) {
    return `${channel.toUpperCase()} ${triggerLabel}`;
  }

  if (triggerLabel !== getTemplateCategoryOption(category).triggerLabel) {
    return triggerLabel;
  }

  return `${getTemplateCategoryOption(category).title} 스킬`;
}

function inferDescription(answer: string, category: MdTemplateCategory): string {
  const compact = compactText(answer);
  if (!compact) {
    return getTemplateCategoryOption(category).description;
  }

  return `${trimSentence(compact, 80)} 업무를 Rocky가 단계별로 물어보고 처리합니다.`;
}

function inferRequiredInputs(answer: string, category: MdTemplateCategory): string[] {
  const compact = compactText(answer);
  const inputs: string[] = [];

  if (includesAny(compact, ["레퍼런스", "기준", "양식", "샘플"])) {
    inputs.push("기준이 되는 레퍼런스 문서나 양식");
  }
  if (includesAny(compact, ["엑셀", "excel", "xlsx", "csv", "원본", "데이터"])) {
    inputs.push("원본 엑셀, CSV, DB, JSON 등 처리할 데이터 파일");
  }
  if (includesAny(compact, ["상품", "제품", "sku", "품목"])) {
    inputs.push("상품명, SKU, 제품 정보, 품목 정보");
  }
  if (includesAny(compact, ["기간", "월", "주차", "마감", "일정"])) {
    inputs.push("대상 기간, 마감일, 보고 주기");
  }
  if (includesAny(compact, ["채널", "gs", "cj", "쿠팡", "네이버", "올리브영"])) {
    inputs.push("채널명과 채널별 제출 양식");
  }
  if (includesAny(compact, ["할인", "행사", "프로모션", "쿠폰"])) {
    inputs.push("행사 조건, 할인율, 프로모션 기간");
  }
  if (includesAny(compact, ["페르소나", "타깃", "고객", "톤", "채널"])) {
    inputs.push("타깃 페르소나, 사용 채널, 원하는 톤");
  }
  if (includesAny(compact, ["결론", "추천", "분석", "지표"])) {
    inputs.push("분석 질문, 기준 지표, 비교 대상");
  }

  return uniqueList(inputs.length > 0 ? inputs : getTemplateCategoryOption(category).requiredInputs);
}

function splitAnswerIntoInputs(answer: string): string[] {
  return uniqueList(
    answer
      .split(/\r?\n|[,/]|그리고|,|，/u)
      .map((entry) => entry.replace(/^[-*\d.)\s]+/u, "").trim())
      .filter((entry) => entry.length > 0 && entry.length < 80)
  );
}

function inferOutputFormat(answer: string, category: MdTemplateCategory): string {
  const compact = compactText(answer);
  const formats: string[] = [];

  if (includesAny(compact, ["엑셀", "excel", "xlsx", "스프레드시트"])) {
    formats.push("엑셀");
  }
  if (includesAny(compact, ["ppt", "파워포인트", "슬라이드", "제안서"])) {
    formats.push("PPT");
  }
  if (includesAny(compact, ["pdf"])) {
    formats.push("PDF");
  }
  if (includesAny(compact, ["표", "테이블"])) {
    formats.push("표");
  }
  if (includesAny(compact, ["보고서", "리포트"])) {
    formats.push("보고서");
  }
  if (includesAny(compact, ["문구", "카피", "글", "텍스트"])) {
    formats.push("텍스트");
  }
  if (includesAny(compact, ["콘티", "스토리보드"])) {
    formats.push("영상 콘티");
  }
  if (includesAny(compact, ["추천", "결론"])) {
    formats.push("추천안");
  }

  return uniqueList(formats).join("/") || getTemplateCategoryOption(category).outputFormatLabel;
}

function composeDefaultInstructions(input: {
  draft: MdTemplateDraft;
  rulesAnswer?: string;
}): string {
  const rules = compactText(input.rulesAnswer ?? "");
  if (rules && !/^없음$/u.test(rules)) {
    return rules;
  }

  const option = getTemplateCategoryOption(input.draft.category);
  return [
    option.defaultInstructions,
    "사용자가 이미 제공한 파일과 답변을 먼저 확인하고, 누락값은 한 번에 하나씩 짧게 질문합니다.",
    "결과물 초안을 만든 뒤 사용자가 검토할 수 있게 수정 포인트를 분리합니다.",
  ].join(" ");
}

export function analyzeTemplateWizardAnswer(input: {
  stepId: MdTemplateWizardStepId;
  answer: string;
  draft: MdTemplateDraft;
}): MdTemplateWizardAnalysis {
  const answer = compactText(input.answer);
  const current = input.draft;
  let draft: MdTemplateDraft = current;
  let summary = "답변을 저장했습니다.";

  if (input.stepId === "intent") {
    const category = inferCategory(answer, current.category);
    draft = {
      ...current,
      category,
      title: current.title || inferTitle(answer, category),
      description: inferDescription(answer, category),
      triggerLabel: inferTriggerLabel(answer, category),
      requiredInputs: inferRequiredInputs(answer, category),
      outputFormatLabel: current.outputFormatLabel || inferOutputFormat(answer, category),
      defaultInstructions: composeDefaultInstructions({
        draft: { ...current, category },
      }),
    };
    summary = `${getTemplateCategoryOption(category).title}로 이해했고, ${draft.triggerLabel} 흐름으로 잡았습니다.`;
  } else if (input.stepId === "inputs") {
    const explicitInputs = splitAnswerIntoInputs(answer);
    const inferredInputs = inferRequiredInputs(answer, current.category);
    draft = {
      ...current,
      requiredInputs: uniqueList([
        ...(explicitInputs.length > 0 ? explicitInputs : []),
        ...inferredInputs,
      ]).slice(0, 8),
    };
    summary = `실행 전에 확인할 값 ${draft.requiredInputs.length}개를 정리했습니다.`;
  } else if (input.stepId === "output") {
    draft = {
      ...current,
      outputFormatLabel: inferOutputFormat(answer, current.category),
    };
    summary = `결과물 형식을 ${draft.outputFormatLabel}로 정리했습니다.`;
  } else if (input.stepId === "rules") {
    draft = {
      ...current,
      defaultInstructions: composeDefaultInstructions({
        draft: current,
        rulesAnswer: answer,
      }),
    };
    summary = "업무 기준을 스킬 실행 규칙으로 정리했습니다.";
  }

  return {
    draft,
    summary,
    nextStepId: nextStepId(input.stepId),
  };
}

export function normalizeTemplateDraft(draft: MdTemplateDraft): MdTemplateDraft {
  const option = getTemplateCategoryOption(draft.category);
  const title = draft.title.trim() || `${option.title} 스킬`;
  const description = draft.description.trim() || option.description;
  const triggerLabel = draft.triggerLabel.trim() || option.triggerLabel;
  const requiredInputs =
    draft.requiredInputs.map((entry) => entry.trim()).filter(Boolean).length > 0
      ? draft.requiredInputs.map((entry) => entry.trim()).filter(Boolean)
      : option.requiredInputs;
  const outputFormatLabel =
    draft.outputFormatLabel.trim() || option.outputFormatLabel;
  const defaultInstructions =
    draft.defaultInstructions.trim() || composeDefaultInstructions({ draft });

  return {
    category: draft.category,
    title,
    description,
    triggerLabel,
    requiredInputs,
    inputFiles: draft.inputFiles,
    inputArtifacts: draft.inputArtifacts,
    sourceRunId: draft.sourceRunId,
    outputFormatLabel,
    defaultInstructions,
  };
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36).padStart(7, "0");
}

function slugifySkillName(value: string, fallback: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-");

  return slug || fallback;
}

export function buildTemplateSkillId(input: {
  category: MdTemplateCategory;
  recordId: string;
  title: string;
}): string {
  const slug = slugifySkillName(input.title, input.category).slice(0, 34);
  return `md-${slug}-${hashString(input.recordId).slice(0, 8)}`.slice(0, 63);
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\s+/gu, " ").trim()}"`;
}

function frontmatterQuote(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\s+/gu, " ").trim()}"`;
}

function formatMarkdownList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- 없음";
}

function packagedInputPath(input: {
  id: string;
  fieldId: string;
  fileName: string;
  skillPath?: string | null;
}): string {
  return (
    input.skillPath ||
    ["assets", "inputs", input.fieldId || "general", input.id, input.fileName]
      .map((entry) => entry.replace(/[^\p{L}\p{N}._-]+/gu, "-") || "input")
      .join("/")
  );
}

function formatPackagedInputArtifacts(
  values: NonNullable<MdTemplateDraft["inputArtifacts"]>
): string[] {
  if (values.length === 0) {
    return [];
  }

  return [
    "## Packaged Input Files",
    "Paths are relative to this skill directory and are already available inputs.",
    ...values.map(
      (artifact) =>
        `- ${artifact.fileName}: \`${packagedInputPath(artifact)}\``
    ),
    "",
  ];
}

function requiresPdfOutput(value: string): boolean {
  return value.toLowerCase().includes("pdf");
}

function formatOutputDirectoryRules(outputFormatLabel: string): string[] {
  const rules = [
    "## Output Directory Rules",
    "- Create every final deliverable file under `outputs/` in the current workspace. Do not place final deliverables in the workspace root or other folders.",
    "- Create `outputs/` before writing files, and verify the expected files exist there before the final response.",
    "- In the final response, list each deliverable with its `outputs/...` path.",
  ];

  if (requiresPdfOutput(outputFormatLabel)) {
    rules.push(
      "- For PDF deliverables, first create a self-contained HTML source file in `outputs/`, then generate the PDF from that exact HTML source. Keep both files in `outputs/`.",
      "- Use a browser rendering engine for HTML-to-PDF whenever available, such as Playwright, Puppeteer, or Chromium with `printBackground: true` and `preferCSSPageSize: true`, so CSS, fonts, backgrounds, tables, and page breaks are preserved.",
      "- Do not replace browser rendering with text-only or manual PDF libraries such as PyMuPDF, ReportLab, or fpdf when the HTML styling matters. If no browser-capable renderer is available, leave the HTML source, explain the blocker, and do not claim the PDF preserves the HTML styling."
    );
  }

  return rules;
}

function formatRunPromptOutputRules(outputFormatLabel: string): string[] {
  const rules = [
    "산출물 저장 규칙:",
    "- 모든 최종 산출물 파일은 현재 workspace의 `outputs/` 폴더에 생성합니다.",
    "- 최종 답변에는 생성한 파일별 `outputs/...` 경로를 적습니다.",
  ];

  if (requiresPdfOutput(outputFormatLabel)) {
    rules.push(
      "- PDF 산출물은 먼저 `outputs/...html` 자급자족 HTML 원본을 만들고, 그 HTML에서 `outputs/...pdf`를 생성합니다.",
      "- HTML→PDF는 가능하면 Playwright, Puppeteer, Chromium 같은 브라우저 렌더러로 생성하고 `printBackground: true`, `preferCSSPageSize: true`를 사용해 CSS, 폰트, 배경, 표, 페이지 나눔을 보존합니다.",
      "- HTML 스타일이 중요한 경우 PyMuPDF, ReportLab, fpdf 같은 수동 PDF 라이브러리로 재구성한 결과를 스타일 보존 PDF로 간주하지 않습니다. 브라우저 렌더러가 없으면 HTML 원본을 남기고 blocker를 설명합니다."
    );
  }

  return rules;
}

export function buildOpenAiSkillDefinition(input: {
  skillId: string;
  draft: MdTemplateDraft;
  syncStatus?: MdTemplateOpenAiSkill["syncStatus"];
  workspacePath?: string | null;
  lastSyncedAt?: string;
  lastSyncError?: string;
}): MdTemplateOpenAiSkill {
  const normalized = normalizeTemplateDraft(input.draft);
  const description = `Use when the user wants Rocky to run the saved "${normalized.title}" MD workflow. Ask for missing inputs step by step, process uploaded files, and produce ${normalized.outputFormatLabel}.`;
  const displayName = normalized.title;
  const invocation = `$${input.skillId}`;
  const skillMarkdown = [
    "---",
    `name: ${input.skillId}`,
    `description: ${frontmatterQuote(description)}`,
    "---",
    "",
    `# ${displayName}`,
    "",
    "## Goal",
    normalized.description,
    "",
    "## Required Inputs",
    formatMarkdownList(normalized.requiredInputs),
    "",
    ...formatPackagedInputArtifacts(normalized.inputArtifacts ?? []),
    "## Workflow",
    "1. Check the user's latest request, uploaded files, and Packaged Input Files before asking anything.",
    "2. Treat Packaged Input Files as available inputs and inspect those paths before asking the user to upload them.",
    "3. Identify which required inputs are still missing.",
    "4. Ask for one missing input at a time in short Korean.",
    "5. Separate reference documents, source data, user constraints, and output format.",
    "6. Produce a draft result, then ask what should be revised.",
    "",
    "## Output",
    `- Preferred output: ${normalized.outputFormatLabel}`,
    "- When creating file-ready content, provide clear file names and table/slide/document structure.",
    "- If an actual export file cannot be created in the current environment, explain the blocker and provide the closest usable structured output.",
    "",
    ...formatOutputDirectoryRules(normalized.outputFormatLabel),
    "",
    "## Quality Rules",
    normalized.defaultInstructions,
    "",
  ].join("\n");
  const openAiYaml = [
    "interface:",
    `  display_name: ${yamlQuote(displayName)}`,
    `  short_description: ${yamlQuote(normalized.description.slice(0, 64))}`,
    `  default_prompt: ${yamlQuote(`Use ${invocation} to run the ${normalized.title} workflow.`)}`,
    "",
    "policy:",
    "  allow_implicit_invocation: true",
    "",
  ].join("\n");

  return {
    id: input.skillId,
    displayName,
    description,
    invocation,
    skillMarkdown,
    openAiYaml,
    syncStatus: input.syncStatus ?? "local",
    workspacePath: input.workspacePath ?? null,
    lastSyncedAt: input.lastSyncedAt,
    lastSyncError: input.lastSyncError,
  };
}

export function ensureTemplateSkillDefinition(
  template: MdTemplateDefinition
): MdTemplateDefinition {
  const skillId =
    template.skill?.id ??
    buildTemplateSkillId({
      category: template.category,
      recordId: template.id,
      title: template.title,
    });
  const skill = buildOpenAiSkillDefinition({
    skillId,
    draft: templateToDraft(template),
    syncStatus: template.skill?.syncStatus ?? "local",
    workspacePath: template.skill?.workspacePath ?? null,
    lastSyncedAt: template.skill?.lastSyncedAt,
    lastSyncError: template.skill?.lastSyncError,
  });

  return {
    ...template,
    skill: {
      ...skill,
      syncStatus: template.skill?.syncStatus ?? skill.syncStatus,
      workspacePath: template.skill?.workspacePath ?? skill.workspacePath,
      lastSyncedAt: template.skill?.lastSyncedAt,
      lastSyncError: template.skill?.lastSyncError,
    },
  };
}

export function createUserTemplateRecord(input: {
  draft: MdTemplateDraft;
  existing?: MdTemplateDefinition | null;
  id?: string;
  now: string;
}): MdTemplateDefinition {
  const normalized = normalizeTemplateDraft(input.draft);
  const recordId = input.existing?.id ?? input.id ?? `template.${input.now}`;
  const skillId =
    input.existing?.skill?.id ??
    buildTemplateSkillId({
      category: normalized.category,
      recordId,
      title: normalized.title,
    });
  const skill = buildOpenAiSkillDefinition({
    skillId,
    draft: normalized,
    syncStatus: "local",
    workspacePath: input.existing?.skill?.workspacePath ?? null,
  });

  return {
    id: recordId,
    source: "user",
    category: normalized.category,
    title: normalized.title,
    description: normalized.description,
    triggerLabel: normalized.triggerLabel,
    requiredInputs: normalized.requiredInputs,
    inputFiles: normalized.inputFiles ?? input.existing?.inputFiles,
    inputArtifacts: normalized.inputArtifacts ?? input.existing?.inputArtifacts,
    sourceRunId: normalized.sourceRunId ?? input.existing?.sourceRunId ?? null,
    outputFormatLabel: normalized.outputFormatLabel,
    outputFiles: input.existing?.outputFiles,
    defaultInstructions: normalized.defaultInstructions,
    skill,
    sortOrder: input.existing?.sortOrder ?? Date.parse(input.now),
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

export function markTemplateSkillSyncing(
  template: MdTemplateDefinition
): MdTemplateDefinition {
  return {
    ...template,
    skill: {
      ...template.skill,
      syncStatus: "syncing",
      lastSyncError: undefined,
    },
  };
}

export function markTemplateSkillSynced(input: {
  template: MdTemplateDefinition;
  workspacePath: string | null;
  now: string;
}): MdTemplateDefinition {
  return {
    ...input.template,
    skill: {
      ...input.template.skill,
      syncStatus: "synced",
      workspacePath: input.workspacePath,
      lastSyncedAt: input.now,
      lastSyncError: undefined,
    },
  };
}

export function markTemplateSkillSyncFailed(input: {
  template: MdTemplateDefinition;
  message: string;
}): MdTemplateDefinition {
  return {
    ...input.template,
    skill: {
      ...input.template.skill,
      syncStatus: "failed",
      lastSyncError: input.message,
    },
  };
}

export function buildTemplateSkillFiles(template: MdTemplateDefinition): Array<{
  path: string;
  content: string;
  encoding?: "utf8";
}> {
  const normalized = ensureTemplateSkillDefinition(template);
  return [
    {
      path: "SKILL.md",
      content: normalized.skill.skillMarkdown,
      encoding: "utf8",
    },
    {
      path: "agents/openai.yaml",
      content: normalized.skill.openAiYaml,
      encoding: "utf8",
    },
  ];
}

export function buildTemplateRunPrompt(
  template: MdTemplateDefinition,
  options: {
    userBrief?: string;
    selectedFileNames?: string[];
  } = {}
): string {
  const normalized = ensureTemplateSkillDefinition(template);
  const inputs = normalized.requiredInputs
    .map((input, index) => `${index + 1}. ${input}`)
    .join("\n");
  const selectedFiles =
    options.selectedFileNames && options.selectedFileNames.length > 0
      ? options.selectedFileNames.map((name) => `- ${name}`).join("\n")
      : "- 아직 없음";
  const packagedFiles =
    normalized.inputArtifacts && normalized.inputArtifacts.length > 0
      ? normalized.inputArtifacts
          .map(
            (artifact) =>
              `- ${artifact.fileName}: ${packagedInputPath(artifact)}`
          )
          .join("\n")
      : "- 스킬에 묶인 입력 파일이 없습니다.";
  const outputFiles =
    normalized.outputFiles && normalized.outputFiles.length > 0
      ? normalized.outputFiles.map((name) => `- ${name}`).join("\n")
      : "- 스킬에 고정 output 파일 경로가 지정되지 않았습니다.";
  const userBrief = options.userBrief?.trim()
    ? options.userBrief.trim()
    : "추가 요청 없음";

  return [
    "[Rocky 템플릿 실행]",
    "",
    `템플릿: ${normalized.title}`,
    `업무 유형: ${normalized.triggerLabel}`,
    `목표: ${normalized.description}`,
    `최종 산출물: ${normalized.outputFormatLabel}`,
    "",
    "연결된 Codex Skill:",
    `- 호출명: ${normalized.skill.invocation}`,
    `- workspace-local skill 경로: .agents/skills/${normalized.skill.id}/SKILL.md`,
    "- 위 skill 파일이 있으면 먼저 읽고, 해당 절차와 품질 기준을 우선 적용합니다.",
    "",
    "실행 준비 UI에서 확인한 내용:",
    `- 추가 요청: ${userBrief}`,
    "- 선택된 파일:",
    selectedFiles,
    "- 스킬에 묶인 파일:",
    packagedFiles,
    "",
    "필요한 입력값:",
    inputs,
    "",
    "템플릿 output 파일:",
    outputFiles,
    "",
    ...formatRunPromptOutputRules(normalized.outputFormatLabel),
    "",
    "진행 방식:",
    "1. 사용자가 이미 올린 파일과 메시지를 먼저 확인합니다.",
    "2. 실행 준비 UI에서 확인한 내용과 연결된 Codex Skill을 기준으로 누락값을 판단합니다.",
    "3. 누락된 입력값은 한 번에 하나씩 짧게 질문합니다.",
    "4. 레퍼런스 문서, 원본 데이터, 최종 산출물 조건을 분리해서 확인합니다.",
    "5. 사용자가 답한 내용을 바탕으로 결과물 초안을 만들고 수정 요청을 받습니다.",
    "",
    `세부 기준: ${normalized.defaultInstructions}`,
    "",
    "첫 응답은 지금 확인된 내용 요약과 다음으로 필요한 한 가지 질문으로 시작하세요.",
  ].join("\n");
}
