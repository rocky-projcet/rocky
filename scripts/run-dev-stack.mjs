#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "cmd.exe" : "npm";

function npmArgs(args) {
  return isWindows ? ["/d", "/s", "/c", "npm.cmd", ...args] : args;
}

function childEnv(extra = {}) {
  if (!isWindows) {
    return {
      ...process.env,
      ...extra,
    };
  }

  const env = {};
  const seenKeys = new Map();
  const pathValue = extra.Path ?? extra.PATH ?? process.env.Path ?? process.env.PATH;

  const setValue = (key, value) => {
    if (value === undefined || key.toLowerCase() === "path") {
      return;
    }

    const lookupKey = key.toLowerCase();
    const previousKey = seenKeys.get(lookupKey);
    if (previousKey) {
      delete env[previousKey];
    }

    env[key] = value;
    seenKeys.set(lookupKey, key);
  };

  for (const [key, value] of Object.entries(process.env)) {
    setValue(key, value);
  }
  for (const [key, value] of Object.entries(extra)) {
    setValue(key, value);
  }

  if (pathValue !== undefined) {
    env.Path = pathValue;
  }

  return env;
}

function usage() {
  console.log(`Usage:
  node scripts/run-dev-stack.mjs [options]

Options:
  --check                     Print the derived settings and exit.
  --skip-install              Skip npm install checks.
  --skip-build                Skip the backend build step.
  --state-root <path>         Backend state root. Defaults to .runtime/agent-engine.
  --backend-host <value>      Backend bind host. Defaults to 127.0.0.1.
  --backend-port <value>      Backend bind port. Defaults to 3000.
  --web-host <value>          Frontend dev-server host. Defaults to 127.0.0.1.
  --web-port <value>          Frontend dev-server port. Defaults to 4173.
  -h, --help                  Show this help.

Environment:
  AGENT_ENGINE_STATE_ROOT
  AGENT_ENGINE_HOST
  AGENT_ENGINE_PORT
  AGENT_ENGINE_WEB_HOST
  AGENT_ENGINE_WEB_PORT

Examples:
  npm run dev
  npm run dev -- --state-root .runtime/dev-stack
  npm run dev -- --backend-host 0.0.0.0 --web-host 0.0.0.0`);
}

function fail(message) {
  console.error(`run-dev-stack: ${message}`);
  process.exit(1);
}

function hasBin(root, name) {
  const binDir = path.join(root, "node_modules", ".bin");
  return existsSync(path.join(binDir, name)) || existsSync(path.join(binDir, `${name}.cmd`));
}

function rootDependenciesReady() {
  return hasBin(repoRoot, "tsc");
}

function webDependenciesReady() {
  const webRoot = path.join(repoRoot, "web");
  return hasBin(webRoot, "tsc") && hasBin(webRoot, "vite");
}

function ensureIntegerPort(label, value) {
  if (!/^\d+$/.test(value)) {
    fail(`${label} must be an integer between 0 and 65535: ${value}`);
  }

  const numericValue = Number(value);
  if (numericValue < 0 || numericValue > 65535) {
    fail(`${label} must be an integer between 0 and 65535: ${value}`);
  }
}

