import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";
import {
  EcountConnectionService,
  type EcountConnectionTestInput,
} from "../../src/integrations/ecount-connection-service.js";

test("ECOUNT connection route tests credentials without returning secrets", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ecount-route-"));
  let received: EcountConnectionTestInput | null = null;
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-03T00:00:00.000Z",
    ecountConnectionTester: {
      async testConnection(input) {
        received = input;
        return {
          ok: true,
          status: "connected",
          accountLabel: input.accountLabel ?? null,
          comCode: input.comCode,
          userId: input.userId,
          zone: input.zone ?? "CC",
          checkedAt: "2026-05-03T00:00:00.000Z",
          message: "ECOUNT login succeeded and a session was issued.",
        };
      },
    },
  });

  try {
    const response = await server.inject({
      method: "POST",
      url: "/integrations/ecount/test",
      payload: {
        accountLabel: "본사 이카운트",
        comCode: "123456",
        userId: "api-user",
        apiCertKey: "test-secret-key",
        zone: "CC",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(received?.apiCertKey, "test-secret-key");
    assert.equal(response.json().ok, true);
    assert.equal(response.json().zone, "CC");
    assert.equal(JSON.stringify(response.json()).includes("test-secret-key"), false);
    assert.equal(JSON.stringify(response.json()).includes("123456"), false);
    assert.equal(JSON.stringify(response.json()).includes("api-user"), false);
  } finally {
    await server.close();
  }
});

test("ECOUNT connection route rejects missing credentials", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ecount-route-"));
  const server = createAgentEngineServer({ stateRoot });

  try {
    const response = await server.inject({
      method: "POST",
      url: "/integrations/ecount/test",
      payload: {
        comCode: "123456",
        userId: "api-user",
      },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /apiCertKey/u);
  } finally {
    await server.close();
  }
});

test("ECOUNT connection settings are encrypted and reused for tests", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ecount-settings-"));
  const received: EcountConnectionTestInput[] = [];
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-03T00:00:00.000Z",
    ecountConnectionTester: {
      async testConnection(input) {
        received.push(input);
        return {
          ok: true,
          status: "connected",
          accountLabel: input.accountLabel ?? null,
          comCode: input.comCode,
          userId: input.userId,
          zone: input.zone ?? "CC",
          checkedAt: "2026-05-03T00:00:00.000Z",
          message: "ECOUNT login succeeded and a session was issued.",
        };
      },
    },
  });

  try {
    const firstResponse = await server.inject({
      method: "POST",
      url: "/integrations/ecount/test",
      payload: {
        accountLabel: "본사 이카운트",
        comCode: "123456",
        userId: "api-user",
        apiCertKey: "test-secret-key",
        zone: "CC",
      },
    });
    assert.equal(firstResponse.statusCode, 200);

    const settingsResponse = await server.inject({
      method: "GET",
      url: "/integrations/ecount/settings",
    });
    assert.equal(settingsResponse.statusCode, 200);
    assert.equal(settingsResponse.json().configured, true);
    assert.equal(settingsResponse.json().accountLabel, "본사 이카운트");
    assert.equal(JSON.stringify(settingsResponse.json()).includes("test-secret-key"), false);
    assert.equal(JSON.stringify(settingsResponse.json()).includes("123456"), false);
    assert.equal(JSON.stringify(settingsResponse.json()).includes("api-user"), false);

    const storedFile = await readFile(
      path.join(stateRoot, "integrations", "ecount", "settings.json"),
      "utf8"
    );
    assert.equal(storedFile.includes("test-secret-key"), false);
    assert.equal(storedFile.includes("123456"), false);
    assert.equal(storedFile.includes("api-user"), false);

    const storedTestResponse = await server.inject({
      method: "POST",
      url: "/integrations/ecount/test",
      payload: {},
    });
    assert.equal(storedTestResponse.statusCode, 200);
    assert.equal(received.length, 2);
    assert.equal(received[1]?.apiCertKey, "test-secret-key");
    assert.equal(received[1]?.comCode, "123456");
    assert.equal(received[1]?.userId, "api-user");
  } finally {
    await server.close();
  }
});

test("EcountConnectionService resolves zone and logs in", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const service = new EcountConnectionService({
    now: () => "2026-05-03T00:00:00.000Z",
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      if (String(url).endsWith("/OAPI/V2/Zone")) {
        return new Response(JSON.stringify({ Data: { Datas: { ZONE: "CC" } } }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({ Data: { Datas: { SESSION_ID: "session-secret" } } }),
        { status: 200 }
      );
    },
  });

  const result = await service.testConnection({
    accountLabel: "본사 이카운트",
    comCode: "123456",
    userId: "api-user",
    apiCertKey: "test-secret-key",
  });

  assert.equal(result.ok, true);
  assert.equal(result.zone, "CC");
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://sboapi.ecount.com/OAPI/V2/Zone",
      "https://sboapiCC.ecount.com/OAPI/V2/OAPILogin",
    ]
  );
  assert.deepEqual(calls[1]?.body, {
    COM_CODE: "123456",
    USER_ID: "api-user",
    API_CERT_KEY: "test-secret-key",
    ISTEST: "Y",
    LAN_TYPE: "ko-KR",
    ZONE: "CC",
  });
  assert.equal(JSON.stringify(result).includes("test-secret-key"), false);
  assert.equal(JSON.stringify(result).includes("session-secret"), false);
});
