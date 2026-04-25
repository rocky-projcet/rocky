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
}

export type NativeFileOpener = (filePath: string) => Promise<NativeFileOpenRecord>;

type ExecFilePromise = (
  file: string,
  args: string[],
  options: ExecFileOptions
) => Promise<unknown>;

interface OpenPowerPointFileOptions {
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
