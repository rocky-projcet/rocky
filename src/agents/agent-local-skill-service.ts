import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentRecord } from "./agent-types.js";
import {
  WORKSPACE_LOCAL_SKILL_AUTHORING_DIR,
  ensureWorkspaceSkillBridge,
  isReservedSystemSkillName,
  listWorkspaceLocalSkills,
  resolveWorkspaceScaffoldPaths,
} from "./agent-workspace.js";

export interface AgentLocalSkillRecord {
  id: string;
  workspacePath: string;
  skillPath: string;
  displayName: string;
  description: string | null;
  invocation: string;
  runtimePath: string | null;
  runtimeSkillPath: string | null;
}

export interface AgentLocalSkillDeleteResult {
  id: string;
  deleted: boolean;
  deletedPaths: string[];
  skills: AgentLocalSkillRecord[];
}

export interface AgentLocalSkillFileInput {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
}

export interface AgentLocalSkillUpsertResult {
  id: string;
  skill: AgentLocalSkillRecord;
  skills: AgentLocalSkillRecord[];
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function notFound(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 404,
  });
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function validateSkillId(skillId: string): string {
  const normalized = skillId.trim();
  if (!normalized) {
    throw badRequest("Skill id must be a non-empty string.");
  }

  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0")
  ) {
    throw badRequest("Skill id must be a single path segment.");
  }

  if (!/^[A-Za-z0-9._-]+$/u.test(normalized)) {
    throw badRequest("Skill id may only contain letters, numbers, dots, underscores, or hyphens.");
  }

  if (isReservedSystemSkillName(normalized)) {
    throw badRequest(`Reserved system skill cannot be managed here: ${normalized}`);
  }

  return normalized;
}

function assertInsideWorkspace(workspaceRoot: string, targetPath: string): void {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedWorkspace, resolvedTarget);

  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw badRequest("Skill path must stay inside the agent workspace.");
  }
}

function assertInsideRuntimeHome(runtimeHome: string, targetPath: string): void {
  const resolvedRuntimeHome = path.resolve(runtimeHome);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRuntimeHome, resolvedTarget);

  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw badRequest("Runtime skill path must stay inside the agent runtime home.");
  }
}

function resolveSkillFilePath(skillDir: string, relativeFilePath: string): string {
  const normalized = relativeFilePath.trim();
  if (!normalized) {
    throw badRequest("Skill file path must be non-empty.");
  }

  if (
    path.isAbsolute(normalized) ||
    normalized.includes("\0") ||
    normalized.split(/[\\/]+/u).some((segment) => segment === "..")
  ) {
    throw badRequest("Skill file path must stay inside the skill directory.");
  }

  return path.join(skillDir, normalized);
}

function resolveNativeCodexSkillDir(agent: AgentRecord, skillId: string): string {
  return path.join(agent.runtimeHome, ".codex", "skills", skillId);
}

function resolveLegacyRuntimeSkillDir(agent: AgentRecord, skillId: string): string {
  return path.join(agent.runtimeHome, "skills", skillId);
}

