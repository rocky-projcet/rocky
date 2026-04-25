import {
  ROCKY_CORE_AGENT_ID,
  ROCKY_CORE_WORKER_ID,
} from "./rocky-chat-constants.js";

import type {
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
  candidateRules: [],
  protectionRules: [],
};

export const ROCKY_ORCHESTRATION_SKILLS: RockyOrchestrationSkill[] = [
  ROCKY_CORE_SKILL,
];

export function getRockySkill(
  _skillId: string | null | undefined
): RockyOrchestrationSkill {
  return ROCKY_CORE_SKILL;
}

export function getRockySkillByWorkerId(
  _workerId: string | null | undefined
): RockyOrchestrationSkill {
  return ROCKY_CORE_SKILL;
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
