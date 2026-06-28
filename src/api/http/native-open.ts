import { execFile as defaultExecFile, type ExecFileOptions } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(defaultExecFile);
const POWERPOINT_APP_NAME = "Microsoft PowerPoint";
const NATIVE_OPEN_TIMEOUT_MS = 10_000;

export interface NativeFileOpenRecord {
  status: "opened";
  application: string;
  fileName: string;
  platform: NodeJS.Platform | "test";
  kind?: "file" | "folder";
  path?: string;
}

export interface NativeUrlOpenRecord {
  status: "opened";
  application: string;
  url: string;
  platform: NodeJS.Platform | "test";
  kind: "url";
}

export type NativeFileOpener = (filePath: string) => Promise<NativeFileOpenRecord>;
export type NativeFolderOpener = (
  folderPath: string
) => Promise<NativeFileOpenRecord>;
export type NativeUrlOpener = (url: string) => Promise<NativeUrlOpenRecord>;

type ExecFilePromise = (
  file: string,
  args: string[],
  options: ExecFileOptions
) => Promise<unknown>;

interface OpenPowerPointFileOptions {
  execFile?: ExecFilePromise;
  platform?: NodeJS.Platform | "test";
}

interface OpenFolderOptions {
  execFile?: ExecFilePromise;
  platform?: NodeJS.Platform | "test";
}

interface OpenFileOptions {
  execFile?: ExecFilePromise;
  platform?: NodeJS.Platform | "test";
}

interface OpenUrlOptions {
  execFile?: ExecFilePromise;
  platform?: NodeJS.Platform | "test";
}

function statusError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export async function openPowerPointFile(
  filePath: string,
  options: OpenPowerPointFileOptions = {}
): Promise<NativeFileOpenRecord> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    throw statusError(
      `PowerPoint 직접 열기는 현재 macOS 로컬 서버에서만 지원됩니다: ${platform}`,
      501
    );
  }

  const execFileImpl = options.execFile ?? (execFileAsync as ExecFilePromise);

  try {
    await execFileImpl("open", ["-a", POWERPOINT_APP_NAME, filePath], {
      timeout: NATIVE_OPEN_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw statusError(
      `${POWERPOINT_APP_NAME}에서 파일을 열지 못했습니다. PowerPoint 설치 상태를 확인하세요. ${detail}`,
      503
    );
  }

  return {
    status: "opened",
    application: POWERPOINT_APP_NAME,
    fileName: path.basename(filePath),
    platform,
  };
}

function folderOpenCommand(
  platform: NodeJS.Platform | "test",
  folderPath: string
): { file: string; args: string[]; application: string } | null {
  if (platform === "darwin") {
    return {
      file: "open",
      args: [folderPath],
      application: "Finder",
    };
  }

  if (platform === "win32") {
    return {
      file: "cmd.exe",
      args: ["/c", "start", "", folderPath],
      application: "File Explorer",
    };
  }

  if (platform === "linux") {
    return {
      file: "xdg-open",
      args: [folderPath],
      application: "file manager",
    };
  }

  return null;
}

function fileOpenCommand(
  platform: NodeJS.Platform | "test",
  filePath: string
): { file: string; args: string[]; application: string } | null {
  if (platform === "darwin") {
    return {
      file: "open",
      args: [filePath],
      application: "default application",
    };
  }

  if (platform === "win32") {
    return {
      file: "cmd.exe",
      args: ["/c", "start", "", filePath],
      application: "default application",
    };
  }

  if (platform === "linux") {
    return {
      file: "xdg-open",
      args: [filePath],
      application: "default application",
    };
  }

  return null;
}

function urlOpenCommand(
  platform: NodeJS.Platform | "test",
  url: string
): { file: string; args: string[]; application: string } | null {
  if (platform === "darwin") {
    return {
      file: "open",
      args: [url],
      application: "default browser",
    };
  }

  if (platform === "win32") {
    return {
      file: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
      application: "default browser",
    };
  }

  if (platform === "linux") {
    return {
      file: "xdg-open",
      args: [url],
      application: "default browser",
    };
  }

  return null;
}

function assertHttpUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return;
    }
  } catch {
    // Report a consistent bad request below.
  }

  throw statusError(`열 수 없는 URL입니다: ${url}`, 400);
}

export async function openFolder(
  folderPath: string,
  options: OpenFolderOptions = {}
): Promise<NativeFileOpenRecord> {
  const platform = options.platform ?? process.platform;
  const command = folderOpenCommand(platform, folderPath);
  if (!command) {
    throw statusError(
      `실제 폴더 열기는 현재 지원되지 않는 로컬 서버 플랫폼입니다: ${platform}`,
      501
    );
  }

  const execFileImpl = options.execFile ?? (execFileAsync as ExecFilePromise);

  try {
    await execFileImpl(command.file, command.args, {
      timeout: NATIVE_OPEN_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw statusError(
      `${command.application}에서 폴더를 열지 못했습니다. ${detail}`,
      503
    );
  }

  const resolvedPath = path.resolve(folderPath);

  return {
    status: "opened",
    application: command.application,
    fileName: path.basename(resolvedPath) || resolvedPath,
    platform,
    kind: "folder",
    path: resolvedPath,
  };
}

export async function openFile(
  filePath: string,
  options: OpenFileOptions = {}
): Promise<NativeFileOpenRecord> {
  const platform = options.platform ?? process.platform;
  const command = fileOpenCommand(platform, filePath);
  if (!command) {
    throw statusError(
      `실제 파일 열기는 현재 지원되지 않는 로컬 서버 플랫폼입니다: ${platform}`,
      501
    );
  }

  const execFileImpl = options.execFile ?? (execFileAsync as ExecFilePromise);

  try {
    await execFileImpl(command.file, command.args, {
      timeout: NATIVE_OPEN_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw statusError(
      `${command.application}에서 파일을 열지 못했습니다. ${detail}`,
      503
    );
  }

  const resolvedPath = path.resolve(filePath);

  return {
    status: "opened",
    application: command.application,
    fileName: path.basename(resolvedPath),
    platform,
    kind: "file",
    path: resolvedPath,
  };
}

export async function openUrl(
  url: string,
  options: OpenUrlOptions = {}
): Promise<NativeUrlOpenRecord> {
  assertHttpUrl(url);

  const platform = options.platform ?? process.platform;
  const command = urlOpenCommand(platform, url);
  if (!command) {
    throw statusError(
      `기본 브라우저 열기는 현재 지원되지 않는 로컬 서버 플랫폼입니다: ${platform}`,
      501
    );
  }

  const execFileImpl = options.execFile ?? (execFileAsync as ExecFilePromise);

  try {
    await execFileImpl(command.file, command.args, {
      timeout: NATIVE_OPEN_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw statusError(
      `${command.application}에서 URL을 열지 못했습니다. ${detail}`,
      503
    );
  }

  return {
    status: "opened",
    application: command.application,
    url,
    platform,
    kind: "url",
  };
}
