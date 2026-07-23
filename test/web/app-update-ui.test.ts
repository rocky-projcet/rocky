import assert from "node:assert/strict";
import test from "node:test";

import * as appUpdateUi from "../../web/src/domains/rocky/lib/app-update.js";

import {
  AgentEngineClient,
  type AppUpdateRecord,
} from "../../web/src/shared/lib/agent-engine-client.js";

const {
  appUpdateStatusLabel,
  canInstallAppUpdate,
  primaryAppUpdateActionLabel,
} = appUpdateUi;

function buildRecord(overrides: Partial<AppUpdateRecord> = {}): AppUpdateRecord {
  return {
    currentVersion: "0.1.3",
    platform: "win32",
    supported: true,
    status: "idle",
    latestVersion: null,
    releaseUrl: null,
    releaseNotes: null,
    limitations: [],
    updateAvailable: false,
    installerAsset: null,
    download: null,
    downloadProgress: null,
    preservedPathNames: [".runtime", ".codex", ".tools", ".env", ".env.local"],
    checkedAt: null,
    startedAt: null,
    completedAt: null,
    lastError: null,
    ...overrides,
  };
}

test("app update UI labels visible app update states", () => {
  assert.equal(appUpdateStatusLabel(buildRecord({ status: "idle" })), "확인 전");
  assert.equal(
    appUpdateStatusLabel(buildRecord({ status: "update-available", latestVersion: "0.1.4" })),
    "0.1.4 업데이트 가능"
  );
  assert.equal(appUpdateStatusLabel(buildRecord({ status: "downloaded" })), "설치 준비 완료");
  assert.equal(
    appUpdateStatusLabel(buildRecord({ status: "failed", lastError: "Checksum mismatch" })),
    "복구 필요"
  );
});

test("app update UI only enables install for verified desktop downloads", () => {
  assert.equal(canInstallAppUpdate(buildRecord({ status: "update-available" })), false);
  assert.equal(
    canInstallAppUpdate(
      buildRecord({
        status: "downloaded",
        download: {
          path: "C:/Rocky/Rocky-Setup-v0.1.4.exe",
          fileName: "Rocky-Setup-v0.1.4.exe",
          size: 15,
          sha256: "abc",
          verified: true,
          verifiedAt: "2026-06-25T00:00:00.000Z",
          downloadedAt: "2026-06-25T00:00:00.000Z",
        },
      })
    ),
    true
  );
  assert.equal(
    canInstallAppUpdate(
      buildRecord({
        status: "downloaded",
        platform: "darwin",
        download: {
          path: "/tmp/Rocky-Setup-v0.1.4.exe",
          fileName: "Rocky-Setup-v0.1.4.exe",
          size: 15,
          sha256: "abc",
          verified: true,
          verifiedAt: "2026-06-25T00:00:00.000Z",
          downloadedAt: "2026-06-25T00:00:00.000Z",
        },
      })
    ),
    true
  );
});

test("app update UI selects the next safe primary action", () => {
  assert.equal(primaryAppUpdateActionLabel(buildRecord()), "업데이트 확인");
  assert.equal(
    primaryAppUpdateActionLabel(buildRecord({ status: "update-available" })),
    "업데이트"
  );
  assert.equal(primaryAppUpdateActionLabel(buildRecord({ status: "downloaded" })), "설치 실행");
  assert.equal(primaryAppUpdateActionLabel(buildRecord({ status: "current" })), "다시 확인");
  assert.equal(primaryAppUpdateActionLabel(buildRecord({ status: "failed" })), "다시 시도");
});

test("app update UI exposes real download progress", () => {
  const record = buildRecord({
    status: "downloading",
    downloadProgress: {
      bytesReceived: 50,
      totalBytes: 100,
      percent: 50,
    },
  } as unknown as Partial<AppUpdateRecord>);

  assert.equal(appUpdateStatusLabel(record), "다운로드 50%");
  assert.equal(primaryAppUpdateActionLabel(record), "다운로드 50%");
});

test("app update UI enables verified macOS installers", () => {
  const record = buildRecord({
    platform: "darwin",
    status: "downloaded",
    download: {
      path: "/tmp/Rocky-v0.1.4.pkg",
      fileName: "Rocky-v0.1.4.pkg",
      size: 15,
      sha256: "abc",
      verified: true,
      verifiedAt: "2026-07-23T00:00:00.000Z",
      downloadedAt: "2026-07-23T00:00:00.000Z",
    },
  });

  assert.equal(canInstallAppUpdate(record), true);
});

test("app update UI offers manual recovery when a verified download remains", () => {
  const canRevealAppUpdateDownload = (
    appUpdateUi as unknown as {
      canRevealAppUpdateDownload?: (record: AppUpdateRecord) => boolean;
    }
  ).canRevealAppUpdateDownload;

  assert.equal(typeof canRevealAppUpdateDownload, "function");
});

test("AgentEngineClient requests the app update reveal endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ method: string; url: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      method: init?.method ?? "GET",
      url: String(input),
    });
    return new Response(JSON.stringify(buildRecord({ status: "downloaded" })), {
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const client = new AgentEngineClient("https://rocky.local");
    const revealRockyAppUpdateInstaller = (
      client as unknown as {
        revealRockyAppUpdateInstaller?: () => Promise<AppUpdateRecord>;
      }
    ).revealRockyAppUpdateInstaller;
    assert.equal(typeof revealRockyAppUpdateInstaller, "function");
    await revealRockyAppUpdateInstaller!.call(client);
    assert.deepEqual(requests, [
      {
        method: "POST",
        url: "https://rocky.local/rocky/app-update/reveal",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("app update UI auto-checks idle desktop state and auto-installs verified downloads", () => {
  const helpers = appUpdateUi as unknown as {
    shouldAutoCheckAppUpdate?: (record: AppUpdateRecord) => boolean;
    shouldAutoInstallAppUpdate?: (record: AppUpdateRecord) => boolean;
  };

  assert.equal(typeof helpers.shouldAutoCheckAppUpdate, "function");
  assert.equal(typeof helpers.shouldAutoInstallAppUpdate, "function");
  assert.equal(helpers.shouldAutoCheckAppUpdate!(buildRecord()), true);
  assert.equal(
    helpers.shouldAutoInstallAppUpdate!(
      buildRecord({
        platform: "darwin",
        status: "downloaded",
        download: {
          path: "/tmp/Rocky-v0.1.4.pkg",
          fileName: "Rocky-v0.1.4.pkg",
          size: 15,
          sha256: "abc",
          verified: true,
          verifiedAt: "2026-07-23T00:00:00.000Z",
          downloadedAt: "2026-07-23T00:00:00.000Z",
        },
      })
    ),
    true
  );
});
