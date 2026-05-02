import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { access, chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import {
  CodexCliRuntime,
  UNSANDBOXED_SHELL_INSPECTION_WARNING,
  buildCodexCommand,
  prepareCodexRuntimeEnvironment,
} from "../../src/runtime/codex-cli-runtime.js";
import { shouldUseSharedHomeForWritableSandbox } from "../../src/runtime/codex-runtime-environment.js";

import type {
  RuntimeChildProcess,
  RuntimeSession,
} from "../../src/runtime/runtime-types.js";

const execFileAsync = promisify(execFile);

function createFakeChild(): EventEmitter & RuntimeChildProcess {
  const child = new EventEmitter() as EventEmitter & RuntimeChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal = "SIGTERM") => {
    queueMicrotask(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit("close", null, signal);
    });
  };
  return child;
}

test("buildCodexCommand builds first-turn exec args with model overrides", () => {
  const session: RuntimeSession = {
    workspaceRoot: "/workspace/app",
    runtimeSessionId: null,
    config: {
      codexBin: "codex",
      sandbox: "workspace-write",
      approval: "on-request",
      profile: "default",
      authProfileId: null,
      model: "gpt-5.4",
      reasoningEffort: "high",
      serviceTier: "fast",
      fullAuto: true,
      additionalWritableDirs: ["/workspace/shared"],
      configOverrides: ['foo="bar"', 'model_reasoning_effort="low"'],
      enableFeatures: ["feature-a"],
      disableFeatures: ["feature-b"],
      skipGitRepoCheck: true,
      dangerouslyBypassApprovalsAndSandbox: false,
      ephemeral: false,
    },
    id: "session",
    agentId: null,
    runtimeKind: "codex-cli",
    runtimeHome: "/workspace/app/.runtime/codex",
    createdAt: "2026-03-13T00:00:00.000Z",
    updatedAt: "2026-03-13T00:00:00.000Z",
  };

  const { command, args } = buildCodexCommand({
    session,
    request: {
      sessionId: "session",
      prompt: "hello",
      additionalWritableDirs: ["/workspace/output"],
      outputLastMessagePath: "/tmp/last.txt",
    },
  });

  assert.equal(command, "codex");
  assert.deepEqual(args.slice(0, 15), [
    "--ask-for-approval",
    "never",
    "exec",
    "-C",
    "/workspace/app",
    "--profile",
    "default",
    "--model",
    "gpt-5.4",
    "--sandbox",
    "workspace-write",
    "--add-dir",
    "/workspace/shared",
    "--add-dir",
    "/workspace/output",
  ]);
  assert.ok(args.includes("-c"));
  assert.ok(args.includes('foo="bar"'));
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(args.includes('service_tier="fast"'));
  assert.ok(!args.includes('model_reasoning_effort="low"'));
  assert.ok(args.includes("exec"));
  assert.ok(args.includes("--json"));
  assert.ok(args.includes("hello"));
});

test("buildCodexCommand builds resume args with runtime session id", () => {
  const session: RuntimeSession = {
    workspaceRoot: "/workspace/app",
    runtimeSessionId: "thread-123",
    config: {
      codexBin: "codex",
      sandbox: "read-only",
      approval: "never",
      profile: null,
      authProfileId: null,
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      fullAuto: false,
      additionalWritableDirs: [],
      configOverrides: [],
      enableFeatures: [],
      disableFeatures: [],
      skipGitRepoCheck: true,
      dangerouslyBypassApprovalsAndSandbox: false,
      ephemeral: false,
    },
    id: "session",
    agentId: null,
    runtimeKind: "codex-cli",
    runtimeHome: "/workspace/app/.runtime/codex",
    createdAt: "2026-03-13T00:00:00.000Z",
    updatedAt: "2026-03-13T00:00:00.000Z",
  };

  const { args } = buildCodexCommand({
    mode: "resume",
    session,
    request: {
      sessionId: "session",
      prompt: "continue",
    },
  });

  assert.deepEqual(args.slice(0, 6), [
    "--ask-for-approval",
    "never",
    "exec",
    "resume",
    "--json",
    "--skip-git-repo-check",
  ]);
  assert.ok(!args.includes("--color"));
  assert.ok(!args.includes("-C"));
  assert.ok(args.includes("thread-123"));
  assert.equal(args.at(-1), "continue");
});

