import test from "node:test";
import assert from "node:assert/strict";

import {
  appUpdateOperationLabel,
  getAppUpdateActions,
} from "../../web/src/domains/codex/lib/app-update-display.js";
import type { RockyAppUpdateRecord } from "../../web/src/domains/codex/types.js";

function buildState(
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

test("getAppUpdateActions allows download only when a checksum-backed update asset exists", () => {
  assert.deepEqual(
    getAppUpdateActions(
      buildState({
        latestStatus: "update-available",
        asset: {
          name: "rocky-v0.1.4-macos-arm64.pkg",
          kind: "pkg",
          sizeBytes: 10,
          downloadUrl: "https://downloads.example.test/rocky.pkg",
          checksumSha256: "a".repeat(64),
          checksumSource: "release-manifest",
        },
      })
    ),
    {
      busy: false,
      canCheck: true,
      canDownload: true,
      canInstall: false,
      canOpenFolder: false,
    }
  );

  assert.equal(
    getAppUpdateActions(
      buildState({
        latestStatus: "update-available",
        asset: {
          name: "rocky-v0.1.4-macos-arm64.pkg",
          kind: "pkg",
          sizeBytes: 10,
          downloadUrl: "https://downloads.example.test/rocky.pkg",
          checksumSha256: null,
          checksumSource: null,
        },
      })
    ).canDownload,
    false
  );
});

test("getAppUpdateActions enables install and folder actions after verification", () => {
  const actions = getAppUpdateActions(
    buildState({
      latestStatus: "update-available",
      download: {
        fileName: "rocky-v0.1.4-macos-arm64.pkg",
        filePath: "/tmp/rocky-v0.1.4-macos-arm64.pkg",
        directory: "/tmp",
        sizeBytes: 10,
        sha256: "a".repeat(64),
        verified: true,
        verifiedAt: "2026-06-28T00:00:00.000Z",
      },
    })
  );

  assert.equal(actions.canDownload, false);
  assert.equal(actions.canInstall, true);
  assert.equal(actions.canOpenFolder, true);
});

test("appUpdateOperationLabel names pending operation states", () => {
  assert.equal(
    appUpdateOperationLabel(
      buildState({
        operation: {
          kind: "download",
          status: "pending",
          startedAt: "2026-06-28T00:00:00.000Z",
          completedAt: null,
          lastError: null,
        },
      })
    ),
    "다운로드 중"
  );
});
