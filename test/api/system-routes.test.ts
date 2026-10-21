import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";

import type {
  HardwareStatusRecord,
  HardwareStatusServiceLike,
} from "../../src/system/hardware-status-types.js";

function buildHardwareStatus(
  overrides: Partial<HardwareStatusRecord> = {}
): HardwareStatusRecord {
  return {
    hostname: "rocky.local",
    platform: "darwin",
    arch: "arm64",
    refreshedAt: "2026-03-20T00:00:00.000Z",
    cpu: {
      model: "Apple M2",
      physicalCores: null,
      logicalCores: 8,
      speedGHz: null,
      usagePercent: 31.4,
      normalizedLoadPercent: 24.5,
      loadAverage: {
        oneMinute: 1.96,
        fiveMinute: 1.41,
        fifteenMinute: 1.08,
      },
    },
    memory: {
      kind: "unified",
      totalBytes: 24 * 1024 ** 3,
      usedBytes: 12 * 1024 ** 3,
      freeBytes: 12 * 1024 ** 3,
      availableBytes: 12 * 1024 ** 3,
      usedPercent: 50,
      swapTotalBytes: 4 * 1024 ** 3,
      swapUsedBytes: 512 * 1024 ** 2,
    },
    gpus: [
      {
        name: "Apple M2",
        vendor: "Apple",
        coreCount: 8,
        memoryKind: "unified",
        memoryBytes: 24 * 1024 ** 3,
        utilizationPercent: null,
        note: "GPU 코어 8개 · CPU와 GPU가 통합 메모리를 공유합니다.",
      },
    ],
    storage: {
      path: "/Users/rocky",
      totalBytes: 512 * 1024 ** 3,
      usedBytes: 321 * 1024 ** 3,
      availableBytes: 191 * 1024 ** 3,
      usedPercent: 62.7,
    },
    ...overrides,
  };
}

test("system routes expose hardware status", async () => {
  const fakeHardwareStatusService: HardwareStatusServiceLike = {
    async getStatus() {
      return buildHardwareStatus();
    },
  };
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "system-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    hardwareStatusService: fakeHardwareStatusService,
  });

  await server.listen({
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const address = server.server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const hardwareResponse = await fetch(`${baseUrl}/settings/hardware`);
    assert.equal(hardwareResponse.status, 200);
    const hardwarePayload = await hardwareResponse.json() as HardwareStatusRecord;
    assert.equal(hardwarePayload.platform, "darwin");
    assert.equal(hardwarePayload.memory.kind, "unified");
    assert.equal(hardwarePayload.gpus[0]?.name, "Apple M2");
  } finally {
    await server.close();
  }
});
