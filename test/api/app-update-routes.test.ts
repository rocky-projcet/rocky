import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";
import type {
  RockyAppUpdateRecord,
  RockyAppUpdateServiceLike,
} from "../../src/installer/app-update-types.js";

function buildAppUpdateState(
  overrides: Partial<RockyAppUpdateRecord> = {}
): RockyAppUpdateRecord {
  return {
    appName: "Rocky",
    platform: "darwin",
    arch: "arm64",
    supported: true,
    currentVersion: "0.1.3",
    latestVersion: null,
    latestStatus: "unknown",
    checkedAt: null,
    releaseUrl: null,
    statusText: "Not checked.",
    asset: null,
    download: null,
    operation: {
      kind: null,
      status: "idle",
      startedAt: null,
      completedAt: null,
      lastError: null,
    },
    install: {
      status: "idle",
      openedAt: null,
      message: null,
      nativeOpen: null,
    },
    limitations: [],
    statePreservation: [],
    ...overrides,
  };
}

test("app update routes expose check, download, install, and folder actions", async () => {
  const calls: string[] = [];
  const fakeService: RockyAppUpdateServiceLike = {
    async getState() {
      calls.push("get");
      return buildAppUpdateState();
    },
    async checkForUpdate() {
      calls.push("check");
      return buildAppUpdateState({
        latestVersion: "0.1.4",
        latestStatus: "update-available",
      });
    },
    async downloadUpdate() {
      calls.push("download");
      return buildAppUpdateState({
        download: {
          fileName: "rocky-v0.1.4-macos-arm64.pkg",
          filePath: "/tmp/rocky-v0.1.4-macos-arm64.pkg",
          directory: "/tmp",
          sizeBytes: 10,
          sha256: "a".repeat(64),
          verified: true,
          verifiedAt: "2026-06-28T00:00:00.000Z",
        },
      });
    },
    async openInstaller() {
      calls.push("install");
      return buildAppUpdateState({
        install: {
          status: "opened",
          openedAt: "2026-06-28T00:00:00.000Z",
          message: "opened",
          nativeOpen: null,
        },
      });
    },
    async openDownloadFolder() {
      calls.push("folder");
      return buildAppUpdateState({
        install: {
          status: "manual-action",
          openedAt: "2026-06-28T00:00:00.000Z",
          message: "folder opened",
          nativeOpen: null,
        },
      });
    },
  };
  const server = createAgentEngineServer({
    stateRoot: await mkdtemp(path.join(os.tmpdir(), "app-update-routes-")),
    appUpdateService: fakeService,
  });

  try {
    const getResponse = await server.inject({
      method: "GET",
      url: "/app/update",
    });
    assert.equal(getResponse.statusCode, 200);
    assert.equal((getResponse.json() as RockyAppUpdateRecord).appName, "Rocky");

    const checkResponse = await server.inject({
      method: "POST",
      url: "/app/update/check",
    });
    assert.equal(checkResponse.statusCode, 202);
    assert.equal(
      (checkResponse.json() as RockyAppUpdateRecord).latestStatus,
      "update-available"
    );

    const downloadResponse = await server.inject({
      method: "POST",
      url: "/app/update/download",
    });
    assert.equal(downloadResponse.statusCode, 202);
    assert.equal(
      (downloadResponse.json() as RockyAppUpdateRecord).download?.verified,
      true
    );

    const installResponse = await server.inject({
      method: "POST",
      url: "/app/update/install",
    });
    assert.equal(installResponse.statusCode, 202);
    assert.equal(
      (installResponse.json() as RockyAppUpdateRecord).install.status,
      "opened"
    );

    const folderResponse = await server.inject({
      method: "POST",
      url: "/app/update/open-folder",
    });
    assert.equal(folderResponse.statusCode, 202);
    assert.equal(
      (folderResponse.json() as RockyAppUpdateRecord).install.status,
      "manual-action"
    );

    assert.deepEqual(calls, ["get", "check", "download", "install", "folder"]);
  } finally {
    await server.close();
  }
});
