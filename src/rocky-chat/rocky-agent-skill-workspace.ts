import path from "node:path";
import { mkdir, readdir, writeFile } from "node:fs/promises";

import {
  WORKSPACE_LOCAL_SKILL_AUTHORING_DIR,
  ensureWorkspaceSkillBridge,
  listWorkspaceLocalSkills,
} from "../agents/agent-workspace.js";

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

interface PackagedSkillInputSummary {
  skillDisplayName: string;
  files: string[];
}

const IGNORED_PACKAGED_INPUT_FILENAMES = new Set([".DS_Store"]);

function formatList(items: string[]): string {
  if (items.length === 0) {
    return "- 없음";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function linkedSkillIds(skill: RockyOrchestrationSkill): string[] {
  return skill.ability?.installableSkillIds ?? [];
}

function formatLinkedSkillInstructions(skill: RockyOrchestrationSkill): string[] {
  const skillIds = linkedSkillIds(skill);
  if (skillIds.length === 0) {
    return [];
  }

  return [
    "연결된 workspace-local skill:",
    ...skillIds.map(
      (skillId) =>
        `- \`${WORKSPACE_LOCAL_SKILL_AUTHORING_DIR}/${skillId}/SKILL.md\`가 있으면 먼저 읽고, 해당 절차와 도구 사용 지침을 우선 적용합니다.`
    ),
    "- 연결된 skill 파일이 없으면 없는 상태를 명확히 밝히고, 현재 workspace와 사용 가능한 도구 범위 안에서 처리합니다.",
    "",
  ];
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
      const workspacePath = attachment.workspacePath
        ? `, workspace path: ${attachment.workspacePath}`
        : "";
      return `- ${attachment.name} (${contentType}, ${size}${workspacePath})`;
    })
    .join("\n");
}

async function collectPackagedInputFileNames(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (IGNORED_PACKAGED_INPUT_FILENAMES.has(entry.name)) {
      continue;
    }

    const childPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectPackagedInputFileNames(childPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(entry.name);
    }
  }

  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}

async function listPackagedSkillInputSummaries(
  workspaceRoot: string
): Promise<PackagedSkillInputSummary[]> {
  const skills = await listWorkspaceLocalSkills(workspaceRoot);
  const summaries: PackagedSkillInputSummary[] = [];

  for (const skill of skills) {
    const inputRoot = path.join(path.dirname(skill.skillPath), "assets", "inputs");
    const files = await collectPackagedInputFileNames(inputRoot);
    if (files.length === 0) {
      continue;
    }

    summaries.push({
      skillDisplayName: skill.displayName,
      files,
    });
  }

  return summaries;
}

function formatPackagedSkillInputs(summaries: PackagedSkillInputSummary[]): string {
  if (summaries.length === 0) {
    return "- 없음";
  }

  return summaries
    .flatMap((summary) =>
      summary.files.map((file) => `- ${file} (스킬: ${summary.skillDisplayName})`)
    )
    .join("\n");
}

function executionModeLabel(intent: RockyRoutingIntent): string {
  return intent === "clarification" ? "rocky core clarification" : "rocky core session";
}

function domainLabel(_domain: RockyChatDomain): string {
  return "일반 요청";
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
    "Execution mode: rocky core session",
    `요청 영역: ${domainLabel(skill.domain)}`,
    `Agent: ${skill.agent.name}`,
    "",
    "설명:",
    skill.description,
    "",
    "처리 범위:",
    formatList(skill.capabilities),
    "",
    "운영 규칙:",
    formatList(skill.operatingRules),
    "",
    "응답 기준:",
    formatList(skill.handoffContract),
    "",
    "현재 턴 처리 규칙:",
    "- 사용자 요청은 현재 turn의 원문 user message를 그대로 사용합니다.",
    "- 현재 turn의 첨부 메타데이터는 runtime system instructions에 지정된 context file에서 확인합니다.",
    "- 별도 템플릿 문서를 사용자 요청으로 다시 감싸지 않습니다.",
    "",
    ...formatLinkedSkillInstructions(skill),
    "응답:",
    "- 한국어로 답하세요.",
    "- 사용자에게 바로 전달할 수 있는 최종 답변을 작성하세요.",
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
  packagedSkillInputs?: PackagedSkillInputSummary[];
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
    `Execution mode: ${executionModeLabel(input.dispatch.intent)}`,
    `요청 영역: ${domainLabel(input.domain)}`,
    `Agent: ${input.skill.agent.name}`,
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
    "스킬 포함 파일:",
    formatPackagedSkillInputs(input.packagedSkillInputs ?? []),
    "",
    "파일 목록 답변 기준:",
    "- 사용자가 첨부 파일만 물으면 첨부 메타데이터를 기준으로 답합니다.",
    "- 사용자가 올라와 있는 파일, 사용 가능한 파일, 또는 파일 목록을 물으면 첨부 메타데이터와 스킬 포함 파일을 함께 구분해 답합니다.",
    "- 스킬 포함 파일은 파일명과 스킬 표시 이름만 답하고 내부 저장 경로는 노출하지 않습니다.",
    "",
  ].join("\n");
}

