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

test("standard integration routes expose ECOUNT capabilities and query products", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ecount-standard-route-"));
  const received: Array<{
    dataset: string;
    limit?: number | null;
    offset?: number | null;
    filters?: Record<string, unknown> | null;
  }> = [];
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-03T00:00:00.000Z",
    ecountLookupService: {
      async getBasicProductsList() {
        throw new Error("queryDataset should be used by the standard route.");
      },
      listCapabilities() {
        return [
          {
            provider: "ecount",
            dataset: "products",
            label: "품목",
            status: "supported",
            access: "read",
            api: "InventoryBasic/GetBasicProductsList",
            filters: ["limit", "offset"],
            reason: null,
          },
          {
            provider: "ecount",
            dataset: "sales",
            label: "판매",
            status: "unsupported",
            access: "read",
            api: null,
            filters: ["fromDate", "toDate"],
            reason: "not implemented",
          },
        ];
      },
      async queryDataset(input, query) {
        received.push({
          dataset: String(query.dataset),
          limit: query.limit,
          offset: query.offset,
          filters: query.filters,
        });
        return {
          ok: true,
          provider: "ecount",
          dataset: String(query.dataset),
          title: "ECOUNT ERP 품목 조회",
          status: "ready",
          accountLabel: input.accountLabel ?? null,
          zone: input.zone ?? "CC",
          checkedAt: "2026-05-03T00:00:00.000Z",
          api: "InventoryBasic/GetBasicProductsList",
          count: 1,
          returnedCount: 1,
          records: [
            {
              code: "P-001",
              name: "테스트 품목",
            },
          ],
          message: "ok",
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

    const capabilitiesResponse = await server.inject({
      method: "GET",
      url: "/integrations/ecount/capabilities",
    });
    assert.equal(capabilitiesResponse.statusCode, 200);
    assert.deepEqual(
      capabilitiesResponse.json().capabilities.map(
        (capability: { dataset: string; status: string }) => [
          capability.dataset,
          capability.status,
        ]
      ),
      [
        ["products", "supported"],
        ["sales", "unsupported"],
      ]
    );

    const queryResponse = await server.inject({
      method: "POST",
      url: "/integrations/ecount/query",
      payload: {
        dataset: "products",
        limit: 25,
        offset: 10,
      },
    });
    assert.equal(queryResponse.statusCode, 200);
    assert.equal(queryResponse.json().provider, "ecount");
    assert.equal(queryResponse.json().dataset, "products");
    assert.equal(queryResponse.json().records[0]?.code, "P-001");
    assert.deepEqual(received, [
      { dataset: "products", limit: 25, offset: 10, filters: null },
    ]);
    assert.equal(JSON.stringify(queryResponse.json()).includes("test-secret-key"), false);

    const inventoryResponse = await server.inject({
      method: "GET",
      url: "/integrations/ecount/datasets/inventory?baseDate=2026-05-01&warehouseCode=100&productCode=P-001",
    });
    assert.equal(inventoryResponse.statusCode, 200);
    assert.equal(inventoryResponse.json().dataset, "inventory");
    assert.deepEqual(received[1], {
      dataset: "inventory",
      limit: null,
      offset: null,
      filters: {
        baseDate: "2026-05-01",
        warehouseCode: "100",
        productCode: "P-001",
      },
    });
  } finally {
    await server.close();
  }
});

test("standard integration route returns structured unsupported ECOUNT dataset results", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "ecount-unsupported-route-"));
  const server = createAgentEngineServer({
    stateRoot,
    now: () => "2026-05-03T00:00:00.000Z",
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
      url: "/integrations/ecount/query",
      payload: {
        dataset: "sales",
        filters: {
          period: "recent-30-days",
        },
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().provider, "ecount");
    assert.equal(response.json().dataset, "sales");
    assert.equal(response.json().status, "unsupported");
    assert.equal(response.json().records.length, 0);
    assert.match(response.json().diagnostics.detail, /sales lookup/u);
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

test("EcountConnectionService queries all scraped read-only ECOUNT manual datasets", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const service = new EcountConnectionService({
    now: () => "2026-05-03T00:00:00.000Z",
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      if (String(url).includes("/OAPILogin")) {
        return new Response(
          JSON.stringify({ Data: { Code: "00", Datas: { SESSION_ID: "session-secret" } } }),
          { status: 200 }
        );
      }
      if (String(url).includes("/InventoryBasic/ViewBasicProduct")) {
        return new Response(
          JSON.stringify({
            Data: {
              Code: "00",
              Result: JSON.stringify([
                {
                  PROD_CD: "P-001",
                  PROD_DES: "테스트 품목",
                  SIZE_DES: "BOX",
                  UNIT: "EA",
                },
              ]),
            },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          Data: {
            Code: "00",
            Result: [
              {
                PROD_CD: "P-001",
                PROD_DES: "테스트 품목",
                WH_CD: "100",
                WH_DES: "본사창고",
                BAL_QTY: "7",
              },
            ],
          },
        }),
        { status: 200 }
      );
    },
  });
  const input = {
    accountLabel: "본사 이카운트",
    comCode: "123456",
    userId: "api-user",
    apiCertKey: "test-secret-key",
    zone: "CC",
  };

  const missingRequired = await service.queryDataset(input, {
    dataset: "inventoryBalance",
    filters: {
      baseDate: "2026-05-01",
    },
  });
  assert.equal(missingRequired.status, "failed");
  assert.equal(missingRequired.diagnostics?.stage, "capability");

  const product = await service.queryDataset(input, {
    dataset: "productDetail",
    filters: {
      productCode: "P-001",
    },
  });
  const inventoryBalance = await service.queryDataset(input, {
    dataset: "inventoryBalance",
    filters: {
      baseDate: "2026-05-01",
      productCode: "P-001",
    },
  });
  const warehouseInventory = await service.queryDataset(input, {
    dataset: "warehouseInventory",
    filters: {
      baseDate: "2026-05-01",
      warehouseCode: "100",
    },
  });
  const warehouseInventoryBalance = await service.queryDataset(input, {
    dataset: "warehouseInventoryBalance",
    filters: {
      baseDate: "2026-05-01",
      productCode: "P-001",
      warehouseCode: "100",
    },
  });

  assert.equal(product.api, "InventoryBasic/ViewBasicProduct");
  assert.equal(product.records[0]?.code, "P-001");
  assert.equal(inventoryBalance.api, "InventoryBalance/ViewInventoryBalanceStatus");
  assert.equal(inventoryBalance.records[0]?.balanceQuantity, 7);
  assert.equal(warehouseInventory.api, "InventoryBalance/GetListInventoryBalanceStatusByLocation");
  assert.equal(warehouseInventory.records[0]?.warehouseCode, "100");
  assert.equal(
    warehouseInventoryBalance.api,
    "InventoryBalance/ViewInventoryBalanceStatusByLocation"
  );
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://sboapiCC.ecount.com/OAPI/V2/OAPILogin",
      "https://sboapiCC.ecount.com/OAPI/V2/InventoryBasic/ViewBasicProduct?SESSION_ID=session-secret",
      "https://sboapiCC.ecount.com/OAPI/V2/OAPILogin",
      "https://sboapiCC.ecount.com/OAPI/V2/InventoryBalance/ViewInventoryBalanceStatus?SESSION_ID=session-secret",
      "https://sboapiCC.ecount.com/OAPI/V2/OAPILogin",
      "https://sboapiCC.ecount.com/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatusByLocation?SESSION_ID=session-secret",
      "https://sboapiCC.ecount.com/OAPI/V2/OAPILogin",
      "https://sboapiCC.ecount.com/OAPI/V2/InventoryBalance/ViewInventoryBalanceStatusByLocation?SESSION_ID=session-secret",
    ]
  );
  assert.deepEqual(calls[1]?.body, {
    SESSION_ID: "session-secret",
    PROD_CD: "P-001",
  });
  assert.deepEqual(calls[3]?.body, {
    SESSION_ID: "session-secret",
    BASE_DATE: "20260501",
    PROD_CD: "P-001",
    WH_CD: "",
  });
  assert.equal(JSON.stringify(product).includes("test-secret-key"), false);
  assert.equal(JSON.stringify(product).includes("session-secret"), false);
});

