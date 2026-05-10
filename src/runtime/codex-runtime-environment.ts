import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ensureWorkspaceSkillBridge,
  shouldManageWorkspaceSkillBridge,
} from "../agents/agent-workspace.js";

import type { RuntimeAuthSource, RuntimeSession } from "./runtime-types.js";

export interface PreparedCodexRuntimeEnvironment {
  env: NodeJS.ProcessEnv;
  effectiveHome: string;
  xdgRoot: string;
  sharedHomeFallback: boolean;
}

export const SHARED_HOME_WRITABLE_SANDBOX_WARNING =
  "Writable Codex runs on this host use the shared HOME with isolated XDG state because isolated HOME breaks live shell/file execution.";

function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return code === "EACCES" || code === "EPERM" || code === "EROFS";
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function seedCodexAuth(
  runtimeHome: string,
  sourceHome: string | null
): Promise<void> {
  if (!sourceHome) {
    return;
  }

  const sourceAuth = path.join(sourceHome, ".codex", "auth.json");
  const targetAuth = path.join(runtimeHome, ".codex", "auth.json");

  if (!(await exists(sourceAuth)) || (await exists(targetAuth))) {
    return;
  }

  await mkdir(path.dirname(targetAuth), { recursive: true });
  await copyFile(sourceAuth, targetAuth);
}

async function seedCodexConfig(
  runtimeHome: string,
  sourceHome: string | null
): Promise<void> {
  if (!sourceHome) {
    return;
  }

  const sourceConfig = path.join(sourceHome, ".codex", "config.toml");
  const targetConfig = path.join(runtimeHome, ".codex", "config.toml");

  if (!(await exists(sourceConfig)) || (await exists(targetConfig))) {
    return;
  }

  await mkdir(path.dirname(targetConfig), { recursive: true });
  await copyFile(sourceConfig, targetConfig);
}

async function collectMatchingRolloutFiles(
  homePath: string,
  runtimeSessionId: string
): Promise<
  Map<
    string,
    {
      absolutePath: string;
      relativePath: string;
      mtimeMs: number;
      size: number;
    }
  >
> {
  const sessionsRoot = path.join(homePath, ".codex", "sessions");
  if (!(await exists(sessionsRoot))) {
    return new Map();
  }

  const matches = new Map<
    string,
    {
      absolutePath: string;
      relativePath: string;
      mtimeMs: number;
      size: number;
    }
  >();
  const stack = [sessionsRoot];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    for (const entry of await readdir(currentDir, { withFileTypes: true })) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (
        !entry.isFile() ||
        !entry.name.endsWith(".jsonl") ||
        !entry.name.includes(runtimeSessionId)
      ) {
        continue;
      }

      const metadata = await stat(absolutePath);
      matches.set(entry.name, {
        absolutePath,
        relativePath: path.relative(sessionsRoot, absolutePath),
        mtimeMs: metadata.mtimeMs,
        size: metadata.size,
      });
    }
  }

  return matches;
}

async function syncCodexSessionRollouts({
  runtimeHome,
  sourceHome,
  runtimeSessionId,
}: {
  runtimeHome: string;
  sourceHome: string | null;
  runtimeSessionId?: string | null;
}): Promise<void> {
  if (!sourceHome || !runtimeSessionId) {
    return;
  }

  const resolvedRuntimeHome = path.resolve(runtimeHome);
  const resolvedSourceHome = path.resolve(sourceHome);
  if (resolvedRuntimeHome === resolvedSourceHome) {
    return;
  }

  const runtimeMatches = await collectMatchingRolloutFiles(
    resolvedRuntimeHome,
    runtimeSessionId
  );
  const sourceMatches = await collectMatchingRolloutFiles(
    resolvedSourceHome,
    runtimeSessionId
  );
  const sessionFileNames = new Set([
    ...runtimeMatches.keys(),
    ...sourceMatches.keys(),
  ]);

  for (const fileName of sessionFileNames) {
    const runtimeEntry = runtimeMatches.get(fileName) ?? null;
    const sourceEntry = sourceMatches.get(fileName) ?? null;
    const newestEntry =
      !runtimeEntry
        ? sourceEntry
        : !sourceEntry
          ? runtimeEntry
          : sourceEntry.mtimeMs > runtimeEntry.mtimeMs ||
              (sourceEntry.mtimeMs === runtimeEntry.mtimeMs &&
                sourceEntry.size > runtimeEntry.size)
            ? sourceEntry
            : runtimeEntry;

    if (!newestEntry) {
      continue;
    }

    for (const targetHome of [resolvedRuntimeHome, resolvedSourceHome]) {
      const targetPath = path.join(
        targetHome,
        ".codex",
        "sessions",
        newestEntry.relativePath
      );
      const targetStat = await stat(targetPath).catch(() => null);
      if (
        targetStat &&
        (targetStat.mtimeMs > newestEntry.mtimeMs ||
          (targetStat.mtimeMs === newestEntry.mtimeMs &&
            targetStat.size >= newestEntry.size))
      ) {
        continue;
      }

      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(newestEntry.absolutePath, targetPath);
    }
  }
}

