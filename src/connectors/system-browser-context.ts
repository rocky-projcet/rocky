import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  chromium,
  type Browser,
  type BrowserContext,
} from "playwright";

import type { ChromiumChannel } from "./connector-types.js";

export interface SystemBrowserContext {
  browser: Browser;
  context: BrowserContext;
  debuggingPort: number;
  close: () => Promise<void>;
}

interface SystemBrowserLauncher {
  command: string;
  args: string[];
  earlyExitIsFatal: boolean;
}

export async function launchSystemBrowserContext(input: {
  channel: ChromiumChannel;
  userDataDir: string;
  viewport: { width: number; height: number };
  locale: string;
}): Promise<SystemBrowserContext | null> {
  const port = await findFreePort();
  const userDataDir = path.resolve(input.userDataDir);
  const browserArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--lang=${input.locale}`,
    `--window-size=${input.viewport.width},${input.viewport.height}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ];
  const launcher = await resolveSystemBrowserLauncher(input.channel, browserArgs);
  if (!launcher) {
    return null;
  }

  const child = spawn(launcher.command, launcher.args, {
    stdio: "ignore",
  });

  try {
    await waitForCdpEndpoint(port, child, {
      earlyExitIsFatal: launcher.earlyExitIsFatal,
    });
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error("시스템 브라우저의 기본 프로필 컨텍스트를 찾지 못했습니다.");
    }
    context.setDefaultTimeout(20_000);
    context.setDefaultNavigationTimeout(30_000);
    for (const page of context.pages()) {
      await page.setViewportSize(input.viewport).catch(() => {});
    }

    return {
      browser,
      context,
      debuggingPort: port,
      close: async () => {
        await browser.close().catch(() => {});
        if (!child.killed) {
          child.kill();
        }
      },
    };
  } catch (error) {
    if (!child.killed) {
      child.kill();
    }
    throw error;
  }
}

export async function connectExistingSystemBrowserContext(input: {
  debuggingPort: number;
  viewport: { width: number; height: number };
}): Promise<SystemBrowserContext | null> {
  const port = input.debuggingPort;
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    return null;
  }
  if (!(await isCdpEndpointAvailable(port))) {
    return null;
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => {});
    return null;
  }
  context.setDefaultTimeout(20_000);
  context.setDefaultNavigationTimeout(30_000);
  for (const page of context.pages()) {
    await page.setViewportSize(input.viewport).catch(() => {});
  }

  return {
    browser,
    context,
    debuggingPort: port,
    close: async () => {
      await browser.close().catch(() => {});
    },
  };
}

async function resolveSystemBrowserLauncher(
  channel: ChromiumChannel,
  browserArgs: string[],
): Promise<SystemBrowserLauncher | null> {
  if (process.platform === "darwin") {
    const appName = await resolveMacBrowserAppName(channel);
    if (appName) {
      return {
        command: "/usr/bin/open",
        args: ["-na", appName, "--args", ...browserArgs],
        earlyExitIsFatal: false,
      };
    }
  }

  const executable = await resolveSystemBrowserExecutable(channel);
  if (!executable) {
    return null;
  }
  return {
    command: executable,
    args: browserArgs,
    earlyExitIsFatal: true,
  };
}

async function resolveMacBrowserAppName(
  channel: ChromiumChannel,
): Promise<string | null> {
  const candidates = macBrowserAppCandidates(channel);
  for (const candidate of candidates) {
    try {
      await access(candidate.path);
      return candidate.name;
    } catch {
      // Try the next app bundle.
    }
  }
  return null;
}

async function resolveSystemBrowserExecutable(
  channel: ChromiumChannel,
): Promise<string | null> {
  const candidates = executableCandidates(channel);
  for (const candidate of candidates) {
    if (isBareCommand(candidate)) {
      return candidate;
    }
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function executableCandidates(channel: ChromiumChannel): string[] {
  if (channel === "msedge") {
    if (process.platform === "darwin") {
      return [
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        path.join(os.homedir(), "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
      ];
    }
    if (process.platform === "win32") {
      return [
        path.join(process.env.PROGRAMFILES ?? "", "Microsoft/Edge/Application/msedge.exe"),
        path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Microsoft/Edge/Application/msedge.exe"),
      ].filter(Boolean);
    }
    return ["microsoft-edge", "microsoft-edge-stable"];
  }

  if (channel === "chrome") {
    if (process.platform === "darwin") {
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      ];
    }
    if (process.platform === "win32") {
      return [
        path.join(process.env.PROGRAMFILES ?? "", "Google/Chrome/Application/chrome.exe"),
        path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Google/Chrome/Application/chrome.exe"),
        path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
      ].filter(Boolean);
    }
    return ["google-chrome", "google-chrome-stable", "chrome"];
  }

  return [];
}

function macBrowserAppCandidates(
  channel: ChromiumChannel,
): Array<{ name: string; path: string }> {
  if (channel === "msedge") {
    return [
      {
        name: "Microsoft Edge",
        path: "/Applications/Microsoft Edge.app",
      },
      {
        name: "Microsoft Edge",
        path: path.join(os.homedir(), "Applications/Microsoft Edge.app"),
      },
    ];
  }

  if (channel === "chrome") {
    return [
      {
        name: "Google Chrome",
        path: "/Applications/Google Chrome.app",
      },
      {
        name: "Google Chrome",
        path: path.join(os.homedir(), "Applications/Google Chrome.app"),
      },
    ];
  }

  return [];
}

function isBareCommand(value: string): boolean {
  return !value.includes("/") && !value.includes("\\");
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) {
          resolve(address.port);
        } else {
          reject(new Error("사용 가능한 Chrome debugging port를 찾지 못했습니다."));
        }
      });
    });
  });
}

async function waitForCdpEndpoint(
  port: number,
  child: ChildProcess,
  options: { earlyExitIsFatal: boolean },
): Promise<void> {
  const deadline = Date.now() + 12_000;
  let exitError: Error | null = null;
  child.once("error", (error) => {
    exitError = error;
  });
  child.once("exit", (code, signal) => {
    if (options.earlyExitIsFatal || code !== 0) {
      exitError = new Error(
        `시스템 브라우저가 시작 중 종료되었습니다. code=${code ?? "null"}, signal=${signal ?? "null"}`,
      );
    }
  });

  while (Date.now() < deadline) {
    if (exitError) {
      throw exitError;
    }
    if (await isCdpEndpointAvailable(port)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("시스템 Chrome debugging endpoint가 시간 안에 열리지 않았습니다.");
}

async function isCdpEndpointAvailable(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}
