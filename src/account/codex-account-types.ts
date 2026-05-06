import type {
  CliUpdateRecord,
  ProviderAccountInfoRecord,
  ProviderAccountRecord,
  ProviderAccountStatus,
} from "./provider-account-types.js";

export type CodexAccountStatus = ProviderAccountStatus;

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

export type CodexAccountInfoRecord = ProviderAccountInfoRecord;

export interface CodexAccountRecord {
  provider: "codex";
  providerLabel: "Codex CLI";
  status: CodexAccountStatus;
  statusText: string;
  homePath: string | null;
  codexBin: string;
  updatedAt: string;
  accountInfo: CodexAccountInfoRecord;
  loginMethods: ProviderAccountRecord["loginMethods"];
  primaryLoginMethodId: string | null;
  diagnostics: ProviderAccountRecord["diagnostics"];
  update: CliUpdateRecord;
  deviceAuth: CodexDeviceAuthRecord;
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

export interface CodexAccountServiceLike {
  getState(): Promise<CodexAccountRecord>;
  startLogin(): Promise<CodexAccountRecord>;
  startDeviceAuth(): Promise<CodexAccountRecord>;
  loginWithApiKey(apiKey: string): Promise<CodexAccountRecord>;
  startUpdate(): Promise<CodexAccountRecord>;
  logout(): Promise<CodexAccountRecord>;
  summarizeTaskRequestTitle(
    prompt: string
  ): Promise<TaskRequestTitleSummaryRecord>;
  suggestAgentForSkill(
    input: AgentSuggestionInput
  ): Promise<AgentSuggestionRecord>;
}
