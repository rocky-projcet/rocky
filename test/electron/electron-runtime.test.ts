import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildBackendLaunchArgs,
  buildBackendLaunchEnv,
  resolveDesktopApiBaseUrl,
  resolveElectronAppRoot,
  resolveElectronWindowIcon,
  resolveElectronLogRoot,
  resolveElectronStateRoot,
} from "../../electron/runtime.js";

test("resolveElectronAppRoot uses repository root in development", () => {
  assert.equal(
    resolveElectronAppRoot({
      isPackaged: false,
      defaultAppRoot: "C:\\repo\\rocky",
      resourcesPath: "C:\\repo\\rocky\\node_modules\\electron\\dist\\resources",
    }),
    path.resolve("C:\\repo\\rocky")
  );
});

test("resolveElectronAppRoot uses resources app payload when packaged", () => {
  assert.equal(
    resolveElectronAppRoot({
      isPackaged: true,
      defaultAppRoot: "C:\\repo\\rocky",
      resourcesPath: "C:\\Users\\jsh\\AppData\\Local\\Programs\\Rocky\\resources",
      resourcesAppExists: true,
    }),
    path.resolve("C:\\Users\\jsh\\AppData\\Local\\Programs\\Rocky\\resources\\app")
  );
});

test("resolveElectronAppRoot falls back for loose Windows installer runtime", () => {
  assert.equal(
    resolveElectronAppRoot({
      isPackaged: true,
      defaultAppRoot: "C:\\Users\\jsh\\AppData\\Local\\Programs\\Rocky",
      resourcesPath:
        "C:\\Users\\jsh\\AppData\\Local\\Programs\\Rocky\\electron\\resources",
      resourcesAppExists: false,
    }),
    path.resolve("C:\\Users\\jsh\\AppData\\Local\\Programs\\Rocky")
  );
});

test("resolveElectronStateRoot prefers explicit environment value", () => {
  assert.equal(
    resolveElectronStateRoot({
      appRoot: "C:\\Program Files\\Rocky\\resources\\app",
      env: { ROCKY_STATE_ROOT: "D:\\Rocky State" },
      homeDir: "C:\\Users\\jsh",
      platform: "win32",
    }),
    path.resolve("D:\\Rocky State")
  );
});

test("resolveElectronStateRoot uses per-user Windows state by default", () => {
  assert.equal(
    resolveElectronStateRoot({
      appRoot: "C:\\Program Files\\Rocky\\resources\\app",
      env: { LOCALAPPDATA: "C:\\Users\\jsh\\AppData\\Local" },
      homeDir: "C:\\Users\\jsh",
      platform: "win32",
    }),
    path.resolve("C:\\Users\\jsh\\AppData\\Local\\Rocky\\state")
  );
});

test("resolveElectronStateRoot uses macOS application support by default", () => {
  assert.equal(
    resolveElectronStateRoot({
      appRoot: "/Applications/Rocky.app/Contents/Resources/app",
      env: {},
      homeDir: "/Users/jsh",
      platform: "darwin",
    }),
    path.resolve("/Users/jsh/Library/Application Support/Rocky/agent-engine")
  );
});

test("resolveElectronLogRoot uses platform log defaults", () => {
  assert.equal(
    resolveElectronLogRoot({
      appRoot: "C:\\Rocky\\resources\\app",
      env: { LOCALAPPDATA: "C:\\Users\\jsh\\AppData\\Local" },
      homeDir: "C:\\Users\\jsh",
      platform: "win32",
    }),
    path.resolve("C:\\Users\\jsh\\AppData\\Local\\Rocky\\logs")
  );

  assert.equal(
    resolveElectronLogRoot({
      appRoot: "/Applications/Rocky.app/Contents/Resources/app",
      env: {},
      homeDir: "/Users/jsh",
      platform: "darwin",
    }),
    path.resolve("/Users/jsh/Library/Logs/Rocky")
  );
});

test("resolveElectronWindowIcon uses the Rocky Windows icon", () => {
  assert.equal(
    resolveElectronWindowIcon({
      appRoot: "C:\\Rocky\\resources\\app",
      platform: "win32",
    }),
    path.resolve("C:\\Rocky\\resources\\app\\assets\\windows\\rocky.ico")
  );

  assert.equal(
    resolveElectronWindowIcon({
      appRoot: "/Applications/Rocky.app/Contents/Resources/app",
      platform: "darwin",
    }),
    undefined
  );
});

test("buildBackendLaunchArgs starts existing CLI server on loopback port", () => {
  assert.deepEqual(
    buildBackendLaunchArgs({
      appRoot: "C:\\Rocky\\resources\\app",
      host: "127.0.0.1",
      port: 49152,
      stateRoot: "C:\\Users\\jsh\\AppData\\Local\\Rocky\\state",
    }),
    [
      path.resolve("C:\\Rocky\\resources\\app\\dist\\src\\cli.js"),
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      "49152",
      "--state-root",
      path.resolve("C:\\Users\\jsh\\AppData\\Local\\Rocky\\state"),
    ]
  );
});

test("buildBackendLaunchEnv passes desktop version and internal backend flags", () => {
  assert.deepEqual(
    buildBackendLaunchEnv({
      apiBaseUrl: "http://127.0.0.1:49152",
      appVersion: "0.1.4",
      baseEnv: {
        PATH: "C:\\Windows\\System32",
        ROCKY_APP_VERSION: "0.0.0",
      },
    }),
    {
      PATH: "C:\\Windows\\System32",
      ROCKY_APP_VERSION: "0.1.4",
      AGENT_ENGINE_INTERNAL_BASE_URL: "http://127.0.0.1:49152",
      ELECTRON_RUN_AS_NODE: "1",
      ROCKY_DESKTOP_CORS: "1",
    }
  );
});

test("resolveDesktopApiBaseUrl exposes backend root without the Vite /api prefix", () => {
  assert.equal(
    resolveDesktopApiBaseUrl({ host: "127.0.0.1", port: 49152 }),
    "http://127.0.0.1:49152"
  );
});
