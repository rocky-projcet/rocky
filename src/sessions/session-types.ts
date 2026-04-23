import type {
  RuntimeKind,
  RuntimeArtifactRef,
  RuntimeEvent,
  RuntimeOllamaLaunchTarget,
  RuntimeReasoningEffort,
  RuntimeRequest,
  RuntimeRunResult,
  RuntimeServiceTier,
  RuntimeSessionConfig,
} from "../runtime/runtime-types.js";
import type {
  RuntimeArtifactPreferredAction,
  RuntimeArtifactPresentation,
} from "../runtime/runtime-artifact-metadata.js";
import type {
  AgentRecord,
  AgentRegistryManagerLike,
  AgentSessionOverrides,
} from "../agents/agent-types.js";
import type { AuthProfileServiceLike } from "../auth/auth-profile-types.js";
import type { RuntimeSession, RuntimeRunStart } from "../runtime/runtime-types.js";

export type AgentSessionStatus = "active" | "running" | "failed" | "cancelled";
export type AgentSessionLifecycle = "active" | "archived";
export type AgentRunStatus = "running" | "completed" | "failed" | "cancelled";
export type AgentRunTriggerType =
  | "interactive"
  | "manual_task"
  | "scheduled"
  | "event";
export type AgentSessionKind = "task-request" | "single-task";

export interface AgentSessionRecord {
  id: string;
  agentId: string;
  kind: AgentSessionKind;
  runtimeKind: RuntimeKind;
  runtimeSessionId: string | null;
  authProfileId: string | null;
  title: string | null;
  status: AgentSessionStatus;
  lifecycle: AgentSessionLifecycle;
  archivedAt: string | null;
  workspaceRoot: string;
  runtimeHome: string;
  runtimeConfig: RuntimeSessionConfig;
  createdAt: string;
  lastActivityAt: string;
}

export interface AgentSessionMessage {
  id: string;
  sessionId: string;
  runId: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  blocks?: AgentSessionMessageBlock[];
  artifacts?: AgentSessionArtifactManifestEntry[];
  source: string;
  createdAt: string;
}

export type AgentSessionMessageBlock =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "code";
      code: string;
      language: string | null;
    }
  | {
      type: "image";
      artifactRole: string;
      alt: string | null;
    }
  | {
      type: "chart";
      artifactRole: string;
      title: string | null;
    }
  | {
      type: "file";
      artifactRole: string;
      label: string | null;
    };

export interface AgentSessionArtifactManifestEntry {
  kind: "file";
  role: string;
  name: string;
  contentType: string;
  presentation: RuntimeArtifactPresentation;
  size: number | null;
  previewable: boolean;
  previewUrl: string | null;
  downloadUrl: string;
  preferredAction: RuntimeArtifactPreferredAction;
}

export interface AgentRunRecord {
  id: string;
  agentId: string;
  sessionId: string;
  runtimeRunId: string | null;
  triggerType: AgentRunTriggerType;
  status: AgentRunStatus;
  runtimeKind?: RuntimeKind;
  ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
  model: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null;
  prompt: string;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
  runtimeSessionId: string | null;
  outputLastMessagePath: string | null;
  resultPath: string;
  eventsPath: string;
  artifactsDir: string;
}

export interface AgentSessionCreateInput extends AgentSessionOverrides {
  agentId: string;
  sessionId?: string;
  title?: string | null;
  kind?: AgentSessionKind;
}

export interface AgentSessionUpdateInput {
  sessionId: string;
  title?: string | null;
  lifecycle?: AgentSessionLifecycle;
  authProfileId?: string | null;
  model?: string | null;
  reasoningEffort?: RuntimeReasoningEffort | null;
  serviceTier?: RuntimeServiceTier | null;
}

export interface AgentSessionTurnInput
  extends Omit<AgentSessionOverrides, "sessionId" | "runtimeSessionId"> {
  sessionId: string;
  runId?: string;
  reuseMessageId?: string;
  prompt: string;
  extraSystemInstructions?: string[];
  triggerType?: AgentRunTriggerType;
  images?: string[];
  extraEnv?: NodeJS.ProcessEnv;
  seedAuthFromCurrentHome?: boolean;
}

export interface SessionServiceOptions {
  stateRoot?: string;
  baseEnv?: NodeJS.ProcessEnv;
  manager?: AgentRegistryManagerLike & {
    getAgent(agentId: string): Promise<AgentRecord>;
    createRuntimeSession(
      runtime: { createSession(input: any): Promise<RuntimeSession> },
      agentOrId: string | AgentRecord,
      overrides?: AgentSessionOverrides
    ): Promise<RuntimeSession>;
    createCodexSession(
      runtime: { createSession(input: any): Promise<RuntimeSession> },
      agentOrId: string | AgentRecord,
      overrides?: AgentSessionOverrides
    ): Promise<RuntimeSession>;
  };
  authProfiles?: AuthProfileServiceLike;
  runtime?: {
    createSession(input: any): Promise<RuntimeSession>;
    sendTurn(input: RuntimeRequest): Promise<RuntimeRunStart>;
    resumeSession(input: RuntimeRequest): Promise<RuntimeRunStart>;
    streamEvents(runId: string): AsyncIterable<RuntimeEvent>;
    cancelRun(runId: string): Promise<void>;
    getRunResult(runId: string): Promise<RuntimeRunResult>;
  };
  runtimeRegistry?: {
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
  };
  now?: () => string;
  idGenerator?: () => string;
}

export interface LiveRunState {
  sessionId: string;
  runtimeKind: RuntimeKind;
  eventQueue: AsyncIterable<RuntimeEvent>;
  completion: Promise<RuntimeRunResult>;
}

export interface AgentSessionPaths {
  sessionRoot: string;
  metadataPath: string;
  transcriptPath: string;
}

export interface AgentRunPaths {
  runRoot: string;
  metadataPath: string;
  resultPath: string;
  eventsPath: string;
  artifactsDir: string;
  outputLastMessagePath: string;
}

export interface StoredRuntimeEvent extends RuntimeEvent {}

export interface StoredRunResult extends RuntimeRunResult {
  artifactRefs: RuntimeArtifactRef[];
}
