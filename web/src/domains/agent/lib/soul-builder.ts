export interface SoulAnswers {
  identity: string;
  identityCustom?: string;
  tone: string;
  style: string;
  rules: string[];
  signature: string;
}

export const SOUL_IDENTITY_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "secretary", label: "비서·행정 도우미" },
  { id: "marketer", label: "마케터" },
  { id: "writer", label: "콘텐츠 작가" },
  { id: "analyst", label: "데이터·리서치 분석가" },
  { id: "designer", label: "디자이너" },
  { id: "developer", label: "개발 도우미" },
  { id: "sales", label: "영업·고객 매니저" },
  { id: "custom", label: "직접 입력" },
];

export const SOUL_TONE_OPTIONS: Array<{
  id: string;
  label: string;
  description: string;
}> = [
  { id: "warm", label: "따뜻하고 친근한", description: "구어체, 부드러운 어조" },
  { id: "polite", label: "정중하고 격식 있는", description: "공식 문서·사외 커뮤니케이션 톤" },
  { id: "peer", label: "동료처럼 캐주얼", description: "가볍고 직설적, 농담 한두 개 OK" },
  { id: "decisive", label: "단호하고 전문적", description: "결론 먼저, 군더더기 없음" },
  { id: "cheerful", label: "활기차고 격려하는", description: "긍정 에너지, 짧은 응원" },
];

export const SOUL_STYLE_OPTIONS: Array<{
  id: string;
  label: string;
  description: string;
}> = [
  { id: "concise", label: "핵심부터 짧게", description: "결론 → 근거 한 줄" },
  { id: "step-by-step", label: "단계별로 차근차근", description: "번호 매겨 설명" },
  { id: "examples", label: "예시·비유 풍부하게", description: "이해를 돕는 사례 곁들임" },
  { id: "empathic", label: "감정 공감 우선", description: "맥락 인정 → 답변" },
];

export const SOUL_RULE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "no-flattery", label: "아첨하지 않는다" },
  { id: "no-emoji", label: "이모지 사용 안 함" },
  { id: "admit-unknown", label: "모르는 건 솔직히 모른다고 한다" },
  { id: "cite-sources", label: "근거·출처를 명시한다" },
  { id: "offer-alternatives", label: "한 가지가 막히면 대안을 제시한다" },
  { id: "ask-when-vague", label: "모호하면 먼저 확인 질문을 한다" },
];

function identityLabel(answers: SoulAnswers): string {
  if (answers.identity === "custom") {
    return answers.identityCustom?.trim() || "전문 도우미";
  }
  const option = SOUL_IDENTITY_OPTIONS.find((entry) => entry.id === answers.identity);
  return option?.label ?? "전문 도우미";
}

function toneText(answers: SoulAnswers): string {
  const option = SOUL_TONE_OPTIONS.find((entry) => entry.id === answers.tone);
  if (!option) return "";
  return `${option.label} 어조로 응답한다 (${option.description}).`;
}

function styleText(answers: SoulAnswers): string {
  const option = SOUL_STYLE_OPTIONS.find((entry) => entry.id === answers.style);
  if (!option) return "";
  return `${option.label}하게 답변을 구성한다 (${option.description}).`;
}

function ruleLines(answers: SoulAnswers): string[] {
  if (answers.rules.length === 0) return [];
  return answers.rules
    .map((id) => SOUL_RULE_OPTIONS.find((entry) => entry.id === id)?.label)
    .filter((label): label is string => Boolean(label))
    .map((label) => `- ${label}`);
}

/**
 * Compile structured wizard answers into a SOUL.md style markdown string.
 * Empty answers yield an empty string so the runtime knows to skip the
 * persona prepend entirely.
 */
export function buildSoulMarkdown(answers: SoulAnswers): string {
  const sections: string[] = [];

  const identity = identityLabel(answers);
  sections.push(`# 정체성\n나는 ${identity}이다.`);

  const tone = toneText(answers);
  if (tone) sections.push(`# 말투\n${tone}`);

  const style = styleText(answers);
  if (style) sections.push(`# 응답 스타일\n${style}`);

  const rules = ruleLines(answers);
  if (rules.length > 0) sections.push(`# 행동 규칙\n${rules.join("\n")}`);

  const signature = answers.signature.trim();
  if (signature) sections.push(`# 시그니처\n${signature}`);

  return sections.join("\n\n").trim();
}

export function emptySoulAnswers(): SoulAnswers {
  return {
    identity: "secretary",
    identityCustom: "",
    tone: "warm",
    style: "concise",
    rules: ["admit-unknown", "ask-when-vague"],
    signature: "",
  };
}
