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

const THREADS_CONNECTOR_CAPABILITY_MANIFEST = `${JSON.stringify(
  {
    provider: "threads",
    capabilities: [
      {
        id: "threads.automation.prepare",
        label: "Automation readiness check",
        description:
          "Validate the connected Threads account and expose safe profile metadata before AI automation runs.",
        action: "read",
        requiresBrowser: true,
        requiresConnectedAccount: true,
        requiresApproval: false,
        status: "available",
        scriptPath: "scripts/threads-crud.mjs",
        usage: "node scripts/threads-crud.mjs prepare",
      },
      {
        id: "threads.profile.read",
        label: "프로필 조회",
        description: "Rocky가 보관한 Threads 브라우저 세션으로 현재 계정 프로필을 읽습니다.",
        action: "read",
        requiresBrowser: true,
        requiresConnectedAccount: true,
        requiresApproval: false,
        status: "available",
        scriptPath: "scripts/threads-crud.mjs",
        usage: "node scripts/threads-crud.mjs profile.read",
      },
      {
        id: "threads.followers.read",
        label: "팔로워 목록 조회",
        description: "Rocky가 보관한 Threads 브라우저 세션으로 팔로워 화면의 이름 목록을 읽습니다.",
        action: "read",
        requiresBrowser: true,
        requiresConnectedAccount: true,
        requiresApproval: false,
        status: "available",
        scriptPath: "scripts/threads-crud.mjs",
        usage: "node scripts/threads-crud.mjs followers.read --limit 50",
      },
      {
        id: "threads.following.read",
        label: "팔로잉 목록 조회",
        description: "Threads 팔로잉 화면의 이름 목록을 읽습니다.",
        action: "read",
        requiresBrowser: true,
        requiresConnectedAccount: true,
        requiresApproval: false,
        status: "planned",
      },
      {
        id: "threads.posts.read",
        label: "게시물 목록 조회",
        description: "Threads 프로필 게시물 목록을 읽습니다.",
        action: "read",
        requiresBrowser: true,
        requiresConnectedAccount: true,
        requiresApproval: false,
        status: "planned",
      },
      {
        id: "threads.posts.publish",
        label: "게시물 작성",
        description: "Threads 게시물을 작성합니다.",
        action: "write",
        requiresBrowser: true,
        requiresConnectedAccount: true,
        requiresApproval: true,
        status: "planned",
      },
      {
        id: "threads.posts.update",
        label: "게시물 수정",
        description: "Threads 게시물을 수정합니다.",
        action: "write",
        requiresBrowser: true,
        requiresConnectedAccount: true,
        requiresApproval: true,
        status: "planned",
      },
      {
        id: "threads.posts.delete",
        label: "게시물 삭제",
        description: "Threads 게시물을 삭제합니다.",
        action: "write",
        requiresBrowser: true,
        requiresConnectedAccount: true,
        requiresApproval: true,
        status: "planned",
      },
    ],
  },
  null,
  2,
)}\n`;