test("buildCodexCommand restates the Ollama provider when resuming", () => {
  const session: RuntimeSession = {
    workspaceRoot: "/workspace/app",
    runtimeSessionId: "thread-456",
    config: {
      codexBin: "codex",
      sandbox: "workspace-write",
      approval: "never",
      profile: "ollama-launch",
      authProfileId: null,
      model: "gemma4:31b-cloud",
      reasoningEffort: null,
      serviceTier: null,
      fullAuto: false,
      additionalWritableDirs: ["/workspace/extra"],
      configOverrides: [],
      enableFeatures: [],
      disableFeatures: [],
      skipGitRepoCheck: true,
      dangerouslyBypassApprovalsAndSandbox: false,
      ephemeral: false,
    },
    id: "session",
    agentId: null,
    runtimeKind: "codex-cli",
    runtimeHome: "/workspace/app/.runtime/codex",
    createdAt: "2026-03-13T00:00:00.000Z",
    updatedAt: "2026-03-13T00:00:00.000Z",
  };

  const { args } = buildCodexCommand({
    mode: "resume",
    session,
    request: {
      sessionId: "session",
      prompt: "continue",
    },
  });

  assert.ok(args.includes("resume"));
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("gemma4:31b-cloud"));
  assert.ok(args.includes("-c"));
  assert.ok(args.includes('model_provider="ollama-launch"'));
  assert.ok(!args.includes("--profile"));
  assert.ok(!args.includes("--sandbox"));
  assert.ok(!args.includes("--add-dir"));
});

test("buildCodexCommand honors request-level dangerous bypass", () => {
  const session: RuntimeSession = {
    workspaceRoot: "/workspace/app",
    runtimeSessionId: null,
    config: {
      codexBin: "codex",
      sandbox: "read-only",
      approval: "never",
      profile: null,
      authProfileId: null,
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      fullAuto: false,
      additionalWritableDirs: [],
      configOverrides: [],
      enableFeatures: [],
      disableFeatures: [],
      skipGitRepoCheck: true,
      dangerouslyBypassApprovalsAndSandbox: false,
      ephemeral: false,
    },
    id: "session",
    agentId: null,
    runtimeKind: "codex-cli",
    runtimeHome: "/workspace/app/.runtime/codex",
    createdAt: "2026-03-13T00:00:00.000Z",
    updatedAt: "2026-03-13T00:00:00.000Z",
  };

  const { args } = buildCodexCommand({
    session,
    request: {
      sessionId: "session",
      prompt: "Run 'ls -la'",
      dangerouslyBypassApprovalsAndSandbox: true,
    },
  });

  assert.ok(args.includes("--sandbox"));
  assert.ok(args.includes("read-only"));
  assert.ok(args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.ok(!args.includes("--ask-for-approval"));
  assert.equal(args[0], "--dangerously-bypass-approvals-and-sandbox");
  assert.equal(args[1], "exec");
});

test("buildCodexCommand drops legacy default service tier overrides", () => {
  const session: RuntimeSession = {
    workspaceRoot: "/workspace/app",
    runtimeSessionId: null,
    config: {
      codexBin: "codex",
      sandbox: "workspace-write",
      approval: "on-request",
      profile: null,
      authProfileId: null,
      model: "gpt-5.4",
      reasoningEffort: null,
      serviceTier: "default" as never,
      fullAuto: false,
      additionalWritableDirs: [],
      configOverrides: [],
      enableFeatures: [],
      disableFeatures: [],
      skipGitRepoCheck: true,
      dangerouslyBypassApprovalsAndSandbox: false,
      ephemeral: false,
    },
    id: "session",
    agentId: null,
    runtimeKind: "codex-cli",
    runtimeHome: "/workspace/app/.runtime/codex",
    createdAt: "2026-03-13T00:00:00.000Z",
    updatedAt: "2026-03-13T00:00:00.000Z",
  };

  const { args } = buildCodexCommand({
    session,
    request: {
      sessionId: "session",
      prompt: "hello",
    },
  });

  assert.ok(!args.includes('service_tier="default"'));
  assert.ok(!args.includes('service_tier="flex"'));
});

test("CodexCliRuntime createSession defaults to non-git read-only analysis mode", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-session-"));
  const runtime = new CodexCliRuntime();

  const session = await runtime.createSession({
    workspaceRoot: tempRoot,
  });

  assert.equal(session.config.sandbox, "read-only");
  assert.equal(session.config.approval, null);
  assert.equal(session.config.skipGitRepoCheck, true);
  assert.equal(session.config.dangerouslyBypassApprovalsAndSandbox, false);
});

