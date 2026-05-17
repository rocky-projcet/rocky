import path from "node:path";
import { mkdir, readdir, writeFile } from "node:fs/promises";

import {
  WORKSPACE_LOCAL_SKILL_AUTHORING_DIR,
  ensureWorkspaceSkillBridge,
  listWorkspaceLocalSkills,
} from "../agents/agent-workspace.js";

import type { AgentRecord } from "../agents/agent-types.js";
import type {
  ConnectorBrowserAccessRecord,
  ConnectorCapabilityRecord,
  ConnectorProfileRecord,
} from "../connectors/connector-types.js";
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
const ROCKY_TASK_INPUTS_DIRECTORY = "inputs";
const ROCKY_TASK_OUTPUTS_DIRECTORY = "outputs";

export interface AgentEcountLookupInstruction {
  configured: boolean;
  preparedResults: AgentPreparedIntegrationSummary[];
}

export interface AgentPreparedIntegrationSummary {
  provider: "ecount" | "threads";
  dataset: string;
  title: string;
  status: "ready" | "failed" | "unsupported" | "not-configured";
  api: string | null;
  count: number | null;
  returnedCount: number | null;
  checkedAt: string | null;
  workspacePath: string | null;
  message: string;
  diagnostic: string | null;
  source: "fresh" | "existing" | "settings";
}

export interface AgentConnectorSummary {
  provider: string;
  label: string;
  status: "idle" | "connecting" | "connected" | "failed";
  loginMode: string | null;
  accountLabel: string | null;
  connectedAt: string | null;
  browserAccess: ConnectorBrowserAccessRecord;
  capabilities: ConnectorCapabilityRecord[];
  draftPublishing: "server-managed" | null;
  requiredBySkills?: Array<{
    id: string;
    displayName: string;
  }>;
}

export interface AgentConnectorProfileSummary {
  provider: string;
  label: string;
  status: "ready" | "failed" | "not-connected" | "unsupported";
  accountLabel: string | null;
  profile: ConnectorProfileRecord | null;
  message: string;
  checkedAt: string | null;
}

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

function formatPreparedIntegrationResults(
  summaries: AgentPreparedIntegrationSummary[]
): string {
  if (summaries.length === 0) {
    return "- 없음";
  }

  return summaries
    .map((summary) => {
      const details = [
        summary.api ? `api=${summary.api}` : null,
        typeof summary.count === "number" ? `total=${summary.count}` : null,
        typeof summary.returnedCount === "number"
          ? `returned=${summary.returnedCount}`
          : null,
        summary.workspacePath ? `file=${summary.workspacePath}` : null,
        summary.checkedAt ? `checked_at=${summary.checkedAt}` : null,
        summary.diagnostic ? `diagnostic=${summary.diagnostic}` : null,
      ].filter(Boolean);
      return `- ${summary.title}: ${summary.status}; ${summary.message}${
        details.length > 0 ? ` (${details.join(", ")})` : ""
      }`;
    })
    .join("\n");
}

function formatConnectorProfileResults(
  summaries: AgentConnectorProfileSummary[]
): string {
  if (summaries.length === 0) {
    return "- 없음";
  }

  return summaries
    .map((summary) => {
      const profile = summary.profile;
      const details = [
        summary.accountLabel ? `account=${summary.accountLabel}` : null,
        profile?.id ? `id=${profile.id}` : null,
        profile?.username ? `username=${profile.username}` : null,
        profile?.displayName ? `display_name=${profile.displayName}` : null,
        profile?.bio ? `bio=${profile.bio}` : null,
        profile?.followersText ? `followers=${profile.followersText}` : null,
        profile?.url ? `url=${profile.url}` : null,
        summary.checkedAt ? `checked_at=${summary.checkedAt}` : null,
      ].filter(Boolean);
      return `- ${summary.label}: ${summary.status}; ${summary.message}${
        details.length > 0 ? ` (${details.join(", ")})` : ""
      }`;
    })
    .join("\n");
}

