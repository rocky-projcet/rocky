export type RuntimeKind = "codex-cli" | "claude-code" | "ollama";
export type ProviderKind = "codex" | "claude" | "ollama";
export type RuntimeReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type RuntimeServiceTier = "fast";
export type RuntimeOllamaLaunchTarget = "codex" | "claude";
export type MessengerProviderKind = "kakao" | "telegram" | "slack" | "discord";
export type MessengerProviderAvailability = "available" | "planned";

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  color: string | null;
  workspaceRoot: string;
  runtimeHome: string;
  defaultRuntime: RuntimeKind;
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
  defaultRuntime?: RuntimeKind;
}

export interface AgentUpdateInput {
  name?: string;
  description?: string | null;
  lifecycle?: "active" | "archived";
  stopRunningSessions?: boolean;
  color?: string | null;
  defaultRuntime?: RuntimeKind;
}

export type AuthProfileLifecycle = "active" | "archived";
export type AuthProfileLoginStatus =
  | "idle"
  | "pending"
  | "authenticated"
  | "failed";
export type AuthProfileLoginMethod = "device-auth" | "api-key" | null;

export interface AuthProfileLoginState {
  status: AuthProfileLoginStatus;
  defaultMethod: "device-auth";
  lastMethod: AuthProfileLoginMethod;
  startedAt: string | null;
  completedAt: string | null;
  verificationUri: string | null;
  userCode: string | null;
  instructions: string | null;
  lastError: string | null;
}

export interface AuthProfileRecord {
  id: string;
  name: string;
  accountLabel: string | null;
  lifecycle: AuthProfileLifecycle;
  archivedAt: string | null;
  homePath: string;
  codexHomePath: string;
  authConfigPath: string;
  runtimeConfigPath: string;
  login: AuthProfileLoginState;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  lastVerifiedAt: string | null;
}

export interface AuthProfileCreateInput {
  name: string;
  id?: string | null;
  accountLabel?: string | null;
}

export interface AuthProfileUpdateInput {
  name?: string;
  accountLabel?: string | null;
  lifecycle?: AuthProfileLifecycle;
}

export interface MessengerProviderDescriptorRecord {
  provider: MessengerProviderKind;
  label: string;
  subtitle: string;
  availability: MessengerProviderAvailability;
  docsUrl: string | null;
}

export interface TelegramMessengerConnectionRecord {
  agentId: string;
  provider: "telegram";
  enabled: boolean;
  botToken: string | null;
  botUsername: string | null;
  botUserId: string | null;
  publicBaseUrl: string | null;
  defaultAckText: string | null;
  createdAt: string;
  updatedAt: string;
  lastReceivedAt: string | null;
  lastDeliveredAt: string | null;
  lastSyncAt: string | null;
  lastPolledAt: string | null;
  lastConsumedUpdateId: number | null;
  lastSessionId: string | null;
  lastRunId: string | null;
  lastError: string | null;
}

export type MessengerConnectionRecord = TelegramMessengerConnectionRecord;

export interface AgentMessengerSlotRecord {
  provider: MessengerProviderKind;
  descriptor: MessengerProviderDescriptorRecord;
  connection: MessengerConnectionRecord | null;
}

export interface AgentMessengerSlotsResponse {
  slots: AgentMessengerSlotRecord[];
  updatedAt: string;
}

export interface TelegramMessengerConnectionInput {
  enabled?: boolean;
  botToken?: string | null;
  publicBaseUrl?: string | null;
  defaultAckText?: string | null;
}

export type ProviderAccountStatus =
  | "authenticated"
  | "logged-out"
  | "pending"
  | "error"
  | "unavailable";

export type CliInstallStatus = "installed" | "not-installed" | "error";
export type CliInstallMethod = "homebrew-cask" | "npm-global" | "unknown";
export type CliLatestStatus = "current" | "update-available" | "unknown" | "error";

export interface CodexDeviceAuthRecord {
  status: "idle" | "pending" | "completed" | "failed";
  mode: "browser-login" | "device-auth" | "api-token" | null;
  startedAt: string | null;
  completedAt: string | null;
  output: string[];
  verificationUri: string | null;
  userCode: string | null;
  instructions: string | null;
  lastError: string | null;
}

export interface ClaudeBrowserAuthRecord {
  status: "idle" | "pending" | "completed" | "failed";
  mode: "claudeai" | "console" | null;
  startedAt: string | null;
  completedAt: string | null;
  verificationUri: string | null;
  instructions: string | null;
  lastError: string | null;
}

