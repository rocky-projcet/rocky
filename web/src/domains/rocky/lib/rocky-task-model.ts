import type { MdTemplateDefinition } from "../../template/types.js";
import type {
  RockyAttachmentRecord,
  RockyChatRecord,
  RockyOrchestrationRecord,
  RockyOrchestrationStatus,
} from "../../../shared/lib/agent-engine-client.js";

const TEMPLATE_RUN_MARKER = "[Rocky 템플릿 실행]";

export type RockyTaskStatus =
  | RockyOrchestrationStatus
  | "ready"
  | "waiting";

export type RockyTaskTemplateGroup = {
  id: string;
  label: string;
};

function latestOrchestration(
  chat: RockyChatRecord
): RockyOrchestrationRecord | null {
  const orchestrations = [
    ...chat.dispatches.flatMap((dispatch) =>
      dispatch.orchestration ? [dispatch.orchestration] : []
    ),
    ...(chat.orchestration ? [chat.orchestration] : []),
  ];

  return (
    orchestrations.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )[0] ?? null
  );
}

export function getRockyTaskStatus(chat: RockyChatRecord): RockyTaskStatus {
  const active = chat.dispatches.find((dispatch) => {
    const status = dispatch.orchestration?.status;
    return status === "running" || status === "planned";
  });
  if (active?.orchestration?.status) {
    return active.orchestration.status;
  }

  const latest = latestOrchestration(chat);
  if (latest?.status) {
    return latest.status;
  }

  return chat.messages.length > 0 ? "ready" : "waiting";
}

export function rockyTaskStatusLabel(status: RockyTaskStatus): string {
  if (status === "planned") return "대기중";
  if (status === "running") return "진행중";
  if (status === "completed") return "완료";
  if (status === "failed") return "실패";
  if (status === "cancelled") return "중단됨";
  if (status === "ready") return "응답 대기";
  return "초기화";
}

export function rockyTaskStatusTone(status: RockyTaskStatus): string {
  if (status === "running" || status === "planned") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  }

  if (status === "failed") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }

  if (status === "completed") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700";
  }

  if (status === "cancelled") {
    return "border-zinc-500/25 bg-zinc-500/10 text-zinc-700";
  }

  return "border-border bg-muted text-muted-foreground";
}

export function isRockyTaskActive(chat: RockyChatRecord): boolean {
  const status = getRockyTaskStatus(chat);
  return status === "running" || status === "planned";
}

