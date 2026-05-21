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

export type ConnectorFailureKind = "authentication" | "platform";

export type ConnectorLoginMode =
  | "oauth"
  | "custom-browser"
  | "external-browser"
  | "managed-browser";

export type ConnectorCapabilityAction = "read" | "write";
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
  | "permission_missing"
  | "app_review_required"
  | "access_token_missing"
  | "instagram_business_account_id_missing"
  | "rocky_capability_not_implemented";

export interface ConnectorReadinessBlockerRecord {
  code: ConnectorBlockerCode;
  message: string;
  nextAction: string;
}

export interface ConnectorReadinessRecord {
  setupMode: ConnectorSetupMode | null;
  accountKind: ConnectorAccountKind | null;
  browserSessionPurpose: ConnectorBrowserSessionPurpose | null;
  blockers: ConnectorReadinessBlockerRecord[];
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
  sourceSkillId?: string | null;
  sourceSkillName?: string | null;
  scriptPath?: string | null;
  usage?: string | null;
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

export interface ConnectorStartLoginInput {
  redirectBaseUrl?: string | null;
}

export interface ConnectorOAuthCallbackInput {
  code?: string | null;
  state?: string | null;
  error?: string | null;
  errorDescription?: string | null;
}

export interface ConnectorOAuthCallbackResult {
  ok: boolean;
  provider: ConnectorProvider;
  title: string;
  message: string;
  state: ConnectorState;
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
  failureKind: ConnectorFailureKind | null;
  browserAccess: ConnectorBrowserAccessRecord;
  capabilities: ConnectorCapabilityRecord[];
  readiness: ConnectorReadinessRecord;
  updatedAt: string;
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

export interface ConnectorServiceLike {
  getState(provider: ConnectorProvider): Promise<ConnectorState>;
  startLogin(
    provider: ConnectorProvider,
    input?: ConnectorStartLoginInput,
  ): Promise<ConnectorState>;
  handleOAuthCallback(
    provider: ConnectorProvider,
    input: ConnectorOAuthCallbackInput,
  ): Promise<ConnectorOAuthCallbackResult>;
  publishDraft(
    provider: ConnectorProvider,
    input: ConnectorPublishDraftInput,
  ): Promise<ConnectorPublishDraftResult>;
  executeCapability(
    provider: ConnectorProvider,
    input: ConnectorExecuteCapabilityInput,
  ): Promise<ConnectorExecuteCapabilityResult>;
  readProfile(provider: ConnectorProvider): Promise<ConnectorReadProfileResult>;
  cancelLogin(provider: ConnectorProvider): Promise<ConnectorState>;
  disconnect(provider: ConnectorProvider): Promise<ConnectorState>;
  getDiagnostics(): Promise<ConnectorDiagnosticsRecord>;
}
