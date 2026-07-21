import assert from "node:assert/strict";
import test from "node:test";

import {
  appUpdateStatusLabel,
  canInstallAppUpdate,
  primaryAppUpdateActionLabel,
} from "../../web/src/domains/rocky/lib/app-update.js";

import type { AppUpdateRecord } from "../../web/src/shared/lib/agent-engine-client.js";

function buildRecord(overrides: Partial<AppUpdateRecord> = {}): AppUpdateRecord {
  return {
    currentVersion: "0.1.3",
    platform: "win32",
    supported: true,
    status: "idle",
    latestVersion: null,
    releaseUrl: null,
    updateAvailable: false,
    installerAsset: null,
    download: null,
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

test("app update UI only enables install for verified Windows downloads", () => {
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
    false
  );
});

test("app update UI selects the next safe primary action", () => {
  assert.equal(primaryAppUpdateActionLabel(buildRecord()), "업데이트 확인");
  assert.equal(
    primaryAppUpdateActionLabel(buildRecord({ status: "update-available" })),
    "설치 파일 다운로드"
  );
  assert.equal(primaryAppUpdateActionLabel(buildRecord({ status: "downloaded" })), "설치 실행");
  assert.equal(primaryAppUpdateActionLabel(buildRecord({ status: "current" })), "다시 확인");
  assert.equal(primaryAppUpdateActionLabel(buildRecord({ status: "failed" })), "다시 시도");
});
