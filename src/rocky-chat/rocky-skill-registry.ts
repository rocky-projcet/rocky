import {
  GENERAL_AGENT_ID,
  GENERAL_WORKER_ID,
  NUTRITION_AGENT_ID,
  NUTRITION_WORKER_ID,
  ROCKY_CORE_AGENT_ID,
  ROCKY_CORE_WORKER_ID,
  VISUAL_REPORT_AGENT_ID,
  VISUAL_REPORT_WORKER_ID,
} from "./rocky-chat-constants.js";

import type {
  RockyAttachmentRecord,
  RockyChatDomain,
  RockyRoutingIntent,
  RockySkillCandidateRecord,
} from "./rocky-chat-types.js";

export type RockySkillMode = "core" | "delegated";

export interface RockySkillAgentDefinition {
  id: string;
  name: string;
  description: string;
}

export interface RockySkillWorkerDefinition {
  id: string;
  displayName: string;
}

export interface RockySkillCandidateRule {
  title: string;
  description: string;
  trigger: string;
  confidence: number;
  keywords: string[];
}

export interface RockySkillProtectionRule {
  label: string;
  keywords: string[];
}

export interface RockyOrchestrationSkill {
  id: string;
  version: string;
  mode: RockySkillMode;
  domain: RockyChatDomain;
  displayName: string;
  description: string;
  worker: RockySkillWorkerDefinition;
  agent: RockySkillAgentDefinition;
  taskSignals: string[];
  domainSignals: string[];
  conversationSignals?: string[];
  clarificationPatterns?: RegExp[];
  capabilities: string[];
  operatingRules: string[];
  handoffContract: string[];
  candidateRules: RockySkillCandidateRule[];
  protectionRules: RockySkillProtectionRule[];
}

export interface RockySkillSelection {
  skill: RockyOrchestrationSkill;
  intent: RockyRoutingIntent;
  domain: RockyChatDomain;
  reason: string;
}