export interface ProviderAccountInfoRecord {
  label: string | null;
  email: string | null;
  name: string | null;
  userId: string | null;
  planType: string | null;
  organizationTitle: string | null;
  authMode: string | null;
}

export interface ProviderLoginMethodRecord {
  id: string;
  label: string;
  description: string;
  kind: "primary" | "advanced";
  hiddenByDefault: boolean;
  supported: boolean;
}

export interface CliVersionDiagnosticsRecord {
  command: string;
  resolvedPath: string | null;
  installStatus: CliInstallStatus;
  installMethod: CliInstallMethod;
  currentVersion: string | null;
  rawVersionText: string | null;
  checkedAt: string;
  latestVersion: string | null;
  latestStatus: CliLatestStatus;
  latestCheckedAt: string | null;
  latestSource: string | null;
  statusText: string;
}

export interface CliUpdateRecord {
  status: "idle" | "pending" | "completed" | "failed";
  supported: boolean;
  installMethod: CliInstallMethod;
  commandPreview: string | null;
  startedAt: string | null;
  completedAt: string | null;
  output: string[];
  lastError: string | null;
}

export interface ProviderAccountRecord {
  provider: ProviderKind;
  providerLabel: string;
  status: ProviderAccountStatus;
  statusText: string;
  homePath: string | null;
  updatedAt: string;
  accountInfo: ProviderAccountInfoRecord;
  loginMethods: ProviderLoginMethodRecord[];
  primaryLoginMethodId: string | null;
  diagnostics: CliVersionDiagnosticsRecord;
  update: CliUpdateRecord;
}

export interface CodexAccountRecord extends ProviderAccountRecord {
  provider: "codex";
  providerLabel: "Codex CLI";
  codexBin: string;
  deviceAuth: CodexDeviceAuthRecord;
}

export interface ClaudeAccountRecord extends ProviderAccountRecord {
  provider: "claude";
  providerLabel: "Claude Code";
  claudeBin: string;
  apiProvider: string | null;
  browserAuth: ClaudeBrowserAuthRecord;
}

export interface TaskRequestTitleSummaryRecord {
  title: string;
  model: string;
}

export type ProviderStatusDataState = "ok" | "stale" | "unavailable" | "error";

export interface ProviderStatusAccountSummaryRecord {
  status: ProviderAccountStatus;
  statusText: string;
  label: string | null;
  authMode: string | null;
  planType: string | null;
}

export interface ProviderStatusUsageWindowRecord {
  status: ProviderStatusDataState;
  windowMinutes: number;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetAt: string | null;
}

export interface ProviderUsageSummaryRecord {
  source: "rate-limits" | "stats-cache" | "session-log" | "none";
  totalTokens: number | null;
  totalCostUsd: number | null;
  totalMessages: number | null;
  totalSessions: number | null;
  primaryModel: string | null;
  refreshedAt: string | null;
}

export interface ProviderStatusRecord {
  provider: ProviderKind;
  account: ProviderStatusAccountSummaryRecord;
  diagnostics: CliVersionDiagnosticsRecord;
  model: string | null;
  reasoningEffort: string | null;
  fiveHour: ProviderStatusUsageWindowRecord;
  weekly: ProviderStatusUsageWindowRecord;
  usageSummary: ProviderUsageSummaryRecord | null;
  refreshedAt: string | null;
  status: ProviderStatusDataState;
  statusText: string;
}

export interface CodexStatusRecord extends Omit<ProviderStatusRecord, "provider"> {
  provider: "codex";
}

export interface ClaudeStatusRecord extends Omit<ProviderStatusRecord, "provider"> {
  provider: "claude";
}

export interface ProviderAccountsResponse {
  providers: Array<CodexAccountRecord | ClaudeAccountRecord>;
  updatedAt: string;
}

