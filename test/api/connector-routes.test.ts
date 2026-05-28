import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";

import type {
  ConnectorExecuteCapabilityResult,
  ConnectorState,
} from "../../src/connectors/connector-types.js";
import type { ConnectorRunnerEvent } from "../../src/connectors/connector-runner.js";

const INSTAGRAM_GRAPH_ENV = {
  ROCKY_CONNECTOR_INSTAGRAM_ACCOUNT_KIND: "professional_business",
  ROCKY_CONNECTOR_INSTAGRAM_GRAPH_ACCESS_TOKEN: "instagram-graph-secret",
  ROCKY_CONNECTOR_INSTAGRAM_BUSINESS_ACCOUNT_ID: "17841400000000000",
  ROCKY_CONNECTOR_INSTAGRAM_FACEBOOK_PAGE_ID: "112233445566",
  ROCKY_CONNECTOR_INSTAGRAM_META_BUSINESS_ID: "998877665544",
  ROCKY_CONNECTOR_INSTAGRAM_META_APP_ID: "123456789",
  ROCKY_CONNECTOR_INSTAGRAM_GRAPH_PERMISSIONS:
    "instagram_basic,pages_show_list,instagram_content_publish,instagram_manage_insights",
};

test("Facebook connector browser login connects without OAuth credentials", async () => {
  let onEvent: ((event: ConnectorRunnerEvent) => void) | null = null;
  let profileReaderCalls = 0;
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-09T12:42:00.000Z",
    connectorBaseEnv: {},
    connectorBrowserDetector: async () => ({
      available: true,
      channel: "chrome",
      message: "Chrome available",
    }),
    connectorBrowserLoginStarter: async (input) => {
      assert.equal(input.adapter.provider, "facebook");
      assert.equal(input.adapter.loginUrl, "https://www.facebook.com/login");
      assert.equal(input.channel, "chrome");
      assert.equal(
        input.userDataDir,
        path.join(stateRoot, "connectors", "facebook", "browser-profile"),
      );
      onEvent = input.onEvent;
      return {
        cancel: async () => {},
      };
    },
    connectorBrowserProfileReader: async (input) => {
      profileReaderCalls += 1;
      assert.equal(input.provider, "facebook");
      assert.equal(input.accountLabel, "Facebook account");
      assert.equal(input.channel, "chrome");
      return {
        ok: true,
        provider: "facebook",
        status: "profile-read",
        accountLabel: input.accountLabel,
        profile: {
          id: "1234567890",
          username: "rocky.facebook",
          displayName: "Rocky Facebook",
          bio: "Facebook connector test profile",
          followersText: null,
          url: "https://www.facebook.com/rocky.facebook",
          rawText: null,
        },
        message: "Facebook profile read from the connected browser session.",
        checkedAt: input.now(),
      };
    },
    nativeUrlOpener: async () => {
      throw new Error("should not open OAuth URL");
    },
  });

  try {
    const loginResponse = await server.inject({
      method: "POST",
      url: "/connectors/facebook/login",
    });
    assert.equal(loginResponse.statusCode, 202);
    const loginBody = loginResponse.json<ConnectorState>();
    assert.equal(loginBody.status, "connecting");
    assert.equal(loginBody.loginMode, "custom-browser");
    assert.equal(loginBody.loginUrl, null);
    assert.equal(loginBody.failureKind, null);
    assert.ok(onEvent);

    onEvent({
      kind: "connected",
      accountLabel: "Facebook account",
      storageStateJson: JSON.stringify({
        cookies: [{ name: "c_user", value: "facebook-session-secret" }],
        origins: [],
      }),
    });

    const connected = await waitForConnectorState(
      server,
      "facebook",
      (state) => state.status === "connected",
    );
    assert.equal(connected.accountLabel, "Facebook account");
    assert.equal(connected.connectedAt, "2026-05-09T12:42:00.000Z");
    assert.equal(connected.loginMode, "custom-browser");
    assert.equal(connected.browserAccess.status, "granted");
    assert.ok(
      connected.capabilities.some(
        (capability) =>
          capability.id === "facebook.profile.read" &&
          capability.action === "read" &&
          capability.requiresApproval === false,
      ),
    );

    const profileResponse = await server.inject({
      method: "GET",
      url: "/connectors/facebook/profile",
    });
    assert.equal(profileResponse.statusCode, 200);
    const profileBody = profileResponse.json();
    assert.equal(profileBody.ok, true);
    assert.equal(profileBody.profile.displayName, "Rocky Facebook");

    const executeProfileResponse = await server.inject({
      method: "POST",
      url: "/connectors/facebook/capabilities/facebook.profile.read/execute",
    });
    assert.equal(executeProfileResponse.statusCode, 200);
    const executeProfileBody = executeProfileResponse.json();
    assert.equal(executeProfileBody.ok, true);
    assert.equal(executeProfileBody.resultType, "profile");
    assert.equal(executeProfileBody.profile.username, "rocky.facebook");
    assert.equal(profileReaderCalls, 2);

    const executeWriteResponse = await server.inject({
      method: "POST",
      url: "/connectors/facebook/capabilities/facebook.content.write/execute",
    });
    assert.equal(executeWriteResponse.statusCode, 409);
    const executeWriteBody = executeWriteResponse.json();
    assert.equal(executeWriteBody.ok, false);
    assert.equal(executeWriteBody.status, "requires-approval");
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
      url: "/connectors/facebook/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const restoredBody = stateResponse.json<ConnectorState>();
    assert.equal(restoredBody.status, "connected");
    assert.equal(restoredBody.accountLabel, "Facebook account");
    assert.equal(restoredBody.loginMode, "custom-browser");
  } finally {
    await restoredServer.close();
  }

  const sessionFile = await readFile(
    path.join(stateRoot, "connectors", "facebook", "browser-session.json"),
    "utf8",
  );
  assert.match(sessionFile, /"algorithm": "aes-256-gcm"/);
  assert.doesNotMatch(sessionFile, /facebook-session-secret|storageStateJson|browser-profile/u);
});

test("planned OAuth connectors ignore missing app credentials without marking failed", async () => {
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
      url: "/connectors/linkedin/login",
    });
    assert.equal(response.statusCode, 202);
    const body = response.json<ConnectorState>();
    assert.equal(body.status, "planned");
    assert.equal(body.loginMode, null);
    assert.equal(body.accountLabel, null);
    assert.equal(body.lastError, null);
    assert.equal(body.failureKind, null);
  } finally {
    await server.close();
  }
});

test("planned connectors stay in preparation state instead of starting OAuth", async () => {
  let opened = false;
  let fetched = false;
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    connectorBaseEnv: {
      ROCKY_CONNECTOR_OAUTH_BASE_URL: "http://127.0.0.1:3000",
      ROCKY_CONNECTOR_YOUTUBE_CLIENT_ID: "youtube-client",
      ROCKY_CONNECTOR_YOUTUBE_CLIENT_SECRET: "youtube-secret",
    },
    nativeUrlOpener: async () => {
      opened = true;
      throw new Error("should not open");
    },
    connectorFetch: async () => {
      fetched = true;
      throw new Error("should not fetch");
    },
  });

  try {
    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/youtube/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const initialState = stateResponse.json<ConnectorState>();
    assert.equal(initialState.status, "planned");
    assert.equal(initialState.loginMode, null);
    assert.equal(initialState.accountLabel, null);
    assert.equal(initialState.browserAccess.status, "unavailable");
    assert.ok(initialState.capabilities.every((capability) => capability.status === "planned"));

    const loginResponse = await server.inject({
      method: "POST",
      url: "/connectors/youtube/login",
    });
    assert.equal(loginResponse.statusCode, 202);
    const loginBody = loginResponse.json<ConnectorState>();
    assert.equal(loginBody.status, "planned");
    assert.equal(loginBody.loginUrl, null);
    assert.equal(loginBody.loginMode, null);
    assert.equal(opened, false);
    assert.equal(fetched, false);
  } finally {
    await server.close();
  }
});

