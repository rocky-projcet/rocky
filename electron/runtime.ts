import path from "node:path";

export interface ElectronAppRootInput {
  defaultAppRoot: string;
  isPackaged: boolean;
  resourcesPath: string;
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

export function resolveElectronAppRoot(input: ElectronAppRootInput): string {
  if (input.isPackaged) {
    return path.resolve(input.resourcesPath, "app");
  }

  return path.resolve(input.defaultAppRoot);
}

export function resolveElectronStateRoot(input: ElectronPlatformPathsInput): string {
  const configured = input.env.ROCKY_STATE_ROOT;
  if (configured && configured.trim()) {
    return path.resolve(configured.trim());
  }

  if (input.platform === "win32") {
    const localAppData = input.env.LOCALAPPDATA;
    if (localAppData && localAppData.trim()) {
      return path.resolve(localAppData.trim(), "Rocky", "state");
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

  return path.resolve(input.appRoot, ".runtime", "state");
}

export function resolveElectronLogRoot(input: ElectronPlatformPathsInput): string {
  const configured = input.env.ROCKY_LOG_ROOT;
  if (configured && configured.trim()) {
    return path.resolve(configured.trim());
  }

  if (input.platform === "win32") {
    const localAppData = input.env.LOCALAPPDATA;
    if (localAppData && localAppData.trim()) {
      return path.resolve(localAppData.trim(), "Rocky", "logs");
    }
  }

  if (input.platform === "darwin") {
    return path.resolve(input.homeDir, "Library", "Logs", "Rocky");
  }

  return path.resolve(input.appRoot, ".runtime", "logs");
}

export function resolveElectronWindowIcon(
  input: ElectronWindowIconInput
): string | undefined {
  if (input.platform !== "win32") {
    return undefined;
  }

  return path.resolve(input.appRoot, "assets", "windows", "rocky.ico");
}

export function resolveBackendEntry(appRoot: string): string {
  return path.resolve(appRoot, "dist", "src", "cli.js");
}

export function resolveWebIndex(appRoot: string): string {
  return path.resolve(appRoot, "web", "dist", "index.html");
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
    path.resolve(input.stateRoot),
  ];
}

export function resolveDesktopApiBaseUrl(input: DesktopApiBaseUrlInput): string {
  return `http://${input.host}:${input.port}`;
}
