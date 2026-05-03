import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRecentSavedFiles,
  collectRecentSavedFileRunContexts,
  isRecentSavedFileArtifact,
} from "../../web/src/domains/rocky/lib/home-recent-files.js";
import type {
  RockyChatRecord,
  RockyDispatchRecord,
  RockyOrchestrationRecord,
  RunArtifactRecord,
} from "../../web/src/shared/lib/agent-engine-client.js";

function orchestration(
  overrides: Partial<RockyOrchestrationRecord> = {}
): RockyOrchestrationRecord {
  return {
    id: overrides.id ?? "orchestration-1",
    status: overrides.status ?? "completed",
    agentId: overrides.agentId ?? "agent-1",
    sessionId: overrides.sessionId ?? "session-1",
    runId: overrides.runId ?? "run-1",
    output: overrides.output ?? null,
    error: overrides.error ?? null,
    startedAt: overrides.startedAt ?? "2026-05-02T00:00:00.000Z",
    endedAt: overrides.endedAt ?? "2026-05-02T00:05:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-02T00:05:00.000Z",
  };
}

function dispatch(overrides: Partial<RockyDispatchRecord> = {}): RockyDispatchRecord {
  return {
    id: overrides.id ?? "dispatch-1",
    chatId: overrides.chatId ?? "chat-1",
    messageId: overrides.messageId ?? "message-1",
    skillId: overrides.skillId ?? "rocky.core",
    intent: overrides.intent ?? "conversation",
    domain: overrides.domain ?? "general",
    workerId: overrides.workerId ?? "worker-1",
    attachmentIds: overrides.attachmentIds ?? [],
    originalRequest: overrides.originalRequest ?? "Create a report",
    skillCandidateIds: overrides.skillCandidateIds ?? [],
    protectionHints: overrides.protectionHints ?? [],
    orchestration: overrides.orchestration ?? orchestration(),
    executionStarted: overrides.executionStarted ?? true,
    createdAt: overrides.createdAt ?? "2026-05-02T00:00:00.000Z",
  };
}

function chat(overrides: Partial<RockyChatRecord> = {}): RockyChatRecord {
  return {
    id: overrides.id ?? "chat-1",
    title: overrides.title ?? "Report task",
    intent: overrides.intent ?? "conversation",
    domain: overrides.domain ?? "general",
    worker: overrides.worker ?? null,
    attachments: overrides.attachments ?? [],
    messages: overrides.messages ?? [],
    skillCandidates: overrides.skillCandidates ?? [],
    dispatches: overrides.dispatches ?? [dispatch()],
    orchestration: overrides.orchestration ?? null,
    executionStarted: overrides.executionStarted ?? true,
    createdAt: overrides.createdAt ?? "2026-05-02T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-02T00:05:00.000Z",
  };
}

function artifact(overrides: Partial<RunArtifactRecord> = {}): RunArtifactRecord {
  return {
    kind: overrides.kind ?? "file",
    role: overrides.role ?? "workspace-outputs-report-md",
    name: overrides.name ?? "report.md",
    workspaceRelativePath: Object.hasOwn(overrides, "workspaceRelativePath")
      ? overrides.workspaceRelativePath
      : "outputs/report.md",
    contentType: overrides.contentType ?? "text/markdown; charset=utf-8",
    presentation: overrides.presentation ?? "file",
    size: Object.hasOwn(overrides, "size") ? (overrides.size ?? null) : 1024,
    previewable: overrides.previewable ?? true,
    previewUrl: Object.hasOwn(overrides, "previewUrl")
      ? (overrides.previewUrl ?? null)
      : "/runs/run-1/artifacts/report/preview",
    downloadUrl: overrides.downloadUrl ?? "/runs/run-1/artifacts/report",
    preferredAction: overrides.preferredAction ?? "preview",
  };
}

test("collectRecentSavedFileRunContexts keeps completed runs sorted by finish time", () => {
  const contexts = collectRecentSavedFileRunContexts(
    [
      chat({
        id: "older-chat",
        title: "Older",
        dispatches: [
          dispatch({
            orchestration: orchestration({
              runId: "run-old",
              endedAt: "2026-05-01T00:05:00.000Z",
            }),
          }),
        ],
      }),
      chat({
        id: "running-chat",
        title: "Running",
        dispatches: [
          dispatch({
            orchestration: orchestration({
              status: "running",
              runId: "run-running",
              endedAt: null,
            }),
          }),
        ],
      }),
      chat({
        id: "newer-chat",
        title: "Newer",
        dispatches: [
          dispatch({
            orchestration: orchestration({
              runId: "run-new",
              endedAt: "2026-05-02T00:05:00.000Z",
            }),
          }),
        ],
      }),
    ],
    10
  );

  assert.deepEqual(
    contexts.map((context) => context.runId),
    ["run-new", "run-old"]
  );
});

test("isRecentSavedFileArtifact filters internal files and keeps user outputs", () => {
  assert.equal(isRecentSavedFileArtifact(artifact()), true);
  assert.equal(
    isRecentSavedFileArtifact(
      artifact({
        role: "output-last-message",
        name: "output.txt",
        workspaceRelativePath: undefined,
        contentType: "text/plain; charset=utf-8",
      })
    ),
    false
  );
  assert.equal(
    isRecentSavedFileArtifact(
      artifact({
        role: "workspace-readme-md",
        name: "README.md",
        workspaceRelativePath: "README.md",
      })
    ),
    false
  );
  assert.equal(
    isRecentSavedFileArtifact(
      artifact({
        role: "chart-image",
        name: "chart.png",
        workspaceRelativePath: undefined,
        contentType: "image/png",
      })
    ),
    true
  );
});

test("buildRecentSavedFiles deduplicates workspace paths and limits results", () => {
  const contexts = collectRecentSavedFileRunContexts(
    [
      chat({
        id: "chat-1",
        title: "Newest task",
        dispatches: [
          dispatch({
            orchestration: orchestration({
              runId: "run-1",
              endedAt: "2026-05-02T00:05:00.000Z",
            }),
          }),
        ],
      }),
      chat({
        id: "chat-2",
        title: "Older task",
        dispatches: [
          dispatch({
            orchestration: orchestration({
              runId: "run-2",
              endedAt: "2026-05-01T00:05:00.000Z",
            }),
          }),
        ],
      }),
    ],
    10
  );
  const artifactsByRunId = new Map<string, RunArtifactRecord[]>([
    [
      "run-1",
      [
        artifact({ role: "workspace-outputs-report-md" }),
        artifact({ role: "workspace-outputs-report-copy-md" }),
      ],
    ],
    [
      "run-2",
      [
        artifact({
          role: "workspace-outputs-summary-md",
          name: "summary.md",
          workspaceRelativePath: "outputs/summary.md",
          downloadUrl: "/runs/run-2/artifacts/summary",
        }),
      ],
    ],
  ]);

  const files = buildRecentSavedFiles(contexts, artifactsByRunId, 1);

  assert.equal(files.length, 1);
  assert.equal(files[0]?.runId, "run-1");
  assert.equal(files[0]?.displayPath, "outputs/report.md");
});