test("Instagram connector exposes Graph API onboarding blockers", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    connectorBaseEnv: {},
  });

  try {
    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/instagram/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const state = stateResponse.json<ConnectorState>();
    assert.equal(state.readiness.setupMode, "graph-api");
    assert.equal(state.readiness.accountKind, "unknown");
    assert.equal(state.readiness.browserSessionPurpose, "readiness_check");
    assert.ok(
      state.readiness.blockers.some(
        (blocker) => blocker.code === "professional_account_required",
      ),
    );
    assert.ok(
      state.readiness.blockers.some(
        (blocker) => blocker.code === "access_token_missing",
      ),
    );

    const accountRead = state.capabilities.find(
      (capability) => capability.id === "instagram.account.read",
    );
    assert.equal(accountRead?.status, "blocked");
    assert.ok(
      accountRead?.blockerCodes?.includes("professional_account_required"),
    );

    const mediaPublish = state.capabilities.find(
      (capability) => capability.id === "instagram.media.publish",
    );
    assert.equal(mediaPublish?.status, "blocked");
    assert.ok(
      mediaPublish?.blockerCodes?.includes("access_token_missing"),
    );

    const blockedExecuteResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/capabilities/instagram.account.read/execute",
    });
    assert.equal(blockedExecuteResponse.statusCode, 409);
    const blockedExecuteBody =
      blockedExecuteResponse.json<ConnectorExecuteCapabilityResult>();
    assert.equal(blockedExecuteBody.ok, false);
    assert.equal(blockedExecuteBody.status, "failed");
    assert.match(
      blockedExecuteBody.message,
      /professional_account_required/u,
    );
  } finally {
    await server.close();
  }
});

test("Instagram Graph API readiness becomes available from configured environment", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    connectorBaseEnv: {
      ROCKY_INSTAGRAM_ACCOUNT_KIND: "professional_business",
      ROCKY_INSTAGRAM_FACEBOOK_PAGE_ID: "page-123",
      ROCKY_INSTAGRAM_META_BUSINESS_ID: "business-123",
      ROCKY_INSTAGRAM_META_APP_ID: "app-123",
      ROCKY_INSTAGRAM_ACCESS_TOKEN: "secret-token",
      ROCKY_INSTAGRAM_BUSINESS_ACCOUNT_ID: "ig-123",
      ROCKY_INSTAGRAM_PERMISSIONS:
        "instagram_basic,pages_show_list,instagram_content_publish,instagram_manage_insights",
    },
  });

  try {
    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/instagram/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const state = stateResponse.json<ConnectorState>();
    assert.deepEqual(state.readiness.blockers, []);
    assert.equal(state.readiness.accountKind, "professional_business");
    assert.equal(
      state.capabilities.find(
        (capability) => capability.id === "instagram.account.read",
      )?.status,
      "available",
    );
    assert.equal(
      state.capabilities.find(
        (capability) => capability.id === "instagram.media.prepare",
      )?.status,
      "available",
    );
    assert.equal(
      state.capabilities.find(
        (capability) => capability.id === "instagram.insights.read",
      )?.status,
      "available",
    );

    const accountReadResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/capabilities/instagram.account.read/execute",
    });
    assert.equal(accountReadResponse.statusCode, 200);
    const accountReadBody =
      accountReadResponse.json<ConnectorExecuteCapabilityResult>();
    assert.equal(accountReadBody.ok, true);
    assert.equal(accountReadBody.status, "completed");
    assert.match(accountReadBody.message, /professional_business/u);

    const prepareResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/capabilities/instagram.media.prepare/execute",
    });
    assert.equal(prepareResponse.statusCode, 409);
    const prepareBody =
      prepareResponse.json<ConnectorExecuteCapabilityResult>();
    assert.equal(prepareBody.status, "requires-approval");
  } finally {
    await server.close();
  }
});

test("Instagram connector accepts OAuth client id as Meta app readiness", async () => {
  const {
    ROCKY_CONNECTOR_INSTAGRAM_META_APP_ID: _metaAppId,
    ...graphEnvWithoutMetaAppId
  } = INSTAGRAM_GRAPH_ENV;
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    connectorBaseEnv: {
      ...graphEnvWithoutMetaAppId,
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_ID: "meta-client-id",
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_SECRET: "meta-client-secret",
    },
  });

  try {
    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/instagram/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const state = stateResponse.json<ConnectorState>();
    assert.equal(
      state.readiness.blockers.some(
        (blocker) => blocker.code === "meta_app_required",
      ),
      false,
    );
  } finally {
    await server.close();
  }
});

test("Instagram Graph discovery starts a dedicated Meta OAuth flow", async () => {
  let openedUrl: string | null = null;
  let browserStarted = false;
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    connectorBaseEnv: {
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_ID: "meta-client-id",
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_SECRET: "meta-client-secret",
      ROCKY_CONNECTOR_OAUTH_BASE_URL: "http://127.0.0.1:3333",
    },
    nativeUrlOpener: async (url) => {
      openedUrl = url;
      return {
        status: "opened",
        application: "default browser",
        url,
        platform: "test",
        kind: "url",
      };
    },
    connectorBrowserLoginStarter: async () => {
      browserStarted = true;
      throw new Error("Graph discovery must not launch browser assist");
    },
  });

  try {
    const response = await server.inject({
      method: "POST",
      url: "/connectors/instagram/graph-discovery",
    });
    assert.equal(response.statusCode, 202);
    const state = response.json<ConnectorState>();
    assert.equal(state.status, "connecting");
    assert.equal(state.loginMode, "oauth");
    assert.equal(state.graphDiscovery?.status, "not-started");
    assert.equal(browserStarted, false);
    assert.equal(openedUrl, state.loginUrl);
    assert.ok(state.loginUrl);
    const loginUrl = new URL(state.loginUrl ?? "");
    assert.equal(loginUrl.hostname, "www.instagram.com");
    assert.equal(loginUrl.searchParams.get("client_id"), "meta-client-id");
    assert.match(
      loginUrl.searchParams.get("redirect_uri") ?? "",
      /\/connectors\/instagram\/graph\/oauth\/callback$/u,
    );
    assert.equal(
      loginUrl.searchParams.get("scope"),
      "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
    );
    assert.equal(loginUrl.searchParams.get("enable_fb_login"), "0");
    assert.doesNotMatch(state.loginUrl ?? "", /meta-client-secret/u);
  } finally {
    await server.close();
  }
});

test("Instagram Graph discovery can defer OAuth URL opening to the current browser", async () => {
  let opened = false;
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    connectorBaseEnv: {
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_ID: "meta-client-id",
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_SECRET: "meta-client-secret",
      ROCKY_CONNECTOR_OAUTH_BASE_URL: "http://127.0.0.1:3333",
    },
    nativeUrlOpener: async () => {
      opened = true;
      throw new Error("Graph discovery should not open the OS default browser");
    },
  });

  try {
    const response = await server.inject({
      method: "POST",
      url: "/connectors/instagram/graph-discovery",
      payload: {
        openExternal: false,
      },
    });
    assert.equal(response.statusCode, 202);
    const state = response.json<ConnectorState>();
    assert.equal(state.status, "connecting");
    assert.equal(state.loginMode, "oauth");
    assert.equal(opened, false);
    assert.ok(state.loginUrl);
    assert.equal(new URL(state.loginUrl ?? "").hostname, "www.instagram.com");
    assert.equal(state.lastError, null);
    assert.match(state.message, /URL is ready/u);
  } finally {
    await server.close();
  }
});

