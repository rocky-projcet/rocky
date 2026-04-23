import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { ensureWorkspaceSkillBridge } from "../agents/agent-workspace.js";

import type { AgentRecord } from "../agents/agent-types.js";
import type {
  RockyAttachmentRecord,
  RockyChatDomain,
  RockyDispatchRecord,
  RockyRoutingIntent,
  RockySkillCandidateRecord,
} from "./rocky-chat-types.js";
import type { RockyOrchestrationSkill } from "./rocky-skill-registry.js";

export const ROCKY_AGENT_REQUEST_CONTEXT_DIR = ".agents/rocky/requests";

function formatList(items: string[]): string {
  if (items.length === 0) {
    return "- 없음";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function formatAttachments(attachments: RockyAttachmentRecord[]): string {
  if (attachments.length === 0) {
    return "- 없음";
  }

  return attachments
    .map((attachment) => {
      const size =
        typeof attachment.size === "number" ? `${attachment.size} bytes` : "size unknown";
      const contentType = attachment.contentType ?? "content type unknown";
      return `- ${attachment.name} (${contentType}, ${size})`;
    })
    .join("\n");
}

function formatSkillCandidates(candidates: RockySkillCandidateRecord[]): string {
  if (candidates.length === 0) {
    return "- 없음";
  }

  return candidates
    .map(
      (candidate) =>
        `- ${candidate.title}: ${candidate.description} (trigger: ${candidate.trigger})`
    )
    .join("\n");
}

function formatProtectionHints(hints: string[]): string {
  if (hints.length === 0) {
    return "- 없음";
  }

  return hints.map((hint) => `- ${hint}`).join("\n");
}

function executionModeLabel(
  skill: RockyOrchestrationSkill,
  intent: RockyRoutingIntent
): string {
  if (skill.mode === "core") {
    return intent === "clarification" ? "core clarification" : "core conversation";
  }

  return "delegated execution";
}

function domainLabel(domain: RockyChatDomain): string {
  return domain === "nutrition-md" ? "영양제 MD 작업" : "일반 자료 작업";
}

export function buildRockyWorkspaceSkillMarkdown(
  skill: RockyOrchestrationSkill
): string {
  return [
    `# ${skill.displayName}`,
    "",
    `Skill: ${skill.displayName}`,
    `Skill ID: ${skill.id}`,
    `Skill version: ${skill.version}`,
    `Execution mode: ${skill.mode === "core" ? "core conversation" : "delegated execution"}`,
    `작업 영역: ${domainLabel(skill.domain)}`,
    `담당: ${skill.worker.displayName}`,
    "",
    "스킬 설명:",
    skill.description,
    "",
    "스킬 역량:",
    formatList(skill.capabilities),
    "",
    "운영 규칙:",
    formatList(skill.operatingRules),
    "",
    "Rocky 전달 계약:",
    formatList(skill.handoffContract),
    "",
    "현재 턴 처리 규칙:",
    "- 사용자 요청은 현재 turn의 원문 user message를 그대로 사용합니다.",
    "- 현재 turn의 첨부 메타데이터, 반복 기준 후보, 보호 항목은 runtime system instructions에 지정된 context file에서 확인합니다.",
    "- 별도 템플릿 문서를 사용자 요청으로 다시 감싸지 않습니다.",
    "",
    "응답:",
    "- 한국어로 답하세요.",
    "- Rocky가 별도 가공 없이 사용자에게 전달할 수 있는 최종 답변을 작성하세요.",
    "- 최종 답변은 Markdown으로 작성하고, 필요한 경우 제목, 목록, 표, 코드 블록을 사용하세요.",
    "- 실행하지 못한 부분이 있으면 이유와 필요한 입력을 명확히 적으세요.",
    "",
  ].join("\n");
}

export function buildRockyTurnContextMarkdown(input: {
  chatId: string;
  dispatch: RockyDispatchRecord;
  domain: RockyChatDomain;
  skill: RockyOrchestrationSkill;
  attachments: RockyAttachmentRecord[];
  skillCandidates: RockySkillCandidateRecord[];
  protectionHints: string[];
  timestamp: string;
}): string {
  return [
    "# Rocky Turn Context",
    "",
    `Skill: ${input.skill.displayName}`,
    `Skill ID: ${input.skill.id}`,
    `Skill version: ${input.skill.version}`,
    `Execution mode: ${executionModeLabel(input.skill, input.dispatch.intent)}`,
    `작업 영역: ${domainLabel(input.domain)}`,
    `담당: ${input.skill.worker.displayName}`,
    "",
    "요청 분류:",
    `- chat_id: ${input.chatId}`,
    `- dispatch_id: ${input.dispatch.id}`,
    `- intent: ${input.dispatch.intent}`,
    `- created_at: ${input.timestamp}`,
    "",
    "첨부 메타데이터:",
    formatAttachments(input.attachments),
    "",
    "반복 기준 후보:",
    formatSkillCandidates(input.skillCandidates),
    "",
    "보호해서 다룰 항목:",
    formatProtectionHints(input.protectionHints),
    "",
  ].join("\n");
}

export async function syncRockyAgentSkillWorkspace(input: {
  agent: AgentRecord;
  skill: RockyOrchestrationSkill;
}): Promise<string> {
  const skillDir = path.join(input.agent.workspaceRoot, "skills", input.skill.id);
  const skillPath = path.join(skillDir, "SKILL.md");
  await mkdir(skillDir, { recursive: true });
  await writeFile(skillPath, buildRockyWorkspaceSkillMarkdown(input.skill), "utf8");
  await ensureWorkspaceSkillBridge(input.agent.workspaceRoot);
  return skillPath;
}

export async function writeRockyTurnContextFile(input: {
  agent: AgentRecord;
  chatId: string;
  dispatch: RockyDispatchRecord;
  domain: RockyChatDomain;
  skill: RockyOrchestrationSkill;
  attachments: RockyAttachmentRecord[];
  skillCandidates: RockySkillCandidateRecord[];
  protectionHints: string[];
  timestamp: string;
}): Promise<string> {
  const relativePath = `${ROCKY_AGENT_REQUEST_CONTEXT_DIR}/${input.dispatch.id}.md`;
  const absolutePath = path.join(input.agent.workspaceRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    buildRockyTurnContextMarkdown({
      chatId: input.chatId,
      dispatch: input.dispatch,
      domain: input.domain,
      skill: input.skill,
      attachments: input.attachments,
      skillCandidates: input.skillCandidates,
      protectionHints: input.protectionHints,
      timestamp: input.timestamp,
    }),
    "utf8"
  );
  return relativePath;
}

export function buildRockyTurnSystemInstructions(input: {
  skill: RockyOrchestrationSkill;
  contextRelativePath: string;
}): string[] {
  return [
    `Use the workspace-local skill \`${input.skill.id}\` for this turn.`,
    `Read \`${input.contextRelativePath}\` in the workspace before answering.`,
    "Treat the current user message as the canonical original request.",
  ];
}
