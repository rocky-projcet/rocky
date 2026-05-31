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
  soul: string | null;
  color: string | null;
  workspaceRoot: string;
  runtimeHome: string;
  defaultRuntime: RuntimeKind;
  sandboxPolicy: string;
  approvalPolicy: string;
  modelProfile: string | null;
  skillPolicy: {
    automaticSkillCreation: boolean;
  };
  status: string;
  lifecycle: "active" | "archived";
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

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

export type SkillTemplateCategory = "document" | "content" | "data";

export interface SkillTemplateInputArtifactRecord {
  id: string;
  runId: string;
  fieldId: string;
  fileName: string;
  contentType: string | null;
  size: number | null;
  runtimePath: string;
  skillPath?: string | null;
  uploadedAt: string;
}

export interface SavedSkillTemplateRecord {
  id: string;
  source: "builtin" | "user";
  category: SkillTemplateCategory;
  title: string;
  description: string;
  triggerLabel: string;
  requiredInputs: string[];
  inputFiles?: string[];
  inputArtifacts?: SkillTemplateInputArtifactRecord[];
  sourceRunId?: string | null;
  outputFormatLabel: string;
  outputFiles?: string[];
  defaultInstructions: string;
  skill: {
    id: string;
    displayName: string;
    description: string;
    invocation: string;
    skillMarkdown: string;
    openAiYaml: string;
    syncStatus: "local" | "syncing" | "synced" | "failed";
    workspacePath: string | null;
    lastSyncedAt?: string;
    lastSyncError?: string;
  };
  sortOrder: number;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
  externalSkill?: {
    sourceKind: ExternalSkillSourceKind;
    sourceUrl: string | null;
    packageHash: string;
    previewId?: string;
    mountedAt: string;
  };
}

export type ExternalSkillSourceKind = "mcp-market" | "github" | "upload";

export interface ExternalSkillPackageFileInput {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
}

export interface ExternalSkillPreviewCheck {
  id: string;
  status: "passed" | "warning" | "failed";
  message: string;
}

export interface ExternalSkillPreviewCapability {
  id: string;
  provider: string;
  action: string;
  scriptPath: string;
  requiresConnectedAccount: boolean;
  credentialGateStatus: "not-required" | "allowed" | "blocked";
  reasons: string[];
}

export interface ExternalSkillPreviewRecord {
  id: string;
  sourceKind: ExternalSkillSourceKind;
  sourceUrl: string | null;
  packageHash: string;
  installable: boolean;
  skillId: string;
  title: string;
  description: string | null;
  fileCount: number;
  checks: ExternalSkillPreviewCheck[];
  capabilities: ExternalSkillPreviewCapability[];
  createdAt: string;
}

export interface ExternalSkillMountResult {
  preview: ExternalSkillPreviewRecord;
  skill: SavedSkillTemplateRecord;
}

export interface SkillTemplateRunRecord {
  id: string;
  templateKind: string | null;
  status: "draft" | "completed";
  createdAt: string;
  updatedAt: string;
}

export interface EcountConnectionTestInput {
  accountLabel?: string | null;
  comCode: string;
  userId: string;
  apiCertKey: string;
  zone?: string | null;
  lanType?: string | null;
}

export interface EcountConnectionTestRecord {
  ok: boolean;
  status: "connected" | "failed";
  accountLabel: string | null;
  comCode: string;
  userId: string;
  zone: string | null;
  checkedAt: string;
  message: string;
  diagnostics?: {
    stage: "zone" | "login";
    detail: string;
  };
}

export interface EcountConnectionSettingsRecord {
  configured: boolean;
  accountLabel: string | null;
  comCodeMasked: string | null;
  userIdMasked: string | null;
  apiCertKeyMasked: string | null;
  zone: string | null;
  checkedAt: string | null;
  updatedAt: string | null;
}

export interface IntegrationCapabilityRecord {
  provider: string;
  dataset: string;
  label: string;
  status: "supported" | "unsupported";
  access: "read";
  api: string | null;
  filters: string[];
  reason: string | null;
}

export interface IntegrationCapabilitiesRecord {
  provider: string;
  capabilities: IntegrationCapabilityRecord[];
}

export interface IntegrationQueryInput {
  dataset?: string;
  datasets?: string[];
  limit?: number | null;
  offset?: number | null;
  filters?: Record<string, unknown> | null;
}

export interface IntegrationQueryResultRecord {
  ok: boolean;
  provider: string;
  dataset: string;
  title: string;
  status: "ready" | "failed" | "unsupported";
  accountLabel: string | null;
  zone: string | null;
  checkedAt: string;
  api: string | null;
  count: number;
  returnedCount: number;
  records: Array<Record<string, unknown>>;
  message: string;
  diagnostics?: {
    stage: string;
    detail: string;
  };
}

