import test from "node:test";
import assert from "node:assert/strict";

import {
  instagramPublishApprovalMessage,
  instagramPublishApprovalStatusLabel,
} from "../../web/src/domains/rocky/lib/instagram-publish-approval.js";
import type { RockyInstagramPublishApprovalRecord } from "../../web/src/shared/lib/agent-engine-client.js";

function approval(
  status: RockyInstagramPublishApprovalRecord["status"],
  message: string,
): RockyInstagramPublishApprovalRecord {
  return {
    provider: "instagram",
    status,
    publishType: "feed",
    targetAccountLabel: "@rocky.agent.kr",
    permalink: null,
    publishedAt: null,
    message,
    approvedAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z",
    completedAt: "2026-04-21T00:00:00.000Z",
  };
}

test("Instagram publish approval UI labels retry and verification states", () => {
  assert.equal(instagramPublishApprovalStatusLabel("publish_failed"), "재시도 가능");
  assert.equal(instagramPublishApprovalStatusLabel("verification_required"), "상태 확인 필요");
  assert.equal(instagramPublishApprovalStatusLabel("already_published"), "이미 발행됨");
});

test("Instagram publish approval UI redacts raw failure internals", () => {
  const message = instagramPublishApprovalMessage(
    approval(
      "verification_required",
      "Status verification failed at https://graph.instagram.com/v22.0/media-123?access_token=secret with https://tmpfiles.org/dl/raw/feed.png in C:/tmp/agent-workspaces/a/workspace/outputs/chat/instagram-publish-request.json Bearer token",
    ),
  );

  assert.match(message, /상태|Status/u);
  assert.doesNotMatch(
    message,
    /graph[.]instagram[.]com|tmpfiles[.]org|access_token=secret|Bearer token|agent-workspaces|instagram-publish-request[.]json|media-123/u,
  );
});
