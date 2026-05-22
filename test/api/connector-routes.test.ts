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
      ROCKY_INSTAGRAM_PERMISSIONS: "instagram_basic,pages_show_list",
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
