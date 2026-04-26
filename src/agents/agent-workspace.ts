import path from "node:path";
import { constants as fsConstants } from "node:fs";
import {
  access,
  cp,
  mkdir,
  readdir,
  writeFile,
} from "node:fs/promises";

import {
  DEFAULT_AGENT_WORKSPACE_MODE,
  DEFAULT_UV_VENV_DIRNAME,
} from "./agent-policy.js";

import type { AgentPaths, AgentRecord } from "./agent-types.js";

export const RUNTIME_HOME_LAYOUT_DIRS = Object.freeze([
  ".codex",
  "config",
  "rules",
  "skills",
  "state",
  "xdg-cache",
  "xdg-config",
  "xdg-state",
]);

export const WORKSPACE_SCAFFOLD_DIRS = Object.freeze([
  ".agents",
  ".agents/skills",
]);

export const WORKSPACE_LOCAL_SKILL_AUTHORING_DIR = ".agents/skills";
export const WORKSPACE_LEGACY_SKILL_AUTHORING_DIR = "skills";
export const WORKSPACE_AGENT_CONFIG_FILENAME = "agent.config.json";
export const WORKSPACE_ENV_TEMPLATE_FILENAME = ".env.template";
export const WORKSPACE_AGENTS_OVERLAY_FILENAME = "AGENTS.md";
export const READ_ONLY_SYSTEM_SKILLS = Object.freeze([
  {
    name: "openai-docs",
    description: "OpenAI 제품/API 관련 최신 공식 문서 기반 안내",
  },
  {
    name: "skill-creator",
    description: "새 스킬 작성과 기존 스킬 개선 가이드",
  },
  {
    name: "skill-installer",
    description: "큐레이션 목록 또는 GitHub 저장소에서 스킬 설치",
  },
]);

const RESERVED_SYSTEM_SKILL_NAMES = new Set([
  "system",
  ".system",
  ...READ_ONLY_SYSTEM_SKILLS.map((skill) => skill.name),
]);

