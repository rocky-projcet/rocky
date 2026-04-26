import {
  maybeReadLastMessage,
} from "./codex-runtime-environment.js";
import {
  buildOutputLastMessageArtifactRef,
  captureWorkspaceArtifacts,
  deriveArtifactsDir,
} from "./codex-runtime-artifacts.js";

import type {
  RuntimeMessage,
  RuntimeRequest,
  RuntimeRunResult,
  RuntimeRunState,
  RuntimeSession,
} from "./runtime-types.js";

function ensureResultMessages(
  messages: RuntimeMessage[],
  lastMessage: string | null,
  occurredAt: string | null
): RuntimeMessage[] {
  const normalizedLastMessage = lastMessage?.trim();
  if (!normalizedLastMessage || !occurredAt) {
    return messages;
  }

  const lastAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  if (lastAssistantMessage?.text.trim() === normalizedLastMessage) {
    return messages;
  }

  return [
    ...messages,
    {
      role: "assistant",
      text: normalizedLastMessage,
      itemType: "output-last-message",
      occurredAt,
      source: "output-last-message",
    },
  ];
}

export function statusFromExit({
  exitCode,
  signal,
  cancelled,
}: {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  cancelled: boolean;
}): string {
  if (cancelled || signal === "SIGTERM" || signal === "SIGINT") {
    return "cancelled";
  }

  return exitCode === 0 ? "completed" : "failed";
}

export async function buildRunResult({
  runId,
  session,
  run,
  command,
  args,
  request,
}: {
  runId: string;
  session: RuntimeSession;
  run: RuntimeRunState;
  command: string;
  args: string[];
  request: RuntimeRequest;
}): Promise<RuntimeRunResult> {
  const lastMessage = await maybeReadLastMessage(request.outputLastMessagePath);
  const artifactRefs = [];
  const outputLastMessageArtifactRef = buildOutputLastMessageArtifactRef(
    request.outputLastMessagePath
  );
  if (outputLastMessageArtifactRef) {
    artifactRefs.push(outputLastMessageArtifactRef);
  }

  const artifactsDir = deriveArtifactsDir(request.outputLastMessagePath);
  if (artifactsDir) {
    try {
      const workspaceArtifacts = await captureWorkspaceArtifacts({
        workspaceRoot: session.workspaceRoot,
        artifactsDir,
        beforeSnapshot: run.workspaceSnapshot,
        excludedPaths: request.outputLastMessagePath
          ? [request.outputLastMessagePath]
          : [],
      });

      artifactRefs.push(...workspaceArtifacts.artifactRefs);
      if (workspaceArtifacts.skippedCount > 0) {
        run.warnings.push({
          message: `Skipped ${workspaceArtifacts.skippedCount} additional workspace artifact files after reaching the capture limit.`,
          retriable: false,
          occurredAt: run.endedAt ?? run.startedAt,
        });
      }
    } catch (error) {
      run.warnings.push({
        message: `Failed to capture workspace artifacts: ${
          error instanceof Error ? error.message : String(error)
        }`,
        retriable: false,
        occurredAt: run.endedAt ?? run.startedAt,
      });
    }
  }
  const messages = ensureResultMessages(
    [...run.messages],
    lastMessage,
    run.endedAt
  );

  return {
    runId,
    sessionId: session.id,
    runtimeSessionId: run.runtimeSessionId ?? session.runtimeSessionId,
    sessionBinding: run.sessionBinding,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    exitCode: run.exitCode,
    signal: run.signal,
    command,
    args,
    messages,
    warnings: [...run.warnings],
    errors: [...run.errors],
    stderr: [...run.stderr],
    artifactRefs,
    lastMessage,
    outputLastMessagePath: request.outputLastMessagePath ?? null,
    rawEvents: [...run.rawEvents],
  };
}