test("Instagram Graph discovery uses the default managed broker without local Meta credentials", async () => {
  let brokerStartUrl: string | null = null;
  let brokerStartBody: Record<string, unknown> | null = null;
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    connectorBaseEnv: {},
    nativeUrlOpener: async () => {
      throw new Error("Graph discovery should use the current browser in this test");
    },
    connectorFetch: async (input, init) => {
      brokerStartUrl = input instanceof URL ? input.toString() : String(input);
      brokerStartBody = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      return jsonResponse({
        ok: true,
        provider: "instagram",
        loginUrl: "https://www.instagram.com/oauth/authorize?state=broker-state",
        message: "Instagram Graph OAuth broker URL is ready.",
      });
    },
  });

  try {
    const response = await server.inject({
      method: "POST",
      url: "/connectors/instagram/graph-discovery",
      headers: {
        host: "127.0.0.1:4173",
        "x-forwarded-proto": "http",
      },
      payload: {
        openExternal: false,
      },
    });
    assert.equal(response.statusCode, 202);
    const state = response.json<ConnectorState>();
    assert.equal(state.status, "connecting");
    assert.equal(state.loginMode, "oauth");
    assert.equal(
      brokerStartUrl,
      "https://connect.blip.rocks/api/oauth-broker/instagram/graph/start",
    );
    assert.equal(
      brokerStartBody?.returnUrl,
      "http://127.0.0.1:4173/api/connectors/instagram/graph/broker/callback",
    );
    assert.equal(brokerStartBody?.brokerBaseUrl, "https://connect.blip.rocks");
    assert.equal(
      state.loginUrl,
      "https://www.instagram.com/oauth/authorize?state=broker-state",
    );
    assert.equal(
      state.readiness.blockers.some(
        (blocker) => blocker.code === "meta_app_required",
      ),
      false,
    );
  } finally {
    await server.close();
  }
});

test("Instagram Graph discovery uses an explicit broker URL override", async () => {
  let brokerStartUrl: string | null = null;
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    connectorBaseEnv: {
      ROCKY_CONNECTOR_OAUTH_BROKER_BASE_URL: "https://broker.example.test",
    },
    connectorFetch: async (input) => {
      brokerStartUrl = input instanceof URL ? input.toString() : String(input);
      return jsonResponse({
        ok: true,
        provider: "instagram",
        loginUrl: "https://www.instagram.com/oauth/authorize?state=broker-state",
        message: "Instagram Graph OAuth broker URL is ready.",
      });
    },
  });

  try {
    const response = await server.inject({
      method: "POST",
      url: "/connectors/instagram/graph-discovery",
      payload: {
        openExternal: false,
      },
    });
    assert.equal(response.statusCode, 202);
    assert.equal(
      brokerStartUrl,
      "https://broker.example.test/api/oauth-broker/instagram/graph/start",
    );
  } finally {
    await server.close();
  }
});

test("Instagram OAuth broker rejects external return URLs", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    connectorBaseEnv: {},
  });

  try {
    const response = await server.inject({
      method: "POST",
      url: "/oauth-broker/instagram/graph/start",
      payload: {
        returnUrl: "https://evil.example/callback",
      },
    });
    assert.equal(response.statusCode, 202);
    const body = response.json<{
      ok: boolean;
      loginUrl: string | null;
      message: string;
    }>();
    assert.equal(body.ok, false);
    assert.equal(body.loginUrl, null);
    assert.match(body.message, /loopback Rocky callback/u);
  } finally {
    await server.close();
  }
});

test("Instagram OAuth broker expires pending authorization state", async () => {
  let now = "2026-05-28T10:00:00.000Z";
  let tokenExchangeCalls = 0;
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => now,
    connectorBaseEnv: {
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_ID: "meta-client-id",
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_SECRET: "meta-client-secret",
      ROCKY_CONNECTOR_INSTAGRAM_BROKER_REDIRECT_URI:
        "https://connect.blip.rocks/api/oauth-broker/instagram/graph/callback",
    },
    connectorFetch: async () => {
      tokenExchangeCalls += 1;
      return jsonResponse({});
    },
  });

  try {
    const startResponse = await server.inject({
      method: "POST",
      url: "/oauth-broker/instagram/graph/start",
      payload: {
        returnUrl:
          "http://127.0.0.1:4173/api/connectors/instagram/graph/broker/callback",
      },
    });
    assert.equal(startResponse.statusCode, 202);
    const startBody = startResponse.json<{
      ok: boolean;
      loginUrl: string | null;
    }>();
    assert.equal(startBody.ok, true);
    const state = new URL(startBody.loginUrl ?? "").searchParams.get("state");
    assert.ok(state);

    now = "2026-05-28T10:10:01.000Z";
    const callbackResponse = await server.inject({
      method: "GET",
      url: `/oauth-broker/instagram/graph/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    });
    assert.equal(callbackResponse.statusCode, 400);
    assert.match(callbackResponse.body, /broker state is missing/u);
    assert.equal(tokenExchangeCalls, 0);
  } finally {
    await server.close();
  }
});

test("Instagram OAuth app settings are encrypted and used for Graph discovery", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-26T12:00:00.000Z",
    connectorBaseEnv: {},
    nativeUrlOpener: async () => {
      throw new Error("Graph discovery should use the current browser in this test");
    },
  });

  try {
    const saveResponse = await server.inject({
      method: "PUT",
      url: "/connectors/instagram/oauth-settings",
      payload: {
        clientId: "meta-client-id",
        clientSecret: "meta-client-secret",
      },
    });
    assert.equal(saveResponse.statusCode, 200);
    assert.equal(saveResponse.json().configured, true);
    assert.equal(JSON.stringify(saveResponse.json()).includes("meta-client-secret"), false);
    assert.equal(JSON.stringify(saveResponse.json()).includes("meta-client-id"), false);

    const settingsResponse = await server.inject({
      method: "GET",
      url: "/connectors/instagram/oauth-settings",
    });
    assert.equal(settingsResponse.statusCode, 200);
    assert.equal(settingsResponse.json().configured, true);
    assert.equal(JSON.stringify(settingsResponse.json()).includes("meta-client-secret"), false);
    assert.equal(JSON.stringify(settingsResponse.json()).includes("meta-client-id"), false);

    const storedFile = await readFile(
      path.join(stateRoot, "connectors", "instagram", "oauth-settings.json"),
      "utf8",
    );
    assert.equal(storedFile.includes("meta-client-secret"), false);
    assert.equal(storedFile.includes("meta-client-id"), false);

    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/instagram/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const state = stateResponse.json<ConnectorState>();
    assert.equal(
      state.readiness.blockers.some(
        (blocker) => blocker.code === "meta_app_required",
      ),
      false,
    );

    const discoveryResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/graph-discovery",
      payload: {
        openExternal: false,
      },
    });
    assert.equal(discoveryResponse.statusCode, 202);
    const discoveryState = discoveryResponse.json<ConnectorState>();
    assert.ok(discoveryState.loginUrl);
    const loginUrl = new URL(discoveryState.loginUrl ?? "");
    assert.equal(loginUrl.hostname, "www.instagram.com");
    assert.equal(loginUrl.searchParams.get("client_id"), "meta-client-id");
    assert.doesNotMatch(discoveryState.loginUrl ?? "", /meta-client-secret/u);

    const deleteResponse = await server.inject({
      method: "DELETE",
      url: "/connectors/instagram/oauth-settings",
    });
    assert.equal(deleteResponse.statusCode, 200);
    assert.equal(deleteResponse.json().configured, false);
  } finally {
    await server.close();
  }
});

test("Instagram Graph discovery reports actionable blockers when no account is discovered", async () => {
  const fetchCalls: string[] = [];
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    connectorBaseEnv: {
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_ID: "meta-client-id",
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_SECRET: "meta-client-secret",
      ROCKY_CONNECTOR_OAUTH_BASE_URL: "http://127.0.0.1:3333",
    },
    nativeUrlOpener: async (url) => ({
      status: "opened",
      application: "default browser",
      url,
      platform: "test",
      kind: "url",
    }),
    connectorFetch: async (input, init) => {
      const url = input instanceof URL ? input.toString() : String(input);
      fetchCalls.push(url);
      if (url.includes("/oauth/access_token")) {
        return jsonResponse({
          access_token: "instagram-user-token",
          token_type: "bearer",
        });
      }
      if (url.includes("/access_token")) {
        return jsonResponse({
          access_token: "instagram-long-lived-token",
          token_type: "bearer",
          expires_in: 5_184_000,
          scope:
            "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
        });
      }
      assert.equal(
        (init?.headers as Record<string, string> | undefined)?.Authorization,
        "Bearer instagram-long-lived-token",
      );
      assert.match(url, /graph\.instagram\.com\/v22\.0\/me/u);
      assert.match(url, /fields=id%2Cuser_id%2Cusername%2Cname%2Caccount_type/u);
      assert.doesNotMatch(url, /instagram-user-token/u);
      return jsonResponse({
        id: "ig-personal",
        user_id: "ig-personal",
        username: "personal_ig",
        account_type: "PERSONAL",
      });
    },
  });

  try {
    const startResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/graph-discovery",
    });
    assert.equal(startResponse.statusCode, 202);
    const started = startResponse.json<ConnectorState>();
    const state = new URL(started.loginUrl ?? "").searchParams.get("state");
    assert.ok(state);

    const callbackResponse = await server.inject({
      method: "GET",
      url: `/connectors/instagram/graph/oauth/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    });
    assert.equal(callbackResponse.statusCode, 400);

    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/instagram/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const body = stateResponse.json<ConnectorState>();
    assert.equal(body.status, "failed");
    assert.equal(body.graphDiscovery?.status, "blocked");
    assert.ok(
      body.readiness.blockers.some(
        (blocker) => blocker.code === "professional_account_required",
      ),
    );
    assert.equal(
      body.capabilities.find(
        (capability) => capability.id === "instagram.account.read",
      )?.status,
      "blocked",
    );
    assert.doesNotMatch(JSON.stringify(body), /instagram-user-token|meta-client-secret/u);
    assert.equal(fetchCalls.length, 3);
  } finally {
    await server.close();
  }
});

