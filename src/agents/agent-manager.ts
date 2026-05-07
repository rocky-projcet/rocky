import { execFile as nodeExecFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_AGENT_WORKSPACE_MODE,
  DEFAULT_UV_VENV_DIRNAME,
  buildDefaultAgentRuntimePolicy,
  buildDefaultAgentToolPolicy,
  policiesEqual,
  resolveUvPipCandidates,
  resolveUvPythonCandidates,
  resolveUvVenvPath,
} from "./agent-policy.js";
import {
  RUNTIME_HOME_LAYOUT_DIRS,
  WORKSPACE_SCAFFOLD_DIRS,
  WORKSPACE_AGENT_CONFIG_FILENAME,
  WORKSPACE_ENV_TEMPLATE_FILENAME,
  ensureAgentFilesystemLayout,
  ensureAgentWorkspaceScaffold,
} from "./agent-workspace.js";

import type {
  AgentCreateInput,
  AgentManagerOptions,
  AgentPaths,
  AgentRecord,
  AgentSessionOverrides,
  AgentUpdatePatch,
  ExecFileLike,
  ExecFileResult,
} from "./agent-types.js";
import type {
  RuntimeKind,
  RuntimeSessionInput,
} from "../runtime/runtime-types.js";

export {
  DEFAULT_AGENT_WORKSPACE_MODE,
  DEFAULT_UV_VENV_DIRNAME,
  buildDefaultAgentRuntimePolicy,
  buildDefaultAgentToolPolicy,
  resolveUvVenvPath,
} from "./agent-policy.js";
export {
  RUNTIME_HOME_LAYOUT_DIRS,
  WORKSPACE_SCAFFOLD_DIRS,
  WORKSPACE_AGENT_CONFIG_FILENAME,
  WORKSPACE_ENV_TEMPLATE_FILENAME,
  ensureAgentFilesystemLayout,
  ensureAgentWorkspaceScaffold,
} from "./agent-workspace.js";

export const DEFAULT_AGENT_RUNTIME: RuntimeKind = "codex-cli";
export const DEFAULT_AGENT_STATUS = "active";
export const DEFAULT_AGENT_LIFECYCLE = "active";
export const DEFAULT_SANDBOX_POLICY = "workspace-write";
export const DEFAULT_APPROVAL_POLICY = "on-request";

function badRequestError(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 400,
  });
}

function conflictError(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), {
    statusCode: 409,
  });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function resolveManagerStateRoot(stateRoot?: string): string {
  return path.resolve(
    stateRoot ?? path.join(process.cwd(), ".runtime", "agent-engine")
  );
}

function defaultExecFile(
  file: string,
  args: string[],
  options: Record<string, unknown> = {}
): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    nodeExecFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        const executionError = error as Error & ExecFileResult;
        executionError.stdout = stdout;
        executionError.stderr = stderr;
        reject(executionError);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function hasAnyPath(paths: string[]): Promise<boolean> {
  for (const candidatePath of paths) {
    if (await pathExists(candidatePath)) {
      return true;
    }
  }

  return false;
}

export function resolveAgentPaths({
  stateRoot,
  agentId,
  workspaceRoot,
  runtimeHome,
}: {
  stateRoot?: string;
  agentId: string;
  workspaceRoot?: string;
  runtimeHome?: string;
}): AgentPaths {
  if (!agentId) {
    throw new Error("resolveAgentPaths() requires agentId");
  }

  const resolvedStateRoot = resolveManagerStateRoot(stateRoot);
  const agentRoot = path.join(resolvedStateRoot, "agents", agentId);

  return {
    stateRoot: resolvedStateRoot,
    agentRoot,
    workspaceRoot: path.resolve(workspaceRoot ?? path.join(agentRoot, "workspace")),
    runtimeHome: path.resolve(runtimeHome ?? path.join(agentRoot, "runtime-home")),
    metadataPath: path.join(agentRoot, "agent.json"),
  };
}