function parseArgs(argv) {
  const settings = {
    checkOnly: false,
    skipInstall: false,
    skipBuild: false,
    stateRoot: process.env.AGENT_ENGINE_STATE_ROOT ?? ".runtime/agent-engine",
    backendHost: process.env.AGENT_ENGINE_HOST ?? "127.0.0.1",
    backendPort: process.env.AGENT_ENGINE_PORT ?? "3000",
    webHost: process.env.AGENT_ENGINE_WEB_HOST ?? "127.0.0.1",
    webPort: process.env.AGENT_ENGINE_WEB_PORT ?? "4173",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value) {
        fail(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case "--check":
        settings.checkOnly = true;
        break;
      case "--skip-install":
        settings.skipInstall = true;
        break;
      case "--skip-build":
        settings.skipBuild = true;
        break;
      case "--state-root":
        settings.stateRoot = next();
        break;
      case "--backend-host":
        settings.backendHost = next();
        break;
      case "--backend-port":
        settings.backendPort = next();
        break;
      case "--web-host":
        settings.webHost = next();
        break;
      case "--web-port":
        settings.webPort = next();
        break;
      case "-h":
      case "--help":
        usage();
        process.exit(0);
        break;
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  ensureIntegerPort("Backend port", settings.backendPort);
  ensureIntegerPort("Web port", settings.webPort);

  return settings;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { env, ...spawnOptions } = options;
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      ...spawnOptions,
      env: childEnv(env),
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}`));
    });
  });
}

function start(command, args, options = {}) {
  const { env, ...spawnOptions } = options;
  return spawn(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...spawnOptions,
    env: childEnv(env),
  });
}

function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (isWindows) {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  child.kill("SIGTERM");
}

function waitForFirstExit(children) {
  return new Promise((resolve) => {
    let settled = false;

    for (const child of children) {
      child.on("exit", (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({ code, signal });
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({ code: 1, signal: null, error });
      });
    }
  });
}

const settings = parseArgs(process.argv.slice(2));
const proxyTargetHost = settings.backendHost === "0.0.0.0" ? "127.0.0.1" : settings.backendHost;
const proxyTarget = `http://${proxyTargetHost}:${settings.backendPort}`;
const stateRootPath = path.resolve(repoRoot, settings.stateRoot);

if (settings.checkOnly) {
  console.log(`repo_root=${repoRoot}`);
  console.log(`state_root=${settings.stateRoot}`);
  console.log(`backend_host=${settings.backendHost}`);
  console.log(`backend_port=${settings.backendPort}`);
  console.log(`web_host=${settings.webHost}`);
  console.log(`web_port=${settings.webPort}`);
  console.log(`proxy_target=${proxyTarget}`);
  console.log(`skip_install=${settings.skipInstall ? 1 : 0}`);
  console.log(`skip_build=${settings.skipBuild ? 1 : 0}`);
  console.log(`root_node_modules=${existsSync(path.join(repoRoot, "node_modules"))}`);
  console.log(`root_dependencies_ready=${rootDependenciesReady()}`);
  console.log(`web_node_modules=${existsSync(path.join(repoRoot, "web", "node_modules"))}`);
  console.log(`web_dependencies_ready=${webDependenciesReady()}`);
  process.exit(0);
}

if (!settings.skipInstall) {
  if (!rootDependenciesReady()) {
    console.log("[setup] Installing root dependencies...");
    await run(npmCommand, npmArgs(["install"]));
  }

  if (!webDependenciesReady()) {
    console.log("[setup] Installing web dependencies...");
    await run(npmCommand, npmArgs(["--prefix", "web", "install"]));
  }
}

if (!settings.skipBuild) {
  console.log("[setup] Building backend...");
  await run(npmCommand, npmArgs(["run", "build"]));
}

mkdirSync(stateRootPath, { recursive: true });

console.log(`[backend] http://${settings.backendHost}:${settings.backendPort}`);
console.log(`[frontend] http://${settings.webHost}:${settings.webPort}`);
console.log(`[state] ${settings.stateRoot}`);
console.log("[hint] Press Ctrl+C to stop both processes.");

const backend = start("node", [
  "dist/src/cli.js",
  "serve",
  "--state-root",
  settings.stateRoot,
  "--host",
  settings.backendHost,
  "--port",
  settings.backendPort,
]);

const web = start(npmCommand, npmArgs(["--prefix", "web", "run", "dev", "--", "--host", settings.webHost, "--port", settings.webPort]), {
  env: {
    ...process.env,
    AGENT_ENGINE_PROXY_TARGET: proxyTarget,
  },
});

let shuttingDown = false;
async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  stopProcess(backend);
  stopProcess(web);
  setTimeout(() => process.exit(exitCode), 500);
}

process.on("SIGINT", () => {
  void shutdown(130);
});
process.on("SIGTERM", () => {
  void shutdown(143);
});

const result = await waitForFirstExit([backend, web]);
if (result.error) {
  console.error(result.error.message);
}

const exitCode = result.code ?? (result.signal ? 1 : 0);
await shutdown(exitCode);
