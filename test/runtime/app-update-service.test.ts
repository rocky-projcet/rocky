import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, stat } from "node:fs/promises";

import {
  RockyAppUpdateService,
  appUpdateServiceInternals,
} from "../../src/installer/app-update-service.js";

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

function textResponse(value: string): Response {
  return new Response(value, {
    status: 200,
    headers: {
      "content-type": "text/plain",
    },
  });
}

function buildRelease(input: {
  assetName?: string;
  checksum?: string | null;
  digest?: string | null;
}) {
  const assetName = input.assetName ?? "rocky-v0.1.4-macos-arm64.pkg";
  const assets = [
    {
      name: assetName,
      size: 11,
      browser_download_url: "https://downloads.example.test/rocky.pkg",
      digest: input.digest ?? null,
    },
  ];

  if (input.checksum !== null) {
    assets.push({
      name: "SHA256SUMS-macos-arm64.txt",
      size: 88,
      browser_download_url: "https://downloads.example.test/SHA256SUMS-macos-arm64.txt",
      digest: null,
    });
  }

  return {
    tag_name: "v0.1.4",
    html_url: "https://github.com/rocky-projcet/rocky/releases/tag/v0.1.4",
    assets,
  };
}

test("RockyAppUpdateService selects, downloads, verifies, and opens macOS pkg assets", async () => {
  const payload = Buffer.from("pkg payload");
  const checksum = sha256(payload);
  const release = buildRelease({ checksum });
  const requested: string[] = [];
  const opened: string[] = [];
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-app-update-"));
  const service = new RockyAppUpdateService({
    stateRoot,
    platform: "darwin",
    arch: "arm64",
    currentVersion: "0.1.3",
    now: () => "2026-06-28T00:00:00.000Z",
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/releases/latest")) {
        return jsonResponse(release);
      }
      if (url.endsWith("SHA256SUMS-macos-arm64.txt")) {
        return textResponse(`${checksum}  rocky-v0.1.4-macos-arm64.pkg\n`);
      }
      if (url.endsWith("rocky.pkg")) {
        return new Response(payload);
      }
      return new Response("not found", { status: 404, statusText: "Not Found" });
    },
    openInstallerFile: async (filePath) => {
      opened.push(filePath);
      return {
        status: "opened",
        application: "Installer",
        fileName: path.basename(filePath),
        platform: "darwin",
        kind: "file",
        path: filePath,
      };
    },
  });

  const checked = await service.checkForUpdate();
  assert.equal(checked.latestStatus, "update-available");
  assert.equal(checked.asset?.kind, "pkg");
  assert.equal(checked.asset?.checksumSha256, checksum);
  assert.equal(checked.asset?.checksumSource, "release-manifest");

  const downloaded = await service.downloadUpdate();
  assert.equal(downloaded.download?.verified, true);
  assert.equal(downloaded.download?.sha256, checksum);
  assert.equal(
    (await readFile(downloaded.download!.filePath, "utf8")),
    payload.toString("utf8")
  );

  const installed = await service.openInstaller();
  assert.equal(installed.install.status, "opened");
  assert.deepEqual(opened, [downloaded.download!.filePath]);
  assert.deepEqual(requested, [
    "https://api.github.com/repos/rocky-projcet/rocky/releases/latest",
    "https://downloads.example.test/SHA256SUMS-macos-arm64.txt",
    "https://downloads.example.test/rocky.pkg",
  ]);
});

test("RockyAppUpdateService blocks install flow when checksum is missing", async () => {
  const release = buildRelease({ checksum: null });
  const service = new RockyAppUpdateService({
    stateRoot: await mkdtemp(path.join(os.tmpdir(), "rocky-app-update-no-checksum-")),
    platform: "darwin",
    arch: "arm64",
    currentVersion: "0.1.3",
    fetchImpl: async (input) => {
      if (String(input).endsWith("/releases/latest")) {
        return jsonResponse(release);
      }
      return new Response("not found", { status: 404, statusText: "Not Found" });
    },
  });

  const checked = await service.checkForUpdate();
  assert.equal(checked.latestStatus, "update-available");
  assert.equal(checked.asset?.checksumSha256, null);
  assert.equal(checked.operation.status, "failed");

  const downloaded = await service.downloadUpdate();
  assert.equal(downloaded.download, null);
  assert.equal(downloaded.operation.status, "failed");
  assert.match(downloaded.operation.lastError ?? "", /checksum/);
});

test("RockyAppUpdateService rejects checksum mismatches and removes the partial file", async () => {
  const payload = Buffer.from("pkg payload");
  const release = buildRelease({ checksum: "0".repeat(64) });
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "rocky-app-update-bad-checksum-"));
  const service = new RockyAppUpdateService({
    stateRoot,
    platform: "darwin",
    arch: "arm64",
    currentVersion: "0.1.3",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/releases/latest")) {
        return jsonResponse(release);
      }
      if (url.endsWith("SHA256SUMS-macos-arm64.txt")) {
        return textResponse(`${"0".repeat(64)}  rocky-v0.1.4-macos-arm64.pkg\n`);
      }
      if (url.endsWith("rocky.pkg")) {
        return new Response(payload);
      }
      return new Response("not found", { status: 404, statusText: "Not Found" });
    },
  });

  await service.checkForUpdate();
  const downloaded = await service.downloadUpdate();
  assert.equal(downloaded.download, null);
  assert.equal(downloaded.operation.status, "failed");
  assert.match(downloaded.operation.lastError ?? "", /checksum 검증에 실패/);

  await assert.rejects(
    stat(path.join(stateRoot, "app-updates", "rocky-v0.1.4-macos-arm64.pkg")),
    /ENOENT/
  );
});

test("RockyAppUpdateService reports unsupported platforms without network work", async () => {
  const requested: string[] = [];
  const service = new RockyAppUpdateService({
    platform: "linux",
    arch: "x64",
    currentVersion: "0.1.3",
    fetchImpl: async (input) => {
      requested.push(String(input));
      return new Response("not expected", { status: 500 });
    },
  });

  const state = await service.checkForUpdate();
  assert.equal(state.supported, false);
  assert.equal(state.operation.status, "completed");
  assert.deepEqual(requested, []);
});

test("selectMacAsset skips installers for a different architecture", () => {
  const release = {
    tag_name: "v0.1.4",
    html_url: null,
    assets: [
      {
        name: "rocky-v0.1.4-macos-x64.pkg",
        size: 10,
        browser_download_url: "https://downloads.example.test/x64.pkg",
      },
      {
        name: "rocky-v0.1.4-macos-arm64.dmg",
        size: 10,
        browser_download_url: "https://downloads.example.test/arm64.dmg",
      },
    ],
  };

  assert.equal(
    appUpdateServiceInternals.selectMacAsset(release, "arm64")?.name,
    "rocky-v0.1.4-macos-arm64.dmg"
  );
});
