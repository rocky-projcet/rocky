import type {
  RockyTemplateCategory,
  RockyTemplateDraft,
  RockyTemplateInterviewAnswer,
  RockyTemplateInterviewStepId,
  RockyTemplateInterviewTurnInput,
  RockyTemplateInterviewTurnResult,
} from "./rocky-chat-types.js";

interface RockyTemplateCategoryOption {
  id: RockyTemplateCategory;
  title: string;
  description: string;
  triggerLabel: string;
  requiredInputs: string[];
  outputFormatLabel: string;
  defaultInstructions: string;
}

interface TemplateInterviewAgentJson {
  summary?: unknown;
  nextStepId?: unknown;
  draft?: unknown;
}

const TEMPLATE_CATEGORY_OPTIONS: RockyTemplateCategoryOption[] = [
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

const TEMPLATE_STEP_ORDER: RockyTemplateInterviewStepId[] = [
  "intent",
  "inputs",
  "output",
  "rules",
  "review",
];

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

function nextStepId(stepId: RockyTemplateInterviewStepId): RockyTemplateInterviewStepId {
  const index = TEMPLATE_STEP_ORDER.indexOf(stepId);
  return TEMPLATE_STEP_ORDER[Math.min(index + 1, TEMPLATE_STEP_ORDER.length - 1)] ?? "review";
}

function categoryOption(category: RockyTemplateCategory): RockyTemplateCategoryOption {
  return (
    TEMPLATE_CATEGORY_OPTIONS.find((option) => option.id === category) ??
    TEMPLATE_CATEGORY_OPTIONS[0]
  );
}

function createEmptyDraft(category: RockyTemplateCategory = "document"): RockyTemplateDraft {
  const option = categoryOption(category);

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

function inferCategory(answer: string, fallback: RockyTemplateCategory): RockyTemplateCategory {
  const compact = compactText(answer);
  const scores: Record<RockyTemplateCategory, number> = {
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

  const best = (Object.keys(scores) as RockyTemplateCategory[]).sort(
    (left, right) => scores[right] - scores[left]
  )[0];

  return scores[best] > 0 ? best : fallback;
}

function inferTriggerLabel(answer: string, category: RockyTemplateCategory): string {
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
  return categoryOption(category).triggerLabel;
}

function inferTitle(answer: string, category: RockyTemplateCategory): string {
  const triggerLabel = inferTriggerLabel(answer, category);
  const compact = compactText(answer);
  const channel = compact.match(/\b(GS|CJ|쿠팡|네이버|올리브영|Amazon|아마존)\b/iu)?.[1];
  if (channel && triggerLabel) {
    return `${channel.toUpperCase()} ${triggerLabel}`;
  }

  if (triggerLabel !== categoryOption(category).triggerLabel) {
    return triggerLabel;
  }

  return `${categoryOption(category).title} 템플릿`;
}

function inferDescription(answer: string, category: RockyTemplateCategory): string {
  const compact = compactText(answer);
  if (!compact) {
    return categoryOption(category).description;
  }

  return `${trimSentence(compact, 80)} 업무를 Rocky가 단계별로 물어보고 처리합니다.`;
}

function inferRequiredInputs(answer: string, category: RockyTemplateCategory): string[] {
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

  return uniqueList(inputs.length > 0 ? inputs : categoryOption(category).requiredInputs);
}

function splitAnswerIntoInputs(answer: string): string[] {
  return uniqueList(
    answer
      .split(/\r?\n|[,/]|그리고|,|，/u)
      .map((entry) => entry.replace(/^[-*\d.)\s]+/u, "").trim())
      .filter((entry) => entry.length > 0 && entry.length < 80)
  );
}

function inferOutputFormat(answer: string, category: RockyTemplateCategory): string {
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

  return uniqueList(formats).join("/") || categoryOption(category).outputFormatLabel;
}

function composeDefaultInstructions(input: {
  draft: RockyTemplateDraft;
  rulesAnswer?: string;
}): string {
  const rules = compactText(input.rulesAnswer ?? "");
  if (rules && !/^없음$/u.test(rules)) {
    return rules;
  }

  const option = categoryOption(input.draft.category);
  return [
    option.defaultInstructions,
    "사용자가 이미 제공한 파일과 답변을 먼저 확인하고, 누락값은 한 번에 하나씩 짧게 질문합니다.",
    "결과물 초안을 만든 뒤 사용자가 검토할 수 있게 수정 포인트를 분리합니다.",
  ].join(" ");
}

function applyAnswerToDraft(input: {
  answer: string;
  draft: RockyTemplateDraft;
  stepId: RockyTemplateInterviewStepId;
}): RockyTemplateDraft {
  const answer = compactText(input.answer);
  const current = input.draft;

  if (input.stepId === "intent") {
    const category = inferCategory(answer, current.category);
    return {
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
  }

  if (input.stepId === "inputs") {
    const explicitInputs = splitAnswerIntoInputs(answer);
    const inferredInputs = inferRequiredInputs(answer, current.category);
    return {
      ...current,
      requiredInputs: uniqueList([
        ...(explicitInputs.length > 0 ? explicitInputs : []),
        ...inferredInputs,
      ]).slice(0, 8),
    };
  }

  if (input.stepId === "output") {
    return {
      ...current,
      outputFormatLabel: inferOutputFormat(answer, current.category),
    };
  }

  if (input.stepId === "rules") {
    return {
      ...current,
      defaultInstructions: composeDefaultInstructions({
        draft: current,
        rulesAnswer: answer,
      }),
    };
  }

  if (input.stepId === "review") {
    return {
      ...current,
      defaultInstructions: [
        current.defaultInstructions,
        `추가 수정 기준: ${answer}`,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  return current;
}

function isTemplateStepId(value: unknown): value is RockyTemplateInterviewStepId {
  return (
    value === "intent" ||
    value === "inputs" ||
    value === "output" ||
    value === "rules" ||
    value === "review"
  );
}

function normalizeDraft(value: unknown): RockyTemplateDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<RockyTemplateDraft>;
  if (
    record.category !== "document" &&
    record.category !== "content" &&
    record.category !== "data"
  ) {
    return null;
  }

  return {
    category: record.category,
    title: typeof record.title === "string" ? compactText(record.title) : "",
    description:
      typeof record.description === "string" ? compactText(record.description) : "",
    triggerLabel:
      typeof record.triggerLabel === "string"
        ? compactText(record.triggerLabel)
        : categoryOption(record.category).triggerLabel,
    requiredInputs: Array.isArray(record.requiredInputs)
      ? uniqueList(
          record.requiredInputs.filter(
            (entry): entry is string => typeof entry === "string"
          )
        )
      : [],
    outputFormatLabel:
      typeof record.outputFormatLabel === "string"
        ? compactText(record.outputFormatLabel)
        : "",
    defaultInstructions:
      typeof record.defaultInstructions === "string"
        ? record.defaultInstructions.trim()
        : "",
  };
}

function normalizeFinalDraft(draft: RockyTemplateDraft): RockyTemplateDraft {
  const option = categoryOption(draft.category);
  return {
    category: draft.category,
    title: draft.title.trim() || `${option.title} 템플릿`,
    description: draft.description.trim() || option.description,
    triggerLabel: draft.triggerLabel.trim() || option.triggerLabel,
    requiredInputs:
      draft.requiredInputs.map((entry) => entry.trim()).filter(Boolean).length > 0
        ? draft.requiredInputs.map((entry) => entry.trim()).filter(Boolean)
        : option.requiredInputs,
    outputFormatLabel: draft.outputFormatLabel.trim() || option.outputFormatLabel,
    defaultInstructions:
      draft.defaultInstructions.trim() || composeDefaultInstructions({ draft }),
  };
}

function answersWithCurrent(
  input: RockyTemplateInterviewTurnInput
): RockyTemplateInterviewAnswer[] {
  const answers = (input.answers ?? [])
    .filter((answer) => isTemplateStepId(answer.stepId) && answer.answer.trim())
    .map((answer) => ({
      stepId: answer.stepId,
      answer: answer.answer.trim(),
    }));

  const currentAnswer = input.answer.trim();
  if (currentAnswer) {
    answers.push({
      stepId: input.stepId,
      answer: currentAnswer,
    });
  }

  return answers;
}

function buildDraftFromAnswers(input: {
  answers: RockyTemplateInterviewAnswer[];
  draft?: RockyTemplateDraft | null;
}): RockyTemplateDraft {
  const initial = input.draft ?? createEmptyDraft("document");
  return normalizeFinalDraft(
    input.answers.reduce(
      (draft, answer) =>
        applyAnswerToDraft({
          answer: answer.answer,
          draft,
          stepId: answer.stepId,
        }),
      initial
    )
  );
}

function extractJsonObject(value: string): TemplateInterviewAgentJson | null {
  const trimmed = value.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/u)?.[1]?.trim() ?? "",
    trimmed.match(/\{[\s\S]*\}/u)?.[0] ?? "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as TemplateInterviewAgentJson;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function stepTitle(stepId: RockyTemplateInterviewStepId): string {
  if (stepId === "intent") return "업무 의도";
  if (stepId === "inputs") return "필요 자료";
  if (stepId === "output") return "결과물";
  if (stepId === "rules") return "업무 기준";
  return "저장 확인";
}

export function buildTemplateInterviewAgentPrompt(
  input: RockyTemplateInterviewTurnInput
): string {
  const answers = answersWithCurrent(input);
  const isFinal = input.stepId === "rules" || input.stepId === "review";
  const answerText =
    answers.length > 0
      ? answers.map((answer) => `- ${stepTitle(answer.stepId)}: ${answer.answer}`).join("\n")
      : "- 아직 없음";

  return [
    "[Rocky 템플릿 인터뷰 처리]",
    "",
    "사용자가 반복 업무 템플릿을 만들기 위해 인터뷰에 답하고 있습니다.",
    "각 답변을 업무 능력 정의 관점에서 해석하고, 다음 JSON만 반환하세요.",
    "",
    "반환 형식:",
    "{",
    '  "summary": "사용자에게 보여줄 짧은 한국어 처리 요약",',
    `  "nextStepId": "${nextStepId(input.stepId)}",`,
    '  "draft": null',
    "}",
    "",
    "draft 규칙:",
    isFinal
      ? "- 이번 단계에서는 인터뷰가 완료되었으므로 draft를 반드시 생성하거나 수정합니다."
      : "- 이번 단계는 인터뷰 진행 중이므로 draft는 null로 둡니다.",
    '- draft.category는 "document", "content", "data" 중 하나입니다.',
    "- 사용자가 말한 업무 목적, 필요 자료, 최종 결과물 표현을 임의로 일반화하거나 다른 업무로 바꾸지 않습니다.",
    "- title과 triggerLabel은 사용자의 업무 목적을 우선 보존합니다. 예: '유튜브 쇼츠 영상 생성'은 '영상 콘티 작성'으로 바꾸지 않습니다.",
    "- outputFormatLabel은 사용자가 말한 결과물 형태를 우선 보존합니다. 예: '쇼츠용 영상 파일'은 '텍스트/PPT'로 바꾸지 않습니다.",
    "- requiredInputs에는 사용자가 직접 말한 필요 자료를 먼저 넣고, 필요한 경우에만 실행에 필요한 값을 보강합니다.",
    "- requiredInputs는 사용자가 실행 전에 제공해야 하는 파일/값을 3-8개로 적습니다.",
    "- defaultInstructions는 Rocky가 실행 때 지킬 기준을 한국어로 적습니다.",
    "",
    `현재 단계: ${input.stepId} (${stepTitle(input.stepId)})`,
    `현재 답변: ${input.answer.trim()}`,
    "",
    "누적 답변:",
    answerText,
    "",
    "기존 초안:",
    input.draft ? JSON.stringify(input.draft, null, 2) : "null",
  ].join("\n");
}

export function buildTemplateInterviewFallbackResult(
  input: RockyTemplateInterviewTurnInput
): Omit<RockyTemplateInterviewTurnResult, "agent" | "source"> {
  const answers = answersWithCurrent(input);
  const next = nextStepId(input.stepId);
  if (input.stepId === "rules" || input.stepId === "review") {
    const draft = buildDraftFromAnswers({
      answers,
      draft: input.draft ?? null,
    });
    return {
      summary:
        input.stepId === "review"
          ? "수정 요청을 템플릿 초안에 반영했습니다."
          : "인터뷰 답변을 바탕으로 템플릿 초안을 생성했습니다.",
      nextStepId: "review",
      draft,
    };
  }

  return {
    summary: `${stepTitle(input.stepId)} 답변을 Rocky Core 처리 요청으로 보냈습니다.`,
    nextStepId: next,
    draft: null,
  };
}

export function parseTemplateInterviewAgentResult(input: {
  output: string | null;
  requestedStepId: RockyTemplateInterviewStepId;
}): Omit<RockyTemplateInterviewTurnResult, "agent" | "source"> | null {
  if (!input.output) {
    return null;
  }

  const parsed = extractJsonObject(input.output);
  if (!parsed) {
    return null;
  }

  const next = isTemplateStepId(parsed.nextStepId) ? parsed.nextStepId : null;
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : null;
  if (!summary || !next) {
    return null;
  }

  const draft =
    input.requestedStepId === "rules" || input.requestedStepId === "review"
      ? normalizeDraft(parsed.draft)
      : null;
  if ((input.requestedStepId === "rules" || input.requestedStepId === "review") && !draft) {
    return null;
  }

  return {
    summary,
    nextStepId: input.requestedStepId === "rules" ? "review" : next,
    draft: draft ? normalizeFinalDraft(draft) : null,
  };
}
