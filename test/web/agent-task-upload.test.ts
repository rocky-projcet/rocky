import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAgentTaskChatInput,
  buildRockyAttachmentInputs,
  normalizeTmpfilesDownloadUrl,
  shouldCreateTmpfilesPublicMediaUrls,
  uploadFileToTmpfiles,
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

test("buildRockyAttachmentInputs adds tmpfiles public URLs for media files only when requested", async () => {
  const attachments = await buildRockyAttachmentInputs(
    [
      file({ name: "feed.png", type: "image/png", size: 14 }),
      file({ name: "notes.txt", type: "text/plain", size: 22 }),
    ],
    async (inputFile) => Buffer.from(`body:${inputFile.name}`).toString("base64"),
    {
      createPublicMediaUrls: true,
      uploadPublicMediaFile: async (inputFile) =>
        `https://tmpfiles.org/dl/uploaded/${inputFile.name}`,
    }
  );

  assert.deepEqual(attachments, [
    {
      name: "feed.png",
      contentType: "image/png",
      size: 14,
      contentBase64: Buffer.from("body:feed.png").toString("base64"),
      publicUrl: "https://tmpfiles.org/dl/uploaded/feed.png",
    },
    {
      name: "notes.txt",
      contentType: "text/plain",
      size: 22,
      contentBase64: Buffer.from("body:notes.txt").toString("base64"),
    },
  ]);
});

test("uploadFileToTmpfiles returns a direct tmpfiles download URL", async () => {
  const uploadedUrl = await uploadFileToTmpfiles(
    new File(["png"], "feed.png", { type: "image/png" }),
    async (url, init) => {
      assert.equal(url, "https://tmpfiles.org/api/v1/upload");
      assert.equal(init?.method, "POST");
      assert.ok(init?.body instanceof FormData);
      return new Response(
        JSON.stringify({
          status: "success",
          data: { url: "https://tmpfiles.org/uploaded/feed.png" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }
  );

  assert.equal(uploadedUrl, "https://tmpfiles.org/dl/uploaded/feed.png");
});

test("normalizeTmpfilesDownloadUrl leaves existing direct links unchanged", () => {
  assert.equal(
    normalizeTmpfilesDownloadUrl("https://tmpfiles.org/dl/uploaded/feed.png"),
    "https://tmpfiles.org/dl/uploaded/feed.png"
  );
});

test("shouldCreateTmpfilesPublicMediaUrls requires Instagram publish intent", () => {
  assert.equal(
    shouldCreateTmpfilesPublicMediaUrls({
      message: "인스타그램 피드에 이 이미지를 게시해줘",
    }),
    true
  );
  assert.equal(
    shouldCreateTmpfilesPublicMediaUrls({
      message: "첨부 이미지를 분석해줘",
    }),
    false
  );
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

test("buildAgentTaskChatInput can attach public media URLs", async () => {
  const input = await buildAgentTaskChatInput({
    agentId: "agent-1",
    message: "Post this image to Instagram.",
    skillId: "md-content-instagram",
    files: [file({ name: "feed.png", type: "image/png", size: 22 })],
    encodeFile: async () => "cG5n",
    createPublicMediaUrls: true,
    uploadPublicMediaFile: async () => "https://tmpfiles.org/dl/uploaded/feed.png",
  });

  assert.deepEqual(input, {
    message: "Post this image to Instagram.",
    agentId: "agent-1",
    skillId: "md-content-instagram",
    attachments: [
      {
        name: "feed.png",
        contentType: "image/png",
        size: 22,
        contentBase64: "cG5n",
        publicUrl: "https://tmpfiles.org/dl/uploaded/feed.png",
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
