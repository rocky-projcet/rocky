import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  openFolder,
  openPowerPointFile,
  openUrl,
} from "../../src/api/http/native-open.js";

test("openPowerPointFile launches Microsoft PowerPoint through macOS open", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];

  const result = await openPowerPointFile("/tmp/project deck.pptx", {
    platform: "darwin",
    execFile: async (file, args) => {
      calls.push({ file, args });
    },
  });

  assert.deepEqual(calls, [
    {
      file: "open",
      args: ["-a", "Microsoft PowerPoint", "/tmp/project deck.pptx"],
    },
  ]);
  assert.deepEqual(result, {
    status: "opened",
    application: "Microsoft PowerPoint",
    fileName: "project deck.pptx",
    platform: "darwin",
  });
});

test("openPowerPointFile reports unsupported native open platforms", async () => {
  await assert.rejects(
    () =>
      openPowerPointFile("/tmp/project.pptx", {
        platform: "linux",
        execFile: async () => {
          throw new Error("should not run");
        },
      }),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 501);
      assert.match(String((error as Error).message), /macOS/);
      return true;
    }
  );
});

test("openFolder launches the platform file manager", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const folderPath = "/tmp/project folder";

  const result = await openFolder(folderPath, {
    platform: "darwin",
    execFile: async (file, args) => {
      calls.push({ file, args });
    },
  });

  assert.deepEqual(calls, [
    {
      file: "open",
      args: [folderPath],
    },
  ]);
  const resolvedPath = path.resolve(folderPath);
  assert.deepEqual(result, {
    status: "opened",
    application: "Finder",
    fileName: path.basename(resolvedPath),
    platform: "darwin",
    kind: "folder",
    path: resolvedPath,
  });
});

test("openFolder launches Windows File Explorer without waiting on explorer.exe", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const folderPath = String.raw`C:\Users\jsh\Project Folder`;

  const result = await openFolder(folderPath, {
    platform: "win32",
    execFile: async (file, args) => {
      calls.push({ file, args });
    },
  });

  assert.deepEqual(calls, [
    {
      file: "cmd.exe",
      args: ["/c", "start", "", folderPath],
    },
  ]);
  assert.equal(result.status, "opened");
  assert.equal(result.application, "File Explorer");
  assert.equal(result.platform, "win32");
  assert.equal(result.kind, "folder");
});

test("openFolder reports unsupported native open platforms", async () => {
  await assert.rejects(
    () =>
      openFolder("/tmp/project", {
        platform: "test",
        execFile: async () => {
          throw new Error("should not run");
        },
      }),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 501);
      assert.match(String((error as Error).message), /지원되지 않는/);
      return true;
    }
  );
});

test("openUrl launches the platform default browser", async () => {
  const calls: Array<{ file: string; args: string[] }> = [];

  const result = await openUrl("https://example.com/login", {
    platform: "darwin",
    execFile: async (file, args) => {
      calls.push({ file, args });
    },
  });

  assert.deepEqual(calls, [
    {
      file: "open",
      args: ["https://example.com/login"],
    },
  ]);
  assert.deepEqual(result, {
    status: "opened",
    application: "default browser",
    url: "https://example.com/login",
    platform: "darwin",
    kind: "url",
  });
});

test("openUrl rejects non-http URLs", async () => {
  await assert.rejects(
    () =>
      openUrl("file:///tmp/secret", {
        platform: "darwin",
        execFile: async () => {
          throw new Error("should not run");
        },
      }),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      assert.match(String((error as Error).message), /열 수 없는 URL/);
      return true;
    }
  );
});