export async function syncRockyAgentSkillWorkspace(input: {
  agent: AgentRecord;
  skill: RockyOrchestrationSkill;
}): Promise<string> {
  const skillDir = path.join(
    input.agent.workspaceRoot,
    WORKSPACE_LOCAL_SKILL_AUTHORING_DIR,
    input.skill.id
  );
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
      packagedSkillInputs: await listPackagedSkillInputSummaries(
        input.agent.workspaceRoot
      ),
      skillCandidates: input.skillCandidates,
      protectionHints: input.protectionHints,
      timestamp: input.timestamp,
    }),
    "utf8"
  );
  return relativePath;
}

export function buildAgentTurnContextMarkdown(input: {
  agent: AgentRecord;
  chatId: string;
  dispatch: RockyDispatchRecord;
  attachments: RockyAttachmentRecord[];
  packagedSkillInputs?: PackagedSkillInputSummary[];
  timestamp: string;
}): string {
  return [
    "# Agent Turn Context",
    "",
    `Agent: ${input.agent.name}`,
    `Agent ID: ${input.agent.id}`,
    "Execution mode: agent session",
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
    "스킬 포함 파일:",
    formatPackagedSkillInputs(input.packagedSkillInputs ?? []),
    "",
    "파일 목록 답변 기준:",
    "- 사용자가 첨부 파일만 물으면 첨부 메타데이터를 기준으로 답합니다.",
    "- 사용자가 올라와 있는 파일, 사용 가능한 파일, 또는 파일 목록을 물으면 첨부 메타데이터와 스킬 포함 파일을 함께 구분해 답합니다.",
    "- 스킬 포함 파일은 파일명과 스킬 표시 이름만 답하고 내부 저장 경로는 노출하지 않습니다.",
    "",
  ].join("\n");
}

export async function writeAgentTurnContextFile(input: {
  agent: AgentRecord;
  chatId: string;
  dispatch: RockyDispatchRecord;
  attachments: RockyAttachmentRecord[];
  timestamp: string;
}): Promise<string> {
  const relativePath = `${ROCKY_AGENT_REQUEST_CONTEXT_DIR}/${input.dispatch.id}.md`;
  const absolutePath = path.join(input.agent.workspaceRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    buildAgentTurnContextMarkdown({
      agent: input.agent,
      chatId: input.chatId,
      dispatch: input.dispatch,
      attachments: input.attachments,
      packagedSkillInputs: await listPackagedSkillInputSummaries(
        input.agent.workspaceRoot
      ),
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
    `Use the workspace-local Rocky Core instructions in \`${WORKSPACE_LOCAL_SKILL_AUTHORING_DIR}/${input.skill.id}/SKILL.md\` for this turn.`,
    ...linkedSkillIds(input.skill).map(
      (skillId) =>
        `If \`${WORKSPACE_LOCAL_SKILL_AUTHORING_DIR}/${skillId}/SKILL.md\` exists, read it and apply it as the linked skill instructions for this turn.`
    ),
    `Read \`${input.contextRelativePath}\` in the workspace before answering.`,
    "Treat the current user message as the canonical original request.",
  ];
}

export function buildAgentTurnSystemInstructions(input: {
  agent: AgentRecord;
  contextRelativePath: string;
}): string[] {
  return [
    `You are running as the "${input.agent.name}" agent. Use this agent's configured role and available local skills when relevant.`,
    "When applying an installed user-facing skill, inspect the matching skill directory under `.agents/skills/`, read its `SKILL.md`, and inspect packaged files in that skill directory before asking the user to upload missing inputs.",
    "Generic file searches can skip hidden skill directories, so explicitly inspect `.agents/skills/` when a needed input may be bundled with an installed skill.",
    "When the user asks for uploaded, available, current, or listed files, distinguish newly attached files from packaged files included with installed skills; include packaged input filenames from the turn context when present.",
    "Do not answer that no usable files exist only because attachment metadata is empty; skill-packaged input files in the turn context are already available inputs.",
    `Read \`${input.contextRelativePath}\` in the workspace before answering.`,
    "Treat the current user message as the canonical original request.",
    "If the user asks which skills are available, installed, or equipped, answer only with this agent's installed skill display names; do not list read-only system skills or unavailable repository-root developer skills.",
    "Do not expose internal skill identifiers, invocation strings, file paths, or storage categories in user-facing answers.",
    "Never use the literal phrases `workspace-local`, `호출 ID`, `SKILL.md`, `.agents/skills`, `system`, or `read-only` in user-facing skill inventory answers.",
    "When you apply one or more installed user-facing skills, append a final hidden HTML comment exactly like `<!-- rocky-used-skills: [\"Skill Display Name\"] -->`; keep this marker out of the visible answer text.",
  ];
}
