import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";

import { AppUpdateService } from "../../src/installer/app-update-service.js";

import type { RuntimeChildProcess } from "../../src/runtime/runtime-types.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    {
      status: init.status ?? 200,
      headers: {
        "content-type": typeof body === "string" ? "text/plain" : "application/json",
        ...init.headers,
      },
    }
  );
}

function childProcessStub(): RuntimeChildProcess {
  const child = new EventEmitter() as unknown as RuntimeChildProcess;
  child.stdout = new EventEmitter() as RuntimeChildProcess["stdout"];
  child.stderr = new EventEmitter() as RuntimeChildProcess["stderr"];
  child.kill = () => true;
  return child;
}

test("AppUpdateService discovers the latest Windows installer release", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-app-update-"));
  const installerBody = "installer-bytes";
  const checksum = sha256(installerBody);
  const fetches: string[] = [];
  let authorization: string | null = null;
  const service = new AppUpdateService({
    stateRoot,
    currentVersion: "0.1.3",
    platform: "win32",
    githubToken: "test-token",
    now: () => "2026-06-25T00:00:00.000Z",
    fetchImpl: async (url, init) => {
      fetches.push(String(url));
      authorization = new Headers(init?.headers).get("authorization");
      return response({
        tag_name: "v0.1.4",
        html_url: "https://github.com/rocky-projcet/rocky/releases/tag/v0.1.4",
        assets: [
          {
            name: "Rocky-Setup-v0.1.4.exe",
            url: "https://api.github.com/repos/rocky-projcet/rocky/releases/assets/42",
            browser_download_url: "https://downloads.example/Rocky-Setup-v0.1.4.exe",
            size: installerBody.length,
            digest: `sha256:${checksum}`,
          },
        ],
      });
    },
  });

  const record = await service.checkForUpdates();

  assert.equal(record.status, "update-available");
  assert.equal(record.currentVersion, "0.1.3");
  assert.equal(record.latestVersion, "0.1.4");
  assert.equal(record.updateAvailable, true);
  assert.equal(record.installerAsset?.name, "Rocky-Setup-v0.1.4.exe");
  assert.equal(
    record.installerAsset?.downloadUrl,
    "https://api.github.com/repos/rocky-projcet/rocky/releases/assets/42"
  );
  assert.equal(record.installerAsset?.sha256, checksum);
  assert.equal(authorization, "Bearer test-token");
  assert.deepEqual(fetches, [
    "https://api.github.com/repos/rocky-projcet/rocky/releases/latest",
  ]);
});

test("AppUpdateService downloads and verifies a checksum-backed installer", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-app-update-"));
  const installerBody = "installer-bytes";
  const checksum = sha256(installerBody);
  const fetches: string[] = [];
  let authorization: string | null = null;
  const service = new AppUpdateService({
    stateRoot,
    currentVersion: "0.1.3",
    platform: "win32",
    githubToken: "test-token",
    now: () => "2026-06-25T00:00:00.000Z",
    fetchImpl: async (url, init) => {
      fetches.push(String(url));
      authorization = new Headers(init?.headers).get("authorization");
      if (
        String(url).endsWith(".exe") ||
        String(url).endsWith("/releases/assets/42")
      ) {
        return response(installerBody, {
          headers: { "content-type": "application/octet-stream" },
        });
      }
      return response({
        tag_name: "v0.1.4",
        html_url: "https://github.com/rocky-projcet/rocky/releases/tag/v0.1.4",
        assets: [
          {
            name: "Rocky-Setup-v0.1.4.exe",
            url: "https://api.github.com/repos/rocky-projcet/rocky/releases/assets/42",
            browser_download_url: "https://downloads.example/Rocky-Setup-v0.1.4.exe",
            size: installerBody.length,
          },
          {
            name: "SHA256SUMS.txt",
            browser_download_url: "https://downloads.example/SHA256SUMS.txt",
            size: 128,
          },
        ],
      });
    },
    checksumTextFetcher: async () => `${checksum}  Rocky-Setup-v0.1.4.exe\n`,
  });

  await service.checkForUpdates();
  const record = await service.downloadInstaller();

  assert.equal(record.status, "downloaded");
  assert.equal(record.download?.verified, true);
  assert.equal(record.download?.sha256, checksum);
  assert.ok(record.download?.path.endsWith("Rocky-Setup-v0.1.4.exe"));
  assert.equal(await readFile(record.download!.path, "utf8"), installerBody);
  assert.equal(authorization, "Bearer test-token");
  assert.ok(
    fetches.includes(
      "https://api.github.com/repos/rocky-projcet/rocky/releases/assets/42"
    )
  );
});

