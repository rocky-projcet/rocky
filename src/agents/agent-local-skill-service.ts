import { constants as fsConstants } from "node:fs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
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

function toRecord(agent: AgentRecord, skill: { name: string; skillPath: string }): AgentLocalSkillRecord {
  return {
    id: skill.name,
    workspacePath: path.relative(agent.workspaceRoot, skill.skillPath),
    skillPath: skill.skillPath,
  };
}

export class AgentLocalSkillService {
  async listAgentLocalSkills(agent: AgentRecord): Promise<AgentLocalSkillRecord[]> {
    await ensureWorkspaceSkillBridge(agent.workspaceRoot);
    const skills = await listWorkspaceLocalSkills(agent.workspaceRoot);
    return skills.map((skill) => toRecord(agent, skill));
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
    assertInsideWorkspace(agent.workspaceRoot, canonicalDir);
    assertInsideWorkspace(agent.workspaceRoot, legacyDir);

    await ensureWorkspaceSkillBridge(agent.workspaceRoot);

    const candidateDirs = [...new Set([canonicalDir, legacyDir])];
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
      deletedPaths: existingDirs.map((entry) => path.relative(agent.workspaceRoot, entry)),
      skills: bridge.skills.map((skill) => toRecord(agent, skill)),
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
    assertInsideWorkspace(agent.workspaceRoot, skillDir);
    assertInsideWorkspace(agent.workspaceRoot, legacySkillDir);
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

    const bridge = await ensureWorkspaceSkillBridge(agent.workspaceRoot);
    const skill = bridge.skills.find((entry) => entry.name === id);
    if (!skill) {
      throw new Error(`Installed skill was not indexed: ${id}`);
    }

    return {
      id,
      skill: toRecord(agent, skill),
      skills: bridge.skills.map((entry) => toRecord(agent, entry)),
    };
  }
}

export { WORKSPACE_LOCAL_SKILL_AUTHORING_DIR };