function includesAny(input: string, keywords: string[]): boolean {
  const normalized = input.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function compactMessage(message: string): string {
  return message.replace(/\s+/gu, " ").trim().toLowerCase();
}

function attachmentText(attachments: RockyAttachmentRecord[]): string {
  return attachments.map((attachment) => attachment.name).join(" ");
}

function requestText(message: string, attachments: RockyAttachmentRecord[]): string {
  return `${message} ${attachmentText(attachments)}`;
}

function hasExplicitAttachmentTask(
  message: string,
  attachments: RockyAttachmentRecord[]
): boolean {
  return (
    attachments.length > 0 &&
    includesAny(message, ["정리", "요약", "분석", "작성", "만들", "추출", "비교", "변환"])
  );
}

export const ROCKY_ORCHESTRATION_SKILLS: RockyOrchestrationSkill[] = [
  {
    id: "rocky.core",
    version: "2026-04-22",
    mode: "core",
    domain: "general",
    displayName: "Rocky Core",
    description: "홈 채팅의 대화, 요청 해석, 확인 질문을 맡는 기본 오케스트레이션 스킬입니다.",
    worker: {
      id: ROCKY_CORE_WORKER_ID,
      displayName: "Rocky",
    },
    agent: {
      id: ROCKY_CORE_AGENT_ID,
      name: "Rocky",
      description:
        "Rocky 홈 채팅에서 대화, 요청 해석, 확인 질문 생성을 맡는 코어 오케스트레이터입니다.",
    },
    taskSignals: [],
    domainSignals: [],
    conversationSignals: [
      "뭐 할 수",
      "무엇을 할 수",
      "사용법",
      "도움말",
      "에이전트가 뭐",
      "rocky가 뭐",
      "로키가 뭐",
      "너는 뭐",
    ],
    clarificationPatterns: [
      /^(이거|요거|저거)?\s*(봐줘|봐 줄래|확인해줘|확인해 줄래|확인 가능|어때|가능해|가능|될까|되나)\??$/u,
      /^(정리|분석|요약|검토)\s*(가능|가능해|될까|해줄 수 있어)\??$/u,
      /^(도와줘|뭐 해야 해|어떻게 해)\??$/u,
    ],
    capabilities: [
      "사용자 질문에 직접 답변합니다.",
      "요청이 실행 가능한 작업인지 판단하고 필요한 정보를 묻습니다.",
      "작업 위임이 필요하면 어떤 담당 스킬/에이전트가 처리할 수 있는지 설명합니다.",
    ],
    operatingRules: [
      "한국어로 짧고 실용적으로 답합니다.",
      "모호한 요청은 실행하지 않고 필요한 확인 질문을 먼저 합니다.",
      "파일 본문을 받지 못한 상태에서 파일 내용을 읽었다고 말하지 않습니다.",
    ],
    handoffContract: [
      "사용자가 바로 이해할 수 있는 최종 답변을 작성합니다.",
      "실행이 필요한 경우 필요한 입력과 다음 액션을 명확히 구분합니다.",
    ],
    candidateRules: [],
    protectionRules: [],
  },
  {
    id: "rocky.visual-report",
    version: "2026-04-23",
    mode: "delegated",
    domain: "general",
    displayName: "시각화 리포트 스킬",
    description:
      "지표 요약, 추이 분석, 차트 생성, Markdown 리포트 정리를 담당 에이전트로 위임합니다.",
    worker: {
      id: VISUAL_REPORT_WORKER_ID,
      displayName: "시각화 리포트 담당",
    },
    agent: {
      id: VISUAL_REPORT_AGENT_ID,
      name: "시각화 리포트 담당",
      description:
        "Rocky 홈 채팅에서 그래프, 차트, 시각화 리포트 작업을 맡기 위한 담당입니다.",
    },
    taskSignals: [
      "그래프",
      "차트",
      "시각화",
      "리포트",
      "대시보드",
      "plot",
      "chart",
      "graph",
      "visual",
      "trend",
      "추이",
      "지표",
      "통계",
      "분포",
      "비중",
      "월별",
      "주별",
      "일별",
      "분기",
      "연도",
      "series",
      "매출",
      "성과",
      "csv",
      "엑셀",
      "데이터",
      "보고서",
    ],
    domainSignals: [],
    capabilities: [
      "구조화된 데이터를 요약하고 차트가 필요한 지점을 골라 시각화 리포트로 정리합니다.",
      "가능하면 Python으로 데이터를 집계하고 Rocky UI가 바로 렌더링할 수 있는 차트 아티팩트를 함께 만듭니다.",
      "최종 결과를 Markdown 제목, 요약, 핵심 인사이트, 표, 다음 액션 구조로 정리합니다.",
    ],
    operatingRules: [
      "구조화된 데이터가 있으면 Python으로 집계나 전처리를 수행해도 됩니다.",
      "차트가 필요할 때는 파일명에 chart 또는 graph를 포함한 JSON 아티팩트를 저장하세요. 예: sales-trend-chart.json.",
      '차트 JSON은 {"kind":"line"|"bar"|"area","title":string|null,"xLabel":string|null,"yLabel":string|null,"series":[{"name":string|null,"points":[{"x":string|number,"y":number}]}]} 형식을 우선 사용하세요.',
      "충분한 수치 근거가 없으면 차트를 억지로 만들지 말고 Markdown 리포트만 작성하세요.",
      "없는 파일 본문을 읽었다고 가정하지 않습니다.",
    ],
    handoffContract: [
      "최종 답변은 Rocky가 그대로 전달할 수 있는 Markdown 리포트로 작성합니다.",
      "차트를 만들었다면 본문에서 차트 해석과 핵심 수치를 함께 설명합니다.",
      "차트를 만들지 못했다면 이유와 필요한 데이터 형식을 분명히 적습니다.",
    ],
    candidateRules: [
      {
        title: "추이 차트 템플릿",
        description: "시간축 또는 순서축 지표를 선형/영역 차트로 비교하는 기준입니다.",
        trigger: "추이/월별/주별/일별 언급",
        confidence: 0.84,
        keywords: ["추이", "월별", "주별", "일별", "분기", "연도"],
      },
      {
        title: "지표 요약 카드",
        description: "차트와 함께 핵심 KPI를 상단 요약 카드처럼 정리하는 기준입니다.",
        trigger: "지표/성과/리포트 언급",
        confidence: 0.76,
        keywords: ["지표", "성과", "리포트", "대시보드", "보고서"],
      },
    ],
    protectionRules: [
      {
        label: "고객 정보",
        keywords: ["고객", "개인정보", "전화번호", "이메일"],
      },
    ],
  },
  {
    id: "rocky.general-task",
    version: "2026-04-22",
    mode: "delegated",
    domain: "general",
    displayName: "자료 정리 스킬",
    description: "요약, 정리, 분석, 작성 같은 범용 자료 작업을 담당 에이전트로 위임합니다.",
    worker: {
      id: GENERAL_WORKER_ID,
      displayName: "자료 정리 담당",
    },
    agent: {
      id: GENERAL_AGENT_ID,
      name: "자료 정리 담당",
      description:
        "Rocky 홈 채팅에서 일반 자료 정리와 단일 작업 요청을 맡기 위한 담당입니다.",
    },
    taskSignals: [
      "정리",
      "요약",
      "분석",
      "작성",
      "만들",
      "찾아",
      "비교",
      "추출",
      "변환",
      "분류",
      "계산",
      "검토",
      "수정",
      "번역",
      "보고서",
      "회의록",
      "표로",
      "엑셀",
      "csv",
      "파일",
      "리스트",
      "목록",
      "초안",
      "기획",
      "계획",
      "액션 아이템",
      "자동화",
      "코드",
    ],
    domainSignals: [],
    capabilities: [
      "첨부 자료나 요청 내용을 기준으로 요약, 정리, 비교, 추출 작업을 수행합니다.",
      "반복 가능한 정리 기준 후보를 찾아 Rocky에 되돌려줍니다.",
      "결과를 사용자가 바로 읽을 수 있는 형태로 정리합니다.",
    ],
    operatingRules: [
      "없는 파일 본문을 읽었다고 가정하지 않습니다.",
      "요청 범위가 모호하면 필요한 입력을 짧게 요청합니다.",
      "표가 필요한 경우 간결한 Markdown 표를 사용합니다.",
    ],
    handoffContract: [
      "최종 답변은 Rocky가 그대로 사용자에게 전달할 수 있게 작성합니다.",
      "작업 요약, 핵심 결과, 필요한 다음 액션을 구분합니다.",
    ],
    candidateRules: [
      {
        title: "액션 아이템 정리",
        description: "회의록이나 노트에서 담당자, 할 일, 기한을 분리해 정리합니다.",
        trigger: "회의록/액션 아이템 언급",
        confidence: 0.72,
        keywords: ["회의록", "액션 아이템", "담당자", "기한"],
      },
    ],
    protectionRules: [
      {
        label: "고객 정보",
        keywords: ["고객", "개인정보", "전화번호", "이메일"],
      },
    ],
  },
  {
    id: "rocky.nutrition-md",
    version: "2026-04-22",
    mode: "delegated",
    domain: "nutrition-md",
    displayName: "영양제 MD 스킬",
    description: "영양제/건기식 상품, 이벤트, 채널 성과, 원가/마진 보호가 필요한 MD 작업을 위임합니다.",
    worker: {
      id: NUTRITION_WORKER_ID,
      displayName: "영양제 MD 담당",
    },
    agent: {
      id: NUTRITION_AGENT_ID,
      name: "영양제 MD 담당",
      description:
        "Rocky 단일 채팅에서 영양제 MD 자료 요청을 내부적으로 맡기 위한 담당입니다.",
    },
    taskSignals: [
      "정리",
      "요약",
      "분석",
      "작성",
      "만들",
      "비교",
      "추출",
      "검토",
      "보고서",
      "표로",
      "엑셀",
      "csv",
      "상품",
      "제품",
      "제품명",
      "상품명",
      "상품 기획",
      "판매",
      "판매량",
      "재구매",
      "채널",
      "쿠팡",
      "네이버",
      "자사몰",
      "원가",
      "마진",
      "공급가",
      "거래처",
      "벤더",
      "이벤트",
      "행사",
      "프로모션",
    ],
    domainSignals: ["영양제", "건기식", "건강기능식품", "프로바이오틱스", "오메가", "비타민"],
    capabilities: [
      "영양제/건기식 상품명 표기 차이를 SKU나 대표 상품명 기준으로 묶습니다.",
      "채널별 판매량, 매출, 광고비, 재구매, 환불, 재고를 비교합니다.",
      "원가, 공급가, 마진, 거래처 같은 보호 항목을 노출 주의 대상으로 표시합니다.",
      "다음 MD 액션이나 이벤트 개선 포인트를 정리합니다.",
    ],
    operatingRules: [
      "원가, 공급가, 마진, 거래처 정보는 필요 최소한으로 다룹니다.",
      "상품명 표기 차이는 같은 SKU 또는 명백한 동일 상품 근거가 있을 때만 묶습니다.",
      "채널 성과는 판매량만 보지 말고 광고비, 환불, 재구매도 함께 봅니다.",
      "첨부 본문이 없으면 파일 내용을 읽었다고 말하지 않고 필요한 파일 제공을 요청합니다.",
    ],
    handoffContract: [
      "최종 답변은 Rocky가 그대로 사용자에게 전달할 수 있게 작성합니다.",
      "상품명 그룹핑 결과, 채널별 성과, 보호 항목, 추천 액션을 구분합니다.",
      "보호 항목의 원문 값 전체를 불필요하게 반복하지 않습니다.",
    ],
    candidateRules: [
      {
        title: "상품명 표기 묶기",
        description: "같은 상품이 여러 이름으로 적힌 경우 대표 이름 기준으로 묶는 기준입니다.",
        trigger: "상품명/제품명 표기 차이",
        confidence: 0.86,
        keywords: ["상품명", "제품명", "같은 상품", "다르게 적힌"],
      },
      {
        title: "민감 자료 보호",
        description: "원가, 마진, 공급가, 거래처 정보는 보호해서 볼 항목으로 다룹니다.",
        trigger: "원가/마진/거래처 언급",
        confidence: 0.9,
        keywords: ["원가", "마진", "공급가", "거래처", "벤더"],
      },
      {
        title: "이벤트 기획 기준 정리",
        description: "행사 성과를 다음 기획에 재사용할 수 있는 기준으로 정리합니다.",
        trigger: "이벤트/기획 언급",
        confidence: 0.78,
        keywords: ["이벤트", "행사", "프로모션", "기획"],
      },
      {
        title: "채널별 성과 비교",
        description: "판매 채널별 성과를 따로 비교해 다음 운영 판단에 사용합니다.",
        trigger: "채널 언급",
        confidence: 0.72,
        keywords: ["채널", "쿠팡", "네이버", "자사몰"],
      },
    ],
    protectionRules: [
      {
        label: "원가/마진 정보",
        keywords: ["원가", "마진", "공급가"],
      },
      {
        label: "거래처/계약 정보",
        keywords: ["거래처", "벤더", "계약"],
      },
      {
        label: "고객 정보",
        keywords: ["고객", "개인정보", "전화번호", "이메일"],
      },
    ],
  },
];

export const ROCKY_CORE_SKILL = ROCKY_ORCHESTRATION_SKILLS.find(
  (skill) => skill.id === "rocky.core"
)!;

export function getRockySkill(skillId: string | null | undefined): RockyOrchestrationSkill {
  return (
    ROCKY_ORCHESTRATION_SKILLS.find((skill) => skill.id === skillId) ??
    ROCKY_CORE_SKILL
  );
}

export function getRockySkillByWorkerId(
  workerId: string | null | undefined
): RockyOrchestrationSkill {
  return (
    ROCKY_ORCHESTRATION_SKILLS.find((skill) => skill.worker.id === workerId) ??
    ROCKY_CORE_SKILL
  );
}

function isBareConversation(message: string): boolean {
  const bare = compactMessage(message).replace(/[!?.,~\s]/gu, "");
  return ["안녕", "안녕하세요", "하이", "hi", "hello", "헬로", "ㅎㅇ", "테스트"].includes(
    bare
  );
}

function coreIntent(message: string): RockyRoutingIntent | null {
  const compact = compactMessage(message);
  if (isBareConversation(message)) {
    return "conversation";
  }
  if (includesAny(compact, ROCKY_CORE_SKILL.conversationSignals ?? [])) {
    return "conversation";
  }
  if (
    (ROCKY_CORE_SKILL.clarificationPatterns ?? []).some((pattern) =>
      pattern.test(compact)
    )
  ) {
    return "clarification";
  }

  return null;
}

function skillMatchesDomain(
  skill: RockyOrchestrationSkill,
  message: string,
  attachments: RockyAttachmentRecord[]
): boolean {
  return includesAny(requestText(message, attachments), skill.domainSignals);
}

function skillMatchesTask(
  skill: RockyOrchestrationSkill,
  message: string,
  attachments: RockyAttachmentRecord[]
): boolean {
  return (
    hasExplicitAttachmentTask(message, attachments) ||
    includesAny(requestText(message, attachments), skill.taskSignals)
  );
}

export function selectRockySkill(input: {
  message: string;
  attachments: RockyAttachmentRecord[];
  contextDomain?: RockyChatDomain;
}): RockySkillSelection {
  const explicitCoreIntent = coreIntent(input.message);
  if (explicitCoreIntent) {
    return {
      skill: ROCKY_CORE_SKILL,
      intent: explicitCoreIntent,
      domain: "general",
      reason:
        explicitCoreIntent === "clarification"
          ? "모호한 요청이라 Rocky core 확인 질문 스킬을 선택했습니다."
          : "일반 대화라 Rocky core 대화 스킬을 선택했습니다.",
    };
  }

  const delegatedSkills = ROCKY_ORCHESTRATION_SKILLS.filter(
    (skill) => skill.mode === "delegated"
  );
  const specialized = delegatedSkills.find(
    (skill) =>
      skill.domain !== "general" &&
      (skillMatchesDomain(skill, input.message, input.attachments) ||
        input.contextDomain === skill.domain) &&
      skillMatchesTask(skill, input.message, input.attachments)
  );
  if (specialized) {
    return {
      skill: specialized,
      intent: "specialized-task",
      domain: specialized.domain,
      reason: `${specialized.displayName}이 처리할 수 있는 요청으로 판단했습니다.`,
    };
  }

  const general = delegatedSkills.find(
    (skill) =>
      skill.domain === "general" &&
      skillMatchesTask(skill, input.message, input.attachments)
  );
  if (general) {
    return {
      skill: general,
      intent: "general-task",
      domain: "general",
      reason: `${general.displayName}이 처리할 수 있는 범용 작업으로 판단했습니다.`,
    };
  }

  return {
    skill: ROCKY_CORE_SKILL,
    intent: "conversation",
    domain: input.contextDomain ?? "general",
    reason: "실행 작업 신호가 약해 Rocky core 대화 스킬을 선택했습니다.",
  };
}

export function extractRockySkillCandidates(input: {
  skill: RockyOrchestrationSkill;
  message: string;
  sourceMessageId: string;
  createdAt: string;
  idGenerator: () => string;
}): RockySkillCandidateRecord[] {
  return input.skill.candidateRules
    .filter((rule) => includesAny(input.message, rule.keywords))
    .map((rule) => ({
      id: `skill-${input.idGenerator()}`,
      title: rule.title,
      description: rule.description,
      trigger: rule.trigger,
      confidence: rule.confidence,
      sourceMessageId: input.sourceMessageId,
      status: "candidate",
      createdAt: input.createdAt,
    }));
}

export function extractRockyProtectionHints(input: {
  skill: RockyOrchestrationSkill;
  message: string;
  attachments: RockyAttachmentRecord[];
}): string[] {
  const target = requestText(input.message, input.attachments);
  return input.skill.protectionRules
    .filter((rule) => includesAny(target, rule.keywords))
    .map((rule) => rule.label);
}