test("Instagram Graph discovery records app-access blockers and can retry", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    connectorBaseEnv: {
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_ID: "meta-client-id",
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_SECRET: "meta-client-secret",
      ROCKY_CONNECTOR_OAUTH_BASE_URL: "http://127.0.0.1:3333",
    },
    nativeUrlOpener: async (url) => ({
      status: "opened",
      application: "default browser",
      url,
      platform: "test",
      kind: "url",
    }),
    connectorFetch: async (input) => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url.includes("/oauth/access_token")) {
        return jsonResponse({
          access_token: "instagram-user-token",
          token_type: "bearer",
        });
      }
      if (url.includes("/access_token")) {
        return jsonResponse({
          access_token: "instagram-long-lived-token",
          token_type: "bearer",
          expires_in: 5_184_000,
          scope:
            "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
        });
      }
      return jsonResponse(
        {
          error: {
            message:
              "(#10) Application does not have permission for this action. The user must be an app tester.",
          },
        },
        403,
      );
    },
  });

  try {
    const startResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/graph-discovery",
    });
    assert.equal(startResponse.statusCode, 202);
    const started = startResponse.json<ConnectorState>();
    const state = new URL(started.loginUrl ?? "").searchParams.get("state");
    assert.ok(state);

    const callbackResponse = await server.inject({
      method: "GET",
      url: `/connectors/instagram/graph/oauth/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    });
    assert.equal(callbackResponse.statusCode, 400);

    const blockedResponse = await server.inject({
      method: "GET",
      url: "/connectors/instagram/state",
    });
    const blocked = blockedResponse.json<ConnectorState>();
    assert.equal(blocked.graphDiscovery?.status, "blocked");
    assert.ok(
      blocked.readiness.blockers.some(
        (blocker) => blocker.code === "app_access_required",
      ),
    );

    const retryResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/graph-discovery",
    });
    assert.equal(retryResponse.statusCode, 202);
    const retry = retryResponse.json<ConnectorState>();
    assert.equal(retry.status, "connecting");
    assert.equal(retry.graphDiscovery?.status, "not-started");
  } finally {
    await server.close();
  }
});

test("Instagram Graph discovery maps Korean developer-role errors to tester blockers", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    connectorBaseEnv: {
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_ID: "meta-client-id",
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_SECRET: "meta-client-secret",
      ROCKY_CONNECTOR_OAUTH_BASE_URL: "http://127.0.0.1:3333",
    },
    nativeUrlOpener: async (url) => ({
      status: "opened",
      application: "default browser",
      url,
      platform: "test",
      kind: "url",
    }),
    connectorFetch: async (input) => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url.includes("/oauth/access_token")) {
        return jsonResponse({
          access_token: "instagram-user-token",
          token_type: "bearer",
        });
      }
      if (url.includes("/access_token")) {
        return jsonResponse({
          access_token: "instagram-long-lived-token",
          token_type: "bearer",
          expires_in: 5_184_000,
          scope:
            "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
        });
      }
      return jsonResponse(
        {
          error: {
            message: "개발자 역할 권한 부족: 개발자 역할 권한이 부족합니다.",
          },
        },
        403,
      );
    },
  });

  try {
    const startResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/graph-discovery",
    });
    assert.equal(startResponse.statusCode, 202);
    const started = startResponse.json<ConnectorState>();
    const state = new URL(started.loginUrl ?? "").searchParams.get("state");
    assert.ok(state);

    const callbackResponse = await server.inject({
      method: "GET",
      url: `/connectors/instagram/graph/oauth/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    });
    assert.equal(callbackResponse.statusCode, 400);

    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/instagram/state",
    });
    const blocked = stateResponse.json<ConnectorState>();
    assert.equal(blocked.graphDiscovery?.status, "blocked");
    assert.ok(
      blocked.readiness.blockers.some(
        (blocker) =>
          blocker.code === "app_access_required" &&
          /Instagram 계정 식별자|Rocky Meta 앱/u.test(blocker.nextAction),
      ),
    );
    assert.equal(blocked.readiness.entitlement?.status, "blocked");
  } finally {
    await server.close();
  }
});