const THREADS_CONNECTOR_SCRIPT = `#!/usr/bin/env node
const operation = process.argv[2] || "help";
const supported = new Map([
  ["prepare", "threads.automation.prepare"],
  ["profile.read", "threads.profile.read"],
  ["followers.read", "threads.followers.read"],
]);

if (operation === "help" || operation === "--help" || operation === "-h") {
  printUsage();
  process.exit(0);
}

const capabilityId = supported.get(operation);
if (!capabilityId) {
  console.error(JSON.stringify({
    ok: false,
    message: "Unsupported Threads skill operation.",
    operation,
    supported: Array.from(supported.keys()),
  }, null, 2));
  process.exit(2);
}

const args = parseArgs(process.argv.slice(3));
const baseUrl = (
  process.env.ROCKY_CONNECTOR_BASE_URL ||
  process.env.ROCKY_API_BASE_URL ||
  process.env.ROCKY_AGENT_ENGINE_URL ||
  "http://127.0.0.1:3000"
).replace(/\\/+$/u, "");

try {
  const response = await fetch(
    new URL("/connectors/threads/capabilities/" + encodeURIComponent(capabilityId) + "/execute", baseUrl),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args }),
    },
  );
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok || !payload || payload.ok === false) {
    console.error(JSON.stringify(payload || {
      ok: false,
      statusCode: response.status,
      message: response.statusText,
    }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(payload, null, 2));
} catch (error) {
  const cause = error instanceof Error && error.cause ? String(error.cause) : null;
  console.error(JSON.stringify({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    cause,
    hint: cause && /EPERM|Operation not permitted/iu.test(cause)
      ? "This execution session cannot access the local Rocky connector endpoint. Run with local network permission or execute the read through the Rocky backend host."
      : "Set ROCKY_CONNECTOR_BASE_URL when Rocky backend is not listening on http://127.0.0.1:3000.",
  }, null, 2));
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--limit") {
      const raw = argv[index + 1];
      index += 1;
      const limit = Number.parseInt(raw, 10);
      if (Number.isFinite(limit) && limit > 0) {
        args.limit = Math.min(limit, 200);
      }
    }
  }
  return args;
}

function printUsage() {
  console.log([
    "Usage:",
    "  node scripts/threads-crud.mjs prepare",
    "  node scripts/threads-crud.mjs profile.read",
    "  node scripts/threads-crud.mjs followers.read --limit 50",
    "",
    "Environment:",
    "  ROCKY_CONNECTOR_BASE_URL=http://127.0.0.1:3000",
  ].join("\\n"));
}
`;

function augmentConnectorSkillFiles(
  skillId: string,
  files: AgentLocalSkillFileInput[],
): AgentLocalSkillFileInput[] {
  if (!shouldAugmentThreadsConnectorSkill(skillId, files)) {
    return files;
  }

  const next = [...files];
  const paths = new Set(
    next.map((file) =>
      typeof file?.path === "string" ? normalizeSkillInputPath(file.path) : "",
    ),
  );
  if (!paths.has("connector-capabilities.json")) {
    next.push({
      path: "connector-capabilities.json",
      content: THREADS_CONNECTOR_CAPABILITY_MANIFEST,
    });
  }
  if (!paths.has("scripts/threads-crud.mjs")) {
    next.push({
      path: "scripts/threads-crud.mjs",
      content: THREADS_CONNECTOR_SCRIPT,
    });
  }
  return next;
}

function shouldAugmentThreadsConnectorSkill(
  skillId: string,
  files: AgentLocalSkillFileInput[],
): boolean {
  const skillFile = files.find(
    (file) =>
      typeof file?.path === "string" &&
      normalizeSkillInputPath(file.path) === "SKILL.md",
  );
  const skillMarkdown = skillFile ? readSkillInputText(skillFile) : "";
  const signal = `${skillId}\n${skillMarkdown}`;
  return /threads|쓰레드|스레드/iu.test(signal);
}

function normalizeSkillInputPath(filePath: string): string {
  return filePath.trim().replace(/\\/gu, "/");
}

function readSkillInputText(file: AgentLocalSkillFileInput): string {
  if (file.encoding === "base64") {
    try {
      return Buffer.from(file.content, "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  return file.content;
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

  async ensureAgentLocalSkillConnectorFiles(
    agent: AgentRecord,
    skillId: string,
  ): Promise<boolean> {
    const id = validateSkillId(skillId);
    const skills = await this.listAgentLocalSkills(agent);
    const skill = skills.find((entry) => entry.id === id);
    if (!skill) {
      return false;
    }

    let skillMarkdown: string;
    try {
      skillMarkdown = await readFile(skill.skillPath, "utf8");
    } catch {
      return false;
    }

    const skillInput = [{ path: "SKILL.md", content: skillMarkdown }];
    if (!shouldAugmentThreadsConnectorSkill(id, skillInput)) {
      return false;
    }

    const skillDir = path.dirname(skill.skillPath);
    if (
      (await exists(path.join(skillDir, "connector-capabilities.json"))) &&
      (await exists(path.join(skillDir, "scripts", "threads-crud.mjs")))
    ) {
      return false;
    }

    await this.upsertAgentLocalSkill(agent, id, skillInput, {
      replace: false,
    });
    return true;
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

    const filesToInstall = augmentConnectorSkillFiles(id, files);

    for (const file of filesToInstall) {
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