function buildWorkspaceTrustStanza(workspaceRoot: string): string {
  const escapedWorkspace = workspaceRoot.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `[projects."${escapedWorkspace}"]\ntrust_level = "trusted"\n`;
}

async function ensureWorkspaceTrust(
  runtimeHome: string,
  workspaceRoot?: string
): Promise<void> {
  if (!workspaceRoot) {
    return;
  }

  const resolvedWorkspace = path.resolve(workspaceRoot);
  const configPath = path.join(runtimeHome, ".codex", "config.toml");
  const trustStanza = buildWorkspaceTrustStanza(resolvedWorkspace);
  const currentConfig = (await exists(configPath))
    ? await readFile(configPath, "utf8")
    : "";

  if (currentConfig.includes(trustStanza.trim())) {
    return;
  }

  const nextConfig = currentConfig.trim()
    ? `${currentConfig.trimEnd()}\n\n${trustStanza}`
    : trustStanza;
  await writeFile(configPath, nextConfig, "utf8");
}

async function ensureWorkspaceTrustSafely({
  runtimeHome,
  workspaceRoot,
  sharedHomeFallback,
}: {
  runtimeHome: string;
  workspaceRoot?: string;
  sharedHomeFallback: boolean;
}): Promise<void> {
  try {
    await ensureWorkspaceTrust(runtimeHome, workspaceRoot);
  } catch (error) {
    if (!sharedHomeFallback || !isPermissionDenied(error)) {
      throw error;
    }
  }
}