test("prepareCodexRuntimeEnvironment seeds auth, config, and workspace trust", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-test-"));
  const sourceHome = path.join(tempRoot, "source-home");
  const targetHome = path.join(tempRoot, "target-home");
  const sourceCodexDir = path.join(sourceHome, ".codex");
  const workspaceRoot = path.join(tempRoot, "workspace");

  await mkdir(sourceCodexDir, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(path.join(sourceCodexDir, "auth.json"), '{"token":"abc"}');
  await writeFile(path.join(sourceCodexDir, "config.toml"), 'model = "gpt-5.4"\n');

  const env = await prepareCodexRuntimeEnvironment({
    runtimeHome: targetHome,
    workspaceRoot,
    baseEnv: {
      HOME: sourceHome,
      PATH: process.env.PATH ?? "",
    },
  });

  assert.equal(env.env.HOME, targetHome);
  assert.equal(env.sharedHomeFallback, false);
  assert.equal(env.env.GIT_CEILING_DIRECTORIES, path.dirname(workspaceRoot));
  assert.equal(
    await readFile(path.join(targetHome, ".codex", "auth.json"), "utf8"),
    '{"token":"abc"}'
  );
  assert.equal(
    await readFile(path.join(targetHome, ".codex", "config.toml"), "utf8"),
    `model = "gpt-5.4"\n\n[projects."${workspaceRoot}"]\ntrust_level = "trusted"\n`
  );
  await assert.rejects(access(path.join(workspaceRoot, "AGENTS.md")), /ENOENT/);
});

test("prepareCodexRuntimeEnvironment prevents git discovery above workspace root", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-git-ceiling-"));
  const repoRoot = path.join(tempRoot, "repo");
  const workspaceRoot = path.join(repoRoot, "nested", "workspace");
  const runtimeHome = path.join(tempRoot, "runtime-home");

  await mkdir(workspaceRoot, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, "README.md"), "root\n", "utf8");

  const prepared = await prepareCodexRuntimeEnvironment({
    runtimeHome,
    workspaceRoot,
    baseEnv: {
      HOME: path.join(tempRoot, "home"),
      PATH: process.env.PATH ?? "",
    },
  });

  await assert.rejects(
    execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: workspaceRoot,
      env: prepared.env,
    }),
    /not a git repository/i
  );
});

test("prepareCodexRuntimeEnvironment keeps managed auth profiles on their own HOME", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-managed-auth-"));
  const profileHome = path.join(tempRoot, "profile-home");
  const runtimeHome = path.join(tempRoot, "runtime-home");
  const workspaceRoot = path.join(tempRoot, "workspace");

  await mkdir(path.join(profileHome, ".codex"), { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(
    path.join(profileHome, ".codex", "auth.json"),
    '{"token":"managed"}'
  );
  await writeFile(
    path.join(profileHome, ".codex", "config.toml"),
    'model = "gpt-5.4"\n'
  );

  const env = await prepareCodexRuntimeEnvironment({
    runtimeHome,
    workspaceRoot,
    baseEnv: {
      HOME: path.join(tempRoot, "service-home"),
      PATH: process.env.PATH ?? "",
    },
    authSource: {
      kind: "managed-home",
      authProfileId: "profile-1",
      homePath: profileHome,
    },
  });

  assert.equal(env.env.HOME, profileHome);
  assert.equal(env.sharedHomeFallback, false);
  assert.equal(env.env.XDG_CONFIG_HOME, path.join(runtimeHome, "xdg-config"));
  assert.equal(
    await readFile(path.join(profileHome, ".codex", "auth.json"), "utf8"),
    '{"token":"managed"}'
  );
  assert.equal(
    await readFile(path.join(profileHome, ".codex", "config.toml"), "utf8"),
    `model = "gpt-5.4"\n\n[projects."${workspaceRoot}"]\ntrust_level = "trusted"\n`
  );
  await assert.rejects(access(path.join(runtimeHome, ".codex", "auth.json")), /ENOENT/);
});

test("prepareCodexRuntimeEnvironment refreshes workspace-local AGENTS overlay and skill bridge", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-skill-bridge-"));
  const sourceHome = path.join(tempRoot, "source-home");
  const targetHome = path.join(tempRoot, "target-home");
  const sourceCodexDir = path.join(sourceHome, ".codex");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const localSkillDir = path.join(
    workspaceRoot,
    ".agents",
    "skills",
    "impala-helper"
  );

  await mkdir(sourceCodexDir, { recursive: true });
  await mkdir(localSkillDir, { recursive: true });
  await writeFile(path.join(sourceCodexDir, "auth.json"), '{"token":"abc"}');
  await writeFile(path.join(localSkillDir, "SKILL.md"), "# Impala Helper\n");

  await prepareCodexRuntimeEnvironment({
    runtimeHome: targetHome,
    workspaceRoot,
    baseEnv: {
      HOME: sourceHome,
      PATH: process.env.PATH ?? "",
    },
  });

  await access(path.join(workspaceRoot, ".agents", "skills"));
  const overlay = await readFile(path.join(workspaceRoot, "AGENTS.md"), "utf8");
  assert.match(overlay, /Workspace-local AGENTS overlay/);
  assert.match(overlay, /Impala Helper/);
  assert.doesNotMatch(overlay, /\$impala-helper/u);
  assert.doesNotMatch(overlay, /impala-helper\/SKILL\.md/u);
});

