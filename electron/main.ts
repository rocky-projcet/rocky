import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import type { BrowserWindowConstructorOptions, IpcMainInvokeEvent } from "electron";

import {
  type ApplicationMenuActions,
  buildApplicationMenuSectionTemplate,
  buildApplicationMenuTemplate,
  type ApplicationMenuId,
} from "./menu.js";
import {
  buildBackendLaunchArgs,
  resolveDesktopApiBaseUrl,
  resolveElectronAppRoot,
  resolveElectronLogRoot,
  resolveElectronStateRoot,
  resolveElectronWindowIcon,
  resolveWebIndex,
} from "./runtime.js";

const BACKEND_HOST = "127.0.0.1";
const APP_NAME = "Rocky";
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultAppRoot = path.resolve(currentDir, "..", "..");

interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

interface ApplicationMenuPopupRequest {
  menuId: ApplicationMenuId;
  x: number;
  y: number;
}

let backendProcess: ChildProcess | null = null;
let desktopRuntimeContext: { apiBaseUrl: string; appRoot: string } | null = null;
let mainWindow: BrowserWindow | null = null;

function resolveTitleBarOptions(): Pick<
  BrowserWindowConstructorOptions,
  "titleBarOverlay" | "titleBarStyle"
> {
  if (process.platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      titleBarOverlay: {
        color: "#fafafa",
        symbolColor: "#242424",
        height: 36,
      },
    };
  }

  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#fafafa",
      symbolColor: "#242424",
      height: 36,
    },
  };
}

function debug(message: string, detail?: unknown): void {
  if (process.env.ROCKY_DESKTOP_DEBUG !== "1") {
    return;
  }

  if (detail === undefined) {
    console.log(`[rocky-desktop] ${message}`);
  } else {
    console.log(`[rocky-desktop] ${message}`, detail);
  }
}

function findAvailablePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (typeof port === "number") {
          resolve(port);
        } else {
          reject(new Error("Could not allocate a backend port."));
        }
      });
    });
  });
}

function getNavigationState(window: BrowserWindow | null): NavigationState {
  const history = window?.webContents.navigationHistory;
  return {
    canGoBack: history?.canGoBack() ?? false,
    canGoForward: history?.canGoForward() ?? false,
  };
}

function sendNavigationState(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }

  window.webContents.send(
    "rocky:navigation-state-changed",
    getNavigationState(window)
  );
}

