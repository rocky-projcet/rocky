import type { NativeFileOpenRecord } from "../api/http/native-open.js";

export type RockyAppUpdateAssetKind = "pkg" | "dmg" | "app-zip";

export type RockyAppUpdateLatestStatus =
  | "current"
  | "update-available"
  | "unknown"
  | "error";

export type RockyAppUpdateOperationKind =
  | "check"
  | "download"
  | "install"
  | "open-folder";

export type RockyAppUpdateOperationStatus =
  | "idle"
  | "pending"
  | "completed"
  | "failed";

export type RockyAppUpdateChecksumSource =
  | "github-asset-digest"
  | "release-manifest";

export interface RockyAppUpdateAssetRecord {
  name: string;
  kind: RockyAppUpdateAssetKind;
  sizeBytes: number | null;
  downloadUrl: string;
  checksumSha256: string | null;
  checksumSource: RockyAppUpdateChecksumSource | null;
}

export interface RockyAppUpdateDownloadRecord {
  fileName: string;
  filePath: string;
  directory: string;
  sizeBytes: number;
  sha256: string;
  verified: boolean;
  verifiedAt: string | null;
}

export interface RockyAppUpdateOperationRecord {
  kind: RockyAppUpdateOperationKind | null;
  status: RockyAppUpdateOperationStatus;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
}

export interface RockyAppUpdateInstallRecord {
  status: "idle" | "opened" | "manual-action" | "failed";
  openedAt: string | null;
  message: string | null;
  nativeOpen: NativeFileOpenRecord | null;
}

export interface RockyAppUpdateRecord {
  appName: "Rocky";
  platform: NodeJS.Platform;
  arch: string;
  supported: boolean;
  currentVersion: string;
  latestVersion: string | null;
  latestStatus: RockyAppUpdateLatestStatus;
  checkedAt: string | null;
  releaseUrl: string | null;
  statusText: string;
  asset: RockyAppUpdateAssetRecord | null;
  download: RockyAppUpdateDownloadRecord | null;
  operation: RockyAppUpdateOperationRecord;
  install: RockyAppUpdateInstallRecord;
  limitations: string[];
  statePreservation: string[];
}

export interface RockyAppUpdateServiceLike {
  getState(): Promise<RockyAppUpdateRecord>;
  checkForUpdate(): Promise<RockyAppUpdateRecord>;
  downloadUpdate(): Promise<RockyAppUpdateRecord>;
  openInstaller(): Promise<RockyAppUpdateRecord>;
  openDownloadFolder(): Promise<RockyAppUpdateRecord>;
}
