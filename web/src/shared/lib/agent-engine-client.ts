export type ProviderKind = "codex" | "claude" | "ollama";

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  soul: string | null;
  color: string | null;
  workspaceRoot: string;
  runtimeHome: string;
  sandboxPolicy: string;
  approvalPolicy: string;
  modelProfile: string | null;
  status: string;
  lifecycle: "active" | "archived";
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentCreateInput {
  name: string;
  id?: string | null;
  description?: string | null;
  soul?: string | null;
}

export interface AgentUpdateInput {
  name?: string;
  description?: string | null;
  soul?: string | null;
  lifecycle?: "active" | "archived";
  color?: string | null;
}

export type HardwareMemoryKind = "ram" | "unified";

export type HardwareGpuMemoryKind =
  | "dedicated"
  | "integrated"
  | "shared"
  | "unified"
  | "unknown";

export interface HardwareCpuRecord {
  model: string | null;
  physicalCores: number | null;
  logicalCores: number;
  speedGHz: number | null;
  usagePercent: number | null;
  normalizedLoadPercent: number | null;
  loadAverage: {
    oneMinute: number | null;
    fiveMinute: number | null;
    fifteenMinute: number | null;
  };
}

export interface HardwareMemoryRecord {
  kind: HardwareMemoryKind;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  availableBytes: number;
  usedPercent: number;
  swapTotalBytes: number | null;
  swapUsedBytes: number | null;
}

export interface HardwareGpuRecord {
  name: string | null;
  vendor: string | null;
  coreCount: number | null;
  memoryKind: HardwareGpuMemoryKind;
  memoryBytes: number | null;
  utilizationPercent: number | null;
  note: string | null;
}

export interface HardwareStorageRecord {
  path: string;
  totalBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  usedPercent: number | null;
}

export interface HardwareStatusRecord {
  hostname: string;
  platform: string;
  arch: string;
  refreshedAt: string;
  cpu: HardwareCpuRecord;
  memory: HardwareMemoryRecord;
  gpus: HardwareGpuRecord[];
  storage: HardwareStorageRecord;
}

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "update-available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "install-started"
  | "unsupported"
  | "failed";

export type AppUpdateAssetKind =
  | "windows-exe"
  | "macos-pkg"
  | "macos-dmg"
  | "macos-app-zip";

export interface AppUpdateAssetRecord {
  kind: AppUpdateAssetKind;
  name: string;
  downloadUrl: string;
  size: number | null;
  sha256: string | null;
  checksumSource: "github-asset-digest" | "checksum-asset" | null;
  checksumAssetName: string | null;
}

export interface AppUpdateDownloadRecord {
  path: string;
  fileName: string;
  size: number;
  sha256: string;
  verified: boolean;
  downloadedAt: string;
  verifiedAt: string;
}

export interface AppUpdateDownloadProgress {
  bytesReceived: number;
  totalBytes: number | null;
  percent: number | null;
}

export interface AppUpdateRecord {
  currentVersion: string;
  platform: string;
  supported: boolean;
  status: AppUpdateStatus;
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
  limitations: string[];
  updateAvailable: boolean;
  installerAsset: AppUpdateAssetRecord | null;
  download: AppUpdateDownloadRecord | null;
  downloadProgress: AppUpdateDownloadProgress | null;
  preservedPathNames: string[];
  checkedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
}

