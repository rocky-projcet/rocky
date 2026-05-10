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
  | "connecting"
  | "connected"
  | "failed";

export type ConnectorLoginMode =
  | "oauth"
  | "custom-browser"
  | "external-browser"
  | "managed-browser";

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

export interface ConnectorState {
  provider: ConnectorProvider;
  status: ConnectorStatus;
  message: string;
  accountLabel: string | null;
  connectedAt: string | null;
  loginUrl: string | null;
  loginMode: ConnectorLoginMode | null;
  lastError: string | null;
  updatedAt: string;
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
  cancelLogin(provider: ConnectorProvider): Promise<ConnectorState>;
  disconnect(provider: ConnectorProvider): Promise<ConnectorState>;
  getDiagnostics(): Promise<ConnectorDiagnosticsRecord>;
}
