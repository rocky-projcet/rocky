import test from "node:test";
import assert from "node:assert/strict";

import { hasAvailableInstagramPublishCapability } from "../../web/src/domains/skill/lib/instagram-publish-gate.js";
import {
  AgentEngineClient,
  type ConnectorState,
} from "../../web/src/shared/lib/agent-engine-client.js";

function connectorStateWithCapability(input: {
  status: "available" | "blocked" | "planned";
  requiresApproval: boolean;
}): ConnectorState {
  return {
    capabilities: [
      {
        id: "instagram.media.publish",
        provider: "instagram",
        label: "Media publish",
        description: "Publish approved Instagram media.",
        action: "write",
        requiresBrowser: false,
        requiresConnectedAccount: true,
        requiresApproval: input.requiresApproval,
        status: input.status,
      },
    ],
  } as ConnectorState;
}

test("Instagram publish gate opens only for available approval-gated publish capability", () => {
  assert.equal(
    hasAvailableInstagramPublishCapability(
      connectorStateWithCapability({
        status: "available",
        requiresApproval: true,
      }),
    ),
    true,
  );
  assert.equal(
    hasAvailableInstagramPublishCapability(
      connectorStateWithCapability({
        status: "blocked",
        requiresApproval: true,
      }),
    ),
    false,
  );
  assert.equal(
    hasAvailableInstagramPublishCapability(
      connectorStateWithCapability({
        status: "available",
        requiresApproval: false,
      }),
    ),
    false,
  );
  assert.equal(hasAvailableInstagramPublishCapability(null), false);
});

test("AgentEngineClient sends Instagram publish approvals through the server endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{
    url: string;
    method: string | undefined;
    body: BodyInit | null | undefined;
  }> = [];
  globalThis.fetch = (async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    requests.push({ url, method: init?.method, body: init?.body });
    return new Response(
      JSON.stringify({
        provider: "instagram",
        status: "published",
        publishType: "feed",
        targetAccountLabel: "@rocky.agent.kr",
        permalink: "https://www.instagram.com/p/rocky/",
        publishedAt: "2026-04-21T00:00:10+0000",
        message: "Instagram publish completed.",
        approvedAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:10.000Z",
        completedAt: "2026-04-21T00:00:10.000Z",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const client = new AgentEngineClient("https://rocky.local/api/");
    const result = await client.approveInstagramPublishDraft("chat with spaces");

    assert.deepEqual(requests, [
      {
        url: "https://rocky.local/api/rocky/chats/chat%20with%20spaces/instagram/publish/approve",
        method: "POST",
        body: undefined,
      },
    ]);
    assert.equal(result.status, "published");
    assert.equal(result.permalink, "https://www.instagram.com/p/rocky/");
    assert.doesNotMatch(
      JSON.stringify(result),
      /tmpfiles[.]org|instagram[.]media[.]|creation-|media-/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
