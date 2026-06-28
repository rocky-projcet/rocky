import { existsSync } from "node:fs";
import path from "node:path";

export interface ElectronAppRootInput {
  defaultAppRoot: string;
  isPackaged: boolean;
  resourcesPath: string;
  resourcesAppExists?: boolean;
}

export interface ElectronPlatformPathsInput {
  appRoot: string;
  env: Record<string, string | undefined>;
  homeDir: string;
  platform: NodeJS.Platform;
}

export interface ElectronWindowIconInput {
  appRoot: string;
  platform: NodeJS.Platform;
}

export interface BackendLaunchInput {
  appRoot: string;
  host: string;
  port: number;
  stateRoot: string;
}

export interface DesktopApiBaseUrlInput {
  host: string;
  port: number;
}

function isWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/u.test(value) || value.includes("\\");
}

function resolvePathLike(basePath: string, ...parts: string[]): string {
  const pathApi = isWindowsPath(basePath) ? path.win32 : path;
  return pathApi.resolve(basePath, ...parts);
}

function resolvePlatformPath(
  platform: NodeJS.Platform,
  basePath: string,
  ...parts: string[]
): string {
  const pathApi = platform === "win32" ? path.win32 : path;
  return pathApi.resolve(basePath, ...parts);
}

export function resolveElectronAppRoot(input: ElectronAppRootInput): string {
  if (input.isPackaged) {
    const resourcesAppRoot = resolvePathLike(input.resourcesPath, "app");
    const resourcesAppExists =
      input.resourcesAppExists ?? existsSync(resourcesAppRoot);
    if (resourcesAppExists) {
      return resourcesAppRoot;
    }
  }

  return resolvePathLike(input.defaultAppRoot);
}

export function resolveElectronStateRoot(input: ElectronPlatformPathsInput): string {
  const configured = input.env.ROCKY_STATE_ROOT;
  if (configured && configured.trim()) {
    return resolvePlatformPath(input.platform, configured.trim());
  }

  if (input.platform === "win32") {
    const localAppData = input.env.LOCALAPPDATA;
    if (localAppData && localAppData.trim()) {
      return path.win32.resolve(localAppData.trim(), "Rocky", "state");
    }
  }

  if (input.platform === "darwin") {
    return path.resolve(
      input.homeDir,
      "Library",
      "Application Support",
      "Rocky",
      "agent-engine"
    );
  }

  return resolvePathLike(input.appRoot, ".runtime", "state");
}

export function resolveElectronLogRoot(input: ElectronPlatformPathsInput): string {
  const configured = input.env.ROCKY_LOG_ROOT;
  if (configured && configured.trim()) {
    return resolvePlatformPath(input.platform, configured.trim());
  }

  if (input.platform === "win32") {
    const localAppData = input.env.LOCALAPPDATA;
    if (localAppData && localAppData.trim()) {
      return path.win32.resolve(localAppData.trim(), "Rocky", "logs");
    }
  }

  if (input.platform === "darwin") {
    return path.resolve(input.homeDir, "Library", "Logs", "Rocky");
  }

  return resolvePathLike(input.appRoot, ".runtime", "logs");
}

export function resolveElectronWindowIcon(
  input: ElectronWindowIconInput
): string | undefined {
  if (input.platform !== "win32") {
    return undefined;
  }

  return path.win32.resolve(input.appRoot, "assets", "windows", "rocky.ico");
}

export function resolveBackendEntry(appRoot: string): string {
  return resolvePathLike(appRoot, "dist", "src", "cli.js");
}

export function resolveWebIndex(appRoot: string): string {
  return resolvePathLike(appRoot, "web", "dist", "index.html");
}

export function buildBackendLaunchArgs(input: BackendLaunchInput): string[] {
  return [
    resolveBackendEntry(input.appRoot),
    "serve",
    "--host",
    input.host,
    "--port",
    String(input.port),
    "--state-root",
    resolvePathLike(input.stateRoot),
  ];
}

export function resolveDesktopApiBaseUrl(input: DesktopApiBaseUrlInput): string {
  return `http://${input.host}:${input.port}`;
}