test("prepareCodexRuntimeEnvironment can share HOME while isolating XDG", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-shared-home-"));
  const sourceHome = path.join(tempRoot, "source-home");
  const runtimeHome = path.join(tempRoot, "runtime-home");
  const sourceCodexDir = path.join(sourceHome, ".codex");
  const workspaceRoot = path.join(tempRoot, "workspace");

  await mkdir(sourceCodexDir, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(path.join(sourceCodexDir, "auth.json"), '{"token":"abc"}');

  const prepared = await prepareCodexRuntimeEnvironment({
    runtimeHome,
    workspaceRoot,
    baseEnv: {
      HOME: sourceHome,
      PATH: process.env.PATH ?? "",
    },
    shareHomeWithBaseEnv: true,
  });

  assert.equal(prepared.sharedHomeFallback, true);
  assert.equal(prepared.env.HOME, sourceHome);
  assert.equal(
    prepared.env.XDG_CONFIG_HOME,
    path.join(runtimeHome, "xdg-config")
  );
});

test("prepareCodexRuntimeEnvironment preserves unrelated base environment variables", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-preserve-env-"));
  const sourceHome = path.join(tempRoot, "source-home");
  const runtimeHome = path.join(tempRoot, "runtime-home");
  const workspaceRoot = path.join(tempRoot, "workspace");

  await mkdir(workspaceRoot, { recursive: true });

  const prepared = await prepareCodexRuntimeEnvironment({
    runtimeHome,
    workspaceRoot,
    baseEnv: {
      HOME: sourceHome,
      PATH: process.env.PATH ?? "",
      USER: "korjsh",
      SHELL: "/bin/zsh",
      TMPDIR: "/tmp/custom",
      __CF_USER_TEXT_ENCODING: "0x1F5:0x0:0x0",
    },
  });

  assert.equal(prepared.env.USER, "korjsh");
  assert.equal(prepared.env.SHELL, "/bin/zsh");
  assert.equal(prepared.env.TMPDIR, "/tmp/custom");
  assert.equal(prepared.env.__CF_USER_TEXT_ENCODING, "0x1F5:0x0:0x0");
  assert.equal(prepared.env.HOME, runtimeHome);
});

test("prepareCodexRuntimeEnvironment ignores shared HOME trust write permission failures", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-shared-home-ro-"));
  const sourceHome = path.join(tempRoot, "source-home");
  const runtimeHome = path.join(tempRoot, "runtime-home");
  const sourceCodexDir = path.join(sourceHome, ".codex");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const configPath = path.join(sourceCodexDir, "config.toml");

  await mkdir(sourceCodexDir, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(path.join(sourceCodexDir, "auth.json"), '{"token":"abc"}');
  await writeFile(configPath, 'model = "gpt-5.4"\n');
  await chmod(configPath, 0o444);

  const prepared = await prepareCodexRuntimeEnvironment({
    runtimeHome,
    workspaceRoot,
    baseEnv: {
      HOME: sourceHome,
      PATH: process.env.PATH ?? "",
    },
    shareHomeWithBaseEnv: true,
  });

  assert.equal(prepared.sharedHomeFallback, true);
  assert.equal(prepared.env.HOME, sourceHome);
  assert.equal(
    await readFile(configPath, "utf8"),
    'model = "gpt-5.4"\n'
  );
});

test("prepareCodexRuntimeEnvironment can reuse the base Playwright browser cache", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-playwright-cache-"));
  const sourceHome = path.join(tempRoot, "source-home");
  const runtimeHome = path.join(tempRoot, "runtime-home");
  const workspaceRoot = path.join(tempRoot, "workspace");

  await mkdir(workspaceRoot, { recursive: true });

  const prepared = await prepareCodexRuntimeEnvironment({
    runtimeHome,
    workspaceRoot,
    baseEnv: {
      HOME: sourceHome,
      PATH: process.env.PATH ?? "",
    },
    reuseBasePlaywrightBrowsers: true,
  });

  assert.equal(prepared.env.HOME, runtimeHome);
  assert.equal(
    prepared.env.PLAYWRIGHT_BROWSERS_PATH,
    process.platform === "darwin"
      ? path.join(sourceHome, "Library", "Caches", "ms-playwright")
      : process.platform === "win32"
        ? path.join(sourceHome, "AppData", "Local", "ms-playwright")
        : path.join(sourceHome, ".cache", "ms-playwright")
  );
});