function formatConnectorSummaries(summaries: AgentConnectorSummary[]): string {
  if (summaries.length === 0) {
    return "- 없음";
  }

  return summaries
    .map((summary) => {
      const details = [
        summary.loginMode ? `mode=${summary.loginMode}` : null,
        summary.accountLabel ? `account=${summary.accountLabel}` : null,
        summary.connectedAt ? `connected_at=${summary.connectedAt}` : null,
        `browser=${summary.browserAccess.status}${
          summary.browserAccess.policy ? `:${summary.browserAccess.policy}` : ""
        }`,
        summary.draftPublishing ? `draft_publish=${summary.draftPublishing}` : null,
        summary.capabilities.length > 0
          ? `capabilities=${summary.capabilities
              .map((capability) =>
                `${capability.id}:${capability.action}${
                  capability.requiresApproval ? ":approval" : ""
                }${capability.status ? `:status=${capability.status}` : ""}${
                  capability.sourceSkillId ? `:skill_id=${capability.sourceSkillId}` : ""}${
                  capability.sourceSkillName ? `:skill=${capability.sourceSkillName}` : ""
                }${capability.scriptPath ? `:script=${capability.scriptPath}` : ""}${
                  capability.usage ? `:usage=${capability.usage}` : ""
                }`
              )
              .join("|")}`
          : null,
        summary.requiredBySkills && summary.requiredBySkills.length > 0
          ? `required_by=${summary.requiredBySkills
              .map((skill) => skill.displayName)
              .join("|")}`
          : null,
      ].filter(Boolean);
      return `- ${summary.label}: ${summary.status}${
        details.length > 0 ? ` (${details.join(", ")})` : ""
      }`;
    })
    .join("\n");
}

function executionModeLabel(intent: RockyRoutingIntent): string {
  return intent === "clarification" ? "rocky core clarification" : "rocky core session";
}

function domainLabel(_domain: RockyChatDomain): string {
  return "일반 요청";
}

export function sanitizeRockyTaskPathSegment(value: string): string {
  return (
    value
      .trim()
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "") || "task"
  );
}

export function rockyTaskInputDirectory(chatId: string): string {
  return path.posix.join(
    ROCKY_TASK_INPUTS_DIRECTORY,
    sanitizeRockyTaskPathSegment(chatId)
  );
}

export function rockyTaskAttachmentDirectory(
  chatId: string,
  attachmentId: string
): string {
  return path.posix.join(
    rockyTaskInputDirectory(chatId),
    sanitizeRockyTaskPathSegment(attachmentId)
  );
}

export function rockyTaskOutputDirectory(chatId: string): string {
  return path.posix.join(
    ROCKY_TASK_OUTPUTS_DIRECTORY,
    sanitizeRockyTaskPathSegment(chatId)
  );
}

function formatTaskFileWorkspace(chatId: string): string[] {
  const inputDirectory = rockyTaskInputDirectory(chatId);
  const outputDirectory = rockyTaskOutputDirectory(chatId);

  return [
    "작업 파일 영역:",
    `- task_input_dir: ${inputDirectory}`,
    `- task_output_dir: ${outputDirectory}`,
    "",
    "작업 파일 규칙:",
    `- 이번 작업의 사용자 첨부와 입력 파일은 \`${inputDirectory}/\` 아래에 둡니다.`,
    `- 이번 작업의 최종 산출물은 반드시 \`${outputDirectory}/\` 아래에 생성합니다.`,
    `- 템플릿이나 연결된 스킬 지시문이 일반 \`outputs/\`를 말하면, 이 작업에서는 \`${outputDirectory}/\`로 해석합니다.`,
    `- 최종 답변에는 생성한 산출물별 \`${outputDirectory}/...\` 상대 경로를 적습니다.`,
    "",
  ];
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
    ...formatTaskFileWorkspace(input.chatId),
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
  preparedIntegrations?: AgentPreparedIntegrationSummary[];
  connectorProfileResults?: AgentConnectorProfileSummary[];
  connectorSummaries?: AgentConnectorSummary[];
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
    ...formatTaskFileWorkspace(input.chatId),
    "첨부 메타데이터:",
    formatAttachments(input.attachments),
    "",
    "스킬 포함 파일:",
    formatPackagedSkillInputs(input.packagedSkillInputs ?? []),
    "",
    "연동 조회 결과:",
    formatPreparedIntegrationResults(input.preparedIntegrations ?? []),
    "",
    "커넥터 프로필 조회 결과:",
    formatConnectorProfileResults(input.connectorProfileResults ?? []),
    "",
    "계정 연동 상태:",
    formatConnectorSummaries(input.connectorSummaries ?? []),
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
  preparedIntegrations?: AgentPreparedIntegrationSummary[];
  connectorProfileResults?: AgentConnectorProfileSummary[];
  connectorSummaries?: AgentConnectorSummary[];
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
      preparedIntegrations: input.preparedIntegrations ?? [],
      connectorProfileResults: input.connectorProfileResults ?? [],
      connectorSummaries: input.connectorSummaries ?? [],
      timestamp: input.timestamp,
    }),
    "utf8"
  );
  return relativePath;
}