function parseSkillMetadata(content: string): {
  displayName: string | null;
  description: string | null;
} {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  const metadata: Record<string, string> = {};
  if (frontmatterMatch) {
    for (const line of frontmatterMatch[1]!.split(/\r?\n/u)) {
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
      if (!match) {
        continue;
      }
      const value = match[2]!.trim();
      metadata[match[1]!] = value.replace(/^"(.*)"$/u, "$1").replace(/\\"/gu, '"');
    }
  }

  const titleMatch = content.match(/^#\s+(.+)$/mu);

  return {
    displayName: titleMatch?.[1]?.trim() || metadata.name || null,
    description: metadata.description || null,
  };
}

async function readSkillMetadata(skillPath: string): Promise<{
  displayName: string | null;
  description: string | null;
}> {
  try {
    return parseSkillMetadata(await readFile(skillPath, "utf8"));
  } catch {
    return {
      displayName: null,
      description: null,
    };
  }
}

async function toRecord(
  agent: AgentRecord,
  skill: { name: string; skillPath: string }
): Promise<AgentLocalSkillRecord> {
  const metadata = await readSkillMetadata(skill.skillPath);
  const runtimeSkillDir = resolveNativeCodexSkillDir(agent, skill.name);
  const runtimeSkillPath = path.join(runtimeSkillDir, "SKILL.md");
  const hasRuntimeSkill = await exists(runtimeSkillPath);

  return {
    id: skill.name,
    workspacePath: path.relative(agent.workspaceRoot, skill.skillPath),
    skillPath: skill.skillPath,
    displayName: metadata.displayName ?? skill.name,
    description: metadata.description,
    invocation: `$${skill.name}`,
    runtimePath: hasRuntimeSkill ? path.relative(agent.runtimeHome, runtimeSkillDir) : null,
    runtimeSkillPath: hasRuntimeSkill ? runtimeSkillPath : null,
  };
}

export class AgentLocalSkillService {
  async listAgentLocalSkills(agent: AgentRecord): Promise<AgentLocalSkillRecord[]> {
    await ensureWorkspaceSkillBridge(agent.workspaceRoot);
    const skills = await listWorkspaceLocalSkills(agent.workspaceRoot);
    return Promise.all(skills.map((skill) => toRecord(agent, skill)));
  }

  async deleteAgentLocalSkill(
    agent: AgentRecord,
    skillId: string,
    options: { protectedSkillIds?: string[] } = {}
  ): Promise<AgentLocalSkillDeleteResult> {
    const id = validateSkillId(skillId);
    const protectedSkillIds = new Set(options.protectedSkillIds ?? []);
    if (protectedSkillIds.has(id)) {
      throw badRequest(`Protected agent skill cannot be deleted: ${id}`);
    }

    const scaffoldPaths = resolveWorkspaceScaffoldPaths(agent.workspaceRoot);
    const canonicalDir = path.join(scaffoldPaths.skillsDir, id);
    const legacyDir = path.join(scaffoldPaths.legacySkillsDir, id);
    const runtimeDir = resolveNativeCodexSkillDir(agent, id);
    const legacyRuntimeDir = resolveLegacyRuntimeSkillDir(agent, id);
    assertInsideWorkspace(agent.workspaceRoot, canonicalDir);
    assertInsideWorkspace(agent.workspaceRoot, legacyDir);
    assertInsideRuntimeHome(agent.runtimeHome, runtimeDir);
    assertInsideRuntimeHome(agent.runtimeHome, legacyRuntimeDir);

    await ensureWorkspaceSkillBridge(agent.workspaceRoot);

    const candidateDirs = [...new Set([canonicalDir, legacyDir, runtimeDir, legacyRuntimeDir])];
    const existingDirs: string[] = [];
    for (const candidateDir of candidateDirs) {
      if (await exists(candidateDir)) {
        existingDirs.push(candidateDir);
      }
    }

    if (existingDirs.length === 0) {
      throw notFound(`Unknown agent-local skill: ${id}`);
    }

    for (const targetDir of existingDirs) {
      await rm(targetDir, {
        recursive: true,
        force: false,
      });
    }

    const bridge = await ensureWorkspaceSkillBridge(agent.workspaceRoot);

    return {
      id,
      deleted: true,
      deletedPaths: existingDirs.map((entry) => {
        const relativeWorkspacePath = path.relative(agent.workspaceRoot, entry);
        if (
          relativeWorkspacePath &&
          !relativeWorkspacePath.startsWith("..") &&
          !path.isAbsolute(relativeWorkspacePath)
        ) {
          return relativeWorkspacePath;
        }

        return path.relative(agent.runtimeHome, entry);
      }),
      skills: await Promise.all(bridge.skills.map((skill) => toRecord(agent, skill))),
    };
  }

  async upsertAgentLocalSkill(
    agent: AgentRecord,
    skillId: string,
    files: AgentLocalSkillFileInput[],
    options: {
      replace?: boolean;
      protectedSkillIds?: string[];
    } = {}
  ): Promise<AgentLocalSkillUpsertResult> {
    const id = validateSkillId(skillId);
    const protectedSkillIds = new Set(options.protectedSkillIds ?? []);
    if (protectedSkillIds.has(id)) {
      throw badRequest(`Protected agent skill cannot be overwritten: ${id}`);
    }

    if (!Array.isArray(files) || files.length === 0) {
      throw badRequest("Skill install requires at least one file.");
    }

    const scaffoldPaths = resolveWorkspaceScaffoldPaths(agent.workspaceRoot);
    const skillDir = path.join(scaffoldPaths.skillsDir, id);
    const legacySkillDir = path.join(scaffoldPaths.legacySkillsDir, id);
    const runtimeSkillDir = resolveNativeCodexSkillDir(agent, id);
    const legacyRuntimeSkillDir = resolveLegacyRuntimeSkillDir(agent, id);
    assertInsideWorkspace(agent.workspaceRoot, skillDir);
    assertInsideWorkspace(agent.workspaceRoot, legacySkillDir);
    assertInsideRuntimeHome(agent.runtimeHome, runtimeSkillDir);
    assertInsideRuntimeHome(agent.runtimeHome, legacyRuntimeSkillDir);
    await ensureWorkspaceSkillBridge(agent.workspaceRoot);

    if (options.replace && await exists(skillDir)) {
      await rm(skillDir, {
        recursive: true,
        force: false,
      });
    }
    if (options.replace && await exists(legacySkillDir)) {
      await rm(legacySkillDir, {
        recursive: true,
        force: false,
      });
    }
    if (options.replace && await exists(runtimeSkillDir)) {
      await rm(runtimeSkillDir, {
        recursive: true,
        force: false,
      });
    }
    if (options.replace && await exists(legacyRuntimeSkillDir)) {
      await rm(legacyRuntimeSkillDir, {
        recursive: true,
        force: false,
      });
    }

    for (const file of files) {
      if (!file || typeof file !== "object") {
        throw badRequest("Skill file entries must be objects.");
      }
      if (typeof file.path !== "string" || typeof file.content !== "string") {
        throw badRequest("Skill file entries require path and content strings.");
      }
      if (
        file.encoding !== undefined &&
        file.encoding !== "utf8" &&
        file.encoding !== "base64"
      ) {
        throw badRequest("Skill file encoding must be utf8 or base64.");
      }

      const targetPath = resolveSkillFilePath(skillDir, file.path);
      assertInsideWorkspace(agent.workspaceRoot, targetPath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(
        targetPath,
        file.encoding === "base64"
          ? Buffer.from(file.content, "base64")
          : file.content,
        file.encoding === "base64" ? undefined : "utf8"
      );
    }

    const skillPath = path.join(skillDir, "SKILL.md");
    if (!(await exists(skillPath))) {
      throw badRequest("Skill install must include SKILL.md at the skill root.");
    }
    if (await exists(legacySkillDir)) {
      await rm(legacySkillDir, {
        recursive: true,
        force: false,
      });
    }
    if (await exists(legacyRuntimeSkillDir)) {
      await rm(legacyRuntimeSkillDir, {
        recursive: true,
        force: false,
      });
    }

    await rm(runtimeSkillDir, {
      recursive: true,
      force: true,
    });
    await mkdir(path.dirname(runtimeSkillDir), { recursive: true });
    await cp(skillDir, runtimeSkillDir, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });

    const bridge = await ensureWorkspaceSkillBridge(agent.workspaceRoot);
    const skill = bridge.skills.find((entry) => entry.name === id);
    if (!skill) {
      throw new Error(`Installed skill was not indexed: ${id}`);
    }

    return {
      id,
      skill: await toRecord(agent, skill),
      skills: await Promise.all(bridge.skills.map((entry) => toRecord(agent, entry))),
    };
  }
}

export { WORKSPACE_LOCAL_SKILL_AUTHORING_DIR };
