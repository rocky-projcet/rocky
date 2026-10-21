import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import {
  DEFAULT_AGENT_WORKSPACE_MODE,
  DEFAULT_UV_VENV_DIRNAME,
} from "./agent-policy.js";

import type { AgentPaths, AgentRecord } from "./agent-types.js";

export const RUNTIME_HOME_LAYOUT_DIRS = Object.freeze([
  "config",
  "rules",
  "state",
  "xdg-cache",
  "xdg-config",
  "xdg-state",
]);

export const WORKSPACE_SCAFFOLD_DIRS = Object.freeze([".agents"]);

export const WORKSPACE_AGENT_CONFIG_FILENAME = "agent.config.json";
export const WORKSPACE_ENV_TEMPLATE_FILENAME = ".env.template";

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function resolveWorkspaceScaffoldPaths(workspaceRoot: string): {
  agentsDir: string;
  agentConfigPath: string;
  envTemplatePath: string;
} {
  return {
    agentsDir: path.join(workspaceRoot, ".agents"),
    agentConfigPath: path.join(
      workspaceRoot,
      ".agents",
      WORKSPACE_AGENT_CONFIG_FILENAME
    ),
    envTemplatePath: path.join(workspaceRoot, WORKSPACE_ENV_TEMPLATE_FILENAME),
  };
}

function buildWorkspaceAgentConfig(agent: AgentRecord): Record<string, unknown> {
  return {
    agentId: agent.id,
    name: agent.name,
    description: agent.description,
    workspaceRoot: agent.workspaceRoot,
    runtimeHome: agent.runtimeHome,
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
    `UV_PROJECT_ENVIRONMENT=${DEFAULT_UV_VENV_DIRNAME}`,
    `AGENT_PYTHON_POLICY=${pythonToolPolicy?.mode ?? ""}`,
    `AGENT_PYTHON_VENV=${pythonToolPolicy?.venvPath ?? ""}`,
    `AGENT_PYTHON_FALLBACK=${pythonToolPolicy?.systemFallback ?? ""}`,
    `AGENT_SSH_COMMAND=${sshToolPolicy?.command ?? ""}`,
    "OPENAI_API_KEY=",
  ].join("\n").concat("\n");
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
  await writeFile(
    scaffoldPaths.agentConfigPath,
    serializeJson(buildWorkspaceAgentConfig(agent))
  );
  await writeFile(scaffoldPaths.envTemplatePath, buildWorkspaceEnvTemplate(agent));

  return scaffoldPaths;
}
