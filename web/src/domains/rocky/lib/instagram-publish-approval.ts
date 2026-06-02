import type {
  RockyInstagramPublishApprovalRecord,
  RockyInstagramPublishApprovalStatus,
} from "../../../shared/lib/agent-engine-client.js";

export function instagramPublishApprovalStatusLabel(
  status: RockyInstagramPublishApprovalStatus,
): string {
  if (status === "published") return "발행 완료";
  if (status === "already_published") return "이미 발행됨";
  if (status === "publishing") return "발행 중";
  if (status === "verification_required") return "상태 확인 필요";
  if (status === "publish_failed") return "재시도 가능";
  return "승인 차단";
}

export function instagramPublishApprovalNoticeClassName(
  status: RockyInstagramPublishApprovalStatus,
): string {
  if (status === "published" || status === "already_published") {
    return "border-emerald-300/60 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-100";
  }
  if (status === "verification_required") {
    return "border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100";
  }
  return "border-rose-300/60 bg-rose-50 text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-100";
}

export function instagramPublishApprovalMessage(
  result: RockyInstagramPublishApprovalRecord,
): string {
  const message = sanitizeInstagramPublishApprovalText(result.message);
  if (result.status === "publish_failed") {
    return message || "문제를 수정한 뒤 다시 승인하면 안전하게 재시도할 수 있습니다.";
  }
  if (result.status === "verification_required") {
    return message || "새 발행으로 재시도하지 말고 Instagram에서 게시 여부를 먼저 확인해 주세요.";
  }
  if (result.status === "already_published") {
    return message || "이미 발행된 초안입니다. Instagram에서 게시 상태를 확인해 주세요.";
  }
  return message || "Instagram 발행 상태가 업데이트되었습니다.";
}

export function sanitizeInstagramPublishApprovalText(value: string): string {
  return value
    .replace(/https:\/\/(?:graph[.]facebook|graph[.]instagram)[.]com\/[^\s)"'<>`]+/giu, "Instagram API")
    .replace(/https:\/\/tmpfiles[.]org\/[^\s)"'<>`]+/giu, "임시 미디어 링크")
    .replace(/\b(?:access_token|refresh_token|id_token|auth_token|client_secret|sessionid|session_id|cookie)\b\s*[:=]\s*[^\s,;\])}]+/giu, "인증 정보는 숨겼습니다")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu, "인증 정보는 숨겼습니다")
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"'<>]*(?:agent-workspaces|runtime-home|browser-profile|connectors|outputs)[^\s"'<>]*/giu, "작업공간 경로")
    .replace(/\binstagram[.]media[.](?:prepare|publish|status[.]read)\b/giu, "Instagram connector")
    .replace(/\b(?:creation|media)-[A-Za-z0-9_-]+\b/gu, "발행 식별자")
    .trim();
}