export async function ensureUvVirtualEnvironment({
  workspaceRoot,
  venvPath,
  execFileImpl = defaultExecFile,
}: {
  workspaceRoot: string;
  venvPath?: string;
  execFileImpl?: ExecFileLike;
}): Promise<{ created: boolean; path: string }> {
  const resolvedVenvPath = resolveUvVenvPath(workspaceRoot, venvPath);

  if (
    (await hasAnyPath(resolveUvPythonCandidates(resolvedVenvPath))) &&
    (await hasAnyPath(resolveUvPipCandidates(resolvedVenvPath)))
  ) {
    return {
      created: false,
      path: resolvedVenvPath,
    };
  }

  try {
    await execFileImpl("uv", ["venv", "--seed", resolvedVenvPath], {
      cwd: workspaceRoot,
    });
  } catch (error) {
    const executionError = error as Error & ExecFileResult;
    const detail =
      executionError.stderr?.trim() ||
      executionError.stdout?.trim() ||
      executionError.message ||
      String(error);
    throw new Error(
      `Failed to initialize uv virtual environment at ${resolvedVenvPath}: ${detail}`
    );
  }

  return {
    created: true,
    path: resolvedVenvPath,
  };
}

async function readAgentFile(metadataPath: string): Promise<AgentRecord | null> {
  if (!(await pathExists(metadataPath))) {
    return null;
  }

  const persisted = JSON.parse(await readFile(metadataPath, "utf8")) as Partial<AgentRecord>;
  return hydrateAgentRecord(persisted);
}

function hydrateAgentRecord(persisted: Partial<AgentRecord>): AgentRecord {
  if (!persisted.id) {
    throw new Error("Persisted agent record is missing id");
  }

  if (!persisted.name) {
    throw new Error(`Persisted agent record is missing name: ${persisted.id}`);
  }

  if (!persisted.workspaceRoot || !persisted.runtimeHome) {
    throw new Error(`Persisted agent record is missing managed paths: ${persisted.id}`);
  }

  return {
    id: persisted.id,
    name: persisted.name,
    description: persisted.description ?? "",
    soul: persisted.soul ?? null,
    color: persisted.color ?? null,
    workspaceRoot: path.resolve(persisted.workspaceRoot),
    runtimeHome: path.resolve(persisted.runtimeHome),
    defaultRuntime: persisted.defaultRuntime ?? DEFAULT_AGENT_RUNTIME,
    sandboxPolicy: persisted.sandboxPolicy ?? DEFAULT_SANDBOX_POLICY,
    approvalPolicy: persisted.approvalPolicy ?? DEFAULT_APPROVAL_POLICY,
    modelProfile: persisted.modelProfile ?? null,
    runtimePolicy: persisted.runtimePolicy ?? buildDefaultAgentRuntimePolicy(),
    toolPolicy:
      persisted.toolPolicy ??
      buildDefaultAgentToolPolicy({
        workspaceRoot: path.resolve(persisted.workspaceRoot),
      }),
    status: persisted.status ?? DEFAULT_AGENT_STATUS,
    lifecycle: persisted.lifecycle === "archived" ? "archived" : "active",
    archivedAt:
      persisted.lifecycle === "archived"
        ? persisted.archivedAt ?? persisted.updatedAt ?? persisted.createdAt ?? null
        : null,
    pythonEnvironment: persisted.pythonEnvironment ?? null,
    createdAt: persisted.createdAt ?? new Date(0).toISOString(),
    updatedAt: persisted.updatedAt ?? persisted.createdAt ?? new Date(0).toISOString(),
  };
}

function assertManagedAgentPaths(
  stateRoot: string,
  agentId: string,
  paths: {
    workspaceRoot: string;
    runtimeHome: string;
  }
): void {
  const managedPaths = resolveAgentPaths({
    stateRoot,
    agentId,
  });

  if (path.resolve(paths.workspaceRoot) !== managedPaths.workspaceRoot) {
    throw badRequestError(
      `workspaceRoot must use the managed agent path: ${managedPaths.workspaceRoot}`
    );
  }

  if (path.resolve(paths.runtimeHome) !== managedPaths.runtimeHome) {
    throw badRequestError(
      `runtimeHome must use the managed agent path: ${managedPaths.runtimeHome}`
    );
  }
}

export function usesManagedAgentPaths(
  stateRoot: string,
  agent: Pick<AgentRecord, "id" | "workspaceRoot" | "runtimeHome">
): boolean {
  const managedPaths = resolveAgentPaths({
    stateRoot,
    agentId: agent.id,
  });

  return (
    path.resolve(agent.workspaceRoot) === managedPaths.workspaceRoot &&
    path.resolve(agent.runtimeHome) === managedPaths.runtimeHome
  );
}

