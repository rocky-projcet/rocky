import path from "node:path";

import type { RuntimeSpawnOptions } from "./runtime-types.js";

export interface PreparedWindowsCommandSpawn {
  command: string;
  args: string[];
  options: RuntimeSpawnOptions;
}

function isWindowsCommandScript(command: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  const extension = path.extname(command).toLowerCase();
  return extension === ".cmd" || extension === ".bat";
}

function resolveKnownNpmCommandScript(command: string): string | null {
  if (process.platform !== "win32") {
    return null;
  }

  const basename = path.basename(command).toLowerCase();
  const commandDir = path.dirname(command);

  if (basename === "codex.cmd" || basename === "codex.bat") {
    return path.join(commandDir, "node_modules", "@openai", "codex", "bin", "codex.js");
  }

  return null;
}

export function buildSpawnOptionsForCommand(
  command: string,
  options: RuntimeSpawnOptions
): RuntimeSpawnOptions {
  if (!isWindowsCommandScript(command)) {
    return options;
  }

  return {
    ...options,
    shell: true,
  };
}

export function prepareWindowsCommandSpawn(
  command: string,
  args: string[],
  options: RuntimeSpawnOptions
): PreparedWindowsCommandSpawn {
  const npmScript = resolveKnownNpmCommandScript(command);
  if (npmScript) {
    return {
      command: "node",
      args: [npmScript, ...args],
      options,
    };
  }

  return {
    command,
    args,
    options: buildSpawnOptionsForCommand(command, options),
  };
}
