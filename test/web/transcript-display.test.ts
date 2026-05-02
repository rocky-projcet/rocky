import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTranscriptDisplayEntries,
  formatElapsedDuration,
  isSuppressedTranscriptArtifact,
  normalizeStreamingMarkdown,
  splitTranscriptArtifacts,
  splitTextWithWorkspacePaths,
} from "../../web/src/domains/session/lib/transcript-display.js";
import type { AgentSessionMessage } from "../../web/src/domains/session/types.js";

function buildMessage(
  overrides: Partial<AgentSessionMessage> & Pick<AgentSessionMessage, "id" | "role" | "content">
): AgentSessionMessage {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId ?? "session-1",
    runId: overrides.runId ?? null,
    role: overrides.role,
    content: overrides.content,
    blocks: overrides.blocks,
    artifacts: overrides.artifacts,
    source: overrides.source ?? "test",
    createdAt: overrides.createdAt ?? "2026-03-19T00:00:00.000Z",
  };
}

test("buildTranscriptDisplayEntries groups consecutive assistant messages from the same run", () => {
  const entries = buildTranscriptDisplayEntries([
    buildMessage({
      id: "user-1",
      role: "user",
      runId: "run-1",
      content: "prompt",
    }),
    buildMessage({
      id: "assistant-1",
      role: "assistant",
      runId: "run-1",
      content: "step one",
    }),
    buildMessage({
      id: "assistant-2",
      role: "assistant",
      runId: "run-1",
      content: "step two",
    }),
    buildMessage({
      id: "assistant-3",
      role: "assistant",
      runId: "run-2",
      content: "other run",
    }),
  ]);

  assert.equal(entries.length, 3);
  assert.equal(entries[0]?.kind, "message");
  assert.equal(entries[1]?.kind, "assistant-group");
  assert.deepEqual(
    entries[1]?.kind === "assistant-group"
      ? entries[1].sections.map((section) => section.content)
      : null,
    ["step one", "step two"]
  );
  assert.equal(entries[2]?.kind, "assistant-group");
  assert.deepEqual(
    entries[2]?.kind === "assistant-group"
      ? entries[2].sections.map((section) => section.content)
      : null,
    ["other run"]
  );
});

test("normalizeStreamingMarkdown closes an unfinished fenced code block", () => {
  assert.equal(
    normalizeStreamingMarkdown("Before\n```ts\nconst value = 1;"),
    "Before\n```ts\nconst value = 1;\n```"
  );
  assert.equal(
    normalizeStreamingMarkdown("Done\n```ts\nconst value = 1;\n```"),
    "Done\n```ts\nconst value = 1;\n```"
  );
});

test("formatElapsedDuration renders compact elapsed labels", () => {
  assert.equal(
    formatElapsedDuration(
      "2026-03-19T00:00:00.000Z",
      "2026-03-19T00:00:09.000Z"
    ),
    "9s"
  );
  assert.equal(
    formatElapsedDuration(
      "2026-03-19T00:00:00.000Z",
      "2026-03-19T00:01:09.000Z"
    ),
    "1m 09s"
  );
  assert.equal(
    formatElapsedDuration(
      "2026-03-19T00:00:00.000Z",
      "2026-03-19T02:01:09.000Z"
    ),
    "2h 01m"
  );
});

test("splitTextWithWorkspacePaths links workspace-relative files and directories", () => {
  assert.deepEqual(
    splitTextWithWorkspacePaths(
      "Open web/src/app/router.tsx then compare src/runtime/."
    ),
    [
      {
        kind: "text",
        value: "Open ",
      },
      {
        kind: "workspace-path",
        value: "web/src/app/router.tsx",
        path: "web/src/app/router.tsx",
        pathKind: "file",
      },
      {
        kind: "text",
        value: " then compare ",
      },
      {
        kind: "workspace-path",
        value: "src/runtime/",
        path: "src/runtime",
        pathKind: "directory",
      },
      {
        kind: "text",
        value: ".",
      },
    ]
  );
});