test("AppUpdateService blocks installer execution until checksum verification and restart confirmation", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-app-update-"));
  const installerBody = "installer-bytes";
  const spawned: Array<{ command: string; args: string[] }> = [];
  const service = new AppUpdateService({
    stateRoot,
    currentVersion: "0.1.3",
    platform: "win32",
    now: () => "2026-06-25T00:00:00.000Z",
    fetchImpl: async (url) => {
      if (String(url).endsWith(".exe")) {
        return response(installerBody, {
          headers: { "content-type": "application/octet-stream" },
        });
      }
      return response({
        tag_name: "v0.1.4",
        html_url: "https://github.com/rocky-projcet/rocky/releases/tag/v0.1.4",
        assets: [
          {
            name: "Rocky-Setup-v0.1.4.exe",
            browser_download_url: "https://downloads.example/Rocky-Setup-v0.1.4.exe",
            size: installerBody.length,
          },
          {
            name: "SHA256SUMS.txt",
            browser_download_url: "https://downloads.example/SHA256SUMS.txt",
            size: 128,
          },
        ],
      });
    },
    checksumTextFetcher: async () => `${sha256("other-bytes")}  Rocky-Setup-v0.1.4.exe\n`,
    spawn: (command, args) => {
      spawned.push({ command, args });
      return childProcessStub();
    },
  });

  await service.checkForUpdates();
  const download = await service.downloadInstaller();
  assert.equal(download.status, "failed");
  assert.match(download.lastError ?? "", /checksum/i);

  const unconfirmed = await service.startInstaller({ confirmedRestartRisk: false });
  assert.equal(unconfirmed.status, "failed");
  assert.match(unconfirmed.lastError ?? "", /confirm/i);

  const install = await service.startInstaller({ confirmedRestartRisk: true });
  assert.equal(install.status, "failed");
  assert.match(install.lastError ?? "", /verified/i);
  assert.deepEqual(spawned, []);
});

test("AppUpdateService starts the verified installer without deleting preserved install roots", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-app-update-"));
  const installerBody = "installer-bytes";
  const checksum = sha256(installerBody);
  const spawned: Array<{ command: string; args: string[] }> = [];
  const service = new AppUpdateService({
    stateRoot,
    currentVersion: "0.1.3",
    platform: "win32",
    now: () => "2026-06-25T00:00:00.000Z",
    fetchImpl: async (url) => {
      if (String(url).endsWith(".exe")) {
        return response(installerBody, {
          headers: { "content-type": "application/octet-stream" },
        });
      }
      return response({
        tag_name: "v0.1.4",
        html_url: "https://github.com/rocky-projcet/rocky/releases/tag/v0.1.4",
        assets: [
          {
            name: "Rocky-Setup-v0.1.4.exe",
            browser_download_url: "https://downloads.example/Rocky-Setup-v0.1.4.exe",
            size: installerBody.length,
            digest: `sha256:${checksum}`,
          },
        ],
      });
    },
    spawn: (command, args) => {
      spawned.push({ command, args });
      return childProcessStub();
    },
  });

  await service.checkForUpdates();
  await service.downloadInstaller();
  const install = await service.startInstaller({ confirmedRestartRisk: true });

  assert.equal(install.status, "install-started");
  assert.equal(install.preservedPathNames.includes(".runtime"), true);
  assert.equal(install.preservedPathNames.includes(".codex"), true);
  assert.equal(spawned.length, 1);
  assert.ok(spawned[0]!.command.endsWith("Rocky-Setup-v0.1.4.exe"));
});
