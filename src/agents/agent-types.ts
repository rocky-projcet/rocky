import type {
  RuntimeKind,
  RuntimeSessionInput,
} from "../runtime/runtime-types.js";

export interface AgentRuntimePolicy {
  workspaceMode: string;
  gitBackedWorkspace: boolean;
  isolatedHome: boolean;
  isolatedXdg: boolean;
}

export interface AgentPythonToolPolicy {
  enabled: boolean;
  mode: string;
  venvPath: string;
  interpreterCandidates: string[];
  systemFallback: string;
}

export interface AgentSshToolPolicy {
  enabled: boolean;
  mode: string;
  command: string;
}

export interface AgentToolPolicy {
  python: AgentPythonToolPolicy;
  ssh: AgentSshToolPolicy;
}

export interface PythonEnvironment {
  manager: string;
  type: string;
  path: string;
}

export type AgentLifecycle = "active" | "archived";

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  soul: string | null;
  color: string | null;
  workspaceRoot: string;
  runtimeHome: string;
  defaultRuntime: RuntimeKind;
  sandboxPolicy: string;
  approvalPolicy: string;
  modelProfile: string | null;
  runtimePolicy: AgentRuntimePolicy;
  toolPolicy: AgentToolPolicy;
  status: string;
  lifecycle: AgentLifecycle;
  archivedAt: string | null;
  pythonEnvironment: PythonEnvironment | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentPaths {
  stateRoot: string;
  agentRoot: string;
  workspaceRoot: string;
  runtimeHome: string;
  metadataPath: string;
}

export interface ExecFileResult {
  stdout?: string;
  stderr?: string;
}

export interface ExecFileOptions {
  cwd?: string;
}

export type ExecFileLike = (
  file: string,
  args: string[],
  options?: ExecFileOptions
) => Promise<ExecFileResult>;

export interface AgentCreateInput extends Partial<AgentRecord> {
  bootstrapUvVenv?: boolean;
  uvVenvPath?: string;
}

export interface AgentUpdatePatch extends Partial<AgentRecord> {
  bootstrapUvVenv?: boolean;
  uvVenvPath?: string;
}

export interface AgentSessionOverrides {
  sessionId?: string;
  runtimeKind?: RuntimeKind;
  runtimeSessionId?: string | null;
  workspaceRoot?: string;
  runtimeHome?: string;
  codexBin?: string;
  sandbox?: string;
  approval?: string | null;
  profile?: string | null;
  authProfileId?: string | null;
  model?: string | null;
  ollamaLaunchTarget?: RuntimeSessionInput["ollamaLaunchTarget"];
  reasoningEffort?: RuntimeSessionInput["reasoningEffort"];
  serviceTier?: RuntimeSessionInput["serviceTier"];
  fullAuto?: boolean;
  dangerouslyBypassApprovalsAndSandbox?: boolean;
  additionalWritableDirs?: string[];
  configOverrides?: string[];
  enableFeatures?: string[];
  disableFeatures?: string[];
  skipGitRepoCheck?: boolean;
  ephemeral?: boolean;
}

export interface AgentManagerOptions {
  stateRoot?: string;
  now?: () => string;
  idGenerator?: () => string;
  execFile?: ExecFileLike;
}

export interface AgentRegistryManagerLike {
  createAgent(input?: AgentCreateInput): Promise<AgentRecord>;
  getAgent(agentId: string): Promise<AgentRecord>;
  listAgents(): Promise<AgentRecord[]>;
  updateAgent(agentId: string, patch?: AgentUpdatePatch): Promise<AgentRecord>;
  deleteAgent(agentId: string): Promise<void>;
  createRuntimeSession<T>(
    runtime: { createSession(input: RuntimeSessionInput): Promise<T> },
    agentOrId: string | AgentRecord,
    overrides?: AgentSessionOverrides
  ): Promise<T>;
  createCodexSession<T>(
    runtime: { createSession(input: RuntimeSessionInput): Promise<T> },
    agentOrId: string | AgentRecord,
    overrides?: AgentSessionOverrides
  ): Promise<T>;
}

export interface AgentRegistryServiceOptions extends AgentManagerOptions {
  manager?: AgentRegistryManagerLike;
}