test("EcountConnectionService queries ECOUNT inventory balance datasets", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const service = new EcountConnectionService({
    now: () => "2026-05-03T00:00:00.000Z",
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
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
                PROD_CD: "P-001",
                PROD_DES: "테스트 품목",
                WH_CD: "100",
                WH_DES: "본사창고",
                BAL_QTY: "7",
              },
              {
                PROD_CD: "P-001",
                PROD_DES: "테스트 품목",
                WH_CD: "200",
                WH_DES: "지점창고",
                BAL_QTY: "3",
              },
            ],
          },
        }),
        { status: 200 }
      );
    },
  });
  assert.deepEqual(
    service
      .listCapabilities()
      .filter((capability) =>
        ["products", "inventory", "warehouseInventory", "purchases"].includes(capability.dataset)
      )
      .map((capability) => [capability.dataset, capability.status, capability.api]),
    [
      ["products", "supported", "InventoryBasic/GetBasicProductsList"],
      [
        "inventory",
        "supported",
        "InventoryBalance/GetListInventoryBalanceStatus",
      ],
      [
        "warehouseInventory",
        "supported",
        "InventoryBalance/GetListInventoryBalanceStatusByLocation",
      ],
      ["purchases", "supported", "Purchases/GetPurchasesOrderList"],
    ]
  );

  const result = await service.queryDataset(
    {
      accountLabel: "본사 이카운트",
      comCode: "123456",
      userId: "api-user",
      apiCertKey: "test-secret-key",
      zone: "CC",
    },
    {
      dataset: "inventory",
      filters: {
        baseDate: "2026-05-01",
        productCode: "P-001",
        warehouseCode: "100",
      },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.dataset, "inventory");
  assert.equal(result.api, "InventoryBalance/GetListInventoryBalanceStatus");
  assert.equal(result.count, 2);
  assert.equal(result.returnedCount, 2);
  assert.deepEqual(result.records[0], {
    productCode: "P-001",
    productName: "테스트 품목",
    productSpec: null,
    warehouseCode: "100",
    warehouseName: "본사창고",
    balanceQuantity: 7,
    raw: {
      PROD_CD: "P-001",
      PROD_DES: "테스트 품목",
      WH_CD: "100",
      WH_DES: "본사창고",
      BAL_QTY: "7",
    },
  });
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://sboapiCC.ecount.com/OAPI/V2/OAPILogin",
      "https://sboapiCC.ecount.com/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus?SESSION_ID=session-secret",
    ]
  );
  assert.deepEqual(calls[1]?.body, {
    SESSION_ID: "session-secret",
    BASE_DATE: "20260501",
    PROD_CD: "P-001",
    WH_CD: "100",
  });
  assert.equal(JSON.stringify(result).includes("test-secret-key"), false);
  assert.equal(JSON.stringify(result).includes("session-secret"), false);
});

