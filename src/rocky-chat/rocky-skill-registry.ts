import {
  ROCKY_CORE_AGENT_ID,
  ROCKY_CORE_WORKER_ID,
} from "./rocky-chat-constants.js";

import type {
  RockyAbilityCardRecord,
  RockyAttachmentRecord,
  RockyChatDomain,
  RockyRoutingIntent,
  RockySkillCandidateRecord,
} from "./rocky-chat-types.js";

export type RockySkillMode = "core";

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

export interface RockySkillAbilityDefinition {
  title: string;
  description: string;
  icon: RockyAbilityCardRecord["icon"];
  examples: string[];
  guideMarkdown: string;
  installableSkillIds?: string[];
  sortOrder?: number;
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
  conversationSignals?: string[];
  clarificationPatterns?: RegExp[];
  capabilities: string[];
  operatingRules: string[];
  handoffContract: string[];
  ability?: RockySkillAbilityDefinition;
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

export const ROCKY_CORE_SKILL: RockyOrchestrationSkill = {
  id: "rocky.core",
  version: "2026-04-25",
  mode: "core",
  domain: "general",
  displayName: "Rocky Core",
  description:
    "홈 채팅의 대화와 작업 요청을 하나의 Rocky Core 에이전트 세션에서 처리합니다.",
  worker: {
    id: ROCKY_CORE_WORKER_ID,
    displayName: "Rocky",
  },
  agent: {
    id: ROCKY_CORE_AGENT_ID,
    name: "Rocky",
    description:
      "Rocky 홈 채팅에서 사용자 대화와 작업 요청을 직접 처리하는 코어 에이전트입니다.",
  },
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
    "자료 정리, 요약, 분석, 작성 같은 작업 요청을 현재 Rocky Core 작업 폴더에서 처리합니다.",
    "요청이 모호하면 필요한 정보를 먼저 묻습니다.",
  ],
  operatingRules: [
    "한국어로 짧고 실용적으로 답합니다.",
    "모호한 요청은 필요한 확인 질문을 먼저 합니다.",
    "파일 본문을 받지 못한 상태에서 파일 내용을 읽었다고 말하지 않습니다.",
    "현재 세션의 작업 폴더와 사용 가능한 도구 범위 안에서 처리합니다.",
  ],
  handoffContract: [
    "사용자가 바로 이해할 수 있는 최종 답변을 작성합니다.",
    "실행하지 못한 부분이 있으면 이유와 필요한 입력을 명확히 적습니다.",
  ],
  ability: {
    title: "자료 정리 능력",
    description: "파일과 요청을 바탕으로 요약, 분석, 작성 흐름을 잡습니다.",
    icon: "message-square",
    examples: [
      "자료를 핵심만 요약합니다.",
      "회의록에서 액션 아이템을 뽑습니다.",
      "표, 문서, 답변 초안을 만듭니다.",
    ],
    guideMarkdown: [
      "# 자료 정리 능력 사용법",
      "",
      "파일을 올리거나 정리할 내용을 붙여주고 원하는 결과 형태를 말하면 됩니다. Rocky는 보통 핵심 요약, 액션 아이템, 표 정리, 답변 초안처럼 바로 쓸 수 있는 형태로 정리합니다.",
      "",
      "## 예시 요청",
      "",
      "### 자료 요약",
      "\"첨부한 문서를 5줄로 요약하고, 중요한 결정 사항과 리스크를 따로 정리해줘.\"",
      "",
      "### 회의록 정리",
      "\"이 회의록에서 담당자별 액션 아이템, 기한, 확인이 필요한 질문을 뽑아줘.\"",
      "",
      "### 초안 작성",
      "\"아래 내용을 고객 공지 메일 초안으로 바꿔줘. 톤은 짧고 정중하게 해줘.\"",
      "",
      "실제 작업을 하려면 파일이나 원문, 원하는 출력 형식, 톤이나 분량 기준을 알려주면 됩니다.",
    ].join("\n"),
    sortOrder: 10,
  },
  candidateRules: [],
  protectionRules: [],
};

