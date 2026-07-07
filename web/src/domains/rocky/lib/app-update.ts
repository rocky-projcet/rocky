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
    case "downloaded":
      return "설치 준비 완료";
    case "installing":
      return "설치 실행 중";
    case "install-started":
      return "설치 파일 실행됨";
    case "unsupported":
      return "Windows 전용";
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
    record.platform === "win32" &&
    record.status === "downloaded" &&
    record.download?.verified === true
  );
}

export function primaryAppUpdateActionLabel(record: AppUpdateRecord): string {
  if (record.status === "checking") {
    return "확인 중";
  }
  if (record.status === "update-available") {
    return "설치 파일 다운로드";
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