export interface IntegrationQueryBatchResultRecord {
  provider: string;
  status: "ready" | "partial";
  checkedAt: string;
  results: IntegrationQueryResultRecord[];
}

export interface AgentCreateInput {
  name: string;
  id?: string | null;
  description?: string | null;
  soul?: string | null;
  defaultRuntime?: RuntimeKind;
  skillPolicy?: {
    automaticSkillCreation: boolean;
  };
}

export interface AgentUpdateInput {
  name?: string;
  description?: string | null;
  soul?: string | null;
  lifecycle?: "active" | "archived";
  stopRunningSessions?: boolean;
  color?: string | null;
  defaultRuntime?: RuntimeKind;
  skillPolicy?: {
    automaticSkillCreation: boolean;
  };
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

export interface AgentSuggestionInput {
  title: string;
  description: string;
  triggerLabel: string;
}

export interface AgentSuggestionRecord {
  name: string;
  description: string;
  emoji: string | null;
  model: string;
}

export type ConnectorProvider =
  | "threads"
  | "instagram"
  | "x"
  | "facebook"
  | "linkedin"
  | "tiktok"
  | "youtube"
  | "naver-blog"
  | "tistory"
  | "brunch"
  | "kakao-channel"
  | "medium";

export type ConnectorStatus =
  | "idle"
  | "planned"
  | "connecting"
  | "connected"
  | "failed";
export type ConnectorLoginMode =
  | "oauth"
  | "custom-browser"
  | "external-browser"
  | "managed-browser";

export type ConnectorCapabilityAction = "read" | "write";
export type ConnectorCapabilityExecutionOwner =
  | "agent-script"
  | "rocky-server";
export type ConnectorCapabilityStatus =
  | "available"
  | "blocked"
  | "planned"
  | "unsupported";

export type ConnectorSetupMode = "oauth" | "custom-browser" | "graph-api";
export type ConnectorAccountKind =
  | "unknown"
  | "personal"
  | "professional_business"
  | "professional_creator";
export type ConnectorBrowserSessionPurpose =
  | "manual_assist"
  | "readiness_check";

export type ConnectorBlockerCode =
  | "professional_account_required"
  | "facebook_page_required"
  | "meta_business_setup_required"
  | "meta_app_required"
  | "app_access_required"
  | "permission_missing"
  | "app_review_required"
  | "access_token_missing"
  | "token_expired"
  | "instagram_business_account_id_missing"
  | "rocky_capability_not_implemented";

export type ConnectorTokenStatus = "active" | "expired" | "unknown";

export interface ConnectorReadinessBlockerRecord {
  code: ConnectorBlockerCode;
  message: string;
  nextAction: string;
}

export type ConnectorEntitlementGate = "instagram-meta-app-tester";
export type ConnectorEntitlementStatus = "allowed" | "blocked" | "pending";

export interface ConnectorEntitlementRecord {
  gate: ConnectorEntitlementGate;
  status: ConnectorEntitlementStatus;
  reason: string;
  checkedAt: string | null;
  testerRequestStatus?: ConnectorTesterRequestStatus | null;
}

export interface ConnectorReadinessRecord {
  setupMode: ConnectorSetupMode | null;
  accountKind: ConnectorAccountKind | null;
  accountLabel?: string | null;
  instagramUserId?: string | null;
  grantedScopes?: string[];
  tokenStatus?: ConnectorTokenStatus | null;
  checkedAt?: string | null;
  browserSessionPurpose: ConnectorBrowserSessionPurpose | null;
  entitlement?: ConnectorEntitlementRecord | null;
  blockers: ConnectorReadinessBlockerRecord[];
}

export type ConnectorGraphDiscoveryStatus =
  | "not-started"
  | "blocked"
  | "candidate";

export type ConnectorTesterRequestStatus =
  | "pending"
  | "invited"
  | "accepted"
  | "failed"
  | "completed";

export interface ConnectorTesterRequestInput {
  accountIdentifier: string;
  status?: ConnectorTesterRequestStatus;
}

export interface ConnectorStartLoginInput {
  openExternal?: boolean;
}

export interface ConnectorTesterRequestRecord {
  provider: "instagram";
  accountIdentifier: string;
  status: ConnectorTesterRequestStatus;
  requestedAt: string;
  updatedAt: string;
  completedAt: string | null;
  message: string;
}

export interface ConnectorGraphDiscoveryCandidateRecord {
  facebookPageId: string | null;
  facebookPageName: string | null;
  instagramBusinessAccountId: string;
  instagramUsername: string | null;
  instagramAccountLabel: string;
  accountKind: Extract<
    ConnectorAccountKind,
    "professional_business" | "professional_creator"
  >;
  grantedScopes: string[];
  discoveredAt: string;
}

export interface ConnectorGraphDiscoveryRecord {
  status: ConnectorGraphDiscoveryStatus;
  accountCount: number;
  candidate: ConnectorGraphDiscoveryCandidateRecord | null;
  blockers: ConnectorReadinessBlockerRecord[];
  checkedAt: string | null;
}

export interface ConnectorTokenMetadataRecord {
  accessTokenPresent: boolean;
  tokenType: string | null;
  expiresAt: string | null;
  dataAccessExpiresAt: string | null;
  checkedAt: string;
  status: ConnectorTokenStatus;
}

export interface ConnectorGraphConnectionRecord {
  source: "instagram-login-oauth";
  instagramUserId: string;
  username: string | null;
  accountLabel: string;
  accountKind: Extract<
    ConnectorAccountKind,
    "professional_business" | "professional_creator"
  >;
  grantedScopes: string[];
  token: ConnectorTokenMetadataRecord;
  checkedAt: string;
}

export interface ConnectorCapabilityRecord {
  id: string;
  provider: ConnectorProvider;
  label: string;
  description: string;
  action: ConnectorCapabilityAction;
  requiresBrowser: boolean;
  requiresConnectedAccount: boolean;
  requiresApproval: boolean;
  status?: ConnectorCapabilityStatus;
  source?: "backend" | "skill";
  executionOwner?: ConnectorCapabilityExecutionOwner;
  sourceSkillId?: string | null;
  sourceSkillName?: string | null;
  scriptPath?: string | null;
  usage?: string | null;
  setupMode?: ConnectorSetupMode | null;
  setupSteps?: string[];
  requiredEnv?: string[];
  allowedBaseUrls?: string[];
  allowedEndpointPaths?: string[];
  credentialGateStatus?: "not-required" | "allowed" | "blocked";
  credentialGateReasons?: string[];
  blockerCodes?: ConnectorBlockerCode[];
  blockers?: ConnectorReadinessBlockerRecord[];
}

export type ConnectorBrowserAccessStatus =
  | "not-applicable"
  | "needs-login"
  | "granted"
  | "unavailable";

export interface ConnectorBrowserAccessRecord {
  status: ConnectorBrowserAccessStatus;
  policy: "persistent" | "per-run" | null;
  readAllowed: boolean;
  writeAllowedAfterApproval: boolean;
  message: string;
}

export type ConnectorPublishVisibility = "draft" | "private" | "public";

export interface ConnectorPublishDraftInput {
  title: string;
  contentMarkdown: string;
  tags?: string[];
  visibility?: ConnectorPublishVisibility;
}

export interface ConnectorPublishDraftResult {
  ok: boolean;
  provider: ConnectorProvider;
  status: "draft-saved" | "failed";
  accountLabel: string | null;
  url: string | null;
  message: string;
  checkedAt: string;
}

export interface ConnectorProfileRecord {
  id: string | null;
  username: string | null;
  displayName: string | null;
  bio: string | null;
  followersText: string | null;
  url: string | null;
  rawText: string | null;
}

export interface ConnectorReadProfileResult {
  ok: boolean;
  provider: ConnectorProvider;
  status: "profile-read" | "failed";
  accountLabel: string | null;
  profile: ConnectorProfileRecord | null;
  message: string;
  checkedAt: string;
}

export interface ConnectorFollowerRecord {
  username: string | null;
  displayName: string | null;
  profileUrl: string | null;
  rawText: string;
}

export interface ConnectorFollowerListRecord {
  items: ConnectorFollowerRecord[];
  url: string | null;
  rawText: string | null;
}

export interface ConnectorReadFollowerListResult {
  ok: boolean;
  provider: ConnectorProvider;
  status: "followers-read" | "failed";
  accountLabel: string | null;
  followers: ConnectorFollowerListRecord | null;
  message: string;
  checkedAt: string;
}

export interface ConnectorExecuteCapabilityInput {
  capabilityId: string;
  args?: Record<string, unknown>;
}

export type ConnectorExecuteCapabilityStatus =
  | "completed"
  | "failed"
  | "unsupported"
  | "requires-approval";

export type ConnectorExecuteCapabilityResultType =
  | "profile"
  | "followers"
  | "draft"
  | "media-container"
  | "media-publish"
  | "media-status"
  | "none";

export interface ConnectorExecuteCapabilityResult {
  ok: boolean;
  provider: ConnectorProvider;
  capabilityId: string;
  action: ConnectorCapabilityAction | null;
  status: ConnectorExecuteCapabilityStatus;
  resultType: ConnectorExecuteCapabilityResultType;
  accountLabel: string | null;
  profile: ConnectorProfileRecord | null;
  followers: ConnectorFollowerListRecord | null;
  draft: ConnectorPublishDraftResult | null;
  data?: Record<string, unknown> | null;
  setupMode?: ConnectorSetupMode | null;
  blockerCodes?: ConnectorBlockerCode[];
  setupSteps?: string[];
  message: string;
  checkedAt: string;
}

export interface ConnectorState {
  provider: ConnectorProvider;
  status: ConnectorStatus;
  message: string;
  accountLabel: string | null;
  connectedAt: string | null;
  loginUrl: string | null;
  loginMode: ConnectorLoginMode | null;
  lastError: string | null;
  failureKind: "authentication" | "platform" | null;
  browserAccess: ConnectorBrowserAccessRecord;
  capabilities: ConnectorCapabilityRecord[];
  readiness: ConnectorReadinessRecord;
  graphDiscovery?: ConnectorGraphDiscoveryRecord | null;
  graphConnection?: ConnectorGraphConnectionRecord | null;
  testerRequest?: ConnectorTesterRequestRecord | null;
  updatedAt: string;
}

export interface ConnectorOAuthSettingsInput {
  clientId: string;
  clientSecret: string;
  redirectUri?: string | null;
}

export interface ConnectorOAuthSettingsRecord {
  configured: boolean;
  clientIdMasked: string | null;
  clientSecretMasked: string | null;
  redirectUri: string | null;
  updatedAt: string | null;
}

export interface AgentConnectorIntegrationRecord {
  provider: ConnectorProvider;
  label: string;
  status: ConnectorStatus;
  loginMode: ConnectorLoginMode | null;
  accountLabel: string | null;
  connectedAt: string | null;
  browserAccess: ConnectorBrowserAccessRecord;
  capabilities: ConnectorCapabilityRecord[];
  readiness: ConnectorReadinessRecord;
  requiredBySkills: Array<{
    id: string;
    displayName: string;
  }>;
}

export type ChromiumChannel = "chrome" | "msedge" | "chromium";

export interface ConnectorDiagnosticsRecord {
  available: boolean;
  channel: ChromiumChannel | null;
  message: string;
  checkedAt: string;
}

export type FavoriteKind = "output-file" | "agent-message" | "task";

export interface FavoriteRecord {
  id: string;
  kind: FavoriteKind;
  chatId: string;
  runId: string | null;
  artifactId: string | null;
  messageId: string | null;
  createdAt: string;
}

export interface FavoriteCreateInput {
  kind: FavoriteKind;
  chatId: string;
  runId?: string | null;
  artifactId?: string | null;
  messageId?: string | null;
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

export type RockyChatDomain = "general";

export type RockyRoutingIntent =
  | "conversation"
  | "clarification";

export type RockyOrchestrationStatus =
  | "planned"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface RockyOrchestrationRecord {
  id: string;
  status: RockyOrchestrationStatus;
  agentId: string | null;
  sessionId: string | null;
  runId: string | null;
  output: string | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
}

export type RockyInstagramPublishDraftPreviewStatus = "ready" | "blocked";
export type RockyInstagramPublishDraftPreviewMediaKind = "image" | "video" | "unknown";
export type RockyInstagramPublishType = "feed" | "reels";

export interface RockyInstagramPublishDraftPreviewMediaRecord {
  kind: RockyInstagramPublishDraftPreviewMediaKind;
  label: string;
  contentType: string | null;
  previewUrl: string | null;
}

export interface RockyInstagramPublishDraftPreviewRecord {
  provider: "instagram";
  status: RockyInstagramPublishDraftPreviewStatus;
  publishType: RockyInstagramPublishType;
  targetAccountLabel: string;
  media: RockyInstagramPublishDraftPreviewMediaRecord | null;
  caption: string | null;
  blocker: string | null;
  updatedAt: string;
}

export type RockyInstagramPublishApprovalStatus =
  | "publishing"
  | "published"
  | "publish_failed"
  | "blocked";

export interface RockyInstagramPublishApprovalRecord {
  provider: "instagram";
  status: RockyInstagramPublishApprovalStatus;
  publishType: RockyInstagramPublishType;
  targetAccountLabel: string;
  permalink: string | null;
  publishedAt: string | null;
  message: string;
  approvedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface RockyAttachmentInput {
  name: string;
  contentType?: string | null;
  size?: number | null;
  contentBase64?: string | null;
  publicUrl?: string | null;
}

export interface RockyAttachmentRecord {
  id: string;
  name: string;
  contentType: string | null;
  size: number | null;
  workspacePath: string | null;
  publicUrl?: string | null;
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

export interface RockyUsedSkillRecord {
  id: string;
  displayName: string;
}

export type RockyAbilityIcon = "message-square" | "presentation";

export interface RockyAbilityCardRecord {
  id: string;
  skillId: string;
  title: string;
  description: string;
  icon: RockyAbilityIcon;
  examples: string[];
  matchedSkillIds: string[];
  installedSkillIds: string[];
  installed: boolean;
  sortOrder: number;
}

export interface RockyWorkerRecord {
  id: string;
  skillId: string;
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
  skillId: string;
  intent: RockyRoutingIntent;
  domain: RockyChatDomain;
  workerId: string;
  attachmentIds: string[];
  originalRequest: string;
  skillCandidateIds: string[];
  protectionHints: string[];
  orchestration: RockyOrchestrationRecord | null;
  executionStarted: boolean;
  createdAt: string;
}

export interface RockyMessageRecord {
  id: string;
  chatId: string;
  role: "user" | "rocky";
  intent: RockyRoutingIntent;
  text: string;
  attachmentIds: string[];
  domain: RockyChatDomain;
  workerId: string | null;
  skillCandidateIds: string[];
  usedSkills: RockyUsedSkillRecord[];
  dispatchId: string | null;
  createdAt: string;
}

export interface RockyChatMessagePageRecord {
  messages: RockyMessageRecord[];
  limit: number;
  totalCount: number;
  hasPrevious: boolean;
  nextBefore: string | null;
}

export interface RockyChatRecord {
  id: string;
  title: string;
  intent: RockyRoutingIntent;
  domain: RockyChatDomain;
  worker: RockyWorkerRecord | null;
  attachments: RockyAttachmentRecord[];
  messages: RockyMessageRecord[];
  skillCandidates: RockySkillCandidateRecord[];
  dispatches: RockyDispatchRecord[];
  orchestration: RockyOrchestrationRecord | null;
  executionStarted: boolean;
  instagramPublishDraftPreview?: RockyInstagramPublishDraftPreviewRecord | null;
  createdAt: string;
  updatedAt: string;
  messagePage?: RockyChatMessagePageRecord;
}

export interface RockyCoreSettingsRecord {
  defaultRuntimeKind: RuntimeKind;
  defaultModel: string | null;
  defaultReasoningEffort: RuntimeReasoningEffort | null;
  defaultServiceTier: RuntimeServiceTier | null;
  defaultOllamaLaunchTarget: RuntimeOllamaLaunchTarget | null;
  updatedAt: string | null;
}

export interface RockyCoreSettingsUpdateInput {
  defaultRuntimeKind?: RuntimeKind;
  defaultModel?: string | null;
  defaultReasoningEffort?: RuntimeReasoningEffort | null;
  defaultServiceTier?: RuntimeServiceTier | null;
  defaultOllamaLaunchTarget?: RuntimeOllamaLaunchTarget | null;
}

export interface RockyCoreSkillRecord {
  id: string;
  version: string;
  displayName: string;
  description: string;
  workspacePath: string | null;
  matchedSkillIds: string[];
  installedSkillIds: string[];
  installed: boolean;
  synchronized: boolean;
}

export interface RockyCoreSessionHealthRecord {
  homeChatCount: number;
  chatsWithDispatches: number;
  chatsWithoutSessionIds: number;
  chatsWithMissingSessions: number;
  existingSessionCount: number;
  runningSessionCount: number;
  danglingSessionIds: string[];
}

export interface RockyCoreManagementRecord {
  agent: {
    id: string;
    name: string;
    description: string;
    workspaceRoot: string;
    runtimeHome: string;
    defaultRuntime: RuntimeKind;
    lifecycle: "active" | "archived";
    updatedAt: string;
  } | null;
  settings: RockyCoreSettingsRecord;
  skills: RockyCoreSkillRecord[];
  sessionHealth: RockyCoreSessionHealthRecord;
}

export interface RockyChatCreateInput {
  message: string;
  attachments?: RockyAttachmentInput[];
  agentId?: string | null;
  skillId?: string | null;
}

export type RockyTemplateCategory = "document" | "content" | "data";

export type RockyTemplateInterviewStepId =
  | "intent"
  | "inputs"
  | "output"
  | "rules"
  | "review";

export interface RockyTemplateDraft {
  category: RockyTemplateCategory;
  title: string;
  description: string;
  triggerLabel: string;
  requiredInputs: string[];
  outputFormatLabel: string;
  defaultInstructions: string;
}

export interface RockyTemplateInterviewAnswer {
  stepId: RockyTemplateInterviewStepId;
  answer: string;
}

export interface RockyTemplateInterviewTurnInput {
  stepId: RockyTemplateInterviewStepId;
  answer: string;
  answers?: RockyTemplateInterviewAnswer[];
  draft?: RockyTemplateDraft | null;
}

export interface RockyTemplateInterviewAgentRecord {
  status: RockyOrchestrationStatus;
  sessionId: string | null;
  runId: string | null;
  output: string | null;
  error: string | null;
}

export interface RockyTemplateInterviewTurnResult {
  summary: string;
  nextStepId: RockyTemplateInterviewStepId;
  draft: RockyTemplateDraft | null;
  source: "agent" | "fallback";
  agent: RockyTemplateInterviewAgentRecord | null;
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