export function buildAgentSessionInput(
  agent: AgentRecord,
  overrides: AgentSessionOverrides = {}
): RuntimeSessionInput {
  if (!agent.id) {
    throw new Error("buildAgentSessionInput() requires an agent record");
  }

  return {
    id: overrides.sessionId,
    agentId: agent.id,
    runtimeKind: overrides.runtimeKind ?? agent.defaultRuntime,
    runtimeSessionId: overrides.runtimeSessionId ?? null,
    workspaceRoot: path.resolve(overrides.workspaceRoot ?? agent.workspaceRoot),
    runtimeHome: path.resolve(overrides.runtimeHome ?? agent.runtimeHome),
    codexBin: overrides.codexBin,
    sandbox: overrides.sandbox ?? agent.sandboxPolicy,
    approval: overrides.approval ?? agent.approvalPolicy,
    profile: overrides.profile ?? agent.modelProfile ?? null,
    authProfileId: overrides.authProfileId ?? null,
    model: overrides.model ?? null,
    ollamaLaunchTarget: overrides.ollamaLaunchTarget ?? null,
    reasoningEffort: overrides.reasoningEffort ?? null,
    serviceTier: overrides.serviceTier ?? null,
    fullAuto: overrides.fullAuto ?? false,
    dangerouslyBypassApprovalsAndSandbox:
      overrides.dangerouslyBypassApprovalsAndSandbox ?? false,
    additionalWritableDirs: overrides.additionalWritableDirs ?? [],
    configOverrides: overrides.configOverrides ?? [],
    enableFeatures: overrides.enableFeatures ?? [],
    disableFeatures: overrides.disableFeatures ?? [],
    skipGitRepoCheck: overrides.skipGitRepoCheck ?? true,
    ephemeral: overrides.ephemeral ?? false,
  };
}

export class AgentManager {
  private readonly stateRoot: string;
  private readonly now: () => string;
  private readonly idGenerator: () => string;
  private readonly execFileImpl: ExecFileLike;

  constructor(options: AgentManagerOptions = {}) {
    this.stateRoot = resolveManagerStateRoot(options.stateRoot);
    this.now = options.now ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.execFileImpl = options.execFile ?? defaultExecFile;
  }

  getAgentRoot(agentId: string): string {
    return path.join(this.stateRoot, "agents", agentId);
  }

  getMetadataPath(agentId: string): string {
    return path.join(this.getAgentRoot(agentId), "agent.json");
  }

