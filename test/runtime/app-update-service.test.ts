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

test("AppUpdateService prefers a macOS pkg and exposes release notes", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-app-update-"));
  const service = new AppUpdateService({
    stateRoot,
    currentVersion: "0.1.3",
    platform: "darwin",
    now: () => "2026-07-23T00:00:00.000Z",
    fetchImpl: async () =>
      response({
        tag_name: "v0.1.4",
        body: "macOS updater release notes",
        assets: [
          {
            name: "Rocky-v0.1.4.app.zip",
            browser_download_url: "https://downloads.example/Rocky-v0.1.4.app.zip",
          },
          {
            name: "Rocky-v0.1.4.dmg",
            browser_download_url: "https://downloads.example/Rocky-v0.1.4.dmg",
          },
          {
            name: "Rocky-v0.1.4.pkg",
            browser_download_url: "https://downloads.example/Rocky-v0.1.4.pkg",
          },
        ],
      }),
  });

  const record = await service.checkForUpdates();

  assert.equal(record.status, "update-available");
  assert.equal(record.installerAsset?.name, "Rocky-v0.1.4.pkg");
  assert.equal(record.installerAsset?.kind, "macos-pkg");
  assert.equal(record.releaseNotes, "macOS updater release notes");
});

test("AppUpdateService falls back from dmg to app.zip for macOS releases", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-app-update-"));
  const release = {
    tag_name: "v0.1.4",
    assets: [
      {
        name: "Rocky-v0.1.4.app.zip",
        browser_download_url: "https://downloads.example/Rocky-v0.1.4.app.zip",
      },
      {
        name: "Rocky-v0.1.4.dmg",
        browser_download_url: "https://downloads.example/Rocky-v0.1.4.dmg",
      },
    ],
  };
  const service = new AppUpdateService({
    stateRoot,
    currentVersion: "0.1.3",
    platform: "darwin",
    fetchImpl: async () => response(release),
  });

  const dmgRecord = await service.checkForUpdates();
  assert.equal(dmgRecord.installerAsset?.kind, "macos-dmg");

  const zipOnlyService = new AppUpdateService({
    stateRoot,
    currentVersion: "0.1.3",
    platform: "darwin",
    fetchImpl: async () =>
      response({
        ...release,
        assets: release.assets.slice(0, 1),
      }),
  });
  const zipRecord = await zipOnlyService.checkForUpdates();
  assert.equal(zipRecord.installerAsset?.kind, "macos-app-zip");
});

test("AppUpdateService skips macOS installers for a different architecture", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-app-update-"));
  const currentArch = process.arch;
  const otherArch = currentArch === "arm64" ? "x64" : "arm64";
  const service = new AppUpdateService({
    stateRoot,
    currentVersion: "0.1.3",
    platform: "darwin",
    fetchImpl: async () =>
      response({
        tag_name: "v0.1.4",
        assets: [
          {
            name: `Rocky-v0.1.4-macos-${otherArch}.pkg`,
            browser_download_url:
              `https://downloads.example/Rocky-v0.1.4-macos-${otherArch}.pkg`,
          },
          {
            name: `Rocky-v0.1.4-macos-${currentArch}.dmg`,
            browser_download_url:
              `https://downloads.example/Rocky-v0.1.4-macos-${currentArch}.dmg`,
          },
        ],
      }),
  });

  const record = await service.checkForUpdates();

  assert.equal(
    record.installerAsset?.name,
    `Rocky-v0.1.4-macos-${currentArch}.dmg`
  );
});

test("AppUpdateService prefers an exact architecture over a universal asset of the same kind", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-app-update-"));
  const currentArch = process.arch;
  const service = new AppUpdateService({
    stateRoot,
    currentVersion: "0.1.3",
    platform: "darwin",
    fetchImpl: async () =>
      response({
        tag_name: "v0.1.4",
        assets: [
          {
            name: "Rocky-v0.1.4-macos-universal.pkg",
            browser_download_url:
              "https://downloads.example/Rocky-v0.1.4-macos-universal.pkg",
          },
          {
            name: `Rocky-v0.1.4-macos-${currentArch}.pkg`,
            browser_download_url:
              `https://downloads.example/Rocky-v0.1.4-macos-${currentArch}.pkg`,
          },
        ],
      }),
  });

  const record = await service.checkForUpdates();

  assert.equal(
    record.installerAsset?.name,
    `Rocky-v0.1.4-macos-${currentArch}.pkg`
  );
});

