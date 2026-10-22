import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp } from "node:fs/promises";

import { runAgentCli } from "../../src/cli.js";

function createBufferStream(): { write(chunk: string): void; toString(): string } {
  let output = "";

  return {
    write(chunk: string) {
      output += chunk;
    },
    toString() {
      return output;
    },
  };
}

test("agent CLI creates, lists, and updates agents", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-cli-"));

  const createStdout = createBufferStream();
  const createExitCode = await runAgentCli(
    [
      "agent",
      "create",
      "--state-root",
      stateRoot,
      "--id",
      "cli-agent",
      "--name",
      "CLI Agent",
    ],
    {
      stdout: createStdout,
      stderr: createBufferStream(),
    }
  );
  const created = JSON.parse(createStdout.toString());

  assert.equal(createExitCode, 0);
  assert.equal(created.id, "cli-agent");
  await access(path.join(created.workspaceRoot, ".agents", "agent.config.json"));

  const listStdout = createBufferStream();
  const listExitCode = await runAgentCli(
    ["agent", "list", "--state-root", stateRoot],
    {
      stdout: listStdout,
      stderr: createBufferStream(),
    }
  );
  const listed = JSON.parse(listStdout.toString());

  assert.equal(listExitCode, 0);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "cli-agent");

  const updateStdout = createBufferStream();
  const updateExitCode = await runAgentCli(
    [
      "agent",
      "update",
      "cli-agent",
      "--state-root",
      stateRoot,
      "--model-profile",
      "ops",
      "--approval",
      "never",
    ],
    {
      stdout: updateStdout,
      stderr: createBufferStream(),
    }
  );
  const updated = JSON.parse(updateStdout.toString());

  assert.equal(updateExitCode, 0);
  assert.equal(updated.modelProfile, "ops");
  assert.equal(updated.approvalPolicy, "never");
});