test("Instagram tester request records pending and accepted state without secrets", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-22T10:35:00.000Z",
    connectorBaseEnv: {
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_ID: "meta-client-id",
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_SECRET: "meta-client-secret",
      ROCKY_CONNECTOR_OAUTH_BASE_URL: "http://127.0.0.1:3333",
    },
    nativeUrlOpener: async (url) => ({
      status: "opened",
      application: "default browser",
      url,
      platform: "test",
      kind: "url",
    }),
    connectorFetch: async (input) => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url.includes("/oauth/access_token")) {
        return jsonResponse({
          access_token: "instagram-user-token",
          token_type: "bearer",
        });
      }
      if (url.includes("/access_token")) {
        return jsonResponse({
          access_token: "instagram-long-lived-token",
          token_type: "bearer",
          expires_in: 5_184_000,
          scope:
            "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
        });
      }
      return jsonResponse(
        {
          error: {
            message:
              "(#10) Application does not have permission for this action. The user must be an app tester.",
          },
        },
        403,
      );
    },
  });

  try {
    const startResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/graph-discovery",
    });
    const started = startResponse.json<ConnectorState>();
    const state = new URL(started.loginUrl ?? "").searchParams.get("state");
    assert.ok(state);

    const callbackResponse = await server.inject({
      method: "GET",
      url: `/connectors/instagram/graph/oauth/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    });
    assert.equal(callbackResponse.statusCode, 400);

    const requestResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/tester-request",
      payload: {
        accountIdentifier:
          "@rocky_ig access_token=secret-token /tmp/connectors/instagram/browser-profile",
      },
    });
    assert.equal(requestResponse.statusCode, 200);
    const requested = requestResponse.json<ConnectorState>();
    assert.equal(requested.testerRequest?.status, "pending");
    assert.equal(requested.readiness.entitlement?.gate, "instagram-meta-app-tester");
    assert.equal(requested.readiness.entitlement?.status, "pending");
    assert.equal(requested.readiness.entitlement?.testerRequestStatus, "pending");
    assert.equal(requested.testerRequest?.requestedAt, "2026-05-22T10:35:00.000Z");
    assert.match(requested.testerRequest?.accountIdentifier ?? "", /@rocky_ig/u);
    assert.doesNotMatch(JSON.stringify(requested), /secret-token|browser-profile/u);
    assert.ok(
      requested.readiness.blockers.some(
        (blocker) =>
          blocker.code === "app_access_required" &&
          /Rocky 운영자/u.test(blocker.nextAction),
      ),
    );

    const failedResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/tester-request",
      payload: {
        accountIdentifier: "@rocky_ig",
        status: "failed",
      },
    });
    assert.equal(failedResponse.statusCode, 200);
    const failed = failedResponse.json<ConnectorState>();
    assert.equal(failed.testerRequest?.status, "failed");
    assert.equal(failed.readiness.entitlement?.status, "blocked");
    assert.equal(failed.readiness.entitlement?.testerRequestStatus, "failed");
    assert.ok(
      failed.readiness.blockers.some(
        (blocker) =>
          blocker.code === "app_access_required" &&
          /다시 요청하거나 Rocky 운영자에게 문의/u.test(blocker.nextAction),
      ),
    );

    const acceptedResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/tester-request",
      payload: {
        accountIdentifier: "@rocky_ig",
        status: "accepted",
      },
    });
    assert.equal(acceptedResponse.statusCode, 200);
    const accepted = acceptedResponse.json<ConnectorState>();
    assert.equal(accepted.testerRequest?.status, "accepted");
    assert.equal(accepted.readiness.entitlement?.status, "pending");
    assert.equal(accepted.readiness.entitlement?.testerRequestStatus, "accepted");
    assert.ok(
      accepted.readiness.blockers.some(
        (blocker) =>
          blocker.code === "app_access_required" &&
          /OAuth를 다시 진행/u.test(blocker.nextAction),
      ),
    );
  } finally {
    await server.close();
  }

  const requestFile = await readFile(
    path.join(stateRoot, "connectors", "instagram", "tester-request.json"),
    "utf8",
  );
  assert.match(requestFile, /"status": "accepted"/u);
  assert.doesNotMatch(requestFile, /secret-token|browser-profile/u);

  const restoredServer = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-22T10:36:00.000Z",
    connectorBaseEnv: {},
  });
  try {
    const stateResponse = await restoredServer.inject({
      method: "GET",
      url: "/connectors/instagram/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const restored = stateResponse.json<ConnectorState>();
    assert.equal(restored.testerRequest?.status, "accepted");
    assert.equal(restored.readiness.entitlement?.status, "pending");
    assert.ok(
      restored.readiness.blockers.some(
        (blocker) => blocker.code === "app_access_required",
      ),
    );
  } finally {
    await restoredServer.close();
  }
});

test("Instagram Graph discovery stores a single discovered account as a safe candidate", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-22T10:30:00.000Z",
    connectorBaseEnv: {
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_ID: "meta-client-id",
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_SECRET: "meta-client-secret",
      ROCKY_CONNECTOR_OAUTH_BASE_URL: "http://127.0.0.1:3333",
      ROCKY_CONNECTOR_INSTAGRAM_BUSINESS_ACCOUNT_ID: "env-should-not-win",
      ROCKY_CONNECTOR_INSTAGRAM_ACCOUNT_LABEL: "Env account should not win",
      ROCKY_CONNECTOR_INSTAGRAM_GRAPH_PERMISSIONS:
        "instagram_basic,instagram_content_publish,instagram_manage_insights",
    },
    nativeUrlOpener: async (url) => ({
      status: "opened",
      application: "default browser",
      url,
      platform: "test",
      kind: "url",
    }),
    connectorFetch: async (input, init) => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url.includes("/oauth/access_token")) {
        return jsonResponse({
          access_token: "instagram-user-token",
          token_type: "bearer",
        });
      }
      if (url.includes("/access_token")) {
        return jsonResponse({
          access_token: "instagram-long-lived-token",
          token_type: "bearer",
          expires_in: 5_184_000,
          scope:
            "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
        });
      }
      assert.equal(
        (init?.headers as Record<string, string> | undefined)?.Authorization,
        "Bearer instagram-long-lived-token",
      );
      return jsonResponse({
        id: "app-scoped-123",
        user_id: "ig-123",
        username: "rocky_ig",
        name: "Rocky Instagram",
        account_type: "BUSINESS",
      });
    },
  });

  try {
    const acceptedRequestResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/tester-request",
      payload: {
        accountIdentifier: "@rocky_ig",
        status: "accepted",
      },
    });
    assert.equal(acceptedRequestResponse.statusCode, 200);
    assert.equal(
      acceptedRequestResponse.json<ConnectorState>().testerRequest?.status,
      "accepted",
    );

    const startResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/graph-discovery",
    });
    assert.equal(startResponse.statusCode, 202);
    const started = startResponse.json<ConnectorState>();
    const state = new URL(started.loginUrl ?? "").searchParams.get("state");
    assert.ok(state);

    const callbackResponse = await server.inject({
      method: "GET",
      url: `/connectors/instagram/graph/oauth/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    });
    assert.equal(callbackResponse.statusCode, 200);

    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/instagram/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const body = stateResponse.json<ConnectorState>();
    assert.equal(body.status, "connected");
    assert.equal(body.loginMode, "oauth");
    assert.equal(body.accountLabel, "rocky_ig");
    assert.equal(body.readiness.accountLabel, "rocky_ig");
    assert.equal(body.readiness.instagramUserId, "ig-123");
    assert.deepEqual(body.readiness.grantedScopes, [
      "instagram_business_basic",
      "instagram_business_content_publish",
      "instagram_business_manage_insights",
    ]);
    assert.equal(body.readiness.tokenStatus, "active");
    assert.equal(body.readiness.setupMode, "graph-api");
    assert.deepEqual(body.readiness.blockers, []);
    assert.equal(body.graphConnection?.source, "instagram-login-oauth");
    assert.equal(body.graphConnection?.instagramUserId, "ig-123");
    assert.equal(body.graphConnection?.token.accessTokenPresent, true);
    assert.equal(body.graphConnection?.token.status, "active");
    assert.ok(body.graphConnection?.token.expiresAt);
    assert.equal(body.testerRequest?.status, "completed");
    assert.equal(body.testerRequest?.completedAt, "2026-05-22T10:30:00.000Z");
    assert.equal(body.readiness.entitlement?.status, "allowed");
    assert.equal(body.graphDiscovery?.status, "candidate");
    assert.equal(body.graphDiscovery?.accountCount, 1);
    assert.equal(
      body.graphDiscovery?.candidate?.instagramBusinessAccountId,
      "ig-123",
    );
    assert.equal(body.graphDiscovery?.candidate?.facebookPageId, null);
    assert.equal(
      body.capabilities.find(
        (capability) => capability.id === "instagram.automation.prepare",
      )?.status,
      "available",
    );
    assert.equal(
      body.capabilities.find(
        (capability) => capability.id === "instagram.media.publish",
      )?.status,
      "available",
    );
    assert.equal(
      body.capabilities.find(
        (capability) => capability.id === "instagram.insights.read",
      )?.status,
      "available",
    );
    assert.doesNotMatch(JSON.stringify(body), /instagram-user-token|meta-client-secret/u);

    const accountResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/capabilities/instagram.account.read/execute",
    });
    assert.equal(accountResponse.statusCode, 200);
    const accountBody = accountResponse.json<ConnectorExecuteCapabilityResult>();
    assert.equal(accountBody.accountLabel, "rocky_ig");
    assert.doesNotMatch(accountBody.accountLabel ?? "", /env-should-not-win|Env/u);

    const tokenFile = await readFile(
      path.join(stateRoot, "connectors", "instagram", "oauth-token.json"),
      "utf8",
    );
    assert.match(tokenFile, /"algorithm": "aes-256-gcm"/);
    assert.match(tokenFile, /"instagramBusinessAccountId": "ig-123"/);
    assert.match(tokenFile, /"instagramUserId": "ig-123"/);
    assert.doesNotMatch(tokenFile, /instagram-user-token|meta-client-secret/u);

    const requestFile = await readFile(
      path.join(stateRoot, "connectors", "instagram", "tester-request.json"),
      "utf8",
    );
    assert.match(requestFile, /"status": "completed"/u);
    assert.doesNotMatch(requestFile, /instagram-user-token|meta-client-secret/u);
  } finally {
    await server.close();
  }
});

