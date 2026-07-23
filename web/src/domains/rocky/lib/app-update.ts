import type { AppUpdateRecord } from "../../../shared/lib/agent-engine-client.js";

export function appUpdateStatusLabel(record: AppUpdateRecord): string {
  switch (record.status) {
    case "checking":
      return "확인 중";
    case "current":
      return "최신 버전";
    case "update-available":
      return record.latestVersion
        ? `${record.latestVersion} 업데이트 가능`
        : "업데이트 가능";
    case "downloading":
      return typeof record.downloadProgress?.percent === "number"
        ? `다운로드 ${record.downloadProgress.percent}%`
        : "다운로드 중";
    case "downloaded":
      return "설치 준비 완료";
    case "installing":
      return "설치 실행 중";
    case "install-started":
      return "설치 파일 실행됨";
    case "unsupported":
      return "지원하지 않는 환경";
    case "failed":
      return "복구 필요";
    case "idle":
    default:
      return "확인 전";
  }
}

export function canInstallAppUpdate(record: AppUpdateRecord): boolean {
  return (
    record.supported &&
    (record.platform === "win32" || record.platform === "darwin") &&
    record.status === "downloaded" &&
    record.download?.verified === true
  );
}

export function canRevealAppUpdateDownload(
  record: AppUpdateRecord
): boolean {
  return (
    record.supported &&
    record.download?.verified === true &&
    (record.status === "downloaded" ||
      record.status === "install-started" ||
      record.status === "failed")
  );
}

export function shouldAutoCheckAppUpdate(record: AppUpdateRecord): boolean {
  return record.supported && record.status === "idle";
}

export function shouldAutoInstallAppUpdate(record: AppUpdateRecord): boolean {
  return canInstallAppUpdate(record);
}

export function primaryAppUpdateActionLabel(record: AppUpdateRecord): string {
  if (record.status === "checking") {
    return "확인 중";
  }
  if (record.status === "update-available") {
    return "업데이트";
  }
  if (record.status === "downloading") {
    return typeof record.downloadProgress?.percent === "number"
      ? `다운로드 ${record.downloadProgress.percent}%`
      : "다운로드 중";
  }
  if (record.status === "downloaded") {
    return "설치 실행";
  }
  if (record.status === "current") {
    return "다시 확인";
  }
  if (record.status === "failed") {
    return "다시 시도";
  }
  return "업데이트 확인";
}