export const ROCKY_PRESENTATION_SKILL: RockyOrchestrationSkill = {
  id: "rocky.presentation",
  version: "2026-04-25",
  mode: "core",
  domain: "general",
  displayName: "PPT 능력",
  description:
    "PowerPoint 파일의 텍스트 번역, 슬라이드 요약, 발표 흐름 정리를 돕습니다.",
  worker: {
    id: "rocky-presentation-worker",
    displayName: "Rocky PPT",
  },
  agent: ROCKY_CORE_SKILL.agent,
  conversationSignals: ["ppt", "pptx", "파워포인트", "슬라이드", "발표자료"],
  capabilities: [
    "PPT 파일의 텍스트를 원하는 언어로 번역합니다.",
    "슬라이드별 핵심 내용과 전체 발표 흐름을 요약합니다.",
    "발표용 문장, 제목, 보완 포인트를 정리합니다.",
  ],
  operatingRules: [
    "PPT 원문을 받지 못했으면 파일 업로드나 텍스트 제공을 요청합니다.",
    "슬라이드 번호나 섹션 단위로 결과를 나눠 사용자가 검토하기 쉽게 답합니다.",
    "번역 요청은 원문 의미를 유지하고 발표 문맥에 맞게 자연스럽게 다듬습니다.",
  ],
  handoffContract: [
    "사용자가 바로 복사하거나 검토할 수 있는 형태로 결과를 작성합니다.",
    "추가로 필요한 파일, 언어, 분량 기준이 있으면 먼저 명확히 묻습니다.",
  ],
  ability: {
    title: "PPT 능력",
    description: "PPT 번역, 요약, 발표용 정리를 도와줍니다.",
    icon: "presentation",
    installableSkillIds: ["slides"],
    examples: [
      "PPT 안의 텍스트를 번역합니다.",
      "슬라이드별 핵심 내용을 요약합니다.",
      "발표 흐름과 보완점을 정리합니다.",
    ],
    guideMarkdown: [
      "# PPT 능력 사용법",
      "",
      "PPT 파일을 올리거나 슬라이드 텍스트를 붙여주고, 원하는 작업을 말하면 됩니다. 결과는 보통 슬라이드 번호별로 나눠서 번역, 요약, 발표 문장 형태로 정리합니다.",
      "",
      "## 예시 요청",
      "",
      "### PPT 텍스트 번역",
      "\"첨부한 PPT의 모든 텍스트를 자연스러운 비즈니스 영어로 번역해줘. 제목, 본문, 표 텍스트를 구분해서 정리해줘.\"",
      "",
      "### PPT 요약",
      "\"이 PPT를 슬라이드별 1줄 요약으로 정리하고, 전체 핵심 메시지 3개도 뽑아줘.\"",
      "",
      "### 발표용 정리",
      "\"이 PPT를 10분 발표용으로 정리해줘. 오프닝 멘트, 슬라이드별 발표 대본, 마무리 멘트, 보완하면 좋은 포인트를 포함해줘.\"",
      "",
      "실제 작업을 하려면 PPT 파일 또는 슬라이드 텍스트와 목표 언어, 발표 시간, 원하는 톤을 알려주면 됩니다.",
    ].join("\n"),
    sortOrder: 20,
  },
  candidateRules: [
    {
      title: "PPT 작업",
      description: "PowerPoint 파일이나 슬라이드 작업 요청입니다.",
      trigger: "PPT, PPTX, 파워포인트, 슬라이드, 발표자료",
      confidence: 0.9,
      keywords: ["ppt", "pptx", "파워포인트", "슬라이드", "발표자료"],
    },
  ],
  protectionRules: [],
};

export const ROCKY_ORCHESTRATION_SKILLS: RockyOrchestrationSkill[] = [
  ROCKY_CORE_SKILL,
  ROCKY_PRESENTATION_SKILL,
];

export function getRockySkill(
  skillId: string | null | undefined
): RockyOrchestrationSkill {
  return (
    ROCKY_ORCHESTRATION_SKILLS.find((skill) => skill.id === skillId) ??
    ROCKY_CORE_SKILL
  );
}

export function getRockySkillByWorkerId(
  workerId: string | null | undefined
): RockyOrchestrationSkill {
  return (
    ROCKY_ORCHESTRATION_SKILLS.find(
      (skill) => skill.worker.id === workerId
    ) ?? ROCKY_CORE_SKILL
  );
}

function isBareConversation(message: string): boolean {
  const bare = compactMessage(message).replace(/[!?.,~\s]/gu, "");
  return ["안녕", "안녕하세요", "하이", "hi", "hello", "헬로", "ㅎㅇ", "테스트"].includes(
    bare
  );
}

