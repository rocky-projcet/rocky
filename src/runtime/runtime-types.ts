export type CodexCommandMode = "exec" | "resume";
export type RuntimeKind = "codex-cli" | "claude-code" | "ollama";
export type RuntimeProviderKind = "codex" | "claude" | "ollama";
export type RuntimeReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type RuntimeServiceTier = "fast";
export type RuntimeOllamaLaunchTarget = "codex" | "claude";

export function normalizeRuntimeOllamaLaunchTarget(
  value: string | null | undefined
): RuntimeOllamaLaunchTarget | null {
  return value === "claude" || value === "codex" ? value : null;
}

export function normalizeRuntimeServiceTier(
  value: string | null | undefined
): RuntimeServiceTier | null {
  if (value === "fast") {
    return "fast";
  }

  if (value === "flex" || value === "default") {
    return null;
  }

  return null;
}

export interface RuntimeModelOption {
  id: string;
  label: string;
  provider: RuntimeProviderKind;
  supportedReasoningEfforts: RuntimeReasoningEffort[];
  defaultReasoningEffort: RuntimeReasoningEffort | null;
  supportedServiceTiers: RuntimeServiceTier[];
  defaultServiceTier: RuntimeServiceTier | null;
}

export interface RuntimeCapabilities {
  streaming: boolean;
  resumeSession: boolean;
  shellExecution: boolean;
  fileMutation: boolean;
  approvalFlow: boolean;
  durableSessionState: boolean;
  structuredEvents: boolean;
  skillInjection: boolean;
}

export interface RuntimeAuthSource {
  kind: "current-home" | "managed-home" | "none";
  authProfileId?: string | null;
  homePath?: string | null;
}

export interface RuntimeSessionConfig {
  codexBin: string;
  sandbox: string;
  approval: string | null;
  profile: string | null;
  authProfileId: string | null;
  model: string | null;
  reasoningEffort: RuntimeReasoningEffort | null;
  serviceTier: RuntimeServiceTier | null;
  ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
  fullAuto: boolean;
  dangerouslyBypassApprovalsAndSandbox: boolean;
  additionalWritableDirs: string[];
  configOverrides: string[];
  enableFeatures: string[];
  disableFeatures: string[];
  skipGitRepoCheck: boolean;
  ephemeral: boolean;
}

export interface RuntimeSessionInput {
  id?: string;
  agentId?: string | null;
  runtimeKind?: RuntimeKind;
  runtimeSessionId?: string | null;
  workspaceRoot: string;
  runtimeHome?: string;
  codexBin?: string;
  sandbox?: string;
  approval?: string | null;
  profile?: string | null;
  authProfileId?: string | null;
  model?: string | null;
  reasoningEffort?: RuntimeReasoningEffort | null;
  serviceTier?: RuntimeServiceTier | null;
  ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
  fullAuto?: boolean;
  dangerouslyBypassApprovalsAndSandbox?: boolean;
  additionalWritableDirs?: string[];
  configOverrides?: string[];
  enableFeatures?: string[];
  disableFeatures?: string[];
  skipGitRepoCheck?: boolean;
  ephemeral?: boolean;
}

export interface RuntimeSession {
  id: string;
  agentId: string | null;
  runtimeKind: RuntimeKind;
  runtimeSessionId: string | null;
  workspaceRoot: string;
  runtimeHome: string;
  config: RuntimeSessionConfig;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeRequest {
  sessionId: string;
  runId?: string;
  prompt: string;
  messages?: RuntimeConversationMessage[];
  dangerouslyBypassApprovalsAndSandbox?: boolean;
  additionalWritableDirs?: string[];
  configOverrides?: string[];
  enableFeatures?: string[];
  disableFeatures?: string[];
  skipGitRepoCheck?: boolean;
  ephemeral?: boolean;
  outputLastMessagePath?: string | null;
  images?: string[];
  extraEnv?: NodeJS.ProcessEnv;
  authSource?: RuntimeAuthSource | null;
  seedAuthFromCurrentHome?: boolean;
}

export interface RuntimeConversationMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CodexCommand {
  command: string;
  args: string[];
}

export interface RuntimeEvent {
  source: string;
  type: string;
  runId: string | null;
  sessionId: string | null;
  runtimeSessionId: string | null;
  rawType: string;
  occurredAt: string;
  data: Record<string, any>;
  raw: unknown;
}

export interface NormalizeEventContext {
  runId?: string | null;
  sessionId?: string | null;
  runtimeSessionId?: string | null;
  now?: () => string;
}

export interface SessionBinding {
  runtimeSessionId: string;
  boundAt: string;
  source: string;
}

export interface RuntimeMessage {
  role: "assistant";
  text: string;
  itemType: string | null;
  occurredAt: string;
  source: string;
}

export interface RuntimeArtifactRef {
  kind: "file";
  role: string;
  path: string;
  workspaceRelativePath?: string | null;
}

export interface RuntimeWorkspaceFileSnapshotEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface RuntimeRunResult {
  runId: string;
  sessionId: string;
  runtimeSessionId: string | null;
  sessionBinding: SessionBinding | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  command: string;
  args: string[];
  messages: RuntimeMessage[];
  warnings: Array<Record<string, any>>;
  errors: string[];
  stderr: string[];
  artifactRefs: RuntimeArtifactRef[];
  lastMessage: string | null;
  outputLastMessagePath: string | null;
  rawEvents: unknown[];
}

export interface RuntimeRunStart {
  runId: string;
  sessionId: string;
  command: string;
  args: string[];
  startedAt: string;
  status: string;
}

export interface RuntimeChildProcess {
  stdin?: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadWriteStream;
  stderr: NodeJS.ReadWriteStream;
  kill(signal?: NodeJS.Signals): void;
  once(event: "error", listener: (error: Error) => void): this;
  once(
    event: "close",
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void
  ): this;
}

export interface RuntimeSpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: ["ignore" | "pipe", "pipe", "pipe"];
}

export type SpawnLike = (
  command: string,
  args: string[],
  options: RuntimeSpawnOptions
) => RuntimeChildProcess;

export interface RuntimeOptions {
  spawn?: SpawnLike;
  now?: () => string;
  idGenerator?: () => string;
  baseEnv?: NodeJS.ProcessEnv;
}

export interface RuntimeRunState {
  id: string;
  sessionId: string;
  mode: CodexCommandMode;
  command: string;
  args: string[];
  startedAt: string;
  endedAt: string | null;
  status: string;
  runtimeSessionId: string | null;
  rawEvents: unknown[];
  stderr: string[];
  errors: string[];
  warnings: Array<Record<string, any>>;
  messages: RuntimeMessage[];
  cancelled: boolean;
  sessionBinding: SessionBinding | null;
  child: RuntimeChildProcess;
  result: RuntimeRunResult | null;
  completion: Promise<RuntimeRunResult> | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  workspaceSnapshot: Map<string, RuntimeWorkspaceFileSnapshotEntry>;
}
