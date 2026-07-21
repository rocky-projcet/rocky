import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";
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

test("app update routes check, download, and require explicit installer confirmation", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "app-update-routes-"));
  const installerBody = "installer-bytes";
  const checksum = sha256(installerBody);
  const spawned: string[] = [];
  const appUpdateService = new AppUpdateService({
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
    spawn: (command) => {
      spawned.push(command);
      return childProcessStub();
    },
  });
  const server = createAgentEngineServer({
    stateRoot,
    appUpdateService,
  });

  await server.listen({
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const address = server.server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const initial = await fetch(`${baseUrl}/rocky/app-update`);
    assert.equal(initial.status, 200);
    assert.equal((await initial.json() as { currentVersion: string }).currentVersion, "0.1.3");

    const checked = await fetch(`${baseUrl}/rocky/app-update/check`, {
      method: "POST",
    });
    assert.equal(checked.status, 200);
    assert.equal((await checked.json() as { status: string }).status, "update-available");

    const downloaded = await fetch(`${baseUrl}/rocky/app-update/download`, {
      method: "POST",
    });
    assert.equal(downloaded.status, 202);
    assert.equal((await downloaded.json() as { status: string }).status, "downloaded");

    const unconfirmedInstall = await fetch(`${baseUrl}/rocky/app-update/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmedRestartRisk: false }),
    });
    assert.equal(unconfirmedInstall.status, 400);

    const install = await fetch(`${baseUrl}/rocky/app-update/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmedRestartRisk: true }),
    });
    assert.equal(install.status, 202);
    assert.equal((await install.json() as { status: string }).status, "install-started");
    assert.equal(spawned.length, 1);
  } finally {
    await server.close();
  }
});