function coreIntent(message: string): RockyRoutingIntent {
  const compact = compactMessage(message);
  if (
    (ROCKY_CORE_SKILL.clarificationPatterns ?? []).some((pattern) =>
      pattern.test(compact)
    )
  ) {
    return "clarification";
  }

  return "conversation";
}

function powerPointAttachmentPresent(
  attachments: RockyAttachmentRecord[]
): boolean {
  return attachments.some((attachment) => {
    const name = attachment.name.toLowerCase();
    const contentType = attachment.contentType?.toLowerCase() ?? "";
    return (
      name.endsWith(".ppt") ||
      name.endsWith(".pptx") ||
      contentType.includes("powerpoint") ||
      contentType.includes("presentationml")
    );
  });
}

function selectCapabilitySkill(input: {
  message: string;
  attachments: RockyAttachmentRecord[];
}): RockyOrchestrationSkill | null {
  const compact = compactMessage(input.message);
  if (powerPointAttachmentPresent(input.attachments)) {
    return ROCKY_PRESENTATION_SKILL;
  }

  return (
    ROCKY_ORCHESTRATION_SKILLS.find(
      (skill) =>
        skill.id !== ROCKY_CORE_SKILL.id &&
        (includesAny(compact, skill.conversationSignals ?? []) ||
          skill.candidateRules.some((rule) =>
            includesAny(compact, rule.keywords)
          ))
    ) ?? null
  );
}

export function requestRequiresChartArtifact(
  _skill: RockyOrchestrationSkill,
  _message: string,
  _attachments: RockyAttachmentRecord[]
): boolean {
  return false;
}

export function selectRockySkill(input: {
  message: string;
  attachments: RockyAttachmentRecord[];
  contextDomain?: RockyChatDomain;
}): RockySkillSelection {
  const intent = coreIntent(input.message);
  const capabilitySkill = selectCapabilitySkill(input);
  if (capabilitySkill && intent !== "clarification") {
    return {
      skill: capabilitySkill,
      intent,
      domain: capabilitySkill.domain,
      reason: `${capabilitySkill.displayName}에 맞는 요청이라 해당 skill로 처리합니다.`,
    };
  }

  const conversationMatch =
    isBareConversation(input.message) ||
    includesAny(compactMessage(input.message), ROCKY_CORE_SKILL.conversationSignals ?? []);

  return {
    skill: ROCKY_CORE_SKILL,
    intent,
    domain: "general",
    reason:
      intent === "clarification"
        ? "모호한 요청이라 Rocky Core에서 확인 질문을 준비합니다."
        : conversationMatch
          ? "일반 대화라 Rocky Core에서 답변합니다."
          : "홈 채팅 요청을 Rocky Core에서 처리합니다.",
  };
}

export function listRockySkillAbilityCards(input: {
  installedSkillIds?: string[];
} = {}): RockyAbilityCardRecord[] {
  const installedSkillIds = new Set(input.installedSkillIds ?? []);

  return ROCKY_ORCHESTRATION_SKILLS.flatMap((skill) => {
    if (!skill.ability) {
      return [];
    }

    const matchedSkillIds = skill.ability.installableSkillIds ?? [];
    const matchedInstalledSkillIds = matchedSkillIds.filter((skillId) =>
      installedSkillIds.has(skillId)
    );

    return [
      {
        id: skill.id,
        skillId: skill.id,
        title: skill.ability.title,
        description: skill.ability.description,
        icon: skill.ability.icon,
        examples: skill.ability.examples,
        matchedSkillIds,
        installedSkillIds: matchedInstalledSkillIds,
        installed: matchedInstalledSkillIds.length > 0,
        sortOrder: skill.ability.sortOrder ?? 100,
      },
    ];
  }).sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.title.localeCompare(right.title)
  );
}

export function getRockySkillByAbilityId(
  abilityId: string | null | undefined
): RockyOrchestrationSkill | null {
  if (!abilityId) {
    return null;
  }

  const skill = ROCKY_ORCHESTRATION_SKILLS.find(
    (entry) => entry.id === abilityId && entry.ability
  );
  return skill ?? null;
}

export function extractRockySkillCandidates(_input: {
  skill: RockyOrchestrationSkill;
  message: string;
  sourceMessageId: string;
  createdAt: string;
  idGenerator: () => string;
}): RockySkillCandidateRecord[] {
  return [];
}

export function extractRockyProtectionHints(_input: {
  skill: RockyOrchestrationSkill;
  message: string;
  attachments: RockyAttachmentRecord[];
}): string[] {
  return [];
}