function getWindowFromEvent(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function registerNavigationIpc(): void {
  ipcMain.handle("rocky:navigation-state", (event) => {
    return getNavigationState(getWindowFromEvent(event));
  });

  ipcMain.handle("rocky:navigation-back", (event) => {
    const window = getWindowFromEvent(event);
    const history = window?.webContents.navigationHistory;
    if (history?.canGoBack()) {
      history.goBack();
    }
    return getNavigationState(window);
  });

  ipcMain.handle("rocky:navigation-forward", (event) => {
    const window = getWindowFromEvent(event);
    const history = window?.webContents.navigationHistory;
    if (history?.canGoForward()) {
      history.goForward();
    }
    return getNavigationState(window);
  });
}

function isApplicationMenuId(value: unknown): value is ApplicationMenuId {
  return value === "file" || value === "edit" || value === "view" || value === "help";
}

function registerApplicationMenuIpc(): void {
  ipcMain.handle("rocky:application-menu-popup", (event, request: unknown) => {
    const input = request as Partial<ApplicationMenuPopupRequest>;
    if (!isApplicationMenuId(input.menuId)) {
      throw new Error("Unknown application menu.");
    }

    const window = getWindowFromEvent(event);
    if (!window || window.isDestroyed()) {
      return false;
    }

    const menu = Menu.buildFromTemplate(
      buildApplicationMenuSectionTemplate(input.menuId, process.platform, {
        actions: createApplicationMenuActions(window),
        appName: APP_NAME,
      })
    );
    menu.popup({
      window,
      x: Number.isFinite(input.x) ? Math.round(input.x ?? 0) : 0,
      y: Number.isFinite(input.y) ? Math.round(input.y ?? 0) : 0,
    });
    return true;
  });
}

function createApplicationMenuActions(
  sourceWindow?: BrowserWindow | null
): ApplicationMenuActions {
  return {
    openNewWindow: () => {
      openNewWindow();
    },
    showAbout: () => {
      showAboutDialog(sourceWindow ?? BrowserWindow.getFocusedWindow());
    },
  };
}

function openNewWindow(): void {
  if (!desktopRuntimeContext) {
    return;
  }

  const window = createMainWindow(desktopRuntimeContext);
  window.focus();
}

function showAboutDialog(sourceWindow?: BrowserWindow | null): void {
  const appRoot = desktopRuntimeContext?.appRoot ?? defaultAppRoot;
  const icon = resolveElectronWindowIcon({
    appRoot,
    platform: process.platform,
  });
  const options = {
    type: "info" as const,
    title: `About ${APP_NAME}`,
    message: APP_NAME,
    detail: `Version ${app.getVersion()}`,
    buttons: ["OK"],
    ...(icon && existsSync(icon) ? { icon } : {}),
  };

  if (sourceWindow && !sourceWindow.isDestroyed()) {
    void dialog.showMessageBox(sourceWindow, options);
    return;
  }

  void dialog.showMessageBox(options);
}

function registerNavigationStateEvents(window: BrowserWindow): void {
  const sendCurrentState = () => sendNavigationState(window);

  window.webContents.on("did-finish-load", sendCurrentState);
  window.webContents.on("did-navigate", sendCurrentState);
  window.webContents.on("did-navigate-in-page", sendCurrentState);
}

async function waitForBackend(apiBaseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError: unknown = null;

  debug("waiting for backend", { apiBaseUrl });
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBaseUrl}/agents`);
      if (response.ok) {
        debug("backend ready", { apiBaseUrl });
        return;
      }
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Rocky backend did not become ready: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

async function startBackend(input: {
  apiBaseUrl: string;
  appRoot: string;
  logRoot: string;
  port: number;
  stateRoot: string;
}): Promise<ChildProcess> {
  debug("ensuring log root", { logRoot: input.logRoot });
  await mkdir(input.logRoot, { recursive: true });
  debug("ensuring state root", { stateRoot: input.stateRoot });
  await mkdir(input.stateRoot, { recursive: true });
  debug("opening backend logs");

  const stdout = openSync(path.join(input.logRoot, "api.out.log"), "a");
  const stderr = openSync(path.join(input.logRoot, "api.err.log"), "a");
  const args = buildBackendLaunchArgs({
    appRoot: input.appRoot,
    host: BACKEND_HOST,
    port: input.port,
    stateRoot: input.stateRoot,
  });
  debug("spawning backend", { execPath: process.execPath, args });

  let child: ChildProcess;
  try {
    child = spawn(process.execPath, args, {
      cwd: input.appRoot,
      env: {
        ...process.env,
        AGENT_ENGINE_INTERNAL_BASE_URL: input.apiBaseUrl,
        ELECTRON_RUN_AS_NODE: "1",
        ROCKY_DESKTOP_CORS: "1",
      },
      stdio: ["ignore", stdout, stderr],
      windowsHide: true,
    });
  } catch (error) {
    closeSync(stdout);
    closeSync(stderr);
    throw error;
  }
  debug("backend spawned", { pid: child.pid, args });
  child.once("error", (error) => {
    debug("backend spawn error", { message: error.message });
  });

  child.once("exit", (code, signal) => {
    debug("backend exited", { code, signal });
    closeSync(stdout);
    closeSync(stderr);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("rocky-backend-exit", { code, signal });
    }
  });

  await waitForBackend(input.apiBaseUrl);
  return child;
}

function createMainWindow(input: {
  apiBaseUrl: string;
  appRoot: string;
}): BrowserWindow {
  process.env.ROCKY_DESKTOP_API_BASE_URL = input.apiBaseUrl;
  process.env.ROCKY_DESKTOP_IS_PACKAGED = app.isPackaged ? "1" : "0";
  const windowIcon = resolveElectronWindowIcon({
    appRoot: input.appRoot,
    platform: process.platform,
  });

  debug("creating main window");
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    ...resolveTitleBarOptions(),
    ...(windowIcon && existsSync(windowIcon) ? { icon: windowIcon } : {}),
    title: APP_NAME,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(currentDir, "preload.js"),
      sandbox: false,
    },
  });
  window.setMenuBarVisibility(false);

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  registerNavigationStateEvents(window);

  const webIndex = resolveWebIndex(input.appRoot);
  if (!existsSync(webIndex)) {
    throw new Error(`Built web UI is missing: ${webIndex}`);
  }

  debug("loading web UI", { webIndex });
  window.webContents.once("did-finish-load", () => {
    debug("web UI loaded");
  });
  window.webContents.once("did-fail-load", (_event, errorCode, errorDescription) => {
    debug("web UI failed to load", { errorCode, errorDescription });
  });
  window.once("closed", () => {
    debug("main window closed");
  });

  void window.loadFile(webIndex);
  return window;
}

function stopBackend(): void {
  debug("stopping backend");
  const child = backendProcess;
  backendProcess = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill();
}

async function boot(): Promise<void> {
  debug("boot start", {
    defaultAppRoot,
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  app.setName(APP_NAME);
  if (process.platform === "win32") {
    app.setAppUserModelId(APP_NAME);
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildApplicationMenuTemplate(
        process.platform,
        APP_NAME,
        createApplicationMenuActions()
      )
    )
  );
  const appRoot = resolveElectronAppRoot({
    defaultAppRoot,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  const stateRoot = resolveElectronStateRoot({
    appRoot,
    env: process.env,
    homeDir: os.homedir(),
    platform: process.platform,
  });
  const logRoot = resolveElectronLogRoot({
    appRoot,
    env: process.env,
    homeDir: os.homedir(),
    platform: process.platform,
  });
  const port = await findAvailablePort(BACKEND_HOST);
  const apiBaseUrl = resolveDesktopApiBaseUrl({
    host: BACKEND_HOST,
    port,
  });
  desktopRuntimeContext = { apiBaseUrl, appRoot };

  debug("resolved runtime paths", { appRoot, stateRoot, logRoot, apiBaseUrl });
  backendProcess = await startBackend({
    apiBaseUrl,
    appRoot,
    logRoot,
    port,
    stateRoot,
  });
  mainWindow = createMainWindow({ apiBaseUrl, appRoot });
  debug("boot complete");
}

app.on("before-quit", stopBackend);
app.on("window-all-closed", () => {
  debug("window-all-closed");
  app.quit();
});

app.whenReady()
  .then(() => {
    registerNavigationIpc();
    registerApplicationMenuIpc();
    return boot();
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    dialog.showErrorBox("Rocky failed to start", message);
    app.quit();
  });
