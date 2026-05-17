import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import {
  AgentManager,
  ensureUvVirtualEnvironment,
} from "../../src/agents/agent-manager.js";
import { CodexCliRuntime } from "../../src/runtime/codex-cli-runtime.js";

import type {
  RuntimeChildProcess,
  RuntimeSpawnOptions,
} from "../../src/runtime/runtime-types.js";

function createFakeChild(
  exitCode = 0
): EventEmitter & RuntimeChildProcess {
  const child = new EventEmitter() as EventEmitter & RuntimeChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    queueMicrotask(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit("close", null, "SIGTERM");
    });
  };

  queueMicrotask(() => {
    child.stdout.end();
    child.stderr.end();
    child.emit("close", exitCode, null);
  });

  return child;
}

test("AgentManager creates isolated workspace and runtime-home layout", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-manager-state-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-1",
    now: () => "2026-03-13T00:00:00.000Z",
  });

  const agent = await manager.createAgent({
    name: "analysis-agent",
    description: "parallel runtime bootstrap branch",
    modelProfile: "default",
  });

  assert.equal(
    agent.workspaceRoot,
    path.join(stateRoot, "agents", "agent-1", "workspace")
  );
  assert.equal(
    agent.runtimeHome,
    path.join(stateRoot, "agents", "agent-1", "runtime-home")
  );

  for (const relativePath of [
    "",
    ".codex",
    "config",
    "rules",
    "skills",
    "state",
    "xdg-cache",
    "xdg-config",
    "xdg-state",
  ]) {
    await access(path.join(agent.runtimeHome, relativePath));
  }

  const savedAgent = JSON.parse(
    await readFile(path.join(stateRoot, "agents", "agent-1", "agent.json"), "utf8")
  );
  const workspaceConfig = JSON.parse(
    await readFile(
      path.join(agent.workspaceRoot, ".agents", "agent.config.json"),
      "utf8"
    )
  );
  const envTemplate = await readFile(
    path.join(agent.workspaceRoot, ".env.template"),
    "utf8"
  );
  const workspaceAgentsOverlay = await readFile(
    path.join(agent.workspaceRoot, "AGENTS.md"),
    "utf8"
  );

  assert.equal(savedAgent.name, "analysis-agent");
  assert.equal(savedAgent.modelProfile, "default");
  assert.equal(savedAgent.approvalPolicy, "on-request");
  assert.deepEqual(savedAgent.runtimePolicy, {
    workspaceMode: "directory",
    gitBackedWorkspace: false,
    isolatedHome: true,
    isolatedXdg: true,
  });
  assert.equal(savedAgent.toolPolicy.python.mode, "agent-local-uv-venv");
  assert.equal(
    savedAgent.toolPolicy.python.venvPath,
    path.join(agent.workspaceRoot, ".venv")
  );
  assert.equal(savedAgent.toolPolicy.ssh.command, "ssh");
  assert.equal(workspaceConfig.agentId, "agent-1");
  assert.equal(workspaceConfig.policies.modelProfile, "default");
  assert.equal(workspaceConfig.policies.runtime.workspaceMode, "directory");
  assert.equal(
    workspaceConfig.policies.tools.python.venvPath,
    path.join(agent.workspaceRoot, ".venv")
  );
  assert.match(envTemplate, /AGENT_ID=agent-1/);
  assert.match(envTemplate, /CODEX_SANDBOX=workspace-write/);
  assert.match(envTemplate, /AGENT_WORKSPACE_MODE=directory/);
  assert.ok(
    envTemplate.includes(`AGENT_PYTHON_VENV=${path.join(agent.workspaceRoot, ".venv")}`)
  );
  assert.match(envTemplate, /AGENT_SSH_COMMAND=ssh/);
  await access(path.join(agent.workspaceRoot, ".agents", "skills"));
  await access(path.join(agent.workspaceRoot, "skills"));
  assert.match(workspaceAgentsOverlay, /Workspace-local AGENTS overlay/);
  assert.match(workspaceAgentsOverlay, /Create or edit agent-local skills under `skills`/);
});

test("AgentManager rejects unmanaged custom workspace/runtime paths", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-manager-list-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: (() => {
      const ids = ["agent-a", "agent-b"];
      return () => ids.shift() ?? "";
    })(),
    now: (() => {
      const timestamps = [
        "2026-03-13T00:00:00.000Z",
        "2026-03-13T00:00:01.000Z",
        "2026-03-13T00:00:02.000Z",
      ];
      return () => timestamps.shift() ?? "";
    })(),
  });

  await manager.createAgent({ name: "one" });
  await manager.createAgent({ name: "two" });

  const listed = await manager.listAgents();

  assert.deepEqual(
    listed.map((agent) => agent.id),
    ["agent-a", "agent-b"]
  );

  await assert.rejects(
    manager.createAgent({
      id: "agent-c",
      name: "bad-create",
      workspaceRoot: path.join(stateRoot, "custom-workspace"),
    }),
    /workspaceRoot must use the managed agent path/
  );

  await assert.rejects(
    manager.updateAgent("agent-a", {
      runtimeHome: path.join(stateRoot, "custom-runtime-home"),
    }),
    /runtimeHome must use the managed agent path/
  );
});

