import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";
import {
  normalizeInstagramFeedScreenInput,
  sanitizeInstagramScreenText,
} from "../../src/connectors/instagram-feed-screener.js";

import type { ConnectorExecuteCapabilityResult } from "../../src/connectors/connector-types.js";

const CHECKED_AT = "2026-05-27T10:00:00.000Z";

test("Instagram feed screen input normalizes handles and bounds posts", () => {
  const normalized = normalizeInstagramFeedScreenInput({
    handles: ["@Rocky.AI", "https://www.instagram.com/example_handle/"],
    postsPerHandle: 999,
    browserMode: "playwright",
  });
  assert.equal(normalized.ok, true);
  if (normalized.ok) {
    assert.deepEqual(normalized.value.handles, ["rocky.ai", "example_handle"]);
    assert.equal(normalized.value.postsPerHandle, 10);
    assert.equal(normalized.value.browserMode, "playwright-public");
  }

  const tooMany = normalizeInstagramFeedScreenInput({
    handles: ["one", "two", "three", "four", "five", "six"],
  });
  assert.equal(tooMany.ok, false);
});

test("Instagram feed screening sanitizer redacts browser and token material", () => {
  const sanitized = sanitizeInstagramScreenText(
    '<script>secret()</script> bio access_token=secret sessionid=abc csrftoken=csrf Authorization: Bearer token <b>visible</b>',
  );
  assert.match(sanitized ?? "", /visible/u);
  assert.doesNotMatch(sanitized ?? "", /<script|secret|sessionid=abc|csrftoken=csrf|Bearer token/u);
});

test("instagram.feed.screen executes through connector capability with partial results", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "instagram-feed-screen-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => CHECKED_AT,
    connectorBaseEnv: {},
    connectorInstagramFeedScreener: async ({ request, now }) => ({
      provider: "instagram",
      capabilityId: "instagram.feed.screen",
      browserMode: request.browserMode,
      status: "partial",
      checkedAt: now(),
      notices: [
        "Public Instagram browser screening is read-only and separate from Instagram Graph API credentials.",
      ],
      handles: [
        {
          handle: request.handles[0] ?? "rocky",
          status: "completed",
          profileUrl: `https://www.instagram.com/${request.handles[0] ?? "rocky"}/`,
          profileTitle: "Rocky (@rocky)",
          bio: "Sanitized bio",
          followerText: "1,234 followers",
          recentPostUrls: ["https://www.instagram.com/p/abc/"],
          posts: [
            {
              url: "https://www.instagram.com/p/abc/",
              status: "completed",
              caption: "caption",
              metaDescription: "meta caption",
              visibleEngagementText: "10 likes",
              error: null,
            },
          ],
          error: null,
        },
        {
          handle: request.handles[1] ?? "missing",
          status: "failed",
          profileUrl: `https://www.instagram.com/${request.handles[1] ?? "missing"}/`,
          profileTitle: null,
          bio: null,
          followerText: null,
          recentPostUrls: [],
          posts: [],
          error: "Profile unavailable",
        },
      ],
    }),
  });

  try {
    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/instagram/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    assert.equal(
      stateResponse.json().capabilities.some(
        (capability: { id: string; status: string; requiresConnectedAccount: boolean }) =>
          capability.id === "instagram.feed.screen" &&
          capability.status === "available" &&
          capability.requiresConnectedAccount === false,
      ),
      true,
    );

    const response = await server.inject({
      method: "POST",
      url: "/connectors/instagram/capabilities/instagram.feed.screen/execute",
      payload: {
        args: {
          handles: ["@rocky", "missing"],
          postsPerHandle: 2,
          browserMode: "playwright-public",
        },
      },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json<ConnectorExecuteCapabilityResult>();
    assert.equal(body.ok, true);
    assert.equal(body.status, "completed");
    assert.equal(body.resultType, "none");
    assert.equal(body.data?.status, "partial");
    assert.equal((body.data?.handles as Array<{ status: string }>)[1]?.status, "failed");
    assert.doesNotMatch(JSON.stringify(body), /access_token|sessionid|csrftoken/u);
  } finally {
    await server.close();
  }
});

test("instagram.feed.screen models chrome assist as planned without Graph API semantics", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "instagram-feed-screen-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => CHECKED_AT,
    connectorBaseEnv: {},
  });

  try {
    const response = await server.inject({
      method: "POST",
      url: "/connectors/instagram/capabilities/instagram.feed.screen/execute",
      payload: {
        args: {
          handles: ["rocky"],
          browserMode: "chrome-assist",
        },
      },
    });
    assert.equal(response.statusCode, 409);
    const body = response.json<ConnectorExecuteCapabilityResult>();
    assert.equal(body.ok, false);
    assert.equal(body.status, "unsupported");
    assert.equal(body.data?.browserMode, "chrome-assist");
    assert.match(body.message, /separately from Instagram Graph API/u);
  } finally {
    await server.close();
  }
});
