#!/usr/bin/env node

import { cp, mkdir, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with ${
            signal ? `signal ${signal}` : `exit code ${code}`
          }`
        )
      );
    });
  });
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

await rm(path.join(repoRoot, "dist"), { recursive: true, force: true });

await run(process.execPath, [
  path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
  "--project",
  "tsconfig.json",
]);

const fixturesSource = path.join(repoRoot, "test", "runtime", "fixtures");
if (await exists(fixturesSource)) {
  const fixturesTarget = path.join(repoRoot, "dist", "test", "runtime", "fixtures");
  await mkdir(path.dirname(fixturesTarget), { recursive: true });
  await cp(fixturesSource, fixturesTarget, { recursive: true });
}