  suggestAgentForSkill(
    input: AgentSuggestionInput
  ): Promise<AgentSuggestionRecord> {
    return this.request<AgentSuggestionRecord>("/account/agent-suggestion", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getConnectorDiagnostics(): Promise<ConnectorDiagnosticsRecord> {
    return this.request<ConnectorDiagnosticsRecord>("/connectors/diagnostics");
  }

  getConnectorState(provider: ConnectorProvider): Promise<ConnectorState> {
    return this.request<ConnectorState>(
      `/connectors/${encodeURIComponent(provider)}/state`,
    );
  }

  getConnectorOAuthSettings(
    provider: ConnectorProvider,
  ): Promise<ConnectorOAuthSettingsRecord> {
    return this.request<ConnectorOAuthSettingsRecord>(
      `/connectors/${encodeURIComponent(provider)}/oauth-settings`,
    );
  }

  saveConnectorOAuthSettings(
    provider: ConnectorProvider,
    input: ConnectorOAuthSettingsInput,
  ): Promise<ConnectorOAuthSettingsRecord> {
    return this.request<ConnectorOAuthSettingsRecord>(
      `/connectors/${encodeURIComponent(provider)}/oauth-settings`,
      {
        method: "PUT",
        body: JSON.stringify(input),
      },
    );
  }

  deleteConnectorOAuthSettings(
    provider: ConnectorProvider,
  ): Promise<ConnectorOAuthSettingsRecord> {
    return this.request<ConnectorOAuthSettingsRecord>(
      `/connectors/${encodeURIComponent(provider)}/oauth-settings`,
      {
        method: "DELETE",
      },
    );
  }

  startConnectorLogin(provider: ConnectorProvider): Promise<ConnectorState> {
    return this.request<ConnectorState>(
      `/connectors/${encodeURIComponent(provider)}/login`,
      {
        method: "POST",
      },
    );
  }

  startConnectorGraphDiscovery(
    provider: ConnectorProvider,
    input: ConnectorStartLoginInput = {},
  ): Promise<ConnectorState> {
    return this.request<ConnectorState>(
      `/connectors/${encodeURIComponent(provider)}/graph-discovery`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  requestConnectorTesterRegistration(
    provider: ConnectorProvider,
    input: ConnectorTesterRequestInput,
  ): Promise<ConnectorState> {
    return this.request<ConnectorState>(
      `/connectors/${encodeURIComponent(provider)}/tester-request`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  cancelConnectorLogin(provider: ConnectorProvider): Promise<ConnectorState> {
    return this.request<ConnectorState>(
      `/connectors/${encodeURIComponent(provider)}/cancel`,
      {
        method: "POST",
      },
    );
  }

  disconnectConnector(provider: ConnectorProvider): Promise<ConnectorState> {
    return this.request<ConnectorState>(
      `/connectors/${encodeURIComponent(provider)}/disconnect`,
      {
        method: "POST",
      },
    );
  }

  publishConnectorDraft(
    provider: ConnectorProvider,
    input: ConnectorPublishDraftInput,
  ): Promise<ConnectorPublishDraftResult> {
    return this.request<ConnectorPublishDraftResult>(
      `/connectors/${encodeURIComponent(provider)}/publish-draft`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  readConnectorProfile(
    provider: ConnectorProvider,
  ): Promise<ConnectorReadProfileResult> {
    return this.request<ConnectorReadProfileResult>(
      `/connectors/${encodeURIComponent(provider)}/profile`,
    );
  }

  executeConnectorCapability(
    provider: ConnectorProvider,
    input: ConnectorExecuteCapabilityInput,
  ): Promise<ConnectorExecuteCapabilityResult> {
    const encodedProvider = encodeURIComponent(provider);
    const encodedCapabilityId = encodeURIComponent(input.capabilityId);
    return this.request<ConnectorExecuteCapabilityResult>(
      `/connectors/${encodedProvider}/capabilities/${encodedCapabilityId}/execute`,
      {
        method: "POST",
        body: JSON.stringify({ args: input.args ?? {} }),
      },
    );
  }

  listFavorites(): Promise<{ favorites: FavoriteRecord[] }> {
    return this.request<{ favorites: FavoriteRecord[] }>("/favorites");
  }

  addFavorite(input: FavoriteCreateInput): Promise<FavoriteRecord> {
    return this.request<FavoriteRecord>("/favorites", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  removeFavorite(id: string): Promise<{ id: string; deleted: boolean }> {
    return this.request<{ id: string; deleted: boolean }>(
      `/favorites/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }

  createAgent(input: AgentCreateInput): Promise<AgentRecord> {
    return this.request<AgentRecord>("/agents", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        id: input.id ?? undefined,
        description: input.description ?? undefined,
        soul: input.soul ?? undefined,
        defaultRuntime: input.defaultRuntime ?? undefined,
        skillPolicy: input.skillPolicy ?? undefined,
      }),
    });
  }

  getAgent(agentId: string): Promise<AgentRecord> {
    return this.request<AgentRecord>(`/agents/${encodeURIComponent(agentId)}`);
  }

  listAgentLocalSkills(agentId: string): Promise<AgentLocalSkillRecord[]> {
    return this.request<AgentLocalSkillRecord[]>(
      `/agents/${encodeURIComponent(agentId)}/skills`
    );
  }

  listAgentConnectorIntegrations(
    agentId: string
  ): Promise<AgentConnectorIntegrationRecord[]> {
    return this.request<AgentConnectorIntegrationRecord[]>(
      `/agents/${encodeURIComponent(agentId)}/integrations`
    );
  }

  upsertAgentLocalSkill(
    agentId: string,
    skillId: string,
    input: {
      replace?: boolean;
      files: AgentLocalSkillFileInput[];
    }
  ): Promise<AgentLocalSkillUpsertResult> {
    return this.request<AgentLocalSkillUpsertResult>(
      `/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillId)}`,
      {
        method: "PUT",
        body: JSON.stringify(input),
      }
    );
  }

  deleteAgentLocalSkill(
    agentId: string,
    skillId: string
  ): Promise<AgentLocalSkillDeleteResult> {
    return this.request<AgentLocalSkillDeleteResult>(
      `/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(skillId)}`,
      {
        method: "DELETE",
      }
    );
  }

  listSkillTemplates(): Promise<SavedSkillTemplateRecord[]> {
    return this.request<SavedSkillTemplateRecord[]>("/skills");
  }

  previewExternalSkill(input: {
    sourceKind: ExternalSkillSourceKind;
    sourceUrl?: string | null;
    files: ExternalSkillPackageFileInput[];
  }): Promise<ExternalSkillPreviewRecord> {
    return this.request<ExternalSkillPreviewRecord>("/skills/external/preview", {
      method: "POST",
      body: JSON.stringify({
        sourceKind: input.sourceKind,
        sourceUrl: input.sourceUrl ?? null,
        files: input.files,
      }),
    });
  }

  mountExternalSkill(previewId: string): Promise<ExternalSkillMountResult> {
    return this.request<ExternalSkillMountResult>(
      `/skills/external/previews/${encodeURIComponent(previewId)}/mount`,
      {
        method: "POST",
      }
    );
  }

  upsertSkillTemplate(
    skill: SavedSkillTemplateRecord
  ): Promise<SavedSkillTemplateRecord> {
    return this.request<SavedSkillTemplateRecord>(
      `/skills/${encodeURIComponent(skill.id)}`,
      {
        method: "PUT",
        body: JSON.stringify(skill),
      }
    );
  }

  deleteSkillTemplate(skillId: string): Promise<{ id: string; deleted: boolean }> {
    return this.request<{ id: string; deleted: boolean }>(
      `/skills/${encodeURIComponent(skillId)}`,
      {
        method: "DELETE",
      }
    );
  }

  getSkillTemplateFiles(skillId: string): Promise<AgentLocalSkillFileInput[]> {
    return this.request<AgentLocalSkillFileInput[]>(
      `/skills/${encodeURIComponent(skillId)}/files`
    );
  }

  createSkillTemplateRun(input: {
    templateKind?: string | null;
  } = {}): Promise<SkillTemplateRunRecord> {
    return this.request<SkillTemplateRunRecord>("/skill-template-runs", {
      method: "POST",
      body: JSON.stringify({
        templateKind: input.templateKind ?? null,
      }),
    });
  }

  async uploadSkillTemplateRunFile(input: {
    runId: string;
    fieldId: string;
    file: File;
  }): Promise<SkillTemplateInputArtifactRecord> {
    const contentBase64 = await fileToBase64(input.file);

    return this.request<SkillTemplateInputArtifactRecord>(
      `/skill-template-runs/${encodeURIComponent(input.runId)}/uploads`,
      {
        method: "POST",
        body: JSON.stringify({
          fieldId: input.fieldId,
          fileName: input.file.name,
          contentType: input.file.type || null,
          size: input.file.size,
          contentBase64,
        }),
      }
    );
  }

  testEcountConnection(
    input?: EcountConnectionTestInput | null
  ): Promise<EcountConnectionTestRecord> {
    return this.request<EcountConnectionTestRecord>(
      "/integrations/ecount/test",
      {
        method: "POST",
        body: JSON.stringify(input ?? {}),
      }
    );
  }

  getEcountConnectionSettings(): Promise<EcountConnectionSettingsRecord> {
    return this.request<EcountConnectionSettingsRecord>("/integrations/ecount/settings");
  }

  saveEcountConnectionSettings(
    input: EcountConnectionTestInput
  ): Promise<EcountConnectionSettingsRecord> {
    return this.request<EcountConnectionSettingsRecord>(
      "/integrations/ecount/settings",
      {
        method: "PUT",
        body: JSON.stringify(input),
      }
    );
  }

  deleteEcountConnectionSettings(): Promise<EcountConnectionSettingsRecord> {
    return this.request<EcountConnectionSettingsRecord>(
      "/integrations/ecount/settings",
      {
        method: "DELETE",
      }
    );
  }

  getIntegrationCapabilities(provider: string): Promise<IntegrationCapabilitiesRecord> {
    return this.request<IntegrationCapabilitiesRecord>(
      `/integrations/${encodeURIComponent(provider)}/capabilities`
    );
  }

  queryIntegration(
    provider: string,
    input: IntegrationQueryInput
  ): Promise<IntegrationQueryResultRecord | IntegrationQueryBatchResultRecord> {
    return this.request<IntegrationQueryResultRecord | IntegrationQueryBatchResultRecord>(
      `/integrations/${encodeURIComponent(provider)}/query`,
      {
        method: "POST",
        body: JSON.stringify(input),
      }
    );
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

  getRockyCoreManagement(): Promise<RockyCoreManagementRecord> {
    return this.request<RockyCoreManagementRecord>("/rocky/core");
  }

  updateRockyCoreSettings(
    input: RockyCoreSettingsUpdateInput
  ): Promise<RockyCoreManagementRecord> {
    return this.request<RockyCoreManagementRecord>("/rocky/core/settings", {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  syncRockyCoreSkills(): Promise<RockyCoreManagementRecord> {
    return this.request<RockyCoreManagementRecord>("/rocky/core/skills/sync", {
      method: "POST",
    });
  }

  listRockyAbilities(): Promise<RockyAbilityCardRecord[]> {
    return this.request<RockyAbilityCardRecord[]>("/rocky/abilities");
  }

  startRockyAbilityGuide(abilityId: string): Promise<RockyChatRecord> {
    return this.request<RockyChatRecord>(
      `/rocky/abilities/${encodeURIComponent(abilityId)}/guide`,
      {
        method: "POST",
      }
    );
  }

  processRockyTemplateInterviewTurn(
    input: RockyTemplateInterviewTurnInput
  ): Promise<RockyTemplateInterviewTurnResult> {
    return this.request<RockyTemplateInterviewTurnResult>(
      "/rocky/template-interview/turn",
      {
        method: "POST",
        body: JSON.stringify(input),
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

  getRockyChat(
    chatId: string,
    options: { limit?: number | null } = {}
  ): Promise<RockyChatRecord> {
    const search = new URLSearchParams();
    if (options.limit) {
      search.set("limit", String(options.limit));
    }

    return this.request<RockyChatRecord>(
      search.size > 0
        ? `/rocky/chats/${encodeURIComponent(chatId)}?${search.toString()}`
        : `/rocky/chats/${encodeURIComponent(chatId)}`
    );
  }

  getRockyChatMessages(
    chatId: string,
    options: { before?: string | null; limit?: number | null } = {}
  ): Promise<RockyChatMessagePageRecord> {
    const search = new URLSearchParams();
    if (options.before) {
      search.set("before", options.before);
    }
    if (options.limit) {
      search.set("limit", String(options.limit));
    }

    return this.request<RockyChatMessagePageRecord>(
      search.size > 0
        ? `/rocky/chats/${encodeURIComponent(chatId)}/messages?${search.toString()}`
        : `/rocky/chats/${encodeURIComponent(chatId)}/messages`
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

  approveInstagramPublishDraft(
    chatId: string
  ): Promise<RockyInstagramPublishApprovalRecord> {
    return this.request<RockyInstagramPublishApprovalRecord>(
      `/rocky/chats/${encodeURIComponent(chatId)}/instagram/publish/approve`,
      {
        method: "POST",
      }
    );
  }

  cancelRockyChat(chatId: string): Promise<RockyChatRecord> {
    return this.request<RockyChatRecord>(
      `/rocky/chats/${encodeURIComponent(chatId)}/cancel`,
      {
        method: "POST",
      }
    );
  }

  async deleteRockyChat(chatId: string): Promise<void> {
    await this.request<Record<string, never> | null>(
      `/rocky/chats/${encodeURIComponent(chatId)}`,
      {
        method: "DELETE",
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

  openNativeFile(pathname: string): Promise<NativeFileOpenRecord> {
    return this.request<NativeFileOpenRecord>(pathname, {
      method: "POST",
    });
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

  runArtifactFolderNativeOpenPath(runId: string, artifactRole: string): string {
    return `/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(
      artifactRole
    )}/open-folder-native`;
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