test("prepareCodexRuntimeEnvironment seeds missing rollout files into isolated runtime homes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-rollout-seed-"));
  const sourceHome = path.join(tempRoot, "source-home");
  const runtimeHome = path.join(tempRoot, "runtime-home");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const runtimeSessionId = "thread-123";
  const relativeRolloutPath = path.join(
    "2026",
    "04",
    "06",
    `rollout-2026-04-06T22-03-39-${runtimeSessionId}.jsonl`
  );
  const sourceRolloutPath = path.join(
    sourceHome,
    ".codex",
    "sessions",
    relativeRolloutPath
  );

  await mkdir(path.dirname(sourceRolloutPath), { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(path.join(sourceHome, ".codex", "auth.json"), '{"token":"abc"}');
  await writeFile(sourceRolloutPath, '{"type":"session_meta"}\n', "utf8");

  await prepareCodexRuntimeEnvironment({
    runtimeHome,
    runtimeSessionId,
    workspaceRoot,
    baseEnv: {
      HOME: sourceHome,
      PATH: process.env.PATH ?? "",
    },
  });

  assert.equal(
    await readFile(
      path.join(runtimeHome, ".codex", "sessions", relativeRolloutPath),
      "utf8"
    ),
    '{"type":"session_meta"}\n'
  );
});

test("prepareCodexRuntimeEnvironment syncs newer isolated rollout files back to the shared HOME", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-rollout-sync-"));
  const sourceHome = path.join(tempRoot, "source-home");
  const runtimeHome = path.join(tempRoot, "runtime-home");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const runtimeSessionId = "thread-456";
  const relativeRolloutPath = path.join(
    "2026",
    "04",
    "06",
    `rollout-2026-04-06T22-03-39-${runtimeSessionId}.jsonl`
  );
  const sourceRolloutPath = path.join(
    sourceHome,
    ".codex",
    "sessions",
    relativeRolloutPath
  );
  const runtimeRolloutPath = path.join(
    runtimeHome,
    ".codex",
    "sessions",
    relativeRolloutPath
  );

  await mkdir(path.dirname(sourceRolloutPath), { recursive: true });
  await mkdir(path.dirname(runtimeRolloutPath), { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(path.join(sourceHome, ".codex", "auth.json"), '{"token":"abc"}');
  await writeFile(sourceRolloutPath, "older\n", "utf8");
  await writeFile(runtimeRolloutPath, "newer\nnewer\n", "utf8");

  await prepareCodexRuntimeEnvironment({
    runtimeHome,
    runtimeSessionId,
    workspaceRoot,
    baseEnv: {
      HOME: sourceHome,
      PATH: process.env.PATH ?? "",
    },
    shareHomeWithBaseEnv: true,
  });

  assert.equal(await readFile(sourceRolloutPath, "utf8"), "newer\nnewer\n");
});

test("shouldUseSharedHomeForWritableSandbox disables shared HOME for bypassed turns", () => {
  const session: RuntimeSession = {
    workspaceRoot: "/workspace/app",
    runtimeSessionId: null,
    config: {
      codexBin: "codex",
      sandbox: "workspace-write",
      approval: "on-request",
      profile: null,
      authProfileId: null,
      model: null,
      reasoningEffort: null,
      serviceTier: null,
      fullAuto: false,
      additionalWritableDirs: [],
      configOverrides: [],
      enableFeatures: [],
      disableFeatures: [],
      skipGitRepoCheck: true,
      dangerouslyBypassApprovalsAndSandbox: false,
      ephemeral: false,
    },
    id: "session",
    agentId: null,
    runtimeKind: "codex-cli",
    runtimeHome: "/workspace/app/.runtime/codex",
    createdAt: "2026-03-13T00:00:00.000Z",
    updatedAt: "2026-03-13T00:00:00.000Z",
  };

  assert.equal(
    shouldUseSharedHomeForWritableSandbox({
      session,
      request: {
        dangerouslyBypassApprovalsAndSandbox: true,
      },
      baseEnv: {
        HOME: "/Users/tester",
        PATH: process.env.PATH ?? "",
      },
    }),
    false
  );

  assert.equal(
    shouldUseSharedHomeForWritableSandbox({
      session,
      request: {
        dangerouslyBypassApprovalsAndSandbox: false,
      },
      baseEnv: {
        HOME: "/Users/tester",
        PATH: process.env.PATH ?? "",
      },
    }),
    true
  );
});

test("CodexCliRuntime captures thread binding and completed run result", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-run-"));
  const fakeSpawn = () => {
    const child = createFakeChild();

    queueMicrotask(() => {
      child.stdout.write(
        `${JSON.stringify({ type: "thread.started", thread_id: "thread-xyz" })}\n`
      );
      child.stdout.write(`${JSON.stringify({ type: "turn.started" })}\n`);
      child.stdout.write(
        `${JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            content: [{ text: "analysis result" }],
          },
        })}\n`
      );
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    });

    return child;
  };

  const runtime = new CodexCliRuntime({
    spawn: fakeSpawn,
    idGenerator: (() => {
      const ids = ["session-1", "run-1"];
      return () => ids.shift() ?? "";
    })(),
  });

  const session = await runtime.createSession({
    workspaceRoot: tempRoot,
    runtimeHome: path.join(tempRoot, "runtime-home"),
  });
  const run = await runtime.sendTurn({
    sessionId: session.id,
    prompt: "hello",
  });
  const result = await runtime.getRunResult(run.runId);

  assert.equal(session.runtimeSessionId, "thread-xyz");
  assert.equal(result.status, "completed");
  assert.equal(result.runtimeSessionId, "thread-xyz");
  assert.deepEqual(result.sessionBinding, {
    runtimeSessionId: "thread-xyz",
    boundAt: result.sessionBinding?.boundAt,
    source: "thread.started",
  });
  assert.deepEqual(result.messages, [
    {
      role: "assistant",
      text: "analysis result",
      itemType: "agent_message",
      occurredAt: result.messages[0]?.occurredAt,
      source: "item.completed",
    },
  ]);
});

