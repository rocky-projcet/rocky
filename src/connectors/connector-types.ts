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

export interface ConnectorState {
  provider: ConnectorProvider;
  status: ConnectorStatus;
  message: string;
  accountLabel: string | null;
  connectedAt: string | null;
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
  startLogin(provider: ConnectorProvider): Promise<ConnectorState>;
  cancelLogin(provider: ConnectorProvider): Promise<ConnectorState>;
  disconnect(provider: ConnectorProvider): Promise<ConnectorState>;
  getDiagnostics(): Promise<ConnectorDiagnosticsRecord>;
}
