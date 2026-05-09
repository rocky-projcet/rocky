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

test("ECOUNT product route uses stored settings without returning secrets", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ecount-products-route-"));
  const received: EcountConnectionTestInput[] = [];
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-03T00:00:00.000Z",
    ecountLookupService: {
      async getBasicProductsList(input, options) {
        received.push(input);
        assert.equal(options?.offset, 1000);
        return {
          ok: true,
          status: "connected",
          accountLabel: input.accountLabel ?? null,
          zone: input.zone ?? "CC",
          checkedAt: "2026-05-03T00:00:00.000Z",
          api: "InventoryBasic/GetBasicProductsList",
          count: 1,
          returnedCount: Math.min(options?.limit ?? 1, 1),
          products: [
            {
              code: "P-001",
              name: "테스트 품목",
              spec: null,
              unit: "EA",
              raw: {
                PROD_CD: "P-001",
                PROD_DES: "테스트 품목",
                UNIT: "EA",
              },
            },
          ],
          message: "ECOUNT product lookup returned 1 product(s).",
        };
      },
    },
  });

  try {
    const settingsResponse = await server.inject({
      method: "PUT",
      url: "/integrations/ecount/settings",
      payload: {
        accountLabel: "본사 이카운트",
        comCode: "123456",
        userId: "api-user",
        apiCertKey: "test-secret-key",
        zone: "CC",
      },
    });
    assert.equal(settingsResponse.statusCode, 200);

    const response = await server.inject({
      method: "POST",
      url: "/integrations/ecount/products",
      payload: {
        limit: 50,
        offset: 1000,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0]?.comCode, "123456");
    assert.equal(received[0]?.userId, "api-user");
    assert.equal(received[0]?.apiCertKey, "test-secret-key");
    assert.equal(response.json().ok, true);
    assert.equal(response.json().products[0]?.code, "P-001");
    assert.equal(response.json().products[0]?.name, "테스트 품목");
    assert.equal(JSON.stringify(response.json()).includes("test-secret-key"), false);
    assert.equal(JSON.stringify(response.json()).includes("123456"), false);
    assert.equal(JSON.stringify(response.json()).includes("api-user"), false);
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

test("EcountConnectionService reads, offsets, and normalizes ECOUNT product rows", async () => {
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
      if (String(url).includes("/OAPILogin")) {
        return new Response(
          JSON.stringify({ Data: { Code: "00", Datas: { SESSION_ID: "session-secret" } } }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          Data: {
            Code: "00",
            Output: [
              {
                PROD_CD: "P-000",
                PROD_DES: "건너뛸 품목",
                SIZE_DES: "EA",
                UNIT: "EA",
              },
              {
                PROD_CD: "P-001",
                PROD_DES: "테스트 품목",
                SIZE_DES: "BOX",
                UNIT: "EA",
              },
            ],
          },
        }),
        { status: 200 }
      );
    },
  });

  const result = await service.getBasicProductsList(
    {
      accountLabel: "본사 이카운트",
      comCode: "123456",
      userId: "api-user",
      apiCertKey: "test-secret-key",
    },
    {
      limit: 10,
      offset: 1,
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.zone, "CC");
  assert.equal(result.count, 2);
  assert.equal(result.returnedCount, 1);
  assert.deepEqual(result.products[0], {
    code: "P-001",
    name: "테스트 품목",
    spec: "BOX",
    unit: "EA",
    raw: {
      PROD_CD: "P-001",
      PROD_DES: "테스트 품목",
      SIZE_DES: "BOX",
      UNIT: "EA",
    },
  });
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://sboapi.ecount.com/OAPI/V2/Zone",
      "https://sboapiCC.ecount.com/OAPI/V2/OAPILogin",
      "https://sboapiCC.ecount.com/OAPI/V2/InventoryBasic/GetBasicProductsList?session_Id=session-secret",
    ]
  );
  assert.equal(JSON.stringify(result).includes("test-secret-key"), false);
  assert.equal(JSON.stringify(result).includes("session-secret"), false);
});
