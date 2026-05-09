import {
  access as defaultAccess,
  constants as fsConstants,
  realpath as defaultRealpath,
} from "node:fs/promises";
import path from "node:path";
import { spawn as defaultSpawn } from "node:child_process";

import type { SpawnLike } from "../runtime/runtime-types.js";
import { prepareWindowsCommandSpawn } from "../runtime/windows-command-spawn.js";
import type {
  CliLatestStatus,
  CliVersionDiagnosticsRecord,
  ProviderKind,
} from "./provider-account-types.js";
import { enrichDiagnosticsWithInstallMethod } from "./cli-update-service.js";

interface LatestVersionLookupResult {
  latestVersion: string | null;
  latestCheckedAt: string | null;
  latestSource: string | null;
}

export type LatestVersionResolverLike = (
  provider: ProviderKind
) => Promise<LatestVersionLookupResult | null>;

interface CliDiagnosticsServiceOptions {
  provider: ProviderKind;
  command: string;
  versionArgs?: string[];
  spawn?: SpawnLike;
  now?: () => string;
  baseEnv?: NodeJS.ProcessEnv;
  access?: typeof defaultAccess;
  latestVersionResolver?: LatestVersionResolverLike;
}

interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const VERSION_PATTERN = /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/;

function splitPathEntries(pathValue: string | undefined): string[] {
  return (pathValue ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildExecutableCandidates(
  filePath: string,
  env: NodeJS.ProcessEnv
): string[] {
  if (process.platform !== "win32" || path.extname(filePath)) {
    return [filePath];
  }

  const pathext = splitPathEntries(
    (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").replaceAll(";", path.delimiter)
  );
  return [
    ...pathext.map((extension) => `${filePath}${extension.toLowerCase()}`),
    filePath,
  ];
}

function shouldSpawnResolvedPath(resolvedPath: string | null): resolvedPath is string {
  if (process.platform !== "win32" || !resolvedPath) {
    return false;
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  return extension === ".cmd" || extension === ".bat";
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
}

function latestVersionEnvVar(provider: ProviderKind): string {
  return provider === "codex"
    ? "CODEX_CLI_LATEST_VERSION"
    : "CLAUDE_CODE_LATEST_VERSION";
}

function latestVersionFromEnv(
  provider: ProviderKind,
  env: NodeJS.ProcessEnv,
  now: () => string
): LatestVersionLookupResult | null {
  const envVersion = readNonEmptyString(env[latestVersionEnvVar(provider)]);
  if (!envVersion) {
    return null;
  }

  return {
    latestVersion: envVersion,
    latestCheckedAt: now(),
    latestSource: `env:${latestVersionEnvVar(provider)}`,
  };
}

function extractVersion(rawText: string | null): string | null {
  if (!rawText) {
    return null;
  }

  return rawText.match(VERSION_PATTERN)?.[1] ?? null;
}

function parseComparableVersion(version: string | null): number[] | null {
  if (!version) {
    return null;
  }

  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return match.slice(1).map((segment) => Number.parseInt(segment, 10));
}

function compareVersions(current: string | null, latest: string | null): number | null {
  const left = parseComparableVersion(current);
  const right = parseComparableVersion(latest);
  if (!left || !right) {
    return null;
  }

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function latestStatusForVersions(
  currentVersion: string | null,
  latestVersion: string | null
): CliLatestStatus {
  if (!latestVersion) {
    return "unknown";
  }

  const comparison = compareVersions(currentVersion, latestVersion);
  if (comparison === null) {
    return "unknown";
  }

  return comparison < 0 ? "update-available" : "current";
}

async function resolveCommandPath(
  command: string,
  env: NodeJS.ProcessEnv,
  accessImpl: typeof defaultAccess
): Promise<string | null> {
  if (!command.trim()) {
    return null;
  }

  if (path.isAbsolute(command)) {
    for (const candidate of buildExecutableCandidates(command, env)) {
      try {
        await accessImpl(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }

    return null;
  }

  const searchPath = env.PATH ?? "";
  for (const entry of searchPath.split(path.delimiter)) {
    const directory = entry.trim();
    if (!directory) {
      continue;
    }

    for (const candidate of buildExecutableCandidates(
      path.join(directory, command),
      env
    )) {
      try {
        await accessImpl(candidate, fsConstants.X_OK);
        try {
          return await defaultRealpath(candidate);
        } catch {
          return candidate;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

function buildLatestStatusText(
  installStatus: CliVersionDiagnosticsRecord["installStatus"],
  currentVersion: string | null,
  latestVersion: string | null,
  latestStatus: CliLatestStatus
): string {
  if (installStatus === "not-installed") {
    return "CLI is not installed.";
  }

  if (installStatus === "error") {
    return "CLI diagnostics failed.";
  }

  if (!currentVersion) {
    return "CLI version could not be determined.";
  }

  if (latestStatus === "update-available" && latestVersion) {
    return `Update available: ${currentVersion} -> ${latestVersion}.`;
  }

  if (latestStatus === "current") {
    return "CLI is up to date.";
  }

  return "Latest CLI version is unknown.";
}

async function fetchLatestPackageVersion(
  packageName: string,
  now: () => string
): Promise<LatestVersionLookupResult | null> {
  const encoded = encodeURIComponent(packageName);
  const latestUrl = `https://registry.npmjs.org/${encoded}/latest`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(latestUrl, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as { version?: unknown };
    const latestVersion = readNonEmptyString(payload.version);
    if (!latestVersion) {
      return null;
    }

    return {
      latestVersion,
      latestCheckedAt: now(),
      latestSource: latestUrl,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function caskNameForProvider(provider: ProviderKind): string {
  return provider === "codex" ? "codex" : "claude-code";
}

function createDefaultLatestVersionResolver(
  env: NodeJS.ProcessEnv,
  now: () => string
): LatestVersionResolverLike {
  return async (provider) => {
    const envLookup = latestVersionFromEnv(provider, env, now);
    if (envLookup) {
      return envLookup;
    }

    if (provider === "codex") {
      return fetchLatestPackageVersion("@openai/codex", now);
    }

    return fetchLatestPackageVersion("@anthropic-ai/claude-code", now);
  };
}

export class CliDiagnosticsService {
  private readonly provider: ProviderKind;
  private readonly command: string;
  private readonly versionArgs: string[];
  private readonly spawnImpl: SpawnLike;
  private readonly now: () => string;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly accessImpl: typeof defaultAccess;
  private readonly latestVersionResolver: LatestVersionResolverLike;

  constructor(options: CliDiagnosticsServiceOptions) {
    this.provider = options.provider;
    this.command = options.command;
    this.versionArgs = options.versionArgs ?? ["--version"];
    this.spawnImpl = options.spawn ?? (defaultSpawn as unknown as SpawnLike);
    this.now = options.now ?? (() => new Date().toISOString());
    this.baseEnv = options.baseEnv ?? process.env;
    this.accessImpl = options.access ?? defaultAccess;
    this.latestVersionResolver =
      options.latestVersionResolver ??
      createDefaultLatestVersionResolver(this.baseEnv, this.now);
  }

  async getDiagnostics(): Promise<CliVersionDiagnosticsRecord> {
    const checkedAt = this.now();
    const resolvedPath = await resolveCommandPath(
      this.command,
      this.baseEnv,
      this.accessImpl
    );
    let currentVersion: string | null = null;
    let rawVersionText: string | null = null;
    let installStatus: CliVersionDiagnosticsRecord["installStatus"] =
      resolvedPath ? "installed" : "not-installed";

    try {
      const result = await this.runExternalCommand(
        shouldSpawnResolvedPath(resolvedPath) ? resolvedPath : this.command,
        this.versionArgs
      );
      rawVersionText = normalizeOutput(result.stdout, result.stderr) || null;
      currentVersion = extractVersion(rawVersionText);
      installStatus = result.exitCode === 0 ? "installed" : "error";
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        installStatus = "not-installed";
      } else {
        installStatus = "error";
        rawVersionText = error instanceof Error ? error.message : String(error);
      }
    }

    const installMethod = enrichDiagnosticsWithInstallMethod(this.provider, {
      command: this.command,
      resolvedPath,
      installStatus,
      currentVersion,
      rawVersionText,
      checkedAt,
      latestVersion: null,
      latestStatus: "unknown",
      latestCheckedAt: null,
      latestSource: null,
      statusText: "",
    }).installMethod;

    let latestVersion: string | null = null;
    let latestCheckedAt: string | null = null;
    let latestSource: string | null = null;
    let latestStatus: CliLatestStatus = "unknown";

    try {
      let latestLookup =
        latestVersionFromEnv(this.provider, this.baseEnv, this.now) ??
        (installMethod === "homebrew-cask"
          ? await this.fetchLatestHomebrewCaskVersion()
          : null);
      if (!latestLookup) {
        latestLookup = await this.latestVersionResolver(this.provider);
      }
      latestVersion = latestLookup?.latestVersion ?? null;
      latestCheckedAt = latestLookup?.latestCheckedAt ?? null;
      latestSource = latestLookup?.latestSource ?? null;
      latestStatus = latestStatusForVersions(currentVersion, latestVersion);
    } catch {
      latestStatus = "error";
    }

    return enrichDiagnosticsWithInstallMethod(this.provider, {
      command: this.command,
      resolvedPath,
      installStatus,
      currentVersion,
      rawVersionText,
      checkedAt,
      latestVersion,
      latestStatus,
      latestCheckedAt,
      latestSource,
      statusText: buildLatestStatusText(
        installStatus,
        currentVersion,
        latestVersion,
        latestStatus
      ),
    });
  }

  private async fetchLatestHomebrewCaskVersion(): Promise<LatestVersionLookupResult | null> {
    const caskName = caskNameForProvider(this.provider);
    const result = await this.runExternalCommand("brew", ["info", "--cask", caskName]);
    if (result.exitCode !== 0) {
      return null;
    }

    const rawOutput = normalizeOutput(result.stdout, result.stderr) || null;
    const latestVersion = extractVersion(rawOutput);
    if (!latestVersion) {
      return null;
    }

    return {
      latestVersion,
      latestCheckedAt: this.now(),
      latestSource: `brew:cask:${caskName}`,
    };
  }

  private runExternalCommand(command: string, args: string[]): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const prepared = prepareWindowsCommandSpawn(command, args, {
        cwd: this.baseEnv.HOME ?? process.cwd(),
        env: this.baseEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const child = this.spawnImpl(
        prepared.command,
        prepared.args,
        prepared.options
      );

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.once("error", reject);
      child.once("close", (exitCode, signal) => {
        resolve({
          exitCode,
          signal,
          stdout,
          stderr,
        });
      });
    });
  }
}
