import assert from "node:assert/strict";
import test from "node:test";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";

test("desktop CORS mode answers renderer preflight requests", async () => {
  const previous = process.env.ROCKY_DESKTOP_CORS;
  process.env.ROCKY_DESKTOP_CORS = "1";
  const server = createAgentEngineServer();

  try {
    const response = await server.inject({
      method: "OPTIONS",
      url: "/agents",
      headers: {
        origin: "file://",
        "access-control-request-method": "GET",
      },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["access-control-allow-origin"], "file://");
    assert.match(
      String(response.headers["access-control-allow-methods"]),
      /\bGET\b/
    );
  } finally {
    await server.close();
    if (previous === undefined) {
      delete process.env.ROCKY_DESKTOP_CORS;
    } else {
      process.env.ROCKY_DESKTOP_CORS = previous;
    }
  }
});

test("desktop CORS mode leaves untrusted origins without allow-origin", async () => {
  const previous = process.env.ROCKY_DESKTOP_CORS;
  process.env.ROCKY_DESKTOP_CORS = "1";
  const server = createAgentEngineServer();

  try {
    const response = await server.inject({
      method: "GET",
      url: "/agents",
      headers: {
        origin: "https://example.com",
      },
    });

    assert.equal(response.headers["access-control-allow-origin"], undefined);
  } finally {
    await server.close();
    if (previous === undefined) {
      delete process.env.ROCKY_DESKTOP_CORS;
    } else {
      process.env.ROCKY_DESKTOP_CORS = previous;
    }
  }
});
