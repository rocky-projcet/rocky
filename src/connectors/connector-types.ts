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
  | "completed";

export interface ConnectorTesterRequestInput {
  accountIdentifier: string;
  status?: ConnectorTesterRequestStatus;
}

export interface ConnectorTesterRequestRecord {
  provider: Extract<ConnectorProvider, "instagram">;
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

export interface ConnectorStartLoginInput {
  redirectBaseUrl?: string | null;
  openExternal?: boolean;
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

export interface ConnectorBrokerStartInput {
  returnUrl: string;
  brokerBaseUrl?: string | null;
}

export interface ConnectorBrokerStartResult {
  ok: boolean;
  provider: ConnectorProvider;
  loginUrl: string | null;
  message: string;
}

export interface ConnectorBrokerCallbackResult {
  ok: boolean;
  provider: ConnectorProvider;
  title: string;
  message: string;
  redirectUrl: string | null;
}

export interface ConnectorBrokerRedeemInput {
  handoffCode: string;
}

export interface ConnectorBrokerRedeemResult {
  ok: boolean;
  provider: ConnectorProvider;
  tokenPayload: Record<string, unknown> | null;
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
  failureKind: ConnectorFailureKind | null;
  browserAccess: ConnectorBrowserAccessRecord;
  capabilities: ConnectorCapabilityRecord[];
  readiness: ConnectorReadinessRecord;
  graphDiscovery?: ConnectorGraphDiscoveryRecord | null;
  graphConnection?: ConnectorGraphConnectionRecord | null;
  testerRequest?: ConnectorTesterRequestRecord | null;
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
  getOAuthSettings(provider: ConnectorProvider): Promise<ConnectorOAuthSettingsRecord>;
  saveOAuthSettings(
    provider: ConnectorProvider,
    input: ConnectorOAuthSettingsInput,
  ): Promise<ConnectorOAuthSettingsRecord>;
  deleteOAuthSettings(provider: ConnectorProvider): Promise<ConnectorOAuthSettingsRecord>;
  startLogin(
    provider: ConnectorProvider,
    input?: ConnectorStartLoginInput,
  ): Promise<ConnectorState>;
  startGraphDiscovery(
    provider: ConnectorProvider,
    input?: ConnectorStartLoginInput,
  ): Promise<ConnectorState>;
  requestTesterRegistration(
    provider: ConnectorProvider,
    input: ConnectorTesterRequestInput,
  ): Promise<ConnectorState>;
  handleOAuthCallback(
    provider: ConnectorProvider,
    input: ConnectorOAuthCallbackInput,
  ): Promise<ConnectorOAuthCallbackResult>;
  handleGraphDiscoveryCallback(
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
  startInstagramGraphOAuthBroker(
    input: ConnectorBrokerStartInput,
  ): Promise<ConnectorBrokerStartResult>;
  handleInstagramGraphOAuthBrokerCallback(
    input: ConnectorOAuthCallbackInput,
  ): Promise<ConnectorBrokerCallbackResult>;
  redeemInstagramGraphOAuthBroker(
    input: ConnectorBrokerRedeemInput,
  ): Promise<ConnectorBrokerRedeemResult>;
  handleGraphBrokerCallback(
    provider: ConnectorProvider,
    input: ConnectorBrokerRedeemInput,
  ): Promise<ConnectorOAuthCallbackResult>;
  getDiagnostics(): Promise<ConnectorDiagnosticsRecord>;
}