test("Instagram OAuth-bound readiness refreshes stale tokens", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-22T10:30:00.000Z",
    connectorBaseEnv: {
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_ID: "meta-client-id",
      ROCKY_CONNECTOR_INSTAGRAM_CLIENT_SECRET: "meta-client-secret",
      ROCKY_CONNECTOR_OAUTH_BASE_URL: "http://127.0.0.1:3333",
    },
    nativeUrlOpener: async (url) => ({
      status: "opened",
      application: "default browser",
      url,
      platform: "test",
      kind: "url",
    }),
    connectorFetch: async (input, init) => {
      const url = input instanceof URL ? input.toString() : String(input);
      if (url.includes("/oauth/access_token")) {
        return jsonResponse({
          access_token: "instagram-user-token",
          token_type: "bearer",
        });
      }
      if (url.includes("/access_token")) {
        return jsonResponse({
          access_token: "instagram-long-lived-token",
          token_type: "bearer",
          expires_in: 60,
          scope:
            "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
        });
      }
      if (url.includes("/refresh_access_token")) {
        assert.match(url, /grant_type=ig_refresh_token/u);
        return jsonResponse({
          access_token: "instagram-refreshed-token",
          token_type: "bearer",
          expires_in: 5_184_000,
          scope:
            "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
        });
      }
      assert.equal(
        (init?.headers as Record<string, string> | undefined)?.Authorization,
        "Bearer instagram-long-lived-token",
      );
      return jsonResponse({
        id: "app-scoped-123",
        user_id: "ig-123",
        username: "rocky_ig",
        account_type: "BUSINESS",
      });
    },
  });

  try {
    const startResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/graph-discovery",
    });
    const started = startResponse.json<ConnectorState>();
    const state = new URL(started.loginUrl ?? "").searchParams.get("state");
    assert.ok(state);

    const callbackResponse = await server.inject({
      method: "GET",
      url: `/connectors/instagram/graph/oauth/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    });
    assert.equal(callbackResponse.statusCode, 200);

    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/instagram/state",
    });
    const body = stateResponse.json<ConnectorState>();
    assert.equal(body.readiness.tokenStatus, "active");
    assert.deepEqual(body.readiness.blockers, []);
    assert.equal(
      body.capabilities.find(
        (capability) => capability.id === "instagram.account.read",
      )?.status,
      "available",
    );

    const accountResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/capabilities/instagram.account.read/execute",
    });
    assert.equal(accountResponse.statusCode, 200);
    const accountBody = accountResponse.json<ConnectorExecuteCapabilityResult>();
    assert.equal(accountBody.ok, true);
    assert.equal(accountBody.accountLabel, "rocky_ig");

    const tokenFile = await readFile(
      path.join(stateRoot, "connectors", "instagram", "oauth-token.json"),
      "utf8",
    );
    assert.doesNotMatch(tokenFile, /instagram-user-token|instagram-long-lived-token|instagram-refreshed-token/u);
  } finally {
    await server.close();
  }
});

test("social connector browser login connects without OAuth credentials", async () => {
  let onEvent: ((event: ConnectorRunnerEvent) => void) | null = null;
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-11T08:15:00.000Z",
    connectorBaseEnv: {},
    connectorBrowserDetector: async () => ({
      available: true,
      channel: "chrome",
      message: "Chrome available",
    }),
    connectorBrowserLoginStarter: async (input) => {
      assert.equal(input.adapter.provider, "instagram");
      assert.equal(
        input.userDataDir,
        path.join(stateRoot, "connectors", "instagram", "browser-profile"),
      );
      onEvent = input.onEvent;
      return {
        cancel: async () => {},
      };
    },
    nativeUrlOpener: async () => {
      throw new Error("should not open OAuth URL");
    },
  });

  try {
    const response = await server.inject({
      method: "POST",
      url: "/connectors/instagram/login",
    });
    assert.equal(response.statusCode, 202);
    const body = response.json<ConnectorState>();
    assert.equal(body.status, "connecting");
    assert.equal(body.loginMode, "custom-browser");
    assert.equal(body.loginUrl, null);
    assert.equal(body.failureKind, null);
    assert.ok(onEvent);

    onEvent({
      kind: "connected",
      accountLabel: "Instagram account",
      storageStateJson: JSON.stringify({
        cookies: [{ name: "sessionid", value: "instagram-session-secret" }],
        origins: [],
      }),
    });

    const connected = await waitForConnectorState(
      server,
      "instagram",
      (state) => state.status === "connected",
    );
    assert.equal(connected.accountLabel, "Instagram account");
    assert.equal(connected.connectedAt, "2026-05-11T08:15:00.000Z");
    assert.equal(connected.loginMode, "custom-browser");
    assert.equal(connected.browserAccess.status, "granted");
    assert.equal(connected.browserAccess.writeAllowedAfterApproval, false);
    assert.ok(
      connected.capabilities.some(
        (capability) =>
          capability.id === "instagram.automation.prepare" &&
          capability.action === "read" &&
          capability.status === "blocked" &&
          capability.setupMode === "graph-api" &&
          capability.blockerCodes?.includes("access_token_missing") &&
          capability.requiresApproval === false,
      ),
    );

    const readinessResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/capabilities/instagram.automation.prepare/execute",
    });
    assert.equal(readinessResponse.statusCode, 409);
    const readinessBody =
      readinessResponse.json<ConnectorExecuteCapabilityResult>();
    assert.equal(readinessBody.ok, false);
    assert.equal(readinessBody.status, "failed");
    assert.equal(readinessBody.resultType, "none");
    assert.equal(readinessBody.setupMode, "graph-api");
    assert.ok(readinessBody.blockerCodes?.includes("access_token_missing"));
    assert.match(readinessBody.message, /Graph API setup/u);
    assert.doesNotMatch(readinessBody.message, /instagram-session-secret/u);

    const sessionFile = await readFile(
      path.join(stateRoot, "connectors", "instagram", "browser-session.json"),
      "utf8",
    );
    assert.match(sessionFile, /"algorithm": "aes-256-gcm"/);
    assert.doesNotMatch(
      sessionFile,
      /instagram-session-secret|storageStateJson|browser-profile/u,
    );
  } finally {
    await server.close();
  }
});

test("Instagram native capabilities become available only with Graph API readiness", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-11T08:20:00.000Z",
    connectorBaseEnv: INSTAGRAM_GRAPH_ENV,
    connectorBrowserDetector: async () => {
      throw new Error("Graph API readiness must not launch a browser");
    },
  });

  try {
    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/instagram/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const state = stateResponse.json<ConnectorState>();
    assert.equal(state.status, "connected");
    assert.equal(state.loginMode, "oauth");
    assert.equal(state.browserAccess.status, "not-applicable");
    assert.equal(state.accountLabel, "Instagram Graph account 17841400000000000");
    assert.ok(
      state.capabilities.some(
        (capability) =>
          capability.id === "instagram.media.publish" &&
          capability.action === "write" &&
          capability.status === "available" &&
          capability.setupMode === "graph-api" &&
          capability.requiresApproval === true,
      ),
    );

    const accountResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/capabilities/instagram.account.read/execute",
    });
    assert.equal(accountResponse.statusCode, 200);
    const accountBody = accountResponse.json<ConnectorExecuteCapabilityResult>();
    assert.equal(accountBody.ok, true);
    assert.equal(accountBody.status, "completed");
    assert.equal(accountBody.setupMode, "graph-api");
    assert.match(accountBody.message, /instagram\.account\.read/u);
    assert.doesNotMatch(accountBody.message, /instagram-graph-secret/u);

    const publishResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/capabilities/instagram.media.publish/execute",
    });
    assert.equal(publishResponse.statusCode, 409);
    const publishBody = publishResponse.json<ConnectorExecuteCapabilityResult>();
    assert.equal(publishBody.status, "requires-approval");
    assert.match(publishBody.message, /preview and explicit user approval/u);
  } finally {
    await server.close();
  }
});

test("Instagram Graph media prepare and publish execute through server-managed Graph API", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const calls: Array<{ url: string; method: string; body: string }> = [];
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-11T08:25:00.000Z",
    connectorBaseEnv: INSTAGRAM_GRAPH_ENV,
    connectorFetch: async (input, init) => {
      const url = input instanceof URL ? input.toString() : String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: String(init?.body ?? ""),
      });
      if (url.endsWith("/17841400000000000/media")) {
        return new Response(JSON.stringify({ id: "creation-123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/17841400000000000/media_publish")) {
        return new Response(JSON.stringify({ id: "media-456" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: { message: "unexpected" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    },
  });

  try {
    const blockedResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/capabilities/instagram.media.prepare/execute",
      payload: {
        args: {
          imageUrl: "https://example.com/rocky-test.png",
          caption: "test",
        },
      },
    });
    assert.equal(blockedResponse.statusCode, 409);
    assert.equal(
      blockedResponse.json<ConnectorExecuteCapabilityResult>().status,
      "requires-approval",
    );
    assert.equal(calls.length, 0);

    const prepareResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/capabilities/instagram.media.prepare/execute",
      payload: {
        args: {
          approved: true,
          imageUrl: "https://example.com/rocky-test.png",
          caption: "test",
        },
      },
    });
    assert.equal(prepareResponse.statusCode, 200);
    const prepareBody =
      prepareResponse.json<ConnectorExecuteCapabilityResult>();
    assert.equal(prepareBody.ok, true);
    assert.equal(prepareBody.resultType, "media-container");
    assert.equal(prepareBody.data?.id, "creation-123");

    const publishResponse = await server.inject({
      method: "POST",
      url: "/connectors/instagram/capabilities/instagram.media.publish/execute",
      payload: {
        args: {
          approved: true,
          creationId: "creation-123",
        },
      },
    });
    assert.equal(publishResponse.statusCode, 200);
    const publishBody =
      publishResponse.json<ConnectorExecuteCapabilityResult>();
    assert.equal(publishBody.ok, true);
    assert.equal(publishBody.resultType, "media-publish");
    assert.equal(publishBody.data?.id, "media-456");
    assert.equal(calls.length, 2);
    assert.match(calls[0]?.body ?? "", /image_url=https%3A%2F%2Fexample\.com%2Frocky-test\.png/u);
    assert.match(calls[0]?.body ?? "", /caption=test/u);
    assert.match(calls[1]?.body ?? "", /creation_id=creation-123/u);
    assert.doesNotMatch(JSON.stringify(prepareBody), /instagram-graph-secret/u);
    assert.doesNotMatch(JSON.stringify(publishBody), /instagram-graph-secret/u);
  } finally {
    await server.close();
  }
});

test("connector API responses redact browser session secrets and profile paths", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const browserProfileDir = path.join(
    stateRoot,
    "connectors",
    "instagram",
    "browser-profile",
  );
  const server = createAgentEngineServer({
    stateRoot,
    connectorBaseEnv: {},
    connectorBrowserDetector: async () => ({
      available: true,
      channel: "chrome",
      message: "Chrome available",
    }),
    connectorBrowserLoginStarter: async () => {
      throw new Error(
        `Could not open ${browserProfileDir} with storageStateJson={"cookies":[{"name":"sessionid","value":"session-secret"}],"origins":[]}`,
      );
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
    assert.equal(body.failureKind, "platform");
    assert.doesNotMatch(body.lastError ?? "", /session-secret|browser-profile|storageStateJson=\{/u);
    assert.match(body.lastError ?? "", /\[redacted/);
  } finally {
    await server.close();
  }
});

test("Instagram native readiness ignores expired browser secrets and reports Graph API blockers", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  await mkdir(path.join(stateRoot, "connectors", "instagram"), { recursive: true });
  await writeFile(
    path.join(stateRoot, "connectors", "instagram", "browser-session.json"),
    JSON.stringify(
      {
        provider: "instagram",
        accountLabel: "Instagram account",
        connectedAt: "2026-05-11T08:15:00.000Z",
        storageStateJson: JSON.stringify({
          cookies: [{ name: "sessionid", value: "", domain: ".instagram.com" }],
          origins: [],
        }),
        browserProfileDir: path.join(stateRoot, "connectors", "instagram", "browser-profile"),
      },
      null,
      2,
    ),
  );
  const server = createAgentEngineServer({
    stateRoot,
    connectorBrowserDetector: async () => {
      throw new Error("should not launch browser for expired sessions");
    },
  });

  try {
    const response = await server.inject({
      method: "POST",
      url: "/connectors/instagram/capabilities/instagram.automation.prepare/execute",
    });
    assert.equal(response.statusCode, 409);
    const body = response.json<ConnectorExecuteCapabilityResult>();
    assert.equal(body.ok, false);
    assert.equal(body.status, "failed");
    assert.ok(body.blockerCodes?.includes("access_token_missing"));
    assert.match(body.message, /Graph API setup/u);
    assert.doesNotMatch(body.message, /browser-profile|sessionid/u);

    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/instagram/state",
    });
    const state = stateResponse.json<ConnectorState>();
    assert.equal(state.status, "connected");
    assert.equal(state.failureKind, null);
    assert.equal(state.accountLabel, "Instagram account");
  } finally {
    await server.close();
  }
});

test("connector custom browser login connects Threads without OAuth credentials", async () => {
  let onEvent: ((event: ConnectorRunnerEvent) => void) | null = null;
  let profileReaderCalls = 0;
  let followerReaderCalls = 0;
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-10T11:30:00.000Z",
    connectorBaseEnv: {},
    connectorBrowserDetector: async () => ({
      available: true,
      channel: "chrome",
      message: "시스템 Chrome 사용",
    }),
    connectorBrowserLoginStarter: async (input) => {
      assert.equal(input.adapter.provider, "threads");
      assert.equal(input.adapter.loginUrl, "https://www.threads.net/login");
      assert.equal(input.channel, "chrome");
      assert.equal(
        input.userDataDir,
        path.join(stateRoot, "connectors", "threads", "browser-profile"),
      );
      onEvent = input.onEvent;
      return {
        cancel: async () => {},
      };
    },
    connectorBrowserProfileReader: async (input) => {
      profileReaderCalls += 1;
      assert.equal(input.provider, "threads");
      assert.equal(input.accountLabel, "Threads 계정");
      assert.equal(input.channel, "chrome");
      return {
        ok: true,
        provider: "threads",
        status: "profile-read",
        accountLabel: input.accountLabel,
        profile: {
          id: "64342357840",
          username: "rocky_threads",
          displayName: "Rocky Threads",
          bio: "테스트 프로필",
          followersText: "팔로워 12명",
          url: "https://www.threads.net/@rocky_threads",
          rawText: null,
        },
        message: "Threads 프로필을 연결된 브라우저 세션으로 조회했습니다.",
        checkedAt: input.now(),
      };
    },
    connectorBrowserFollowerListReader: async (input) => {
      followerReaderCalls += 1;
      assert.equal(input.provider, "threads");
      assert.equal(input.accountLabel, "Threads 계정");
      assert.equal(input.channel, "chrome");
      assert.equal(input.limit, 10);
      return {
        ok: true,
        provider: "threads",
        status: "followers-read",
        accountLabel: input.accountLabel,
        followers: {
          items: [
            {
              username: "pixelberry",
              displayName: "Pixel Berry",
              profileUrl: "https://www.threads.net/@pixelberry",
              rawText: "Pixel Berry @pixelberry",
            },
          ],
          url: "https://www.threads.net/@rocky_threads/followers",
          rawText: "Pixel Berry\n@pixelberry",
        },
        message: "Threads 팔로워 1명을 연결된 브라우저 세션으로 조회했습니다.",
        checkedAt: input.now(),
      };
    },
    nativeUrlOpener: async () => {
      throw new Error("should not open OAuth URL");
    },
  });

  try {
    const response = await server.inject({
      method: "POST",
      url: "/connectors/threads/login",
    });
    assert.equal(response.statusCode, 202);
    const body = response.json<ConnectorState>();
    assert.equal(body.status, "connecting");
    assert.equal(body.loginMode, "custom-browser");
    assert.equal(body.loginUrl, null);
    assert.equal(body.lastError, null);
    assert.ok(onEvent);

    onEvent({
      kind: "connected",
      accountLabel: "Threads 계정",
      storageStateJson: JSON.stringify({
        cookies: [{ name: "sessionid", value: "session", domain: ".threads.net" }],
        origins: [],
      }),
    });

    const connected = await waitForConnectorState(
      server,
      "threads",
      (state) => state.status === "connected",
    );
    assert.equal(connected.accountLabel, "Threads 계정");
    assert.equal(connected.connectedAt, "2026-05-10T11:30:00.000Z");
    assert.equal(connected.loginMode, "custom-browser");
    assert.equal(connected.browserAccess.status, "granted");
    assert.equal(connected.browserAccess.policy, "persistent");
    assert.ok(
      connected.capabilities.some(
        (capability) =>
          capability.id === "threads.account.read" &&
          capability.action === "read" &&
          capability.requiresApproval === false,
      ),
    );
    assert.ok(
      connected.capabilities.some(
        (capability) =>
          capability.id === "threads.automation.prepare" &&
          capability.action === "read" &&
          capability.requiresBrowser === true &&
          capability.requiresApproval === false,
      ),
    );
    assert.ok(
      connected.capabilities.some(
        (capability) =>
          capability.id === "threads.content.write" &&
          capability.action === "write" &&
        capability.requiresApproval === true,
      ),
    );

    const sessionFile = await readFile(
      path.join(stateRoot, "connectors", "threads", "browser-session.json"),
      "utf8",
    );
    assert.match(sessionFile, /"algorithm": "aes-256-gcm"/);
    assert.doesNotMatch(sessionFile, /sessionid|storageStateJson|browser-profile/u);

    const profileResponse = await server.inject({
      method: "GET",
      url: "/connectors/threads/profile",
    });
    assert.equal(profileResponse.statusCode, 200);
    const profileBody = profileResponse.json();
    assert.equal(profileBody.ok, true);
    assert.equal(profileBody.profile.username, "rocky_threads");
    assert.equal(profileReaderCalls, 1);

    const executeAccountResponse = await server.inject({
      method: "POST",
      url: "/connectors/threads/capabilities/threads.account.read/execute",
    });
    assert.equal(executeAccountResponse.statusCode, 200);
    const accountBody = executeAccountResponse.json();
    assert.equal(accountBody.ok, true);
    assert.equal(accountBody.status, "completed");
    assert.equal(accountBody.accountLabel, connected.accountLabel);
    assert.equal(accountBody.resultType, "none");
    assert.equal(profileReaderCalls, 1);

    const executePrepareResponse = await server.inject({
      method: "POST",
      url: "/connectors/threads/capabilities/threads.automation.prepare/execute",
    });
    assert.equal(executePrepareResponse.statusCode, 200);
    const prepareBody = executePrepareResponse.json();
    assert.equal(prepareBody.ok, true);
    assert.equal(prepareBody.status, "completed");
    assert.equal(prepareBody.resultType, "profile");
    assert.equal(prepareBody.profile.username, "rocky_threads");
    assert.doesNotMatch(JSON.stringify(prepareBody), /sessionid|storageStateJson|browser-profile/u);
    assert.equal(profileReaderCalls, 2);

    const executeFollowersResponse = await server.inject({
      method: "POST",
      url: "/connectors/threads/capabilities/threads.followers.read/execute",
      payload: {
        args: {
          limit: 10,
        },
      },
    });
    assert.equal(executeFollowersResponse.statusCode, 200);
    const followersBody = executeFollowersResponse.json();
    assert.equal(followersBody.ok, true);
    assert.equal(followersBody.resultType, "followers");
    assert.equal(followersBody.followers.items[0].username, "pixelberry");
    assert.equal(followerReaderCalls, 1);

    const executeWriteResponse = await server.inject({
      method: "POST",
      url: "/connectors/threads/capabilities/threads.content.write/execute",
    });
    assert.equal(executeWriteResponse.statusCode, 409);
    const executeWriteBody = executeWriteResponse.json();
    assert.equal(executeWriteBody.ok, false);
    assert.equal(executeWriteBody.status, "requires-approval");
    assert.equal(profileReaderCalls, 2);
  } finally {
    await server.close();
  }
});

test("planned custom browser connectors do not start login or publish", async () => {
  let loginStarted = false;
  let publishedDraft = false;
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-09T13:20:00.000Z",
    connectorBrowserDetector: async () => ({
      available: true,
      channel: "chrome",
      message: "시스템 Chrome 사용",
    }),
    connectorBrowserLoginStarter: async () => {
      loginStarted = true;
      throw new Error("should not start");
    },
    connectorBrowserDraftPublisher: async () => {
      publishedDraft = true;
      throw new Error("should not publish");
    },
  });

  try {
    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/tistory/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const stateBody = stateResponse.json<ConnectorState>();
    assert.equal(stateBody.status, "planned");
    assert.equal(stateBody.accountLabel, null);
    assert.equal(stateBody.loginMode, null);
    assert.equal(stateBody.browserAccess.status, "unavailable");
    assert.ok(stateBody.capabilities.every((capability) => capability.status === "planned"));

    const response = await server.inject({
      method: "POST",
      url: "/connectors/tistory/login",
    });
    assert.equal(response.statusCode, 202);
    const body = response.json<ConnectorState>();
    assert.equal(body.status, "planned");
    assert.equal(body.loginMode, null);
    assert.equal(body.loginUrl, null);
    assert.equal(body.accountLabel, null);
    assert.equal(loginStarted, false);

    const publishResponse = await server.inject({
      method: "POST",
      url: "/connectors/tistory/publish-draft",
      payload: {
        title: "티스토리 발행 제목",
        contentMarkdown: "본문입니다.",
        tags: ["태그1", "태그2"],
      },
    });
    assert.equal(publishResponse.statusCode, 409);
    const publishBody = publishResponse.json();
    assert.equal(publishBody.ok, false);
    assert.equal(publishBody.status, "failed");
    assert.match(publishBody.message, /준비 중/u);
    assert.equal(publishedDraft, false);
  } finally {
    await server.close();
  }
});

test("planned connectors ignore stale browser sessions and disconnect back to preparation", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  await mkdir(path.join(stateRoot, "connectors", "tistory"), { recursive: true });
  await writeFile(
    path.join(stateRoot, "connectors", "tistory", "browser-session.json"),
    JSON.stringify(
      {
        provider: "tistory",
        accountLabel: "Tistory 계정",
        connectedAt: "2026-05-09T14:09:16.248Z",
        storageStateJson: JSON.stringify({ cookies: [], origins: [] }),
      },
      null,
      2,
    ),
  );
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-09T13:20:00.000Z",
  });

  try {
    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/tistory/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const state = stateResponse.json<ConnectorState>();
    assert.equal(state.status, "planned");
    assert.equal(state.accountLabel, null);
    assert.equal(state.loginMode, null);

    const disconnectResponse = await server.inject({
      method: "POST",
      url: "/connectors/tistory/disconnect",
    });
    assert.equal(disconnectResponse.statusCode, 200);
    const disconnectedBody = disconnectResponse.json<ConnectorState>();
    assert.equal(disconnectedBody.status, "planned");
    assert.equal(disconnectedBody.accountLabel, null);
    await assert.rejects(
      readFile(
        path.join(stateRoot, "connectors", "tistory", "browser-session.json"),
        "utf8",
      ),
    );
  } finally {
    await server.close();
  }
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

async function waitForConnectorState(
  server: ReturnType<typeof createAgentEngineServer>,
  provider: string,
  predicate: (state: ConnectorState) => boolean,
): Promise<ConnectorState> {
  let last: ConnectorState | null = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await server.inject({
      method: "GET",
      url: `/connectors/${encodeURIComponent(provider)}/state`,
    });
    assert.equal(response.statusCode, 200);
    last = response.json<ConnectorState>();
    if (predicate(last)) return last;
    await delay(10);
  }
  throw new Error(`Timed out waiting for connector state: ${JSON.stringify(last)}`);
}