test("CodexCliRuntime streams normalized fixture-based failure events in order", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-stream-"));
  const fixturePath = new URL(
    "./fixtures/codex-cli-startup-failure.jsonl",
    import.meta.url
  );
  const fixtureLines = (await readFile(fixturePath, "utf8")).trim().split("\n");

  const fakeSpawn = () => {
    const child = createFakeChild();

    queueMicrotask(() => {
      for (const line of fixtureLines) {
        child.stdout.write(`${line}\n`);
      }
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 1, null);
    });

    return child;
  };

  const runtime = new CodexCliRuntime({
    spawn: fakeSpawn,
    idGenerator: (() => {
      const ids = ["session-2", "run-2"];
      return () => ids.shift() ?? "";
    })(),
  });

  const session = await runtime.createSession({
    workspaceRoot: tempRoot,
    runtimeHome: path.join(tempRoot, "runtime-home"),
  });
  const run = await runtime.sendTurn({
    sessionId: session.id,
    prompt: "hello",
  });
  const eventsPromise = (async () => {
    const events = [];
    for await (const event of runtime.streamEvents(run.runId)) {
      events.push(event);
    }
    return events;
  })();
  const result = await runtime.getRunResult(run.runId);
  const events = await eventsPromise;

  assert.equal(result.status, "failed");
  assert.equal(session.runtimeSessionId, "019ce441-40b0-75c3-82fc-94ac502fe67f");
  assert.equal(result.warnings.length, 3);
  assert.equal(result.sessionBinding?.runtimeSessionId, session.runtimeSessionId);
  assert.equal(result.messages.length, 0);
  assert.deepEqual(
    events.map((event) => event.type),
    [
      "session.bound",
      "run.started",
      "run.warning",
      "run.warning",
      "run.warning",
      "run.completed",
    ]
  );
});