test("AgentManager updates agent-facing metadata without changing managed paths", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-manager-update-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-a",
    now: (() => {
      const timestamps = [
        "2026-03-13T00:00:00.000Z",
        "2026-03-13T00:05:00.000Z",
      ];
      return () => timestamps.shift() ?? "";
    })(),
  });

  const created = await manager.createAgent({
    name: "original-name",
    description: "before update",
  });
  const updated = await manager.updateAgent("agent-a", {
    name: "renamed-agent",
    description: "after update",
  });

  assert.equal(updated.name, "renamed-agent");
  assert.equal(updated.description, "after update");
  assert.equal(updated.workspaceRoot, created.workspaceRoot);
  assert.equal(updated.runtimeHome, created.runtimeHome);
  assert.equal(updated.updatedAt, "2026-03-13T00:05:00.000Z");
});

test("AgentManager deletes managed agent roots and preserves list ordering", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-manager-delete-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: (() => {
      const ids = ["agent-a", "agent-b"];
      return () => ids.shift() ?? "";
    })(),
    now: (() => {
      const timestamps = [
        "2026-03-13T00:00:00.000Z",
        "2026-03-13T00:00:01.000Z",
      ];
      return () => timestamps.shift() ?? "";
    })(),
  });

  const created = await manager.createAgent({ name: "one" });
  await manager.createAgent({ name: "two" });

  await manager.deleteAgent("agent-a");

  await assert.rejects(manager.getAgent("agent-a"), /Unknown agent: agent-a/);
  await assert.rejects(access(path.join(stateRoot, "agents", "agent-a")), /ENOENT/);

  const listed = await manager.listAgents();
  assert.deepEqual(listed.map((agent) => agent.id), ["agent-b"]);
  assert.equal(created.lifecycle, "active");
  assert.equal(created.archivedAt, null);
});

test("AgentManager binds CodexCliRuntime sessions to isolated agent paths", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-manager-runtime-"));
  const captured: {
    command?: string;
    args?: string[];
    options?: RuntimeSpawnOptions;
  } = {};
  const runtime = new CodexCliRuntime({
    spawn: (command, args, options) => {
      captured.command = command;
      captured.args = args;
      captured.options = options;
      return createFakeChild(0);
    },
    idGenerator: (() => {
      const ids = ["agent-session", "agent-run"];
      return () => ids.shift() ?? "";
    })(),
  });
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-runtime",
    now: () => "2026-03-13T00:00:00.000Z",
  });

  const agent = await manager.createAgent({
    name: "runtime-agent",
    sandboxPolicy: "read-only",
    modelProfile: "default",
  });
  const session = await manager.createCodexSession(runtime, agent.id, {
    model: "gpt-5.4",
    skipGitRepoCheck: true,
  });
  const run = await runtime.sendTurn({
    sessionId: session.id,
    prompt: "hello",
  });

  await runtime.getRunResult(run.runId);

  assert.equal(session.agentId, agent.id);
  assert.equal(session.workspaceRoot, agent.workspaceRoot);
  assert.equal(session.runtimeHome, agent.runtimeHome);
  assert.equal(session.config.sandbox, "read-only");
  assert.equal(session.config.dangerouslyBypassApprovalsAndSandbox, false);
  assert.equal(session.config.approval, "on-request");
  assert.equal(session.config.profile, "default");
  assert.equal(session.config.model, "gpt-5.4");
  assert.ok(!captured.args?.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.ok(captured.args?.includes("--ask-for-approval"));
  assert.ok(captured.args?.includes("never"));
  assert.equal(captured.options?.cwd, agent.workspaceRoot);
  assert.equal(captured.options?.env.HOME, agent.runtimeHome);
  assert.equal(
    captured.options?.env.XDG_CONFIG_HOME,
    path.join(agent.runtimeHome, "xdg-config")
  );
});

test("AgentManager bootstraps a uv virtual environment only once when requested", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-manager-uv-"));
  const commands: Array<{
    file: string;
    args: string[];
    options?: { cwd?: string };
  }> = [];
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-uv",
    now: () => "2026-03-13T00:00:00.000Z",
    execFile: async (file, args, options) => {
      commands.push({ file, args, options });
      const venvPath = args.at(-1) ?? "";
      await mkdir(path.join(venvPath, "bin"), { recursive: true });
      await writeFile(path.join(venvPath, "bin", "python"), "");
      await writeFile(path.join(venvPath, "bin", "pip"), "");
      return { stdout: "", stderr: "" };
    },
  });

  const created = await manager.createAgent({
    name: "python-agent",
    bootstrapUvVenv: true,
  });
  const updated = await manager.updateAgent("agent-uv", {
    description: "still the same venv",
    bootstrapUvVenv: true,
  });

  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.file, "uv");
  assert.deepEqual(commands[0]?.args, [
    "venv",
    "--seed",
    path.join(created.workspaceRoot, ".venv"),
  ]);
  assert.deepEqual(created.pythonEnvironment, {
    manager: "uv",
    type: "venv",
    path: path.join(created.workspaceRoot, ".venv"),
  });
  assert.deepEqual(updated.pythonEnvironment, {
    manager: "uv",
    type: "venv",
    path: path.join(created.workspaceRoot, ".venv"),
  });
});