export interface NativeFileOpenRecord {
  status: "opened";
  application: string;
  fileName: string;
  platform: string;
  kind?: "file" | "folder";
  path?: string;
}

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
  kind: "directory" | "file";
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
  kind: AgentWorkspaceEntryRecord["kind"];
  deleted: true;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error(`Failed to read file: ${file.name}`));
    };

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Failed to encode file: ${file.name}`));
        return;
      }

      const [, payload = ""] = reader.result.split(",", 2);
      resolve(payload);
    };

    reader.readAsDataURL(file);
  });
}

export class AgentEngineClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = trimTrailingSlash(baseUrl);
  }

  private async request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${this.baseUrl}${pathname}`, {
      headers,
      ...init,
    });

    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const body = (await response.json()) as { error?: string };
        if (typeof body.error === "string") {
          detail = body.error;
        }
      } catch {
        // Keep the transport-level detail.
      }
      throw new Error(detail);
    }

    if (response.status === 204) {
      return null as T;
    }

    return (await response.json()) as T;
  }

  listAgents(
    options: {
      includeArchived?: boolean;
    } = {}
  ): Promise<AgentRecord[]> {
    const search = new URLSearchParams();
    if (options.includeArchived) {
      search.set("includeArchived", "true");
    }

    return this.request<AgentRecord[]>(
      search.size > 0 ? `/agents?${search.toString()}` : "/agents"
    );
  }

  getHardwareStatus(signal?: AbortSignal): Promise<HardwareStatusRecord> {
    return this.request<HardwareStatusRecord>("/settings/hardware", {
      signal,
    });
  }

  createAgent(input: AgentCreateInput): Promise<AgentRecord> {
    return this.request<AgentRecord>("/agents", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        id: input.id ?? undefined,
        description: input.description ?? undefined,
        soul: input.soul ?? undefined,
      }),
    });
  }

  getAgent(agentId: string): Promise<AgentRecord> {
    return this.request<AgentRecord>(`/agents/${encodeURIComponent(agentId)}`);
  }

  updateAgent(agentId: string, input: AgentUpdateInput): Promise<AgentRecord> {
    return this.request<AgentRecord>(`/agents/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.request<Record<string, never> | null>(
      `/agents/${encodeURIComponent(agentId)}`,
      {
        method: "DELETE",
      }
    );
  }

  getRockyAppUpdate(): Promise<AppUpdateRecord> {
    return this.request<AppUpdateRecord>("/rocky/app-update");
  }

  checkRockyAppUpdate(): Promise<AppUpdateRecord> {
    return this.request<AppUpdateRecord>("/rocky/app-update/check", {
      method: "POST",
    });
  }

  downloadRockyAppUpdateInstaller(): Promise<AppUpdateRecord> {
    return this.request<AppUpdateRecord>("/rocky/app-update/download", {
      method: "POST",
    });
  }

  startRockyAppUpdateInstaller(): Promise<AppUpdateRecord> {
    return this.request<AppUpdateRecord>("/rocky/app-update/install", {
      method: "POST",
      body: JSON.stringify({
        confirmedRestartRisk: true,
      }),
    });
  }

  revealRockyAppUpdateInstaller(): Promise<AppUpdateRecord> {
    return this.request<AppUpdateRecord>("/rocky/app-update/reveal", {
      method: "POST",
    });
  }

  listAgentWorkspace(
    agentId: string,
    searchPath?: string | null
  ): Promise<AgentWorkspaceDirectoryRecord> {
    const pathname = `/agents/${encodeURIComponent(agentId)}/workspace`;
    const search = new URLSearchParams();
    if (searchPath) {
      search.set("path", searchPath);
    }

    return this.request<AgentWorkspaceDirectoryRecord>(
      search.size > 0 ? `${pathname}?${search.toString()}` : pathname
    );
  }

  searchAgentWorkspace(
    agentId: string,
    query: string,
    searchPath?: string | null
  ): Promise<AgentWorkspaceSearchRecord> {
    const search = new URLSearchParams();
    search.set("query", query);
    if (searchPath) {
      search.set("path", searchPath);
    }

    return this.request<AgentWorkspaceSearchRecord>(
      `/agents/${encodeURIComponent(agentId)}/workspace/search?${search.toString()}`
    );
  }

  async deleteAgentWorkspacePath(
    agentId: string,
    searchPath: string
  ): Promise<AgentWorkspaceDeleteResult> {
    const search = new URLSearchParams();
    search.set("path", searchPath);

    return this.request<AgentWorkspaceDeleteResult>(
      `/agents/${encodeURIComponent(agentId)}/workspace?${search.toString()}`,
      {
        method: "DELETE",
      }
    );
  }

  getAgentWorkspaceFilePreview(
    agentId: string,
    searchPath: string
  ): Promise<AgentWorkspaceFilePreviewRecord> {
    const search = new URLSearchParams();
    search.set("path", searchPath);

    return this.request<AgentWorkspaceFilePreviewRecord>(
      `/agents/${encodeURIComponent(agentId)}/workspace/file?${search.toString()}`
    );
  }

  async uploadAgentWorkspaceFile(
    agentId: string,
    file: File
  ): Promise<AgentWorkspaceFilePreviewRecord> {
    const contentBase64 = await fileToBase64(file);

    return this.request<AgentWorkspaceFilePreviewRecord>(
      `/agents/${encodeURIComponent(agentId)}/workspace/file`,
      {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || null,
          contentBase64,
        }),
      }
    );
  }

  openNativeFile(pathname: string): Promise<NativeFileOpenRecord> {
    return this.request<NativeFileOpenRecord>(pathname, {
      method: "POST",
    });
  }

  agentWorkspaceFileDownloadUrl(agentId: string, searchPath: string): string {
    const search = new URLSearchParams();
    search.set("path", searchPath);

    return this.resolveApiPath(
      `/agents/${encodeURIComponent(agentId)}/workspace/file/content?${search.toString()}`
    );
  }

  agentWorkspaceFilePreviewUrl(agentId: string, searchPath: string): string {
    const search = new URLSearchParams();
    search.set("path", searchPath);

    return this.resolveApiPath(
      `/agents/${encodeURIComponent(agentId)}/workspace/file/preview?${search.toString()}`
    );
  }

  agentWorkspaceFileNativeOpenPath(agentId: string, searchPath: string): string {
    const search = new URLSearchParams();
    search.set("path", searchPath);

    return `/agents/${encodeURIComponent(agentId)}/workspace/file/open-native?${search.toString()}`;
  }

  agentWorkspaceFolderNativeOpenPath(
    agentId: string,
    searchPath?: string | null
  ): string {
    const pathname = `/agents/${encodeURIComponent(agentId)}/workspace/open-native`;
    const search = new URLSearchParams();
    if (searchPath) {
      search.set("path", searchPath);
    }

    return search.size > 0 ? `${pathname}?${search.toString()}` : pathname;
  }

  resolveApiPath(pathname: string): string {
    if (/^https?:\/\//.test(pathname)) {
      return pathname;
    }

    const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return `${this.baseUrl}${normalizedPath}`;
  }
}
