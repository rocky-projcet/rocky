import type {
  RockyAppUpdateAssetKind,
  RockyAppUpdateRecord,
} from "../types.js";

export interface RockyAppUpdateActions {
  busy: boolean;
  canCheck: boolean;
  canDownload: boolean;
  canInstall: boolean;
  canOpenFolder: boolean;
}

export function appUpdateLatestStatusLabel(
  status: RockyAppUpdateRecord["latestStatus"]
): string {
  switch (status) {
    case "current":
      return "최신";
    case "update-available":
      return "업데이트 가능";
    case "error":
      return "확인 실패";
    default:
      return "미확인";
  }
}

export function appUpdateOperationLabel(
  state: RockyAppUpdateRecord
): string {
  if (state.operation.status === "pending") {
    switch (state.operation.kind) {
      case "check":
        return "확인 중";
      case "download":
        return "다운로드 중";
      case "install":
        return "설치 열기 중";
      case "open-folder":
        return "폴더 여는 중";
      default:
        return "처리 중";
    }
  }

  if (state.operation.status === "failed") {
    return "실패";
  }

  return appUpdateLatestStatusLabel(state.latestStatus);
}

export function appUpdateAssetKindLabel(kind: RockyAppUpdateAssetKind): string {
  switch (kind) {
    case "pkg":
      return "macOS Installer";
    case "dmg":
      return "DMG";
    case "app-zip":
      return "App ZIP";
  }
}

export function formatAppUpdateSize(sizeBytes: number | null): string {
  if (sizeBytes === null) {
    return "크기 미확인";
  }

  const mebibytes = sizeBytes / 1024 / 1024;
  if (mebibytes >= 1) {
    return `${mebibytes.toFixed(mebibytes >= 10 ? 0 : 1)} MB`;
  }

  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

export function getAppUpdateActions(
  state: RockyAppUpdateRecord
): RockyAppUpdateActions {
  const busy = state.operation.status === "pending";
  return {
    busy,
    canCheck: state.supported && !busy,
    canDownload:
      state.supported &&
      !busy &&
      state.latestStatus === "update-available" &&
      Boolean(state.asset?.checksumSha256) &&
      !state.download?.verified,
    canInstall:
      state.supported &&
      !busy &&
      Boolean(state.download?.verified),
    canOpenFolder:
      state.supported &&
      !busy &&
      (Boolean(state.download?.directory) ||
        state.operation.status === "failed" ||
        state.install.status === "failed"),
  };
}