test("ensureUvVirtualEnvironment reseeds an existing uv venv when pip is missing", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-manager-seed-"));
  const venvPath = path.join(workspaceRoot, ".venv");
  const commands: Array<{
    file: string;
    args: string[];
    options?: { cwd?: string };
  }> = [];

  await mkdir(path.join(venvPath, "bin"), { recursive: true });
  await writeFile(path.join(venvPath, "bin", "python"), "");

  const result = await ensureUvVirtualEnvironment({
    workspaceRoot,
    execFileImpl: async (file, args, options) => {
      commands.push({ file, args, options });
      await writeFile(path.join(venvPath, "bin", "pip"), "");
      return { stdout: "", stderr: "" };
    },
  });

  assert.equal(result.created, true);
  assert.equal(result.path, venvPath);
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.file, "uv");
  assert.deepEqual(commands[0]?.args, ["venv", "--seed", venvPath]);
});

test("AgentManager refreshes the workspace env template on update", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-manager-env-template-"));
  const manager = new AgentManager({
    stateRoot,
    idGenerator: () => "agent-template",
    now: (() => {
      const timestamps = [
        "2026-03-13T00:00:00.000Z",
        "2026-03-13T00:05:00.000Z",
      ];
      return () => timestamps.shift() ?? "";
    })(),
  });

  const created = await manager.createAgent({
    modelProfile: "default",
    sandboxPolicy: "workspace-write",
  });
  await manager.updateAgent("agent-template", {
    modelProfile: "ops",
    sandboxPolicy: "read-only",
  });

  const envTemplate = await readFile(
    path.join(created.workspaceRoot, ".env.template"),
    "utf8"
  );

  assert.match(envTemplate, /CODEX_SANDBOX=read-only/);
  assert.match(envTemplate, /CODEX_MODEL_PROFILE=ops/);
});

test("AgentManager repairs legacy agent records onto managed workspace/runtime paths", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agent-manager-repair-"));
  const manager = new AgentManager({
    stateRoot,
    now: () => "2026-03-13T00:10:00.000Z",
  });
  const agentRoot = path.join(stateRoot, "agents", "agent-legacy");
  const metadataPath = path.join(agentRoot, "agent.json");
  const oldWorkspaceRoot = path.join(stateRoot, "legacy-workspace");
  const oldRuntimeHome = path.join(stateRoot, "legacy-runtime-home");

  await mkdir(agentRoot, { recursive: true });
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        id: "agent-legacy",
        name: "legacy-agent",
        description: "",
        workspaceRoot: oldWorkspaceRoot,
        runtimeHome: oldRuntimeHome,
        defaultRuntime: "codex-cli",
        sandboxPolicy: "workspace-write",
        approvalPolicy: "on-request",
        modelProfile: null,
        runtimePolicy: {
          workspaceMode: "directory",
          gitBackedWorkspace: false,
          isolatedHome: true,
          isolatedXdg: true,
        },
        toolPolicy: {
          python: {
            mode: "agent-local-uv-venv",
            venvPath: path.join(oldWorkspaceRoot, ".venv"),
            systemFallback: false,
          },
          ssh: {
            command: "ssh",
          },
        },
        status: "active",
        lifecycle: "active",
        archivedAt: null,
        pythonEnvironment: {
          manager: "uv",
          type: "venv",
          path: path.join(oldWorkspaceRoot, ".venv"),
        },
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
      },
      null,
      2
    ),
    "utf8"
  );

  const agent = await manager.getAgent("agent-legacy");

  assert.equal(
    agent.workspaceRoot,
    path.join(stateRoot, "agents", "agent-legacy", "workspace")
  );
  assert.equal(
    agent.runtimeHome,
    path.join(stateRoot, "agents", "agent-legacy", "runtime-home")
  );
  assert.equal(agent.toolPolicy.python.venvPath, path.join(agent.workspaceRoot, ".venv"));
  assert.deepEqual(agent.pythonEnvironment, {
    manager: "uv",
    type: "venv",
    path: path.join(agent.workspaceRoot, ".venv"),
  });

  await access(path.join(agent.workspaceRoot, ".agents", "agent.config.json"));
  await access(path.join(agent.workspaceRoot, "AGENTS.md"));

  const persisted = JSON.parse(await readFile(metadataPath, "utf8"));
  assert.equal(persisted.workspaceRoot, agent.workspaceRoot);
  assert.equal(persisted.runtimeHome, agent.runtimeHome);
});