export function buildRockyTurnSystemInstructions(input: {
  skill: RockyOrchestrationSkill;
  contextRelativePath: string;
  chatId: string;
}): string[] {
  const outputDirectory = rockyTaskOutputDirectory(input.chatId);

  return [
    `Use the workspace-local Rocky Core instructions in \`${WORKSPACE_LOCAL_SKILL_AUTHORING_DIR}/${input.skill.id}/SKILL.md\` for this turn.`,
    ...linkedSkillIds(input.skill).map(
      (skillId) =>
        `If \`${WORKSPACE_LOCAL_SKILL_AUTHORING_DIR}/${skillId}/SKILL.md\` exists, read it and apply it as the linked skill instructions for this turn.`
    ),
    `Read \`${input.contextRelativePath}\` in the workspace before answering.`,
    `Use \`${outputDirectory}\` as the only final deliverable directory for this task; generic \`outputs/\` instructions from templates or linked skills mean \`${outputDirectory}/\` here.`,
    "Treat the current user message as the canonical original request.",
  ];
}

export function buildAgentTurnSystemInstructions(input: {
  agent: AgentRecord;
  contextRelativePath: string;
  chatId: string;
  ecountLookup?: AgentEcountLookupInstruction | null;
  hasTistoryDraftPublisher?: boolean;
  hasConnectedBrowserConnector?: boolean;
  hasConnectorProfileResults?: boolean;
  hasPreparedIntegrationResults?: boolean;
}): string[] {
  const outputDirectory = rockyTaskOutputDirectory(input.chatId);

  return [
    `You are running as the "${input.agent.name}" agent. Use this agent's configured role and available local skills when relevant.`,
    "When applying an installed user-facing skill, inspect the matching skill directory under `.agents/skills/`, read its `SKILL.md`, and inspect packaged files in that skill directory before asking the user to upload missing inputs.",
    "Generic file searches can skip hidden skill directories, so explicitly inspect `.agents/skills/` when a needed input may be bundled with an installed skill.",
    "When creating or editing an agent-local skill, write it under `skills/<skill-id>/`; Rocky indexes it into the installed skill bridge.",
    "When the user asks for uploaded, available, current, or listed files, distinguish newly attached files from packaged files included with installed skills; include packaged input filenames from the turn context when present.",
    "Do not answer that no usable files exist only because attachment metadata is empty; skill-packaged input files in the turn context are already available inputs.",
    `Read \`${input.contextRelativePath}\` in the workspace before answering.`,
    `Use \`${outputDirectory}\` as the only final deliverable directory for this task; generic \`outputs/\` instructions from installed skills mean \`${outputDirectory}/\` here.`,
    "Treat the current user message as the canonical original request.",
    "If the user asks which skills are available, installed, or equipped, answer only with this agent's installed skill display names; do not list read-only system skills or unavailable repository-root developer skills.",
    "Do not expose internal skill identifiers, invocation strings, file paths, or storage categories in user-facing answers.",
    "Never use the literal phrases `workspace-local`, `호출 ID`, `SKILL.md`, `.agents/skills`, `system`, or `read-only` in user-facing skill inventory answers.",
    "When you apply one or more installed user-facing skills, append a final hidden HTML comment exactly like `<!-- rocky-used-skills: [\"Skill Display Name\"] -->`; keep this marker out of the visible answer text.",
    ...(input.ecountLookup
      ? input.ecountLookup.configured
        ? [
            "A Rocky-managed ECOUNT ERP lookup integration is configured for installed ECOUNT skills. The integration is read-only and is executed by Rocky before the turn when relevant.",
            "Use the ECOUNT lookup files and summaries listed in the turn context as the source of truth. Do not call localhost, 127.0.0.1, or Rocky HTTP integration endpoints yourself.",
            "If an ECOUNT lookup file is listed, read that file once and reuse it for summaries, examples, and follow-up analysis instead of attempting another lookup.",
            "If an ECOUNT lookup summary is marked unsupported, clearly report that the Rocky backend does not yet support that dataset and continue with supported lookup files only.",
            "If the needed ECOUNT lookup result is absent, ask the user to request or refresh that lookup instead of trying a local HTTP call.",
            "Rocky stores ECOUNT credentials. Never ask the user for ECOUNT API keys, passwords, or session IDs in chat, and never print secrets.",
            "Do not create, update, delete, submit, or transmit ECOUNT ERP records.",
          ]
        : [
            "An installed skill mentions ECOUNT ERP, but Rocky reports that ECOUNT connection settings are not configured.",
            "For ECOUNT lookup requests, tell the user to complete the ECOUNT ERP connection test in the integration settings. Do not ask for API keys, passwords, or session IDs in chat.",
          ]
      : []),
    ...(input.hasPreparedIntegrationResults
      ? [
          "Prepared integration lookup results may be listed in the turn context. Use those results and files as the source of truth before attempting any connector capability script for the same read.",
          "If a prepared connector lookup file is listed, read that file once and reuse it for summaries and follow-up analysis instead of calling localhost, 127.0.0.1, or Rocky HTTP connector endpoints.",
        ]
      : []),
    ...(input.hasTistoryDraftPublisher
      ? [
          "A Rocky-managed Tistory account connector is connected for this turn. The connected account summary and server-managed draft publishing status are listed in the turn context.",
          "For Tistory upload requests, create or reuse publish-ready Markdown in the task output directory with title, body, and comma-separated tag sections.",
          "Do not call localhost, 127.0.0.1, or Rocky HTTP connector endpoints yourself. Rocky server submits the Tistory draft after this turn when a publish-ready Markdown file is available.",
          "The Tistory connector currently saves drafts only. Do not claim public publishing unless Rocky server appends an explicit public publishing result.",
          "If Rocky server appends a Tistory draft result, report that result and keep the publish-ready file path.",
          "Never print browser cookies, session storage, OAuth tokens, API keys, or connector secret values.",
        ]
      : []),
    ...(input.hasConnectedBrowserConnector
      ? [
          "Rocky-managed browser account connectors may be connected for this turn. Use the connector summary in the turn context as the source of truth for connected account state.",
          "When a connector capability lists a skill script, read the owning installed skill instructions and use that script for the provider-specific work instead of asking Rocky backend for a new one-off connector endpoint. The script path is relative to `.agents/skills/<skill_id>/`.",
          "Use only connector capabilities with no status or status=available for execution. Treat status=planned or status=unsupported as documentation, not executable functionality.",
          "Connector capabilities marked as read can be used without extra approval. Connector capabilities marked as write or approval require explicit user approval before posting, editing, deleting, submitting, or otherwise exposing changes externally.",
          "Do not ask the user for connector passwords, two-factor authentication codes, browser cookies, session storage, OAuth tokens, or API keys in chat.",
          "If a connected browser session is expired, logged out, or asks for two-factor authentication again, tell the user to re-authenticate from Rocky account integrations.",
        ]
      : []),
    ...(input.hasConnectorProfileResults
      ? [
          "Connector profile read results may be listed in the turn context. Use those prepared results as the source of truth and do not invoke desktop browser automation to re-check the same profile.",
        ]
      : []),
  ];
}
