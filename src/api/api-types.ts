import type {
  AgentCreateInput,
  AgentRecord,
  AgentRegistryServiceOptions,
  AgentUpdatePatch,
} from "../agents/agent-types.js";
import type { ClaudeAccountServiceLike } from "../account/claude-account-types.js";
import type { ClaudeStatusServiceLike } from "../account/claude-status-types.js";
import type { CodexAccountServiceLike } from "../account/codex-account-types.js";
import type { CodexStatusServiceLike } from "../account/codex-status-types.js";
import type { AuthProfileServiceLike } from "../auth/auth-profile-types.js";
import type { AgentMessengerServiceLike } from "../messenger/messenger-types.js";
import type {
  AgentRunRecord,
  AgentSessionKind,
  AgentSessionMessage,
  AgentSessionLifecycle,
  AgentSessionRecord,
} from "../sessions/session-types.js";
import type {
  AgentTaskCreateInput,
  AgentTaskRecord,
  AgentTaskRunRecord,
  AgentTaskUpdateInput,
} from "../tasks/task-types.js";
import type { RockyChatServiceLike } from "../rocky-chat/rocky-chat-types.js";
import type {
  RuntimeKind,
  RuntimeEvent,
  RuntimeOllamaLaunchTarget,
  RuntimeReasoningEffort,
  RuntimeRunResult,
  RuntimeSession,
  RuntimeRequest,
  RuntimeRunStart,
  RuntimeServiceTier,
} from "../runtime/runtime-types.js";
import type { HardwareStatusServiceLike } from "../system/hardware-status-types.js";

export interface SessionServiceLike {
  createSession(input: {
    agentId: string;
    title?: string | null;
    runtimeKind?: RuntimeKind;
    ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
    authProfileId?: string | null;
    model?: string | null;
    reasoningEffort?: RuntimeReasoningEffort | null;
    serviceTier?: RuntimeServiceTier | null;
  }): Promise<AgentSessionRecord>;
  listAgentSessions(
    agentId: string,
    options?: {
      includeArchived?: boolean;
      kinds?: AgentSessionKind[];
    }
  ): Promise<AgentSessionRecord[]>;
  updateSession(input: {
    sessionId: string;
    title?: string | null;
    lifecycle?: AgentSessionLifecycle;
    authProfileId?: string | null;
    model?: string | null;
    reasoningEffort?: RuntimeReasoningEffort | null;
    serviceTier?: RuntimeServiceTier | null;
  }): Promise<AgentSessionRecord>;
  getSession(sessionId: string): Promise<AgentSessionRecord>;
  getTranscript(sessionId: string): Promise<AgentSessionMessage[]>;
  deleteSession(sessionId: string): Promise<void>;
  stopSessionRuns(sessionId: string): Promise<string[]>;
  sendTurn(input: {
    sessionId: string;
    prompt: string;
    images?: string[];
    runtimeKind?: RuntimeKind;
    ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
    model?: string | null;
    reasoningEffort?: RuntimeReasoningEffort | null;
    serviceTier?: RuntimeServiceTier | null;
    reuseMessageId?: string;
  }): Promise<AgentRunRecord>;
  streamRunEvents(runId: string): AsyncIterable<RuntimeEvent>;
  getRun(runId: string): Promise<AgentRunRecord>;
  getRunResult(runId: string): Promise<RuntimeRunResult>;
  cancelRun(runId: string): Promise<void>;
  stopAgentRuns(agentId: string): Promise<string[]>;
}

export interface RuntimeDescriptorRecord {
  kind: RuntimeKind;
  label: string;
  provider: "codex" | "claude" | "ollama";
  defaultModel: string | null;
  modelOptions: Array<{
    id: string;
    label: string;
    provider: "codex" | "claude" | "ollama";
    supportedReasoningEfforts: string[];
    defaultReasoningEffort: string | null;
    supportedServiceTiers: string[];
    defaultServiceTier: string | null;
  }>;
}