export interface ProviderStatusesResponse {
  providers: Array<CodexStatusRecord | ClaudeStatusRecord>;
  updatedAt: string;
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

export interface RuntimeModelOption {
  id: string;
  label: string;
  provider: ProviderKind;
  supportedReasoningEfforts: RuntimeReasoningEffort[];
  defaultReasoningEffort: RuntimeReasoningEffort | null;
  supportedServiceTiers: RuntimeServiceTier[];
  defaultServiceTier: RuntimeServiceTier | null;
}

export interface RuntimeDescriptorRecord {
  kind: RuntimeKind;
  label: string;
  provider: ProviderKind;
  defaultModel: string | null;
  modelOptions: RuntimeModelOption[];
}

export interface AgentSessionRecord {
  id: string;
  agentId: string;
  kind: "task-request" | "single-task";
  runtimeKind: RuntimeKind;
  runtimeSessionId: string | null;
  authProfileId: string | null;
  title: string | null;
  status: string;
  lifecycle: "active" | "archived";
  archivedAt: string | null;
  workspaceRoot: string;
  runtimeHome: string;
  runtimeConfig: {
    authProfileId: string | null;
    model: string | null;
    ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
    reasoningEffort: string | null;
    serviceTier: string | null;
  };
  createdAt: string;
  lastActivityAt: string;
}

export interface AgentSessionCreateInput {
  title?: string | null;
  runtimeKind?: RuntimeKind;
  ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
  authProfileId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
}

export interface AgentSessionUpdateInput {
  title?: string | null;
  lifecycle?: "active" | "archived";
  authProfileId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
}

export interface AgentTaskScheduleRecord {
  enabled: boolean;
  intervalMinutes: number | null;
  nextRunAt: string | null;
  lastTriggeredAt: string | null;
}

export interface AgentTaskEventTriggerRecord {
  enabled: boolean;
  webhookToken: string;
  lastTriggeredAt: string | null;
}

export interface AgentTaskMessengerDeliveryRecord {
  enabled: boolean;
  chatId: string | null;
  threadId: string | null;
  lastDeliveredAt: string | null;
  lastError: string | null;
}

export interface AgentTaskRecord {
  id: string;
  agentId: string;
  name: string;
  description: string;
  prompt: string;
  runtimeKind: RuntimeKind;
  ollamaLaunchTarget: RuntimeOllamaLaunchTarget | null;
  model: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null;
  enabled: boolean;
  lifecycle: "active" | "archived";
  archivedAt: string | null;
  sourceSessionId: string | null;
  schedule: AgentTaskScheduleRecord;
  eventTrigger: AgentTaskEventTriggerRecord;
  messengerDelivery: AgentTaskMessengerDeliveryRecord;
  lastRunId: string | null;
  lastSessionId: string | null;
  lastRunStatus: string | null;
  lastRunSummary: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTaskCreateInput {
  id?: string | null;
  name: string;
  description?: string | null;
  prompt: string;
  runtimeKind?: RuntimeKind;
  ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
  model?: string | null;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  enabled?: boolean;
  sourceSessionId?: string | null;
  schedule?: {
    enabled?: boolean;
    intervalMinutes?: number | null;
  } | null;
  eventTrigger?: {
    enabled?: boolean;
  } | null;
  messengerDelivery?: {
    enabled?: boolean;
    chatId?: string | null;
    threadId?: string | null;
  } | null;
}

export interface AgentTaskUpdateInput {
  name?: string;
  description?: string | null;
  prompt?: string;
  runtimeKind?: RuntimeKind;
  ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
  model?: string | null;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  enabled?: boolean;
  lifecycle?: "active" | "archived";
  schedule?: {
    enabled?: boolean;
    intervalMinutes?: number | null;
  } | null;
  eventTrigger?: {
    enabled?: boolean;
    regenerateWebhookToken?: boolean;
  } | null;
  messengerDelivery?: {
    enabled?: boolean;
    chatId?: string | null;
    threadId?: string | null;
  } | null;
}

export interface AgentTaskRunRecord {
  id: string;
  taskId: string;
  agentId: string;
  sessionId: string;
  runId: string;
  triggerType: string;
  triggerSource: string | null;
  status: string;
  runtimeKind: RuntimeKind;
  ollamaLaunchTarget: RuntimeOllamaLaunchTarget | null;
  model: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null;
  prompt: string;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
  messengerDeliveredAt: string | null;
  messengerDeliveryError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RockyChatDomain = "nutrition-md" | "general";

export interface RockyAttachmentInput {
  name: string;
  contentType?: string | null;
  size?: number | null;
}

export interface RockyAttachmentRecord {
  id: string;
  name: string;
  contentType: string | null;
  size: number | null;
  addedAt: string;
}

export interface RockySkillCandidateRecord {
  id: string;
  title: string;
  description: string;
  trigger: string;
  confidence: number;
  sourceMessageId: string;
  status: "candidate";
  createdAt: string;
}

export interface RockyWorkerRecord {
  id: string;
  domain: RockyChatDomain;
  displayName: string;
  agentId: string | null;
  reason: string;
  status: "ready";
  createdAt: string;
  updatedAt: string;
}

export interface RockyDispatchRecord {
  id: string;
  chatId: string;
  messageId: string;
  domain: RockyChatDomain;
  workerId: string;
  attachmentIds: string[];
  originalRequest: string;
  skillCandidateIds: string[];
  protectionHints: string[];
  executionStarted: false;
  createdAt: string;
}

export interface RockyMessageRecord {
  id: string;
  chatId: string;
  role: "user" | "rocky";
  text: string;
  attachmentIds: string[];
  domain: RockyChatDomain;
  workerId: string | null;
  skillCandidateIds: string[];
  dispatchId: string | null;
  createdAt: string;
}

export interface RockyChatRecord {
  id: string;
  title: string;
  domain: RockyChatDomain;
  worker: RockyWorkerRecord | null;
  attachments: RockyAttachmentRecord[];
  messages: RockyMessageRecord[];
  skillCandidates: RockySkillCandidateRecord[];
  dispatches: RockyDispatchRecord[];
  executionStarted: false;
  createdAt: string;
  updatedAt: string;
}

export interface RockyChatCreateInput {
  message: string;
  attachments?: RockyAttachmentInput[];
}

export interface AgentSessionDeleteOptions {
  stopRunningRuns?: boolean;
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
  workspaceRelativePath?: string | null;
  contentType: string;
  presentation: "file" | "image" | "chart";
  size: number | null;
  previewable: boolean;
  previewUrl: string | null;
  downloadUrl: string;
  preferredAction: "preview" | "download";
}

export interface AgentRunRecord {
  id: string;
  agentId: string;
  sessionId: string;
  runtimeRunId: string | null;
  triggerType: string;
  status: string;
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

export interface RuntimeEvent {
  source: string;
  type: string;
  runId: string | null;
  sessionId: string | null;
  runtimeSessionId: string | null;
  rawType: string;
  occurredAt: string;
  data: Record<string, unknown>;
  raw: unknown;
}

export interface RuntimeRunResult {
  runId: string;
  sessionId: string;
  runtimeSessionId: string | null;
  sessionBinding: {
    runtimeSessionId: string;
    boundAt: string;
    source: string;
  } | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  messages: Array<{
    role: string;
    text: string;
    itemType: string | null;
    occurredAt: string;
    source: string;
  }>;
  warnings: Array<Record<string, unknown>>;
  errors: string[];
  stderr: string[];
  artifactRefs: Array<{
    kind: string;
    role: string;
    path: string;
  }>;
  lastMessage: string | null;
  outputLastMessagePath: string | null;
  rawEvents: unknown[];
}

export interface RunArtifactRecord {
  kind: string;
  role: string;
  name: string;
  workspaceRelativePath?: string | null;
  contentType: string;
  presentation: "file" | "image" | "chart";
  size: number | null;
  previewable: boolean;
  previewUrl: string | null;
  downloadUrl: string;
  preferredAction: "preview" | "download";
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

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function fileToBase64(file: File): Promise<string> {
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

  listAuthProfiles(
    options: {
      includeArchived?: boolean;
    } = {}
  ): Promise<AuthProfileRecord[]> {
    const search = new URLSearchParams();
    if (options.includeArchived) {
      search.set("includeArchived", "true");
    }

    return this.request<AuthProfileRecord[]>(
      search.size > 0 ? `/auth-profiles?${search.toString()}` : "/auth-profiles"
    );
  }

  createAuthProfile(input: AuthProfileCreateInput): Promise<AuthProfileRecord> {
    return this.request<AuthProfileRecord>("/auth-profiles", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        id: input.id ?? undefined,
        accountLabel: input.accountLabel ?? null,
      }),
    });
  }