  async createAgent(input: AgentCreateInput = {}): Promise<AgentRecord> {
    const {
      bootstrapUvVenv = false,
      uvVenvPath,
      pythonEnvironment: requestedPythonEnvironment,
      ...persistedInput
    } = input;
    const id = input.id ?? this.idGenerator();
    assertManagedAgentPaths(this.stateRoot, id, {
      workspaceRoot:
        persistedInput.workspaceRoot ?? path.join(this.getAgentRoot(id), "workspace"),
      runtimeHome:
        persistedInput.runtimeHome ?? path.join(this.getAgentRoot(id), "runtime-home"),
    });
    const paths = resolveAgentPaths({
      stateRoot: this.stateRoot,
      agentId: id,
      workspaceRoot: persistedInput.workspaceRoot,
      runtimeHome: persistedInput.runtimeHome,
    });

    if (await pathExists(paths.metadataPath)) {
      throw new Error(`Agent already exists: ${id}`);
    }

    const timestamp = this.now();
    const agent: AgentRecord = {
      id,
      name: persistedInput.name ?? id,
      description: persistedInput.description ?? "",
      soul: persistedInput.soul ?? null,
      color: persistedInput.color ?? null,
      workspaceRoot: paths.workspaceRoot,
      runtimeHome: paths.runtimeHome,
      defaultRuntime: persistedInput.defaultRuntime ?? DEFAULT_AGENT_RUNTIME,
      sandboxPolicy: persistedInput.sandboxPolicy ?? DEFAULT_SANDBOX_POLICY,
      approvalPolicy: persistedInput.approvalPolicy ?? DEFAULT_APPROVAL_POLICY,
      modelProfile: persistedInput.modelProfile ?? null,
      runtimePolicy:
        persistedInput.runtimePolicy ?? buildDefaultAgentRuntimePolicy(),
      toolPolicy:
        persistedInput.toolPolicy ??
        buildDefaultAgentToolPolicy({
          workspaceRoot: paths.workspaceRoot,
        }),
      status: persistedInput.status ?? DEFAULT_AGENT_STATUS,
      lifecycle:
        persistedInput.lifecycle === "archived" ? "archived" : DEFAULT_AGENT_LIFECYCLE,
      archivedAt:
        persistedInput.lifecycle === "archived" ? timestamp : persistedInput.archivedAt ?? null,
      pythonEnvironment: requestedPythonEnvironment ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await ensureAgentFilesystemLayout(paths);

    if (bootstrapUvVenv) {
      const uvEnvironment = await ensureUvVirtualEnvironment({
        workspaceRoot: paths.workspaceRoot,
        venvPath: uvVenvPath,
        execFileImpl: this.execFileImpl,
      });
      agent.pythonEnvironment = {
        manager: "uv",
        type: "venv",
        path: uvEnvironment.path,
      };
    }

    await writeFile(paths.metadataPath, serializeJson(agent));
    await ensureAgentWorkspaceScaffold(agent);

    return agent;
  }

  async getAgent(agentId: string): Promise<AgentRecord> {
    const metadataPath = this.getMetadataPath(agentId);
    const agent = await readAgentFile(metadataPath);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    if (usesManagedAgentPaths(this.stateRoot, agent)) {
      return agent;
    }

    const managedPaths = resolveAgentPaths({
      stateRoot: this.stateRoot,
      agentId,
    });
    const currentDefaultToolPolicy = buildDefaultAgentToolPolicy({
      workspaceRoot: agent.workspaceRoot,
    });
    const repaired: AgentRecord = {
      ...agent,
      workspaceRoot: managedPaths.workspaceRoot,
      runtimeHome: managedPaths.runtimeHome,
      toolPolicy:
        policiesEqual(agent.toolPolicy, currentDefaultToolPolicy)
          ? buildDefaultAgentToolPolicy({
              workspaceRoot: managedPaths.workspaceRoot,
            })
          : agent.toolPolicy?.python?.venvPath === resolveUvVenvPath(agent.workspaceRoot)
            ? {
                ...agent.toolPolicy,
                python: {
                  ...agent.toolPolicy.python,
                  venvPath: resolveUvVenvPath(managedPaths.workspaceRoot),
                },
              }
          : agent.toolPolicy,
      pythonEnvironment:
        agent.pythonEnvironment?.manager === "uv" &&
        agent.pythonEnvironment.path === resolveUvVenvPath(agent.workspaceRoot)
          ? {
              ...agent.pythonEnvironment,
              path: resolveUvVenvPath(managedPaths.workspaceRoot),
            }
          : agent.pythonEnvironment,
      updatedAt: this.now(),
    };

    await ensureAgentFilesystemLayout(managedPaths);
    await writeFile(metadataPath, serializeJson(repaired));
    await ensureAgentWorkspaceScaffold(repaired);

    return repaired;
  }

  async listAgents(): Promise<AgentRecord[]> {
    const agentsRoot = path.join(this.stateRoot, "agents");
    if (!(await pathExists(agentsRoot))) {
      return [];
    }

    const entries = await readdir(agentsRoot, { withFileTypes: true });
    const agents: AgentRecord[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const agent = await readAgentFile(
        path.join(agentsRoot, entry.name, "agent.json")
      );
      if (agent) {
        agents.push(agent);
      }
    }

    return agents.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id)
    );
  }

  async updateAgent(
    agentId: string,
    patch: AgentUpdatePatch = {}
  ): Promise<AgentRecord> {
    if ("id" in patch && patch.id !== agentId) {
      throw new Error("updateAgent() does not support changing the agent id");
    }

    const {
      bootstrapUvVenv = false,
      uvVenvPath,
      ...persistedPatch
    } = patch;
    const current = await this.getAgent(agentId);
    if ("workspaceRoot" in persistedPatch || "runtimeHome" in persistedPatch) {
      assertManagedAgentPaths(this.stateRoot, agentId, {
        workspaceRoot: persistedPatch.workspaceRoot ?? current.workspaceRoot,
        runtimeHome: persistedPatch.runtimeHome ?? current.runtimeHome,
      });
    }
    const paths = resolveAgentPaths({
      stateRoot: this.stateRoot,
      agentId,
      workspaceRoot: persistedPatch.workspaceRoot ?? current.workspaceRoot,
      runtimeHome: persistedPatch.runtimeHome ?? current.runtimeHome,
    });
    const defaultMovedUvPath = resolveUvVenvPath(paths.workspaceRoot);
    const currentDefaultUvPath = resolveUvVenvPath(current.workspaceRoot);
    const inferredRuntimePolicy =
      "runtimePolicy" in persistedPatch
        ? persistedPatch.runtimePolicy
        : current.runtimePolicy ?? buildDefaultAgentRuntimePolicy();
    const currentDefaultToolPolicy = buildDefaultAgentToolPolicy({
      workspaceRoot: current.workspaceRoot,
    });
    const inferredToolPolicy =
      "toolPolicy" in persistedPatch
        ? persistedPatch.toolPolicy
        : persistedPatch.workspaceRoot &&
            policiesEqual(current.toolPolicy, currentDefaultToolPolicy)
          ? buildDefaultAgentToolPolicy({
              workspaceRoot: paths.workspaceRoot,
            })
          : current.toolPolicy ??
            buildDefaultAgentToolPolicy({
              workspaceRoot: paths.workspaceRoot,
            });
    const inferredPythonEnvironment =
      "pythonEnvironment" in persistedPatch
        ? persistedPatch.pythonEnvironment
        : persistedPatch.workspaceRoot &&
            current.pythonEnvironment?.manager === "uv" &&
            current.pythonEnvironment?.path === currentDefaultUvPath
          ? {
              ...current.pythonEnvironment,
              path: defaultMovedUvPath,
            }
          : current.pythonEnvironment ?? null;
    const inferredLifecycle =
      persistedPatch.lifecycle === "archived" ? "archived" : persistedPatch.lifecycle === "active" ? "active" : current.lifecycle;

    const agent: AgentRecord = {
      ...current,
      ...persistedPatch,
      id: agentId,
      workspaceRoot: paths.workspaceRoot,
      runtimeHome: paths.runtimeHome,
      runtimePolicy: inferredRuntimePolicy,
      toolPolicy: inferredToolPolicy,
      lifecycle: inferredLifecycle,
      archivedAt:
        inferredLifecycle === "archived"
          ? current.archivedAt ?? this.now()
          : null,
      pythonEnvironment: inferredPythonEnvironment,
      updatedAt: this.now(),
    };

    await ensureAgentFilesystemLayout(paths);

    if (bootstrapUvVenv) {
      const uvEnvironment = await ensureUvVirtualEnvironment({
        workspaceRoot: paths.workspaceRoot,
        venvPath: uvVenvPath,
        execFileImpl: this.execFileImpl,
      });
      agent.pythonEnvironment = {
        manager: "uv",
        type: "venv",
        path: uvEnvironment.path,
      };
    }

    await writeFile(paths.metadataPath, serializeJson(agent));
    await ensureAgentWorkspaceScaffold(agent);

    return agent;
  }

  async deleteAgent(agentId: string): Promise<void> {
    const agent = await this.getAgent(agentId);
    if (!usesManagedAgentPaths(this.stateRoot, agent)) {
      throw conflictError(
        `Cannot delete agent with unmanaged workspace/runtime paths: ${agentId}`
      );
    }

    const agentRoot = this.getAgentRoot(agentId);
    if (!(await pathExists(agentRoot))) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    await rm(agentRoot, {
      recursive: true,
      force: false,
    });
  }

  async createRuntimeSession<T>(
    runtime: { createSession(input: RuntimeSessionInput): Promise<T> },
    agentOrId: string | AgentRecord,
    overrides: AgentSessionOverrides = {}
  ): Promise<T> {
    if (!runtime?.createSession) {
      throw new Error("createRuntimeSession() requires a runtime adapter");
    }

    const agent =
      typeof agentOrId === "string" ? await this.getAgent(agentOrId) : agentOrId;

    return runtime.createSession(buildAgentSessionInput(agent, overrides));
  }

  async createCodexSession<T>(
    runtime: { createSession(input: RuntimeSessionInput): Promise<T> },
    agentOrId: string | AgentRecord,
    overrides: AgentSessionOverrides = {}
  ): Promise<T> {
    return this.createRuntimeSession(runtime, agentOrId, overrides);
  }
}
