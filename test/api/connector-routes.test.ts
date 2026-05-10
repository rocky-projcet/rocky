import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";

import type { ConnectorState } from "../../src/connectors/connector-types.js";
import type { ConnectorRunnerEvent } from "../../src/connectors/connector-runner.js";

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
          capability.id === "threads.content.write" &&
          capability.action === "write" &&
        capability.requiresApproval === true,
      ),
    );

    const profileResponse = await server.inject({
      method: "GET",
      url: "/connectors/threads/profile",
    });
    assert.equal(profileResponse.statusCode, 200);
    const profileBody = profileResponse.json();
    assert.equal(profileBody.ok, true);
    assert.equal(profileBody.profile.username, "rocky_threads");
    assert.equal(profileReaderCalls, 1);

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
    assert.equal(profileReaderCalls, 1);
  } finally {
    await server.close();
  }
});

test("connector custom browser login connects Tistory only after session detection", async () => {
  let onEvent: ((event: ConnectorRunnerEvent) => void) | null = null;
  let publishedDraft:
    | {
        title: string;
        contentMarkdown: string;
        tags: string[];
        storageStateJson: string;
        browserProfileDir: string | null | undefined;
      }
    | null = null;
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "connector-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-09T13:20:00.000Z",
    connectorBrowserDetector: async () => ({
      available: true,
      channel: "chrome",
      message: "시스템 Chrome 사용",
    }),
    connectorBrowserLoginStarter: async (input) => {
      assert.equal(input.adapter.provider, "tistory");
      assert.equal(input.adapter.loginUrl, "https://www.tistory.com/auth/login");
      assert.equal(input.channel, "chrome");
      assert.equal(
        input.userDataDir,
        path.join(stateRoot, "connectors", "tistory", "browser-profile"),
      );
      onEvent = input.onEvent;
      return {
        cancel: async () => {},
      };
    },
    connectorBrowserDraftPublisher: async (input) => {
      publishedDraft = {
        title: input.draft.title,
        contentMarkdown: input.draft.contentMarkdown,
        tags: input.draft.tags ?? [],
        storageStateJson: input.storageStateJson,
        browserProfileDir: input.browserProfileDir,
      };
      return {
        ok: true,
        provider: input.provider,
        status: "draft-saved",
        accountLabel: input.accountLabel,
        url: "https://example.tistory.com/manage/newpost/",
        message: "임시저장했습니다.",
        checkedAt: input.now(),
      };
    },
  });

  try {
    const response = await server.inject({
      method: "POST",
      url: "/connectors/tistory/login",
    });
    assert.equal(response.statusCode, 202);
    const body = response.json<ConnectorState>();
    assert.equal(body.status, "connecting");
    assert.equal(body.loginMode, "custom-browser");
    assert.equal(body.loginUrl, null);
    assert.equal(body.accountLabel, null);
    assert.ok(onEvent);

    onEvent({
      kind: "connected",
      accountLabel: "Tistory 계정",
      storageStateJson: JSON.stringify({
        cookies: [{ name: "TSSESSION", value: "session" }],
        origins: [],
      }),
    });

    const connected = await waitForConnectorState(
      server,
      "tistory",
      (state) => state.status === "connected",
    );
    assert.equal(connected.accountLabel, "Tistory 계정");
    assert.equal(connected.connectedAt, "2026-05-09T13:20:00.000Z");
    assert.equal(connected.loginMode, "custom-browser");

    const publishResponse = await server.inject({
      method: "POST",
      url: "/connectors/tistory/publish-draft",
      payload: {
        title: "티스토리 발행 제목",
        contentMarkdown: "본문입니다.",
        tags: ["태그1", "태그2"],
      },
    });
    assert.equal(publishResponse.statusCode, 200);
    assert.equal(publishResponse.json().status, "draft-saved");
    assert.deepEqual(publishedDraft, {
      title: "티스토리 발행 제목",
      contentMarkdown: "본문입니다.",
      tags: ["태그1", "태그2"],
      storageStateJson: JSON.stringify({
        cookies: [{ name: "TSSESSION", value: "session" }],
        origins: [],
      }),
      browserProfileDir: path.join(
        stateRoot,
        "connectors",
        "tistory",
        "browser-profile",
      ),
    });
  } finally {
    await server.close();
  }

  const restoredServer = createAgentEngineServer({
    stateRoot,
    connectorBrowserDetector: async () => ({
      available: true,
      channel: "chrome",
      message: "시스템 Chrome 사용",
    }),
    connectorBrowserLoginStarter: async () => {
      throw new Error("should not start");
    },
  });
  try {
    const stateResponse = await restoredServer.inject({
      method: "GET",
      url: "/connectors/tistory/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const restoredBody = stateResponse.json<ConnectorState>();
    assert.equal(restoredBody.status, "connected");
    assert.equal(restoredBody.accountLabel, "Tistory 계정");
    assert.equal(restoredBody.loginMode, "custom-browser");
  } finally {
    await restoredServer.close();
  }
});

test("connector publish marks stale Tistory browser sessions failed", async () => {
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
    connectorBrowserDetector: async () => ({
      available: true,
      channel: "chromium",
      message: "Playwright 번들 Chromium 사용",
    }),
    connectorBrowserDraftPublisher: async () => {
      throw new Error(
        "Tistory 로그인 세션이 유효하지 않거나 관리 가능한 블로그를 찾지 못했습니다. 계정 연동을 다시 진행해 주세요."
      );
    },
  });

  try {
    const response = await server.inject({
      method: "POST",
      url: "/connectors/tistory/publish-draft",
      payload: {
        title: "제목",
        contentMarkdown: "본문",
        tags: [],
        visibility: "draft",
      },
    });
    assert.equal(response.statusCode, 409);

    const stateResponse = await server.inject({
      method: "GET",
      url: "/connectors/tistory/state",
    });
    assert.equal(stateResponse.statusCode, 200);
    const state = stateResponse.json<ConnectorState>();
    assert.equal(state.status, "failed");
    assert.equal(state.accountLabel, null);
    assert.match(state.lastError ?? "", /로그인 세션/u);
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