test("CodexCliRuntime captures stderr, non-json stdout, and output-last-message", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-stdout-"));
  const lastMessagePath = path.join(tempRoot, "last-message.txt");

  const fakeSpawn = () => {
    const child = createFakeChild();

    queueMicrotask(async () => {
      await writeFile(lastMessagePath, "final assistant message");
      child.stdout.write("non-json line from codex\n");
      child.stderr.write("2026-03-13 ERROR websocket disconnected\n");
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 1, null);
    });

    return child;
  };

  const runtime = new CodexCliRuntime({
    spawn: fakeSpawn,
    idGenerator: (() => {
      const ids = ["session-3", "run-3"];
      return () => ids.shift() ?? "";
    })(),
  });

  const session = await runtime.createSession({
    workspaceRoot: tempRoot,
    runtimeHome: path.join(tempRoot, "runtime-home"),
  });
  const run = await runtime.sendTurn({
    sessionId: session.id,
    prompt: "hello",
    outputLastMessagePath: lastMessagePath,
  });
  const eventsPromise = (async () => {
    const events = [];
    for await (const event of runtime.streamEvents(run.runId)) {
      events.push(event);
    }
    return events;
  })();
  const result = await runtime.getRunResult(run.runId);
  const events = await eventsPromise;

  assert.equal(result.lastMessage, "final assistant message");
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0]?.text, "final assistant message");
  assert.deepEqual(result.artifactRefs, [
    {
      kind: "file",
      role: "output-last-message",
      path: lastMessagePath,
    },
  ]);
  assert.ok(events.some((event) => event.type === "run.stdout"));
  assert.ok(events.some((event) => event.type === "run.stderr"));
  assert.match(result.stderr[0] ?? "", /ERROR websocket disconnected/);
});

test("CodexCliRuntime keeps output-last-message after interim assistant events", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-final-"));
  const lastMessagePath = path.join(tempRoot, "last-message.txt");

  const fakeSpawn = () => {
    const child = createFakeChild();

    queueMicrotask(async () => {
      await writeFile(lastMessagePath, "final assistant message");
      child.stdout.write(
        `${JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            content: [{ text: "I'll inspect the request first." }],
          },
        })}\n`
      );
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    });

    return child;
  };

  const runtime = new CodexCliRuntime({
    spawn: fakeSpawn,
    idGenerator: (() => {
      const ids = ["session-4", "run-4"];
      return () => ids.shift() ?? "";
    })(),
  });

  const session = await runtime.createSession({
    workspaceRoot: tempRoot,
    runtimeHome: path.join(tempRoot, "runtime-home"),
  });
  const run = await runtime.sendTurn({
    sessionId: session.id,
    prompt: "hello",
    outputLastMessagePath: lastMessagePath,
  });
  const result = await runtime.getRunResult(run.runId);

  assert.deepEqual(
    result.messages.map((message) => message.text),
    ["I'll inspect the request first.", "final assistant message"]
  );
  assert.equal(result.messages.at(-1)?.itemType, "output-last-message");
  assert.equal(result.lastMessage, "final assistant message");
});

test("CodexCliRuntime shares HOME for writable runs and records the fallback warning", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-home-fallback-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const runtimeHome = path.join(tempRoot, "runtime-home");
  const sourceHome = path.join(tempRoot, "source-home");
  const sourceCodexDir = path.join(sourceHome, ".codex");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(sourceCodexDir, { recursive: true });
  await writeFile(path.join(sourceCodexDir, "auth.json"), '{"token":"abc"}');

  let capturedEnv: NodeJS.ProcessEnv | null = null;
  const fakeSpawn = (_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
    capturedEnv = options.env;
    const child = createFakeChild();
    queueMicrotask(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    });
    return child;
  };

  const runtime = new CodexCliRuntime({
    spawn: fakeSpawn,
    baseEnv: {
      ...process.env,
      HOME: sourceHome,
      PATH: process.env.PATH ?? "",
    },
    idGenerator: (() => {
      const ids = ["session-fallback", "run-fallback"];
      return () => ids.shift() ?? "";
    })(),
  });

  const session = await runtime.createSession({
    workspaceRoot,
    runtimeHome,
    sandbox: "workspace-write",
  });
  const run = await runtime.sendTurn({
    sessionId: session.id,
    prompt: "hello",
  });
  const result = await runtime.getRunResult(run.runId);

  assert.equal(capturedEnv?.HOME, sourceHome);
  assert.equal(
    capturedEnv?.XDG_CONFIG_HOME,
    path.join(runtimeHome, "xdg-config")
  );
  assert.match(
    String(result.warnings[0]?.message ?? ""),
    /shared HOME with isolated XDG state/
  );
});