export interface WorkspaceLocalSkillRecord {
  name: string;
  skillPath: string;
  relativeSkillPath: string;
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function resolveWorkspaceScaffoldPaths(workspaceRoot: string): {
  agentsDir: string;
  skillsDir: string;
  legacySkillsDir: string;
  agentConfigPath: string;
  envTemplatePath: string;
  agentsOverlayPath: string;
} {
  return {
    agentsDir: path.join(workspaceRoot, ".agents"),
    skillsDir: path.join(workspaceRoot, ".agents", "skills"),
    legacySkillsDir: path.join(workspaceRoot, "skills"),
    agentConfigPath: path.join(
      workspaceRoot,
      ".agents",
      WORKSPACE_AGENT_CONFIG_FILENAME
    ),
    envTemplatePath: path.join(workspaceRoot, WORKSPACE_ENV_TEMPLATE_FILENAME),
    agentsOverlayPath: path.join(
      workspaceRoot,
      WORKSPACE_AGENTS_OVERLAY_FILENAME
    ),
  };
}

function buildWorkspaceAgentConfig(agent: AgentRecord): Record<string, unknown> {
  return {
    agentId: agent.id,
    name: agent.name,
    description: agent.description,
    workspaceRoot: agent.workspaceRoot,
    runtimeHome: agent.runtimeHome,
    defaultRuntime: agent.defaultRuntime,
    policies: {
      sandbox: agent.sandboxPolicy,
      approval: agent.approvalPolicy,
      modelProfile: agent.modelProfile,
      runtime: agent.runtimePolicy ?? null,
      tools: agent.toolPolicy ?? null,
    },
    pythonEnvironment: agent.pythonEnvironment ?? null,
    status: agent.status,
    lifecycle: agent.lifecycle,
    archivedAt: agent.archivedAt,
    updatedAt: agent.updatedAt,
  };
}

function buildWorkspaceEnvTemplate(agent: AgentRecord): string {
  const pythonToolPolicy = agent.toolPolicy?.python;
  const sshToolPolicy = agent.toolPolicy?.ssh;

  return [
    "# Agent-local environment template.",
    "# Copy the values you need into .env before running agent-local tools.",
    `AGENT_ID=${agent.id}`,
    `AGENT_WORKSPACE_ROOT=${agent.workspaceRoot}`,
    `AGENT_RUNTIME_HOME=${agent.runtimeHome}`,
    `AGENT_WORKSPACE_MODE=${agent.runtimePolicy?.workspaceMode ?? DEFAULT_AGENT_WORKSPACE_MODE}`,
    `AGENT_GIT_BACKED_WORKSPACE=${agent.runtimePolicy?.gitBackedWorkspace ? "1" : "0"}`,
    `CODEX_SANDBOX=${agent.sandboxPolicy}`,
    `CODEX_APPROVAL_POLICY=${agent.approvalPolicy}`,
    `CODEX_MODEL_PROFILE=${agent.modelProfile ?? ""}`,
    `UV_PROJECT_ENVIRONMENT=${DEFAULT_UV_VENV_DIRNAME}`,
    `AGENT_PYTHON_POLICY=${pythonToolPolicy?.mode ?? ""}`,
    `AGENT_PYTHON_VENV=${pythonToolPolicy?.venvPath ?? ""}`,
    `AGENT_PYTHON_FALLBACK=${pythonToolPolicy?.systemFallback ?? ""}`,
    `AGENT_SSH_COMMAND=${sshToolPolicy?.command ?? ""}`,
    "OPENAI_API_KEY=",
  ].join("\n").concat("\n");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function isReservedSystemSkillName(name: string): boolean {
  const normalizedName = name.trim().toLowerCase();
  return (
    RESERVED_SYSTEM_SKILL_NAMES.has(normalizedName) ||
    normalizedName.startsWith("system-") ||
    normalizedName.startsWith(".system")
  );
}

async function listSkillsFromDir(
  workspaceRoot: string,
  skillsDir: string
): Promise<WorkspaceLocalSkillRecord[]> {
  if (!(await exists(skillsDir))) {
    return [];
  }

  const entries = await readdir(skillsDir, { withFileTypes: true });
  const records: WorkspaceLocalSkillRecord[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    if (isReservedSystemSkillName(entry.name)) {
      continue;
    }

    const skillPath = path.join(skillsDir, entry.name, "SKILL.md");
    if (!(await exists(skillPath))) {
      continue;
    }

    records.push({
      name: entry.name,
      skillPath,
      relativeSkillPath: path.relative(workspaceRoot, skillPath),
    });
  }

  return records;
}

export async function listWorkspaceLocalSkills(
  workspaceRoot: string
): Promise<WorkspaceLocalSkillRecord[]> {
  const scaffoldPaths = resolveWorkspaceScaffoldPaths(workspaceRoot);
  const [canonicalSkills, legacySkills] = await Promise.all([
    listSkillsFromDir(workspaceRoot, scaffoldPaths.skillsDir),
    listSkillsFromDir(workspaceRoot, scaffoldPaths.legacySkillsDir),
  ]);

  const deduped = new Map<string, WorkspaceLocalSkillRecord>();
  for (const skill of [...legacySkills, ...canonicalSkills]) {
    deduped.set(skill.name, skill);
  }

  return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function shouldManageWorkspaceSkillBridge(
  workspaceRoot: string
): Promise<boolean> {
  const scaffoldPaths = resolveWorkspaceScaffoldPaths(workspaceRoot);

  return (
    (await exists(scaffoldPaths.agentConfigPath)) ||
    (await exists(scaffoldPaths.skillsDir)) ||
    (await exists(scaffoldPaths.legacySkillsDir))
  );
}

async function migrateLegacyWorkspaceSkills(
  workspaceRoot: string
): Promise<void> {
  const scaffoldPaths = resolveWorkspaceScaffoldPaths(workspaceRoot);
  if (!(await exists(scaffoldPaths.legacySkillsDir))) {
    return;
  }

  const entries = await readdir(scaffoldPaths.legacySkillsDir, {
    withFileTypes: true,
  });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || isReservedSystemSkillName(entry.name)) {
      continue;
    }

    const legacySkillDir = path.join(scaffoldPaths.legacySkillsDir, entry.name);
    const legacySkillPath = path.join(legacySkillDir, "SKILL.md");
    if (!(await exists(legacySkillPath))) {
      continue;
    }

    const canonicalSkillDir = path.join(scaffoldPaths.skillsDir, entry.name);
    if (await exists(canonicalSkillDir)) {
      continue;
    }

    await cp(legacySkillDir, canonicalSkillDir, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  }
}

export function buildWorkspaceAgentsOverlay(
  workspaceRoot: string,
  skills: WorkspaceLocalSkillRecord[]
): string {
  const workspaceSkillLines = skills.length
    ? skills.map(
        (skill) =>
          `- ${skill.name}: Agent-local workspace skill. (file: ${skill.skillPath})`
      )
    : ["- 아직 등록된 workspace-local skill이 없습니다."];
  const systemSkillLines = READ_ONLY_SYSTEM_SKILLS.map(
    (skill) => `- ${skill.name}: ${skill.description}`
  );

  return [
    "# Workspace-local AGENTS overlay",
    "",
    "<INSTRUCTIONS>",
    "## Skills",
    "이 세션에서는 workspace-local skill과 허용된 read-only system skill만 사용할 수 있습니다.",
    "",
    "### Available skills in this session",
    "**Workspace-local**",
    ...workspaceSkillLines,
    "",
    "**System (read-only)**",
    ...systemSkillLines,
    "",
    "### Unavailable skills",
    "- Repository-root developer skills are unavailable in agent sessions. Do not list or use them.",
    "",
    "### How to use skills",
    "- Use workspace-local skills from this workspace first.",
    "- Only the listed system skills may be read and used. Do not create, modify, shadow, or copy them.",
    "- Repository-root developer skills from parent directories are development-only and unavailable in this agent session.",
    `- Create or edit agent-local skills under \`${WORKSPACE_LOCAL_SKILL_AUTHORING_DIR}\` in this workspace.`,
    "- When asked to list available skills, report only the workspace-local skills and the listed read-only system skills.",
    "- Do not create or modify reserved system skill namespaces such as `.system`, `system`, `system-*`, `openai-docs`, `skill-creator`, or `skill-installer` from this session.",
    "- Keep agent-local skills inside this workspace and do not copy them into the server repository root developer skill set.",
    `- This overlay is generated from the current workspace root: \`${workspaceRoot}\`.`,
    "</INSTRUCTIONS>",
    "",
  ].join("\n");
}

export async function ensureWorkspaceSkillBridge(workspaceRoot: string): Promise<{
  skillsDir: string;
  agentsOverlayPath: string;
  skills: WorkspaceLocalSkillRecord[];
}> {
  const scaffoldPaths = resolveWorkspaceScaffoldPaths(workspaceRoot);
  await mkdir(scaffoldPaths.agentsDir, { recursive: true });
  await mkdir(scaffoldPaths.skillsDir, { recursive: true });
  await migrateLegacyWorkspaceSkills(workspaceRoot);
  const skills = await listWorkspaceLocalSkills(workspaceRoot);

  await writeFile(
    scaffoldPaths.agentsOverlayPath,
    buildWorkspaceAgentsOverlay(workspaceRoot, skills)
  );

  return {
    skillsDir: scaffoldPaths.skillsDir,
    agentsOverlayPath: scaffoldPaths.agentsOverlayPath,
    skills,
  };
}

export async function ensureAgentFilesystemLayout({
  metadataPath,
  workspaceRoot,
  runtimeHome,
}: Pick<AgentPaths, "metadataPath" | "workspaceRoot" | "runtimeHome">): Promise<void> {
  await mkdir(path.dirname(metadataPath), { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(runtimeHome, { recursive: true });

  for (const dirname of RUNTIME_HOME_LAYOUT_DIRS) {
    await mkdir(path.join(runtimeHome, dirname), { recursive: true });
  }

  for (const dirname of WORKSPACE_SCAFFOLD_DIRS) {
    await mkdir(path.join(workspaceRoot, dirname), { recursive: true });
  }
}

export async function ensureAgentWorkspaceScaffold(
  agent: AgentRecord
): Promise<ReturnType<typeof resolveWorkspaceScaffoldPaths>> {
  const scaffoldPaths = resolveWorkspaceScaffoldPaths(agent.workspaceRoot);

  await mkdir(scaffoldPaths.agentsDir, { recursive: true });
  await mkdir(scaffoldPaths.skillsDir, { recursive: true });
  await writeFile(
    scaffoldPaths.agentConfigPath,
    serializeJson(buildWorkspaceAgentConfig(agent))
  );
  await writeFile(scaffoldPaths.envTemplatePath, buildWorkspaceEnvTemplate(agent));
  await ensureWorkspaceSkillBridge(agent.workspaceRoot);

  return scaffoldPaths;
}
