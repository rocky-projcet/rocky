export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "update-available"
  | "downloaded"
  | "installing"
  | "install-started"
  | "unsupported"
  | "failed";

export type AppUpdateChecksumSource =
  | "github-asset-digest"
  | "checksum-asset";

export interface AppUpdateAssetRecord {
  name: string;
  downloadUrl: string;
  size: number | null;
  sha256: string | null;
  checksumSource: AppUpdateChecksumSource | null;
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

export interface AppUpdateRecord {
  currentVersion: string;
  platform: NodeJS.Platform;
  supported: boolean;
  status: AppUpdateStatus;
  latestVersion: string | null;
  releaseUrl: string | null;
  updateAvailable: boolean;
  installerAsset: AppUpdateAssetRecord | null;
  download: AppUpdateDownloadRecord | null;
  preservedPathNames: string[];
  checkedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
}

export interface AppUpdateServiceLike {
  getState(): AppUpdateRecord;
  checkForUpdates(): Promise<AppUpdateRecord>;
  downloadInstaller(): Promise<AppUpdateRecord>;
  startInstaller(input: { confirmedRestartRisk: boolean }): Promise<AppUpdateRecord>;
}