export function formatRockyTaskDateTime(value: string | null | undefined): string {
  if (!value) {
    return "아직 없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatRockyTaskDuration(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined
): string {
  if (!startedAt) {
    return "아직 없음";
  }

  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return "계산 불가";
  }

  const seconds = Math.max(1, Math.round((end - start) / 1000));
  if (seconds < 60) {
    return `${seconds}초`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}분`;
  }

  const hours = Math.round(minutes / 6) / 10;
  return `${hours}시간`;
}

export function parseRockyTaskTemplateTitle(value: string): string | null {
  if (!value.startsWith(TEMPLATE_RUN_MARKER)) {
    return null;
  }

  return value.match(/^템플릿:\s*(.+)$/mu)?.[1]?.trim() ?? null;
}

function parseMarkdownListSection(value: string, heading: string): string[] {
  const lines = value.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex < 0) {
    return [];
  }

  const items: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    const trimmed = line.trim();
    if (!trimmed) {
      break;
    }

    if (!trimmed.startsWith("- ")) {
      continue;
    }

    const item = trimmed.slice(2).trim();
    if (!item || item.includes("고정 output 파일 경로가 지정되지 않았습니다")) {
      continue;
    }

    items.push(item);
  }

  return items;
}

export function getRockyTaskTemplateTitle(chat: RockyChatRecord): string | null {
  for (const message of chat.messages) {
    if (message.role !== "user") {
      continue;
    }

    const templateTitle = parseRockyTaskTemplateTitle(message.text);
    if (templateTitle) {
      return templateTitle;
    }
  }

  return null;
}

export function getRockyTaskTemplateGroup(
  chat: RockyChatRecord,
  templates: MdTemplateDefinition[]
): RockyTaskTemplateGroup {
  const templateTitle = getRockyTaskTemplateTitle(chat);
  if (!templateTitle) {
    return {
      id: "general",
      label: "일반 작업",
    };
  }

  const template = templates.find((entry) => entry.title === templateTitle);
  return {
    id: template?.id ?? `template-title:${templateTitle}`,
    label: template?.title ?? templateTitle,
  };
}

function normalizedSkillToken(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function addSkillToken(target: Set<string>, value: string | null | undefined) {
  const normalized = normalizedSkillToken(value);
  if (normalized) {
    target.add(normalized);
  }
}

function skillTokenSetHas(
  target: Set<string>,
  value: string | null | undefined
): boolean {
  const normalized = normalizedSkillToken(value);
  return normalized ? target.has(normalized) : false;
}

function buildTemplateSkillIdTokens(template: MdTemplateDefinition): Set<string> {
  const tokens = new Set<string>();
  addSkillToken(tokens, template.id);
  addSkillToken(tokens, template.skill.id);
  addSkillToken(tokens, template.skill.invocation);
  addSkillToken(tokens, template.skill.invocation.replace(/^\$/u, ""));
  addSkillToken(tokens, `$${template.skill.id}`);
  return tokens;
}

function buildTemplateSkillNameTokens(template: MdTemplateDefinition): Set<string> {
  const tokens = new Set<string>();
  addSkillToken(tokens, template.title);
  addSkillToken(tokens, template.triggerLabel);
  addSkillToken(tokens, template.skill.displayName);
  return tokens;
}

function buildTemplateSkillInvocationTokens(
  template: MdTemplateDefinition
): string[] {
  const tokens = new Set<string>();
  const invocation = template.skill.invocation.trim();
  if (invocation) {
    tokens.add(invocation);
  }

  const skillId = template.skill.id.trim();
  if (skillId) {
    tokens.add(`$${skillId}`);
  }

  return [...tokens];
}

export function isRockyTaskForTemplateSkill(
  chat: RockyChatRecord,
  template: MdTemplateDefinition,
  templates: MdTemplateDefinition[]
): boolean {
  const group = getRockyTaskTemplateGroup(chat, templates);
  if (group.id === template.id) {
    return true;
  }

  const legacyTemplateTitle = getRockyTaskTemplateTitle(chat);
  const nameTokens = buildTemplateSkillNameTokens(template);
  if (skillTokenSetHas(nameTokens, legacyTemplateTitle)) {
    return true;
  }

  const idTokens = buildTemplateSkillIdTokens(template);

  if (
    chat.messages.some((message) =>
      (message.usedSkills ?? []).some(
        (skill) =>
          skillTokenSetHas(idTokens, skill.id) ||
          skillTokenSetHas(nameTokens, skill.displayName)
      )
    )
  ) {
    return true;
  }

  if (chat.dispatches.some((dispatch) => skillTokenSetHas(idTokens, dispatch.skillId))) {
    return true;
  }

  if (skillTokenSetHas(idTokens, chat.worker?.skillId)) {
    return true;
  }

  const invocationTokens = buildTemplateSkillInvocationTokens(template);
  return chat.messages.some((message) =>
    invocationTokens.some((token) => message.text.includes(token))
  );
}

export function getRockyTaskInputFiles(
  chat: RockyChatRecord
): RockyAttachmentRecord[] {
  return chat.attachments;
}

export function getRockyTaskExpectedOutputFiles(chat: RockyChatRecord): string[] {
  for (const message of chat.messages) {
    if (message.role !== "user" || !message.text.startsWith(TEMPLATE_RUN_MARKER)) {
      continue;
    }

    return parseMarkdownListSection(message.text, "템플릿 output 파일:");
  }

  return [];
}

export function compactRockyTaskRequest(value: string): string {
  if (!value.startsWith(TEMPLATE_RUN_MARKER)) {
    return value.trim();
  }

  const title = parseRockyTaskTemplateTitle(value);
  const brief = value.match(/^이번 작업 추가 조건:\s*(.+)$/mu)?.[1]?.trim();
  if (brief) {
    return brief;
  }

  return title ? `${title} 실행` : "스킬 실행";
}

export function getRockyTaskRequest(chat: RockyChatRecord): string {
  const userMessage = chat.messages.find((message) => message.role === "user");
  if (!userMessage) {
    return chat.title || "요청 대기 중";
  }

  return compactRockyTaskRequest(userMessage.text);
}

export function getRockyTaskSummary(chat: RockyChatRecord): string {
  const latest = latestOrchestration(chat);
  if (latest?.error) {
    return latest.error;
  }

  if (latest?.output) {
    return latest.output;
  }

  const rockyMessage = [...chat.messages]
    .reverse()
    .find((message) => message.role === "rocky");
  if (rockyMessage?.text) {
    return compactRockyTaskRequest(rockyMessage.text);
  }

  return getRockyTaskRequest(chat);
}

export function getRockyTaskStartedAt(chat: RockyChatRecord): string | null {
  const earliestStarted = chat.dispatches
    .flatMap((dispatch) =>
      dispatch.orchestration?.startedAt ? [dispatch.orchestration.startedAt] : []
    )
    .sort()[0];

  return earliestStarted ?? chat.createdAt;
}

export function getRockyTaskEndedAt(chat: RockyChatRecord): string | null {
  const status = getRockyTaskStatus(chat);
  if (status === "running" || status === "planned") {
    return null;
  }

  return (
    latestOrchestration(chat)?.endedAt ??
    (status === "waiting" ? null : chat.updatedAt)
  );
}