test("AppUpdateService can select x64 macOS assets independently of the host architecture", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-app-update-"));
  const service = new AppUpdateService({
    stateRoot,
    currentVersion: "0.1.3",
    platform: "darwin",
    arch: "x64",
    fetchImpl: async () =>
      response({
        tag_name: "v0.1.4",
        assets: [
          {
            name: "Rocky-v0.1.4-macos-arm64.pkg",
            browser_download_url:
              "https://downloads.example/Rocky-v0.1.4-macos-arm64.pkg",
          },
          {
            name: "Rocky-v0.1.4-macos-x64.pkg",
            browser_download_url:
              "https://downloads.example/Rocky-v0.1.4-macos-x64.pkg",
          },
        ],
      }),
  });

  const record = await service.checkForUpdates();

  assert.equal(
    record.installerAsset?.name,
    "Rocky-v0.1.4-macos-x64.pkg"
  );
});

test("AppUpdateService opens a verified macOS pkg with Installer", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-app-update-"));
  const installerBody = "macos-pkg-bytes";
  const checksum = sha256(installerBody);
  const spawned: Array<{ command: string; args: string[] }> = [];
  const service = new AppUpdateService({
    stateRoot,
    currentVersion: "0.1.3",
    platform: "darwin",
    now: () => "2026-07-23T00:00:00.000Z",
    fetchImpl: async (url) => {
      if (String(url).endsWith(".pkg")) {
        return response(installerBody, {
          headers: { "content-type": "application/octet-stream" },
        });
      }
      return response({
        tag_name: "v0.1.4",
        assets: [
          {
            name: "Rocky-v0.1.4.pkg",
            browser_download_url: "https://downloads.example/Rocky-v0.1.4.pkg",
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
  assert.deepEqual(spawned, [
    {
      command: "/usr/bin/open",
      args: [path.join(stateRoot, ".runtime", "app-updates", "Rocky-v0.1.4.pkg")],
    },
  ]);
});

test("AppUpdateService enters downloading state before a streamed asset completes", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-app-update-"));
  const installerBody = "streamed-installer";
  const checksum = sha256(installerBody);
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const service = new AppUpdateService({
    stateRoot,
    currentVersion: "0.1.3",
    platform: "darwin",
    fetchImpl: async (url) => {
      if (String(url).endsWith(".pkg")) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              streamController = controller;
            },
          }),
          {
            headers: {
              "content-length": String(Buffer.byteLength(installerBody)),
              "content-type": "application/octet-stream",
            },
          }
        );
      }
      return response({
        tag_name: "v0.1.4",
        assets: [
          {
            name: "Rocky-v0.1.4.pkg",
            browser_download_url: "https://downloads.example/Rocky-v0.1.4.pkg",
            digest: `sha256:${checksum}`,
          },
        ],
      });
    },
  });

  await service.checkForUpdates();
  const downloadPromise = service.downloadInstaller();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(service.getState().status, "downloading");

  streamController!.enqueue(Buffer.from(installerBody));
  streamController!.close();
  const record = await downloadPromise;
  assert.deepEqual(record.downloadProgress, {
    bytesReceived: Buffer.byteLength(installerBody),
    totalBytes: Buffer.byteLength(installerBody),
    percent: 100,
  });
});

test("AppUpdateService exposes a download reveal action for manual macOS recovery", async () => {
  const service = new AppUpdateService({
    platform: "darwin",
  });
  const revealDownload = (
    service as unknown as {
      revealDownload?: () => Promise<unknown>;
    }
  ).revealDownload;

  assert.equal(typeof revealDownload, "function");
});
