import test from "node:test";
import assert from "node:assert/strict";

import { hasAvailableInstagramPublishCapability } from "../../web/src/domains/skill/lib/instagram-publish-gate.js";
import type { ConnectorState } from "../../web/src/shared/lib/agent-engine-client.js";

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
