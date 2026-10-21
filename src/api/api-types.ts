import type {
  AgentCreateInput,
  AgentRecord,
  AgentRegistryServiceOptions,
  AgentUpdatePatch,
} from "../agents/agent-types.js";
import type { HardwareStatusServiceLike } from "../system/hardware-status-types.js";
import type { AppUpdateServiceLike } from "../installer/app-update-types.js";
import type {
  NativeFileOpener,
  NativeFolderOpener,
} from "./http/native-open.js";

export interface AgentServiceLike {
  createAgent(input?: AgentCreateInput): Promise<AgentRecord>;
  listAgents(): Promise<AgentRecord[]>;
  getAgent(agentId: string): Promise<AgentRecord>;
  updateAgent(agentId: string, patch?: AgentUpdatePatch): Promise<AgentRecord>;
  deleteAgent(agentId: string): Promise<void>;
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

export interface AgentWorkspaceSearchRecord {
  agentId: string;
  workspaceRoot: string;
  path: string;
  query: string;
  matches: AgentWorkspaceEntryRecord[];
  truncated: boolean;
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

export interface AgentWorkspaceDeleteResult {
  agentId: string;
  path: string;
  name: string;
  kind: AgentWorkspaceEntryKind;
  deleted: true;
}

export interface AgentEngineServerOptions extends AgentRegistryServiceOptions {
  agentService?: AgentServiceLike;
  hardwareStatusService?: HardwareStatusServiceLike;
  appUpdateService?: AppUpdateServiceLike;
  appVersion?: string;
  nativeFileOpener?: NativeFileOpener;
  nativeFolderOpener?: NativeFolderOpener;
}
