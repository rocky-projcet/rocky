import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CODEX_BIN = "codex";
const COMMON_POSIX_CODEX_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
];

function splitPathEntries(pathValue: string | undefined): string[] {
  return (pathValue ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isBareCommand(command: string): boolean {
  return !path.isAbsolute(command) && !command.includes("/") && !command.includes("\\");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) {
      return false;
    }

    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function buildExecutableCandidates(
  filePath: string,
  baseEnv: NodeJS.ProcessEnv
): string[] {
  if (process.platform !== "win32") {
    return [filePath];
  }

  const extension = path.extname(filePath);
  if (extension) {
    return [filePath];
  }

  const pathext = splitPathEntries(
    (baseEnv.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").replaceAll(";", path.delimiter)
  );

  return [...pathext.map((suffix) => `${filePath}${suffix.toLowerCase()}`), filePath];
}

async function resolveBareCommand(
  command: string,
  baseEnv: NodeJS.ProcessEnv
): Promise<string | null> {
  const searchDirs = uniqueStrings([
    ...splitPathEntries(baseEnv.PATH),
    ...(process.platform === "win32" ? [] : COMMON_POSIX_CODEX_DIRS),
  ]);

  for (const directory of searchDirs) {
    for (const candidate of buildExecutableCandidates(
      path.join(directory, command),
      baseEnv
    )) {
      if (await isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export async function resolveCodexBin(
  requestedBin: string | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const normalized = requestedBin?.trim() || DEFAULT_CODEX_BIN;

  if (isBareCommand(normalized)) {
    return (await resolveBareCommand(normalized, baseEnv)) ?? normalized;
  }

  const resolvedPath = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(normalized);
  if (await isExecutableFile(resolvedPath)) {
    return resolvedPath;
  }

  if (path.basename(normalized) === DEFAULT_CODEX_BIN) {
    return (await resolveBareCommand(DEFAULT_CODEX_BIN, baseEnv)) ?? resolvedPath;
  }

  return resolvedPath;
}