test("splitTextWithWorkspacePaths keeps unsupported or unsafe tokens as plain text", () => {
  assert.deepEqual(splitTextWithWorkspacePaths("Use n/a for missing values."), [
    {
      kind: "text",
      value: "Use n/a for missing values.",
    },
  ]);
  assert.deepEqual(
    splitTextWithWorkspacePaths(
      "Skip ../secrets.txt, /etc/passwd, and https://example.com/app.ts."
    ),
    [
      {
        kind: "text",
        value: "Skip ../secrets.txt, /etc/passwd, and https://example.com/app.ts.",
      },
    ]
  );
  assert.deepEqual(
    splitTextWithWorkspacePaths(
      "크롬 호환 쪽으로 맞추려면 H.264/AAC 또는 WebM(VP8/VP9) 쪽이 현실적입니다."
    ),
    [
      {
        kind: "text",
        value:
          "크롬 호환 쪽으로 맞추려면 H.264/AAC 또는 WebM(VP8/VP9) 쪽이 현실적입니다.",
      },
    ]
  );
});

test("splitTextWithWorkspacePaths keeps useful root dotpaths clickable without forcing file-vs-directory", () => {
  assert.deepEqual(
    splitTextWithWorkspacePaths("Check .env and ./src/account/codex-account-service.ts."),
    [
      {
        kind: "text",
        value: "Check ",
      },
      {
        kind: "workspace-path",
        value: ".env",
        path: ".env",
        pathKind: "ambiguous",
      },
      {
        kind: "text",
        value: " and ",
      },
      {
        kind: "workspace-path",
        value: "./src/account/codex-account-service.ts",
        path: "src/account/codex-account-service.ts",
        pathKind: "file",
      },
      {
        kind: "text",
        value: ".",
      },
    ]
  );
});

test("splitTextWithWorkspacePaths skips runtime-managed dependency and cache paths", () => {
  assert.deepEqual(
    splitTextWithWorkspacePaths(
      "Skip .venv, node_modules/react/index.js, and .agents/skills/demo/.venv/bin/python."
    ),
    [
      {
        kind: "text",
        value: "Skip .venv, node_modules/react/index.js, and .agents/skills/demo/.venv/bin/python.",
      },
    ]
  );
});

test("isSuppressedTranscriptArtifact hides virtualenv and bootstrap artifacts from transcript", () => {
  assert.equal(
    isSuppressedTranscriptArtifact({
      role: "workspace-venv-impala-test-lib-python3-12-site-packages-bitarray-3-8-0",
      name: "METADATA",
      contentType: "application/octet-stream",
    }),
    true
  );
  assert.equal(
    isSuppressedTranscriptArtifact({
      role: "workspace-artifact",
      name: "activate",
      contentType: "application/octet-stream",
    }),
    true
  );
  assert.equal(
    isSuppressedTranscriptArtifact({
      role: "workspace-agents-skills-impala-connection-test-skill-md",
      name: "SKILL.md",
      contentType: "text/markdown; charset=utf-8",
    }),
    false
  );
  assert.equal(
    isSuppressedTranscriptArtifact({
      role: "workspace-agents",
      name: "AGENTS.md",
      workspaceRelativePath: "AGENTS.md",
      contentType: "text/markdown; charset=utf-8",
    }),
    true
  );
  assert.equal(
    isSuppressedTranscriptArtifact({
      role: "workspace-agents-rocky-requests-dispatch-1",
      name: "dispatch-1.md",
      workspaceRelativePath: ".agents/rocky/requests/dispatch-1.md",
      contentType: "text/markdown; charset=utf-8",
    }),
    true
  );
});

test("splitTranscriptArtifacts keeps meaningful transcript artifacts and counts hidden bootstrap noise", () => {
  const split = splitTranscriptArtifacts([
    {
      kind: "file",
      role: "workspace-agents-skills-impala-connection-test-skill-md",
      name: "SKILL.md",
      contentType: "text/markdown; charset=utf-8",
      presentation: "file",
      size: 1200,
      previewable: true,
      previewUrl: "/preview/skill",
      downloadUrl: "/download/skill",
      preferredAction: "preview",
    },
    {
      kind: "file",
      role: "workspace-venv-impala-test-bin-activate",
      name: "activate",
      contentType: "application/octet-stream",
      presentation: "file",
      size: 2200,
      previewable: false,
      previewUrl: null,
      downloadUrl: "/download/activate",
      preferredAction: "download",
    },
  ]);

  assert.equal(split.hiddenArtifactCount, 1);
  assert.equal(split.visibleArtifacts.length, 1);
  assert.equal(split.visibleArtifacts[0]?.name, "SKILL.md");
});
