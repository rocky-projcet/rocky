import assert from "node:assert/strict";
import test from "node:test";

import {
  createUpdateBackupDirectoryName,
  isPreservedInstallPath,
  normalizeInstallerRelativePath,
} from "../../src/installer/update-safety.js";

test("installer update safety preserves state and local settings roots", () => {
  for (const relativePath of [
    ".runtime/state/agents/a/sessions/s/metadata.json",
    ".runtime\\state\\agents\\a\\tasks\\t.json",
    ".codex/sessions/2026/session.jsonl",
    ".tools/node/v22.20.0/node.exe",
    ".rocky-env.ps1",
    ".env",
    ".env.local",
  ]) {
    assert.equal(isPreservedInstallPath(relativePath), true, relativePath);
  }
});

test("installer update safety treats app payload paths as replaceable", () => {
  for (const relativePath of [
    "dist/src/cli.js",
    "web/dist/index.html",
    "scripts/install-windows.ps1",
    "node_modules/fastify/package.json",
    "assets/windows/rocky.ico",
  ]) {
    assert.equal(isPreservedInstallPath(relativePath), false, relativePath);
  }
});

test("installer update safety normalizes Windows and POSIX relative paths", () => {
  assert.deepEqual(normalizeInstallerRelativePath(".runtime\\state/agents"), [
    ".runtime",
    "state",
    "agents",
  ]);
});

test("installer update backup directory names are hidden and filesystem-safe", () => {
  assert.equal(
    createUpdateBackupDirectoryName(new Date("2026-05-27T01:02:03.004Z")),
    ".rocky-update-backup-2026-05-27T01-02-03-004Z"
  );
});
