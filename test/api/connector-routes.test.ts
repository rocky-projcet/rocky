import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";

import type { ConnectorState } from "../../src/connectors/connector-types.js";

test("connector OAuth opens authorization URL and connects only after callback token exchange", async () => {
  const openedUrls: string[] = [];
  const tokenBodies: URLSearchParams[] = [];
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-09T12:42:00.000Z",
    connectorBaseEnv: {
      ROCKY_CONNECTOR_OAUTH_BASE_URL: "http://127.0.0.1:3000",
      ROCKY_CONNECTOR_YOUTUBE_CLIENT_ID: "youtube-client",
      ROCKY_CONNECTOR_YOUTUBE_CLIENT_SECRET: "youtube-secret",
    },
    nativeUrlOpener: async (url) => {
      openedUrls.push(url);
      return {
        status: "opened",
        application: "default browser",
        url,
        platform: "test",
        kind: "url",
      };
    },
    connectorFetch: async (input, init) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        assert.equal(init?.method, "POST");
        const body = init?.body as URLSearchParams;
        tokenBodies.push(body);
        return jsonResponse({
          access_token: "youtube-access-token",
          refresh_token: "youtube-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      if (url.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) {
        assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer youtube-access-token");
        return jsonResponse({
          email: "creator@example.com",
          name: "Creator",
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  });

  try {
    const loginResponse = await server.inject({
      method: "POST",
      url: "/connectors/youtube/login",
      headers: {
        host: "127.0.0.1:3000",
      },
    });
    assert.equal(loginResponse.statusCode, 202);
    const loginBody = loginResponse.json<ConnectorState>();
    assert.equal(loginBody.status, "connecting");
    assert.equal(loginBody.loginMode, "oauth");
    assert.match(loginBody.loginUrl ?? "", /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
    assert.deepEqual(openedUrls, [loginBody.loginUrl]);

    const authUrl = new URL(loginBody.loginUrl ?? "");
    assert.equal(authUrl.searchParams.get("client_id"), "youtube-client");
    assert.equal(
      authUrl.searchParams.get("redirect_uri"),
      "http://127.0.0.1:3000/connectors/youtube/oauth/callback",
    );
    assert.equal(authUrl.searchParams.get("response_type"), "code");
    assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
    const oauthState = authUrl.searchParams.get("state");
    assert.ok(oauthState);

    const callbackResponse = await server.inject({
      method: "GET",
      url: `/connectors/youtube/oauth/callback?state=${encodeURIComponent(oauthState)}&code=auth-code`,
    });
    assert.equal(callbackResponse.statusCode, 200);
    assert.match(callbackResponse.body, /OAuth 연동 완료/);
    assert.equal(tokenBodies.length, 1);
    assert.equal(tokenBodies[0]?.get("code"), "auth-code");
    assert.equal(tokenBodies[0]?.get("client_id"), "youtube-client");
    assert.equal(
      tokenBodies[0]?.get("redirect_uri"),
      "http://127.0.0.1:3000/connectors/youtube/oauth/callback",
    );
    assert.ok(tokenBodies[0]?.get("code_verifier"));

    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/youtube/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const stateBody = stateResponse.json<ConnectorState>();
    assert.equal(stateBody.status, "connected");
    assert.equal(stateBody.accountLabel, "creator@example.com");
    assert.equal(stateBody.connectedAt, "2026-05-09T12:42:00.000Z");
    assert.equal(stateBody.loginUrl, null);
    assert.equal(stateBody.loginMode, "oauth");
  } finally {
    await server.close();
  }

  const restoredServer = createAgentEngineServer({
    stateRoot,
    nativeUrlOpener: async (url) => ({
      status: "opened",
      application: "default browser",
      url,
      platform: "test",
      kind: "url",
    }),
  });
  try {
    const stateResponse = await restoredServer.inject({
      method: "GET",
      url: "/connectors/youtube/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const restoredBody = stateResponse.json<ConnectorState>();
    assert.equal(restoredBody.status, "connected");
    assert.equal(restoredBody.accountLabel, "creator@example.com");
    assert.equal(restoredBody.loginMode, "oauth");
  } finally {
    await restoredServer.close();
  }
});

test("connector OAuth reports missing app credentials without marking connected", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    connectorBaseEnv: {},
    nativeUrlOpener: async () => {
      throw new Error("should not open");
    },
  });

  try {
    const response = await server.inject({
      method: "POST",
      url: "/connectors/instagram/login",
    });
    assert.equal(response.statusCode, 202);
    const body = response.json<ConnectorState>();
    assert.equal(body.status, "failed");
    assert.equal(body.loginMode, null);
    assert.equal(body.accountLabel, null);
    assert.match(body.lastError ?? "", /ROCKY_CONNECTOR_INSTAGRAM_CLIENT_ID/);
    assert.match(body.lastError ?? "", /ROCKY_CONNECTOR_INSTAGRAM_CLIENT_SECRET/);
  } finally {
    await server.close();
  }
});

test("connector OAuth blocks providers whose official API is no longer supported", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    connectorBaseEnv: {
      ROCKY_CONNECTOR_TISTORY_CLIENT_ID: "tistory-client",
      ROCKY_CONNECTOR_TISTORY_CLIENT_SECRET: "tistory-secret",
    },
    nativeUrlOpener: async () => {
      throw new Error("should not open");
    },
  });

  try {
    const response = await server.inject({
      method: "POST",
      url: "/connectors/tistory/login",
    });
    assert.equal(response.statusCode, 202);
    const body = response.json<ConnectorState>();
    assert.equal(body.status, "failed");
    assert.equal(body.loginMode, null);
    assert.match(body.lastError ?? "", /종료/);
  } finally {
    await server.close();
  }
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