test("EcountConnectionService queries ECOUNT purchase order datasets", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const service = new EcountConnectionService({
    now: () => "2026-05-31T00:00:00.000Z",
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
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
                IO_NO: "PO-001",
                IO_DATE: "20260501",
                CUST: "C-001",
                CUST_DES: "테스트 거래처",
                PROD_CD: "P-001",
                PROD_DES: "첫 번째 품목",
                QTY: "2",
                SUPPLY_AMT: "1,200",
              },
              {
                IO_NO: "PO-002",
                IO_DATE: "20260502",
                CUST: "C-001",
                CUST_DES: "테스트 거래처",
                PROD_CD: "P-002",
                PROD_DES: "두 번째 품목",
                QTY: "3",
                TOTAL_AMT: "2,400",
                STATUS: "open",
              },
            ],
          },
        }),
        { status: 200 }
      );
    },
  });

  const result = await service.queryDataset(
    {
      accountLabel: "본사 이카운트",
      comCode: "123456",
      userId: "api-user",
      apiCertKey: "test-secret-key",
      zone: "CC",
    },
    {
      dataset: "purchases",
      limit: 1,
      offset: 1,
      filters: {
        fromDate: "2026-05-01",
        toDate: "2026-05-31",
        customerCode: "C-001",
        productCode: "P-002",
      },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.dataset, "purchases");
  assert.equal(result.api, "Purchases/GetPurchasesOrderList");
  assert.equal(result.count, 2);
  assert.equal(result.returnedCount, 1);
  assert.deepEqual(result.records[0], {
    orderNo: "PO-002",
    orderDate: "20260502",
    warehouseCode: null,
    warehouseName: null,
    projectCode: null,
    projectName: null,
    employeeCode: null,
    managerName: null,
    customerCode: "C-001",
    customerName: "테스트 거래처",
    productCode: "P-002",
    productName: "두 번째 품목",
    dueDate: null,
    quantity: 3,
    supplyAmount: null,
    vatAmount: null,
    totalAmount: 2400,
    foreignAmount: null,
    status: "open",
    raw: {
      IO_NO: "PO-002",
      IO_DATE: "20260502",
      CUST: "C-001",
      CUST_DES: "테스트 거래처",
      PROD_CD: "P-002",
      PROD_DES: "두 번째 품목",
      QTY: "3",
      TOTAL_AMT: "2,400",
      STATUS: "open",
    },
  });
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://sboapiCC.ecount.com/OAPI/V2/OAPILogin",
      "https://sboapiCC.ecount.com/OAPI/V2/Purchases/GetPurchasesOrderList?SESSION_ID=session-secret",
    ]
  );
  assert.deepEqual(calls[1]?.body, {
    SESSION_ID: "session-secret",
    PROD_CD: "P-002",
    CUST_CD: "C-001",
    ListParam: {
      PAGE_CURRENT: 1,
      PAGE_SIZE: 1,
      BASE_DATE_FROM: "20260501",
      BASE_DATE_TO: "20260531",
    },
  });
  assert.equal(JSON.stringify(result).includes("test-secret-key"), false);
  assert.equal(JSON.stringify(result).includes("session-secret"), false);
});