test("CodexCliRuntime records a warning when an old session is upgraded by request-level bypass", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-shell-bypass-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const runtimeHome = path.join(tempRoot, "runtime-home");
  await mkdir(workspaceRoot, { recursive: true });

  const fakeSpawn = () => {
    const child = createFakeChild();
    queueMicrotask(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    });
    return child;
  };

  const runtime = new CodexCliRuntime({
    spawn: fakeSpawn,
    idGenerator: (() => {
      const ids = ["session-shell-bypass", "run-shell-bypass"];
      return () => ids.shift() ?? "";
    })(),
  });

  const session = await runtime.createSession({
    workspaceRoot,
    runtimeHome,
    sandbox: "read-only",
    dangerouslyBypassApprovalsAndSandbox: false,
  });
  const run = await runtime.sendTurn({
    sessionId: session.id,
    prompt: "Run 'ls -la'",
    dangerouslyBypassApprovalsAndSandbox: true,
  });
  const result = await runtime.getRunResult(run.runId);

  assert.match(
    String(result.warnings[0]?.message ?? ""),
    new RegExp(UNSANDBOXED_SHELL_INSPECTION_WARNING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );
});

test("CodexCliRuntime snapshots new workspace files into run artifacts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-artifacts-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const artifactsDir = path.join(tempRoot, "run-artifacts");
  const outputLastMessagePath = path.join(artifactsDir, "last-message.txt");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });

  const fakeSpawn = () => {
    const child = createFakeChild();

    queueMicrotask(async () => {
      await writeFile(path.join(workspaceRoot, "generated-chart.png"), "png-bytes");
      await writeFile(outputLastMessagePath, "DONE");
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    });

    return child;
  };

  const runtime = new CodexCliRuntime({
    spawn: fakeSpawn,
    idGenerator: (() => {
      const ids = ["session-artifacts", "run-artifacts"];
      return () => ids.shift() ?? "";
    })(),
  });

  const session = await runtime.createSession({
    workspaceRoot,
    runtimeHome: path.join(tempRoot, "runtime-home"),
    sandbox: "workspace-write",
  });
  const run = await runtime.sendTurn({
    sessionId: session.id,
    prompt: "hello",
    outputLastMessagePath,
  });
  const result = await runtime.getRunResult(run.runId);

  const workspaceArtifact = result.artifactRefs.find((artifact) =>
    artifact.role.startsWith("workspace-generated-chart")
  );

  assert.deepEqual(result.artifactRefs[0], {
    kind: "file",
    role: "output-last-message",
    path: outputLastMessagePath,
  });
  assert.ok(workspaceArtifact);
  assert.equal(
    await readFile(workspaceArtifact?.path ?? "", "utf8"),
    "png-bytes"
  );
  assert.ok(
    workspaceArtifact?.path.startsWith(path.join(artifactsDir, "workspace"))
  );
});

test("CodexCliRuntime marks cancelled runs and closes the event queue", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-cancel-"));

  const fakeSpawn = () => createFakeChild();

  const runtime = new CodexCliRuntime({
    spawn: fakeSpawn,
    idGenerator: (() => {
      const ids = ["session-4", "run-4"];
      return () => ids.shift() ?? "";
    })(),
  });

  const session = await runtime.createSession({
    workspaceRoot: tempRoot,
    runtimeHome: path.join(tempRoot, "runtime-home"),
  });
  const run = await runtime.sendTurn({
    sessionId: session.id,
    prompt: "hello",
  });
  const eventsPromise = (async () => {
    const events = [];
    for await (const event of runtime.streamEvents(run.runId)) {
      events.push(event);
    }
    return events;
  })();

  await runtime.cancelRun(run.runId);
  const result = await runtime.getRunResult(run.runId);
  const events = await eventsPromise;

  assert.equal(result.status, "cancelled");
  assert.equal(result.signal, "SIGTERM");
  assert.equal(events.at(-1)?.type, "run.completed");
  assert.equal(events.at(-1)?.data.status, "cancelled");
});

test("CodexCliRuntime handles process errors before close", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-error-"));

  const fakeSpawn = () => {
    const child = createFakeChild();
    queueMicrotask(() => {
      child.emit("error", new Error("spawn failed"));
    });
    return child;
  };

  const runtime = new CodexCliRuntime({
    spawn: fakeSpawn,
    idGenerator: (() => {
      const ids = ["session-5", "run-5"];
      return () => ids.shift() ?? "";
    })(),
  });

  const session = await runtime.createSession({
    workspaceRoot: tempRoot,
    runtimeHome: path.join(tempRoot, "runtime-home"),
  });
  const run = await runtime.sendTurn({
    sessionId: session.id,
    prompt: "hello",
  });
  const eventsPromise = (async () => {
    const events = [];
    for await (const event of runtime.streamEvents(run.runId)) {
      events.push(event);
    }
    return events;
  })();
  const result = await runtime.getRunResult(run.runId);
  const events = await eventsPromise;

  assert.equal(result.status, "failed");
  assert.match(result.errors[0] ?? "", /spawn failed/);
  assert.equal(events.at(-1)?.type, "run.error");
});
