import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAgentTaskChatInput,
  buildRockyAttachmentInputs,
} from "../../web/src/domains/agent/lib/agent-task-upload.js";

function file(overrides: Partial<File> = {}): File {
  return {
    name: overrides.name ?? "sales.csv",
    type: overrides.type ?? "text/csv",
    size: overrides.size ?? 18,
  } as File;
}

test("buildRockyAttachmentInputs encodes selected files for Rocky chat uploads", async () => {
  const attachments = await buildRockyAttachmentInputs(
    [file({ name: "sales.csv", type: "text/csv", size: 14 })],
    async (inputFile) => Buffer.from(`body:${inputFile.name}`).toString("base64")
  );

  assert.deepEqual(attachments, [
    {
      name: "sales.csv",
      contentType: "text/csv",
      size: 14,
      contentBase64: Buffer.from("body:sales.csv").toString("base64"),
    },
  ]);
});

test("buildAgentTaskChatInput includes agent, skill, and attachment payloads", async () => {
  const input = await buildAgentTaskChatInput({
    agentId: "agent-1",
    message: "Analyze the uploaded sales file.",
    skillId: "md-data-sales",
    files: [file({ name: "sales.csv", type: "", size: 22 })],
    encodeFile: async () => "c2t1LHNhbGVzCkEsMTAK",
  });

  assert.deepEqual(input, {
    message: "Analyze the uploaded sales file.",
    agentId: "agent-1",
    skillId: "md-data-sales",
    attachments: [
      {
        name: "sales.csv",
        contentType: null,
        size: 22,
        contentBase64: "c2t1LHNhbGVzCkEsMTAK",
      },
    ],
  });
});

test("buildAgentTaskChatInput omits attachments when no files are selected", async () => {
  const input = await buildAgentTaskChatInput({
    agentId: "agent-1",
    message: "Run without files.",
    skillId: null,
    files: [],
  });

  assert.deepEqual(input, {
    message: "Run without files.",
    agentId: "agent-1",
    skillId: null,
  });
});
