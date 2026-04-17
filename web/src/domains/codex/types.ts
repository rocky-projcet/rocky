import type {
  ProviderAccountInfoRecord as SharedProviderAccountInfoRecord,
  ProviderAccountStatus as SharedProviderAccountStatus,
  ProviderStatusAccountSummaryRecord as SharedProviderStatusAccountSummaryRecord,
  ProviderStatusDataState as SharedProviderStatusDataState,
  ProviderStatusUsageWindowRecord as SharedProviderStatusUsageWindowRecord,
} from "../../shared/lib/agent-engine-client.js";

export type {
  CliInstallMethod,
  CliUpdateRecord,
  CliVersionDiagnosticsRecord,
  ClaudeAccountRecord,
  ClaudeStatusRecord,
  CodexAccountRecord,
  CodexDeviceAuthRecord,
  CodexStatusRecord,
  HardwareCpuRecord,
  HardwareGpuMemoryKind,
  HardwareGpuRecord,
  HardwareMemoryKind,
  HardwareMemoryRecord,
  HardwareStatusRecord,
  HardwareStorageRecord,
  ProviderAccountInfoRecord,
  ProviderAccountRecord,
  ProviderAccountStatus,
  ProviderAccountsResponse,
  ProviderKind,
  ProviderLoginMethodRecord,
  ProviderStatusAccountSummaryRecord,
  ProviderStatusDataState,
  ProviderStatusesResponse,
  ProviderStatusRecord,
  ProviderUsageSummaryRecord,
  ProviderStatusUsageWindowRecord,
  RuntimeKind,
  RuntimeDescriptorRecord,
  RuntimeModelOption,
  RuntimeOllamaLaunchTarget,
} from "../../shared/lib/agent-engine-client.js";

export type CodexAccountStatus = SharedProviderAccountStatus;
export type CodexAccountInfoRecord = SharedProviderAccountInfoRecord;
export type CodexStatusDataState = SharedProviderStatusDataState;
export type CodexStatusAccountSummaryRecord = SharedProviderStatusAccountSummaryRecord;
export type CodexStatusUsageWindowRecord = SharedProviderStatusUsageWindowRecord;
