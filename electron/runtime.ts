import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface ElectronAppRootInput {
  defaultAppRoot: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
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
  platform: NodeJS.Platform;
  port: number;
  stateRoot: string;
}

export interface BackendLaunchEnvInput {
  apiBaseUrl: string;
  appVersion: string;
  baseEnv: NodeJS.ProcessEnv;
}

export interface ElectronAppVersionInput {
  appRoot: string;
  fallbackVersion: string;
}

export interface DesktopApiBaseUrlInput {
  host: string;
  port: number;
}

function pathForPlatform(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

export function resolveElectronAppRoot(input: ElectronAppRootInput): string {
  const platformPath = pathForPlatform(input.platform);

  if (input.isPackaged) {
    const resourcesAppRoot = platformPath.resolve(input.resourcesPath, "app");
    const resourcesAppExists =
      input.resourcesAppExists ?? existsSync(resourcesAppRoot);
    if (resourcesAppExists) {
      return resourcesAppRoot;
    }
  }

  return platformPath.resolve(input.defaultAppRoot);
}

export function resolveElectronStateRoot(input: ElectronPlatformPathsInput): string {
  const platformPath = pathForPlatform(input.platform);
  const configured = input.env.ROCKY_STATE_ROOT;
  if (configured && configured.trim()) {
    return platformPath.resolve(configured.trim());
  }

  if (input.platform === "win32") {
    const localAppData = input.env.LOCALAPPDATA;
    if (localAppData && localAppData.trim()) {
      return platformPath.resolve(localAppData.trim(), "Rocky", "state");
    }
  }

  if (input.platform === "darwin") {
    return platformPath.resolve(
      input.homeDir,
      "Library",
      "Application Support",
      "Rocky",
      "agent-engine"
    );
  }

  return platformPath.resolve(input.appRoot, ".runtime", "state");
}

export function resolveElectronLogRoot(input: ElectronPlatformPathsInput): string {
  const platformPath = pathForPlatform(input.platform);
  const configured = input.env.ROCKY_LOG_ROOT;
  if (configured && configured.trim()) {
    return platformPath.resolve(configured.trim());
  }

  if (input.platform === "win32") {
    const localAppData = input.env.LOCALAPPDATA;
    if (localAppData && localAppData.trim()) {
      return platformPath.resolve(localAppData.trim(), "Rocky", "logs");
    }
  }

  if (input.platform === "darwin") {
    return platformPath.resolve(input.homeDir, "Library", "Logs", "Rocky");
  }

  return platformPath.resolve(input.appRoot, ".runtime", "logs");
}

export function resolveElectronWindowIcon(
  input: ElectronWindowIconInput
): string | undefined {
  if (input.platform !== "win32") {
    return undefined;
  }

  return path.win32.resolve(
    input.appRoot,
    "assets",
    "windows",
    "rocky.ico"
  );
}

export function resolveBackendEntry(
  appRoot: string,
  platform: NodeJS.Platform = process.platform
): string {
  return pathForPlatform(platform).resolve(appRoot, "dist", "src", "cli.js");
}

export function resolveWebIndex(appRoot: string): string {
  return path.resolve(appRoot, "web", "dist", "index.html");
}

export function buildBackendLaunchArgs(input: BackendLaunchInput): string[] {
  const platformPath = pathForPlatform(input.platform);

  return [
    resolveBackendEntry(input.appRoot, input.platform),
    "serve",
    "--host",
    input.host,
    "--port",
    String(input.port),
    "--state-root",
    platformPath.resolve(input.stateRoot),
  ];
}

export function buildBackendLaunchEnv(
  input: BackendLaunchEnvInput
): NodeJS.ProcessEnv {
  return {
    ...input.baseEnv,
    AGENT_ENGINE_INTERNAL_BASE_URL: input.apiBaseUrl,
    ELECTRON_RUN_AS_NODE: "1",
    ROCKY_APP_VERSION: input.appVersion,
    ROCKY_DESKTOP_CORS: "1",
  };
}

export function resolveElectronAppVersion(
  input: ElectronAppVersionInput
): string {
  const packageJsonPath = path.join(input.appRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return input.fallbackVersion;
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : input.fallbackVersion;
  } catch {
    return input.fallbackVersion;
  }
}

export function resolveDesktopApiBaseUrl(input: DesktopApiBaseUrlInput): string {
  return `http://${input.host}:${input.port}`;
}
