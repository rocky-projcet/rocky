import { isSuppressedTranscriptArtifact } from "../../session/lib/transcript-display.js";
import type {
  RockyChatRecord,
  RunArtifactRecord,
} from "../../../shared/lib/agent-engine-client.js";

export type RecentSavedFileRunContext = {
  chatId: string;
  chatTitle: string;
  runId: string;
  savedAt: string;
};

export type RecentSavedFile = {
  id: string;
  chatId: string;
  chatTitle: string;
  runId: string;
  savedAt: string;
  artifact: RunArtifactRecord;
  displayPath: string;
};

function timestampMs(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeWorkspacePath(value: string | null | undefined): string {
  return value?.trim().replace(/^\.\/+/, "").replace(/\\/g, "/").replace(/\/+$/, "") ?? "";
}

function isOutputsPath(value: string): boolean {
  const normalized = normalizeWorkspacePath(value).toLowerCase();
  return normalized === "outputs" || normalized.startsWith("outputs/");
}

function artifactIdentity(artifact: RunArtifactRecord): string {
  return artifact.workspaceRelativePath
    ? `workspace:${normalizeWorkspacePath(artifact.workspaceRelativePath).toLowerCase()}`
    : `artifact:${artifact.downloadUrl}`;
}

export function isRecentSavedFileArtifact(artifact: RunArtifactRecord): boolean {
  if (isSuppressedTranscriptArtifact(artifact)) {
    return false;
  }

  const workspacePath = normalizeWorkspacePath(artifact.workspaceRelativePath);
  if (artifact.role === "output" || isOutputsPath(workspacePath)) {
    return true;
  }

  return (
    !artifact.role.startsWith("workspace-") &&
    artifact.role !== "output-last-message"
  );
}

export function collectRecentSavedFileRunContexts(
  chats: RockyChatRecord[],
  limit: number
): RecentSavedFileRunContext[] {
  const contexts: RecentSavedFileRunContext[] = [];
  const seenRunIds = new Set<string>();

  for (const chat of chats) {
    for (const dispatch of chat.dispatches) {
      const orchestration = dispatch.orchestration;
      if (!orchestration?.runId || seenRunIds.has(orchestration.runId)) {
        continue;
      }

      if (orchestration.status !== "completed") {
        continue;
      }

      seenRunIds.add(orchestration.runId);
      contexts.push({
        chatId: chat.id,
        chatTitle: chat.title || dispatch.originalRequest || "제목 없음",
        runId: orchestration.runId,
        savedAt:
          orchestration.endedAt ??
          orchestration.updatedAt ??
          dispatch.createdAt ??
          chat.updatedAt,
      });
    }
  }

  return contexts
    .sort((left, right) => timestampMs(right.savedAt) - timestampMs(left.savedAt))
    .slice(0, limit);
}

export function buildRecentSavedFiles(
  contexts: RecentSavedFileRunContext[],
  artifactsByRunId: Map<string, RunArtifactRecord[]>,
  limit: number
): RecentSavedFile[] {
  const files: RecentSavedFile[] = [];
  const seenArtifacts = new Set<string>();

  for (const context of contexts) {
    for (const artifact of artifactsByRunId.get(context.runId) ?? []) {
      if (!isRecentSavedFileArtifact(artifact)) {
        continue;
      }

      const identity = artifactIdentity(artifact);
      if (seenArtifacts.has(identity)) {
        continue;
      }

      seenArtifacts.add(identity);
      files.push({
        id: `${context.runId}:${artifact.role}`,
        chatId: context.chatId,
        chatTitle: context.chatTitle,
        runId: context.runId,
        savedAt: context.savedAt,
        artifact,
        displayPath: normalizeWorkspacePath(artifact.workspaceRelativePath) || artifact.role,
      });
    }
  }

  return files
    .sort((left, right) => timestampMs(right.savedAt) - timestampMs(left.savedAt))
    .slice(0, limit);
}