function buildGitCeilingDirectories(
  workspaceRoot: string | undefined,
  inheritedValue: string | undefined
): string | undefined {
  if (!workspaceRoot) {
    return inheritedValue;
  }

  const resolvedWorkspaceParent = path.dirname(path.resolve(workspaceRoot));
  const inheritedEntries = (inheritedValue ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return [resolvedWorkspaceParent, ...inheritedEntries]
    .filter((entry, index, entries) => entries.indexOf(entry) === index)
    .join(path.delimiter);
}

function resolvePlaywrightBrowsersPath(
  baseEnv: NodeJS.ProcessEnv
): string | undefined {
  if (baseEnv.PLAYWRIGHT_BROWSERS_PATH) {
    return baseEnv.PLAYWRIGHT_BROWSERS_PATH;
  }

  const baseHome = baseEnv.HOME ? path.resolve(baseEnv.HOME) : null;
  if (!baseHome) {
    return undefined;
  }

  if (process.platform === "darwin") {
    return path.join(baseHome, "Library", "Caches", "ms-playwright");
  }

  if (process.platform === "win32") {
    return path.join(baseHome, "AppData", "Local", "ms-playwright");
  }

  return path.join(baseHome, ".cache", "ms-playwright");
}

function resolveCurrentHome(baseEnv?: NodeJS.ProcessEnv): string | null {
  const home =
    baseEnv?.HOME?.trim() ||
    baseEnv?.USERPROFILE?.trim() ||
    os.homedir();

  return home ? path.resolve(home) : null;
}

function resolveSandboxMode(session: RuntimeSession): string | null {
  if (session.config.fullAuto) {
    return "workspace-write";
  }

  return session.config.sandbox;
}

function normalizeAuthSource({
  authSource,
  baseEnv,
  seedAuthFromCurrentHome,
}: {
  authSource?: RuntimeAuthSource | null;
  baseEnv?: NodeJS.ProcessEnv;
  seedAuthFromCurrentHome?: boolean;
}): {
  kind: RuntimeAuthSource["kind"];
  authProfileId: string | null;
  sourceHome: string | null;
} {
  if (authSource?.kind === "none") {
    return {
      kind: "none",
      authProfileId: authSource.authProfileId ?? null,
      sourceHome: null,
    };
  }

  if (authSource?.kind === "managed-home") {
    if (!authSource.homePath) {
      throw new Error("Managed auth source requires homePath.");
    }

    return {
      kind: "managed-home",
      authProfileId: authSource.authProfileId ?? null,
      sourceHome: path.resolve(authSource.homePath),
    };
  }

  if (authSource?.kind === "current-home" && authSource.homePath) {
    return {
      kind: "current-home",
      authProfileId: authSource.authProfileId ?? null,
      sourceHome: path.resolve(authSource.homePath),
    };
  }

  if (seedAuthFromCurrentHome === false) {
    return {
      kind: "none",
      authProfileId: null,
      sourceHome: null,
    };
  }

  const currentHome = resolveCurrentHome(baseEnv);
  return {
    kind: "current-home",
    authProfileId: null,
    sourceHome: currentHome,
  };
}

export function shouldUseSharedHomeForWritableSandbox({
  session,
  request,
  baseEnv = process.env,
  authSource,
}: {
  session: RuntimeSession;
  request?: {
    dangerouslyBypassApprovalsAndSandbox?: boolean;
  } | null;
  baseEnv?: NodeJS.ProcessEnv;
  authSource?: RuntimeAuthSource | null;
}): boolean {
  if (authSource?.kind === "managed-home") {
    return false;
  }

  if (request?.dangerouslyBypassApprovalsAndSandbox) {
    return false;
  }

  const baseHome = resolveCurrentHome(baseEnv);
  if (!baseHome) {
    return false;
  }

  const sandboxMode = resolveSandboxMode(session);
  if (sandboxMode !== "workspace-write") {
    return false;
  }

  return path.resolve(session.runtimeHome) !== path.resolve(baseHome);
}

export async function prepareCodexRuntimeEnvironment({
  runtimeHome,
  workspaceRoot,
  baseEnv = process.env,
  extraEnv = {},
  authSource,
  runtimeSessionId,
  seedAuthFromCurrentHome = true,
  shareHomeWithBaseEnv = false,
  reuseBasePlaywrightBrowsers = false,
}: {
  runtimeHome?: string;
  workspaceRoot?: string;
  baseEnv?: NodeJS.ProcessEnv;
  extraEnv?: NodeJS.ProcessEnv;
  authSource?: RuntimeAuthSource | null;
  runtimeSessionId?: string | null;
  seedAuthFromCurrentHome?: boolean;
  shareHomeWithBaseEnv?: boolean;
  reuseBasePlaywrightBrowsers?: boolean;
}): Promise<PreparedCodexRuntimeEnvironment> {
  const isolatedRoot = path.resolve(runtimeHome ?? baseEnv.HOME ?? os.homedir());
  const normalizedAuthSource = normalizeAuthSource({
    authSource,
    baseEnv,
    seedAuthFromCurrentHome,
  });
  const baseHome = resolveCurrentHome(baseEnv);
  const managedAuthHome =
    normalizedAuthSource.kind === "managed-home"
      ? normalizedAuthSource.sourceHome
      : null;
  const sharedHomeFallback = Boolean(
    !managedAuthHome && shareHomeWithBaseEnv && baseHome
  );
  const effectiveHome = managedAuthHome
    ? managedAuthHome
    : sharedHomeFallback && baseHome
      ? baseHome
      : isolatedRoot;
  const xdgRoot = managedAuthHome || sharedHomeFallback ? isolatedRoot : effectiveHome;
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    PATH: baseEnv.PATH ?? "",
    HOME: effectiveHome,
    XDG_CONFIG_HOME: path.join(xdgRoot, "xdg-config"),
    XDG_STATE_HOME: path.join(xdgRoot, "xdg-state"),
    XDG_CACHE_HOME: path.join(xdgRoot, "xdg-cache"),
    GIT_CEILING_DIRECTORIES: buildGitCeilingDirectories(
      workspaceRoot,
      baseEnv.GIT_CEILING_DIRECTORIES
    ),
    LANG: baseEnv.LANG ?? "C.UTF-8",
    TERM: baseEnv.TERM ?? "xterm-256color",
    NO_COLOR: "1",
    ...(reuseBasePlaywrightBrowsers
      ? {
        PLAYWRIGHT_BROWSERS_PATH: resolvePlaywrightBrowsersPath(baseEnv),
      }
      : {}),
    ...extraEnv,
  };

  await mkdir(xdgRoot, { recursive: true });
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true });
  await mkdir(env.XDG_STATE_HOME, { recursive: true });
  await mkdir(env.XDG_CACHE_HOME, { recursive: true });
  if (workspaceRoot) {
    const resolvedWorkspace = path.resolve(workspaceRoot);
    if (await shouldManageWorkspaceSkillBridge(resolvedWorkspace)) {
      await ensureWorkspaceSkillBridge(resolvedWorkspace);
    }
  }

  try {
    await mkdir(path.join(effectiveHome, ".codex"), { recursive: true });
  } catch (error) {
    if (!sharedHomeFallback || !isPermissionDenied(error)) {
      throw error;
    }
  }
  if (
    normalizedAuthSource.sourceHome &&
    path.resolve(normalizedAuthSource.sourceHome) !== path.resolve(effectiveHome)
  ) {
    await seedCodexAuth(effectiveHome, normalizedAuthSource.sourceHome);
    await seedCodexConfig(effectiveHome, normalizedAuthSource.sourceHome);
  }
  await syncCodexSessionRollouts({
    runtimeHome: isolatedRoot,
    sourceHome: normalizedAuthSource.sourceHome,
    runtimeSessionId,
  });
  await ensureWorkspaceTrustSafely({
    runtimeHome: effectiveHome,
    workspaceRoot,
    sharedHomeFallback,
  });

  return {
    env,
    effectiveHome,
    xdgRoot,
    sharedHomeFallback,
  };
}

export async function maybeReadLastMessage(
  filePath: string | null | undefined
): Promise<string | null> {
  if (!filePath || !(await exists(filePath))) {
    return null;
  }

  return readFile(filePath, "utf8");
}