  getAuthProfile(authProfileId: string): Promise<AuthProfileRecord> {
    return this.request<AuthProfileRecord>(
      `/auth-profiles/${encodeURIComponent(authProfileId)}`
    );
  }

  updateAuthProfile(
    authProfileId: string,
    input: AuthProfileUpdateInput
  ): Promise<AuthProfileRecord> {
    return this.request<AuthProfileRecord>(
      `/auth-profiles/${encodeURIComponent(authProfileId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      }
    );
  }

  async deleteAuthProfile(authProfileId: string): Promise<void> {
    await this.request<Record<string, never> | null>(
      `/auth-profiles/${encodeURIComponent(authProfileId)}`,
      {
        method: "DELETE",
      }
    );
  }

  getCodexAccount(signal?: AbortSignal): Promise<CodexAccountRecord> {
    return this.request<CodexAccountRecord>("/account", {
      signal,
    });
  }

  getProviderAccounts(signal?: AbortSignal): Promise<ProviderAccountsResponse> {
    return this.request<ProviderAccountsResponse>("/account/providers", {
      signal,
    });
  }

  getProviderStatuses(signal?: AbortSignal): Promise<ProviderStatusesResponse> {
    return this.request<ProviderStatusesResponse>("/account/providers/status", {
      signal,
    });
  }

  getHardwareStatus(signal?: AbortSignal): Promise<HardwareStatusRecord> {
    return this.request<HardwareStatusRecord>("/settings/hardware", {
      signal,
    });
  }

  getCodexStatus(signal?: AbortSignal): Promise<CodexStatusRecord> {
    return this.request<CodexStatusRecord>("/codex-status", {
      signal,
    });
  }

  getClaudeAccount(signal?: AbortSignal): Promise<ClaudeAccountRecord> {
    return this.request<ClaudeAccountRecord>("/claude/account", {
      signal,
    });
  }

  getClaudeStatus(signal?: AbortSignal): Promise<ClaudeStatusRecord> {
    return this.request<ClaudeStatusRecord>("/claude-status", {
      signal,
    });
  }

  startCodexLogin(): Promise<CodexAccountRecord> {
    return this.request<CodexAccountRecord>("/account/login", {
      method: "POST",
    });
  }

  startCodexDeviceAuth(): Promise<CodexAccountRecord> {
    return this.request<CodexAccountRecord>("/account/login/device", {
      method: "POST",
    });
  }

  loginCodexWithApiKey(apiKey: string): Promise<CodexAccountRecord> {
    return this.request<CodexAccountRecord>("/account/login/api-key", {
      method: "POST",
      body: JSON.stringify({
        apiKey,
      }),
    });
  }

  logoutCodexAccount(): Promise<CodexAccountRecord> {
    return this.request<CodexAccountRecord>("/account/logout", {
      method: "POST",
    });
  }

  startCodexUpdate(): Promise<CodexAccountRecord> {
    return this.request<CodexAccountRecord>("/account/update", {
      method: "POST",
    });
  }

  startClaudeLogin(
    mode: "claudeai" | "console" = "claudeai"
  ): Promise<ClaudeAccountRecord> {
    return this.request<ClaudeAccountRecord>(
      mode === "console" ? "/claude/account/login/console" : "/claude/account/login",
      {
        method: "POST",
      }
    );
  }

  logoutClaudeAccount(): Promise<ClaudeAccountRecord> {
    return this.request<ClaudeAccountRecord>("/claude/account/logout", {
      method: "POST",
    });
  }

  startClaudeUpdate(): Promise<ClaudeAccountRecord> {
    return this.request<ClaudeAccountRecord>("/claude/account/update", {
      method: "POST",
    });
  }

  summarizeTaskRequestTitle(
    prompt: string
  ): Promise<TaskRequestTitleSummaryRecord> {
    return this.request<TaskRequestTitleSummaryRecord>(
      "/account/task-request-title",
      {
        method: "POST",
        body: JSON.stringify({
          prompt,
        }),
      }
    );
  }

  createAgent(input: AgentCreateInput): Promise<AgentRecord> {
    return this.request<AgentRecord>("/agents", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        id: input.id ?? undefined,
        description: input.description ?? undefined,
        defaultRuntime: input.defaultRuntime ?? undefined,
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

  async deleteAgent(
    agentId: string,
    options: {
      stopRunningSessions?: boolean;
    } = {}
  ): Promise<void> {
    const search = new URLSearchParams();
    if (options.stopRunningSessions) {
      search.set("stopRunningSessions", "true");
    }

    await this.request<Record<string, never> | null>(
      search.size > 0
        ? `/agents/${encodeURIComponent(agentId)}?${search.toString()}`
        : `/agents/${encodeURIComponent(agentId)}`,
      {
        method: "DELETE",
      }
    );
  }

  listAgentSessions(
    agentId: string,
    options: {
      includeArchived?: boolean;
      kinds?: Array<"task-request" | "single-task">;
    } = {}
  ): Promise<AgentSessionRecord[]> {
    const pathname = `/agents/${encodeURIComponent(agentId)}/sessions`;
    const search = new URLSearchParams();
    if (options.includeArchived) {
      search.set("includeArchived", "true");
    }
    if (options.kinds && options.kinds.length > 0) {
      search.set("kinds", options.kinds.join(","));
    }

    return this.request<AgentSessionRecord[]>(
      search.size > 0 ? `${pathname}?${search.toString()}` : pathname
    );
  }

  listAgentTasks(
    agentId: string,
    options: {
      includeArchived?: boolean;
    } = {}
  ): Promise<AgentTaskRecord[]> {
    const pathname = `/agents/${encodeURIComponent(agentId)}/tasks`;
    const search = new URLSearchParams();
    if (options.includeArchived) {
      search.set("includeArchived", "true");
    }

    return this.request<AgentTaskRecord[]>(
      search.size > 0 ? `${pathname}?${search.toString()}` : pathname
    );
  }

  createTask(
    agentId: string,
    input: AgentTaskCreateInput
  ): Promise<AgentTaskRecord> {
    return this.request<AgentTaskRecord>(
      `/agents/${encodeURIComponent(agentId)}/tasks`,
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );
  }

  getTask(taskId: string): Promise<AgentTaskRecord> {
    return this.request<AgentTaskRecord>(`/tasks/${encodeURIComponent(taskId)}`);
  }

  updateTask(taskId: string, input: AgentTaskUpdateInput): Promise<AgentTaskRecord> {
    return this.request<AgentTaskRecord>(`/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.request<Record<string, never> | null>(
      `/tasks/${encodeURIComponent(taskId)}`,
      {
        method: "DELETE",
      }
    );
  }

  listTaskRuns(taskId: string): Promise<AgentTaskRunRecord[]> {
    return this.request<AgentTaskRunRecord[]>(
      `/tasks/${encodeURIComponent(taskId)}/runs`
    );
  }

  runTask(taskId: string): Promise<AgentTaskRunRecord> {
    return this.request<AgentTaskRunRecord>(
      `/tasks/${encodeURIComponent(taskId)}/run`,
      {
        method: "POST",
      }
    );
  }

  listRockyChats(): Promise<RockyChatRecord[]> {
    return this.request<RockyChatRecord[]>("/rocky/chats");
  }

  createRockyChat(input: RockyChatCreateInput): Promise<RockyChatRecord> {
    return this.request<RockyChatRecord>("/rocky/chats", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getRockyChat(chatId: string): Promise<RockyChatRecord> {
    return this.request<RockyChatRecord>(
      `/rocky/chats/${encodeURIComponent(chatId)}`
    );
  }

  sendRockyChatMessage(
    chatId: string,
    input: RockyChatCreateInput
  ): Promise<RockyChatRecord> {
    return this.request<RockyChatRecord>(
      `/rocky/chats/${encodeURIComponent(chatId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );
  }

  listAgentMessengerConnections(
    agentId: string
  ): Promise<AgentMessengerSlotsResponse> {
    return this.request<AgentMessengerSlotsResponse>(
      `/agents/${encodeURIComponent(agentId)}/messenger-connections`
    );
  }

  updateTelegramMessengerConnection(
    agentId: string,
    input: TelegramMessengerConnectionInput
  ): Promise<TelegramMessengerConnectionRecord> {
    return this.request<TelegramMessengerConnectionRecord>(
      `/agents/${encodeURIComponent(agentId)}/messenger-connections/telegram`,
      {
        method: "PUT",
        body: JSON.stringify(input),
      }
    );
  }

  async deleteAgentMessengerConnection(
    agentId: string,
    provider: MessengerProviderKind
  ): Promise<void> {
    await this.request<Record<string, never> | null>(
      `/agents/${encodeURIComponent(agentId)}/messenger-connections/${encodeURIComponent(provider)}`,
      {
        method: "DELETE",
      }
    );
  }

  createSession(
    agentId: string,
    input: AgentSessionCreateInput = {}
  ): Promise<AgentSessionRecord> {
    return this.request<AgentSessionRecord>(
      `/agents/${encodeURIComponent(agentId)}/sessions`,
      {
        method: "POST",
        body: JSON.stringify({
          title: input.title ?? null,
          runtimeKind: input.runtimeKind ?? undefined,
          ollamaLaunchTarget: input.ollamaLaunchTarget ?? null,
          authProfileId: input.authProfileId ?? null,
          model: input.model ?? null,
          reasoningEffort: input.reasoningEffort ?? null,
          serviceTier: input.serviceTier ?? null,
        }),
      }
    );
  }

  listRuntimes(signal?: AbortSignal): Promise<RuntimeDescriptorRecord[]> {
    return this.request<RuntimeDescriptorRecord[]>("/runtimes", {
      signal,
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

  getSession(sessionId: string): Promise<AgentSessionRecord> {
    return this.request<AgentSessionRecord>(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  updateSession(
    sessionId: string,
    input: AgentSessionUpdateInput
  ): Promise<AgentSessionRecord> {
    return this.request<AgentSessionRecord>(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  async deleteSession(
    sessionId: string,
    options: AgentSessionDeleteOptions = {}
  ): Promise<void> {
    const search = new URLSearchParams();
    if (options.stopRunningRuns) {
      search.set("stopRunningRuns", "true");
    }

    await this.request<Record<string, never> | null>(
      search.size > 0
        ? `/sessions/${encodeURIComponent(sessionId)}?${search.toString()}`
        : `/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
      }
    );
  }

  getTranscript(sessionId: string): Promise<AgentSessionMessage[]> {
    return this.request<AgentSessionMessage[]>(
      `/sessions/${encodeURIComponent(sessionId)}/transcript`
    );
  }

  sendMessage(
    sessionId: string,
    prompt: string,
    options: {
      images?: string[];
      runtimeKind?: RuntimeKind;
      ollamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
      model?: string | null;
      reasoningEffort?: string | null;
      serviceTier?: string | null;
      reuseMessageId?: string;
    } = {}
  ): Promise<AgentRunRecord> {
    return this.request<AgentRunRecord>(`/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: JSON.stringify({
        prompt,
        images: options.images ?? undefined,
        runtimeKind: options.runtimeKind,
        ollamaLaunchTarget: options.ollamaLaunchTarget,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        serviceTier: options.serviceTier,
        reuseMessageId: options.reuseMessageId,
      }),
    });
  }

  getRun(runId: string): Promise<AgentRunRecord> {
    return this.request<AgentRunRecord>(`/runs/${encodeURIComponent(runId)}`);
  }

  getRunResult(runId: string): Promise<RuntimeRunResult> {
    return this.request<RuntimeRunResult>(`/runs/${encodeURIComponent(runId)}/result`);
  }

  async getRunEvents(runId: string): Promise<RuntimeEvent[]> {
    const response = await fetch(this.runEventsUrl(runId), {
      headers: {
        Accept: "text/event-stream",
      },
    });

    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const body = (await response.json()) as { error?: string };
        if (typeof body.error === "string") {
          detail = body.error;
        }
      } catch {
        // Keep transport detail for SSE failures.
      }
      throw new Error(detail);
    }

    const payload = await response.text();
    return parseRuntimeEventsFromSse(payload);
  }

  listRunArtifacts(runId: string): Promise<RunArtifactRecord[]> {
    return this.request<RunArtifactRecord[]>(`/runs/${encodeURIComponent(runId)}/artifacts`);
  }

  cancelRun(runId: string): Promise<RuntimeRunResult> {
    return this.request<RuntimeRunResult>(`/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
    });
  }

  runEventsUrl(runId: string): string {
    return this.resolveApiPath(`/runs/${encodeURIComponent(runId)}/events`);
  }

  runArtifactUrl(runId: string, artifactRole: string): string {
    return this.resolveApiPath(
      `/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactRole)}`
    );
  }

  runArtifactPreviewUrl(runId: string, artifactRole: string): string {
    return `${this.runArtifactUrl(runId, artifactRole)}/preview`;
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

  resolveApiPath(pathname: string): string {
    if (/^https?:\/\//.test(pathname)) {
      return pathname;
    }

    const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return `${this.baseUrl}${normalizedPath}`;
  }
}

function parseRuntimeEventsFromSse(payload: string): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  const chunks = payload.split("\n\n");

  for (const chunk of chunks) {
    if (!chunk.trim()) {
      continue;
    }

    const dataLines = chunk
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) {
      continue;
    }

    const data = dataLines.join("\n");
    try {
      events.push(JSON.parse(data) as RuntimeEvent);
    } catch {
      // Ignore malformed event frames and keep the rest.
    }
  }

  return events;
}