export interface RuntimeRegistryLike {
  get(kind: RuntimeKind): {
    kind: RuntimeKind;
    adapter: {
      createSession(input: any): Promise<RuntimeSession>;
      sendTurn(input: RuntimeRequest): Promise<RuntimeRunStart>;
      resumeSession(input: RuntimeRequest): Promise<RuntimeRunStart>;
      streamEvents(runId: string): AsyncIterable<RuntimeEvent>;
      cancelRun(runId: string): Promise<void>;
      getRunResult(runId: string): Promise<RuntimeRunResult>;
    };
    resolveBin(
      requestedBin: string | undefined,
      env?: NodeJS.ProcessEnv
    ): Promise<string>;
  };
  list(): Promise<RuntimeDescriptorRecord[]>;
}

export interface AgentServiceLike {
  createAgent(input?: AgentCreateInput): Promise<AgentRecord>;
  listAgents(): Promise<AgentRecord[]>;
  getAgent(agentId: string): Promise<AgentRecord>;
  updateAgent(agentId: string, patch?: AgentUpdatePatch): Promise<AgentRecord>;
  deleteAgent(agentId: string): Promise<void>;
}

export interface TaskServiceLike {
  createTask(agentId: string, input: AgentTaskCreateInput): Promise<AgentTaskRecord>;
  listAgentTasks(
    agentId: string,
    options?: {
      includeArchived?: boolean;
    }
  ): Promise<AgentTaskRecord[]>;
  getTask(taskId: string): Promise<AgentTaskRecord>;
  updateTask(input: AgentTaskUpdateInput): Promise<AgentTaskRecord>;
  deleteTask(taskId: string): Promise<void>;
  listTaskRuns(taskId: string): Promise<AgentTaskRunRecord[]>;
  runTask(input: {
    taskId: string;
    triggerType?: "manual_task" | "scheduled" | "event";
    triggerSource?: string | null;
    eventPayload?: unknown;
  }): Promise<AgentTaskRunRecord>;
  runTaskByWebhookToken(webhookToken: string, payload: unknown): Promise<AgentTaskRunRecord>;
  start?(): Promise<void>;
  close?(): Promise<void>;
}

export interface ArtifactRecord {
  kind: "file";
  role: string;
  name: string;
  contentType: string;
  presentation: "file" | "image" | "chart";
  size: number | null;
  previewable: boolean;
  previewUrl: string | null;
  downloadUrl: string;
  preferredAction: "preview" | "download";
}

export type AgentWorkspaceEntryKind = "directory" | "file";
export type AgentWorkspacePreviewKind =
  | "text"
  | "code"
  | "markdown"
  | "html"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "binary";

export interface AgentWorkspaceEntryRecord {
  kind: AgentWorkspaceEntryKind;
  name: string;
  path: string;
  contentType: string | null;
  size: number | null;
  updatedAt: string;
  previewKind: AgentWorkspacePreviewKind | null;
}

export interface AgentWorkspaceDirectoryRecord {
  agentId: string;
  workspaceRoot: string;
  path: string;
  parentPath: string | null;
  entries: AgentWorkspaceEntryRecord[];
}

export interface AgentWorkspaceFilePreviewRecord {
  agentId: string;
  workspaceRoot: string;
  path: string;
  name: string;
  contentType: string;
  size: number;
  updatedAt: string;
  previewKind: AgentWorkspacePreviewKind;
  text: string | null;
  lineCount: number | null;
  truncated: boolean;
  downloadUrl: string;
  inlinePreviewUrl: string | null;
}

export interface AgentEngineServerOptions extends AgentRegistryServiceOptions {
  sessionService?: SessionServiceLike;
  agentService?: AgentServiceLike;
  authProfileService?: AuthProfileServiceLike;
  codexAccountService?: CodexAccountServiceLike;
  codexStatusService?: CodexStatusServiceLike;
  claudeAccountService?: ClaudeAccountServiceLike;
  claudeStatusService?: ClaudeStatusServiceLike;
  agentMessengerService?: AgentMessengerServiceLike;
  runtimeRegistry?: RuntimeRegistryLike;
  taskService?: TaskServiceLike;
  rockyChatService?: RockyChatServiceLike;
  hardwareStatusService?: HardwareStatusServiceLike;
}
