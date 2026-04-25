import test from "node:test";
import assert from "node:assert/strict";

import { openPowerPointFile } from "../../src/api/http/native-open.js";

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
