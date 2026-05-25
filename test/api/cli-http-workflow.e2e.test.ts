import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { ConnectorState } from "../../src/connectors/connector-types.js";

const execFileAsync = promisify(execFile);

function cliPath(): string {
  return path.join(process.cwd(), "dist", "src", "cli.js");
}

async function createFakeCodexBin(rootDir: string): Promise<string> {
  const binDir = path.join(rootDir, "bin");
  const codexPath =
    process.platform === "win32"
      ? path.join(binDir, "codex.cmd")
      : path.join(binDir, "codex");
  const codexScriptPath =
    process.platform === "win32"
      ? path.join(binDir, "node_modules", "@openai", "codex", "bin", "codex.js")
      : codexPath;

  await mkdir(path.dirname(codexScriptPath), { recursive: true });
  await writeFile(
    codexScriptPath,
    `#!/usr/bin/env node
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const execIndex = args.indexOf("exec");
if (execIndex === -1) {
  console.error("fake-codex: missing exec command");
  process.exit(2);
}

const globalArgs = args.slice(0, execIndex);
const commandArgs = args.slice(execIndex + 1);

let workspaceRoot = null;
for (let index = 0; index < globalArgs.length; index += 1) {
  if (globalArgs[index] === "-C") {
    workspaceRoot = globalArgs[index + 1] ?? null;
    index += 1;
  }
}

let mode = "exec";
let offset = 0;
if (commandArgs[0] === "resume") {
  mode = "resume";
  offset = 1;
}

let skipGitRepoCheck = false;
let outputLastMessagePath = null;
const positionals = [];

for (let index = offset; index < commandArgs.length; index += 1) {
  const value = commandArgs[index];
  if (value === "--json" || value === "--ephemeral" || value === "--full-auto") {
    continue;
  }
  if (
    value === "--dangerously-bypass-approvals-and-sandbox" ||
    value === "--skip-git-repo-check"
  ) {
    if (value === "--skip-git-repo-check") {
      skipGitRepoCheck = true;
    }
    continue;
  }
  if (
    value === "--color" ||
    value === "--output-last-message" ||
    value === "-i"
  ) {
    if (value === "--output-last-message") {
      outputLastMessagePath = commandArgs[index + 1] ?? null;
    }
    index += 1;
    continue;
  }
  positionals.push(value);
}

if (!skipGitRepoCheck) {
  console.error("Not inside a trusted directory and --skip-git-repo-check was not specified.");
  process.exit(1);
}

const runtimeSessionId =
  mode === "resume" ? (positionals.shift() ?? "thread-e2e") : "thread-e2e";
const rawPrompt = positionals.join(" ").trim();
const start = rawPrompt.indexOf("<user_request>\\n");
const end = rawPrompt.lastIndexOf("\\n</user_request>");
const prompt =
  start === -1 || end === -1 || end <= start
    ? rawPrompt
    : rawPrompt.slice(start + "<user_request>".length + 1, end);
const responseText = mode === "resume" ? \`resume:\${prompt}\` : \`first:\${prompt}\`;

if (outputLastMessagePath) {
  await mkdir(path.dirname(outputLastMessagePath), { recursive: true });
  await writeFile(outputLastMessagePath, responseText, "utf8");
}

if (mode === "exec") {
  console.log(JSON.stringify({ type: "thread.started", thread_id: runtimeSessionId }));
}
console.log(JSON.stringify({ type: "turn.started", cwd: workspaceRoot }));
console.log(
  JSON.stringify({
    type: "item.completed",
    item: {
      type: "agent_message",
      content: [{ text: responseText }],
    },
  })
);
`,
    { mode: 0o755 }
  );

  if (process.platform === "win32") {
    await writeFile(
      codexPath,
      `@echo off\r\n"${process.execPath}" "%~dp0node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`,
      { mode: 0o755 }
    );
  }

  return binDir;
}

async function runCliCommand(
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(process.execPath, [cliPath(), ...args], {
    cwd: process.cwd(),
    env: cliTestEnv(env),
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseSseResponse(payload: string): Array<{ event: string; data: any }> {
  return payload
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const event = lines
        .find((line) => line.startsWith("event: "))
        ?.slice("event: ".length);
      const data = lines
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length);

      return {
        event: event ?? "",
        data: JSON.parse(data ?? "{}"),
      };
    });
}

async function startCliServer(
  args: string[],
  env: NodeJS.ProcessEnv,
  options: { cwd?: string } = {}
): Promise<{
  child: ReturnType<typeof spawn>;
  info: { host: string; port: number; stateRoot: string | null };
  stderr: () => string;
}> {
  const child = spawn(process.execPath, [cliPath(), ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: cliTestEnv(env),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  const info = await new Promise<{ host: string; port: number; stateRoot: string | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        reject(new Error(`serve exited before startup: ${code}\\n${stderr}`));
      });
      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
        try {
          const parsed = JSON.parse(stdout.trim()) as {
            host: string;
            port: number;
            stateRoot: string | null;
          };
          resolve(parsed);
        } catch {
          // Wait for the full pretty-printed JSON object.
        }
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
    }
  );

  return {
    child,
    info,
    stderr: () => stderr,
  };
}

function cliTestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ROCKY_DISABLE_DOTENV: "1",
    ...env,
  };
}

async function stopProcess(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

test("serve loads connector environment from cwd .env", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ia15-dotenv-e2e-"));
  const stateRoot = path.join(tempRoot, "state");
  await writeFile(
    path.join(tempRoot, ".env"),
    [
      "ROCKY_CONNECTOR_INSTAGRAM_ACCOUNT_KIND=professional_business",
      "ROCKY_CONNECTOR_INSTAGRAM_GRAPH_ACCESS_TOKEN=instagram-graph-secret",
      "ROCKY_CONNECTOR_INSTAGRAM_BUSINESS_ACCOUNT_ID=17841400000000000",
      "ROCKY_CONNECTOR_INSTAGRAM_FACEBOOK_PAGE_ID=112233445566",
      "ROCKY_CONNECTOR_INSTAGRAM_META_BUSINESS_ID=998877665544",
      "ROCKY_CONNECTOR_INSTAGRAM_CLIENT_ID=meta-client-id",
      "ROCKY_CONNECTOR_INSTAGRAM_CLIENT_SECRET=meta-client-secret",
      "ROCKY_CONNECTOR_INSTAGRAM_GRAPH_PERMISSIONS=instagram_basic,pages_show_list,instagram_content_publish,instagram_manage_insights",
      "",
    ].join("\n"),
    "utf8",
  );

  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("ROCKY_CONNECTOR_INSTAGRAM_") ||
      key.startsWith("ROCKY_INSTAGRAM_") ||
      key.startsWith("INSTAGRAM_")
    ) {
      delete env[key];
    }
  }
  env.ROCKY_DISABLE_DOTENV = "0";
  delete env.ROCKY_DOTENV_PATH;

  const { child, info, stderr } = await startCliServer(
    [
      "serve",
      "--state-root",
      stateRoot,
      "--host",
      "127.0.0.1",
      "--port",
      "0",
    ],
    env,
    { cwd: tempRoot },
  );

  try {
    const response = await fetch(`http://${info.host}:${info.port}/connectors/instagram/state`);
    assert.equal(response.status, 200);
    const state = (await response.json()) as ConnectorState;
    assert.deepEqual(state.readiness.blockers, []);
  } finally {
    await stopProcess(child);
  }

  assert.equal(stderr(), "");
});

test("CLI e2e workflow covers agent/session creation, send, stream, transcript, and run replay", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ia15-cli-e2e-"));
  const fakeCodexBinDir = await createFakeCodexBin(tempRoot);
  const stateRoot = path.join(tempRoot, "state");
  const env = {
    ...process.env,
    PATH: `${fakeCodexBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
  };

  const createdAgent = JSON.parse(
    (
      await runCliCommand(
        [
          "agent",
          "create",
          "--state-root",
          stateRoot,
          "--id",
          "demo-agent",
          "--name",
          "Demo Agent",
        ],
        env
      )
    ).stdout
  );
  assert.equal(createdAgent.id, "demo-agent");

  const createdSession = JSON.parse(
    (
      await runCliCommand(
        [
          "session",
          "create",
          "demo-agent",
          "--state-root",
          stateRoot,
          "--title",
          "CLI Demo",
        ],
        env
      )
    ).stdout
  );
  assert.equal(createdSession.runtimeConfig.skipGitRepoCheck, true);
  assert.equal(
    createdSession.runtimeConfig.dangerouslyBypassApprovalsAndSandbox,
    false
  );

  const firstSend = JSON.parse(
    (
      await runCliCommand(
        [
          "session",
          "send",
          createdSession.id,
          "--state-root",
          stateRoot,
          "--prompt",
          "Reply with exactly OK",
        ],
        env
      )
    ).stdout
  );
  assert.equal(firstSend.result.status, "completed");
  assert.equal(firstSend.result.runtimeSessionId, "thread-e2e");
  assert.equal(firstSend.result.sessionBinding.source, "thread.started");
  assert.equal(firstSend.result.messages[0].text, "first:Reply with exactly OK");

  const streamedLines = (
    await runCliCommand(
      [
        "session",
        "send",
        createdSession.id,
        "--state-root",
        stateRoot,
        "--prompt",
        "방금 답을 한 줄 한국어로 다시 말해줘",
        "--stream",
      ],
      env
    )
  ).stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(streamedLines.at(-1)?.type, "result");
  const streamedEventTypes = streamedLines
    .filter((entry) => entry.type === "event")
    .map((entry) => entry.event.type);
  assert.deepEqual(
    streamedEventTypes.filter((eventType) => eventType !== "run.warning"),
    ["run.started", "assistant.message.completed", "run.completed"]
  );
  const streamedResult = streamedLines.at(-1);
  assert.equal(
    streamedResult.result.messages[0].text,
    "resume:방금 답을 한 줄 한국어로 다시 말해줘"
  );
  assert.equal(streamedResult.result.sessionBinding.source, "existing-session");

  const transcript = JSON.parse(
    (
      await runCliCommand(
        [
          "session",
          "transcript",
          createdSession.id,
          "--state-root",
          stateRoot,
        ],
        env
      )
    ).stdout
  );
  assert.deepEqual(
    transcript.map((message: { role: string; content: string }) => [
      message.role,
      message.content,
    ]),
    [
      ["user", "Reply with exactly OK"],
      ["assistant", "first:Reply with exactly OK"],
      ["user", "방금 답을 한 줄 한국어로 다시 말해줘"],
      ["assistant", "resume:방금 답을 한 줄 한국어로 다시 말해줘"],
    ]
  );

  const replayedRunEvents = (
    await runCliCommand(
      [
        "run",
        "events",
        firstSend.run.id,
        "--state-root",
        stateRoot,
      ],
      env
    )
  ).stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    replayedRunEvents
      .map((event) => event.type)
      .filter((eventType) => eventType !== "run.warning"),
    ["session.bound", "run.started", "assistant.message.completed", "run.completed"]
  );
});

test("HTTP/SSE e2e workflow covers serve, session creation, message send, events, and transcript", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ia15-http-e2e-"));
  const fakeCodexBinDir = await createFakeCodexBin(tempRoot);
  const stateRoot = path.join(tempRoot, "state");
  const env = {
    ...process.env,
    PATH: `${fakeCodexBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
  };

  await runCliCommand(
    [
      "agent",
      "create",
      "--state-root",
      stateRoot,
      "--id",
      "demo-agent",
      "--name",
      "Demo Agent",
    ],
    env
  );

  const { child, info, stderr } = await startCliServer(
    [
      "serve",
      "--state-root",
      stateRoot,
      "--host",
      "127.0.0.1",
      "--port",
      "0",
    ],
    env
  );

  try {
    const baseUrl = `http://${info.host}:${info.port}`;

    const agentsResponse = await fetch(`${baseUrl}/agents`);
    assert.equal(agentsResponse.status, 200);
    const agents = await agentsResponse.json();
    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, "demo-agent");

    const agentResponse = await fetch(`${baseUrl}/agents/demo-agent`);
    assert.equal(agentResponse.status, 200);
    const agent = await agentResponse.json();
    assert.equal(agent.name, "Demo Agent");

    const createdSessionResponse = await fetch(
      `${baseUrl}/agents/demo-agent/sessions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: "HTTP Demo" }),
      }
    );
    assert.equal(createdSessionResponse.status, 201);
    const createdSession = await createdSessionResponse.json();
    assert.equal(createdSession.title, "HTTP Demo");

    const listSessionsResponse = await fetch(`${baseUrl}/agents/demo-agent/sessions`);
    assert.equal(listSessionsResponse.status, 200);
    const sessions = await listSessionsResponse.json();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, createdSession.id);

    const sendTurnResponse = await fetch(
      `${baseUrl}/sessions/${createdSession.id}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: "Reply with exactly OK" }),
      }
    );
    assert.equal(sendTurnResponse.status, 202);
    const createdRun = await sendTurnResponse.json();

    const sseResponse = await fetch(`${baseUrl}/runs/${createdRun.id}/events`);
    assert.equal(sseResponse.status, 200);
    const sseEvents = parseSseResponse(await sseResponse.text());
    assert.deepEqual(
      sseEvents
        .map((entry) => entry.event)
        .filter((eventType) => eventType !== "run.warning"),
      ["session.bound", "run.started", "assistant.message.completed", "run.completed"]
    );

    const resultResponse = await fetch(`${baseUrl}/runs/${createdRun.id}/result`);
    assert.equal(resultResponse.status, 200);
    const result = await resultResponse.json();
    assert.equal(result.status, "completed");
    assert.equal(result.sessionBinding.source, "thread.started");
    assert.equal(result.messages[0].text, "first:Reply with exactly OK");

    const artifactsResponse = await fetch(`${baseUrl}/runs/${createdRun.id}/artifacts`);
    assert.equal(artifactsResponse.status, 200);
    const artifacts = await artifactsResponse.json();
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].role, "output-last-message");
    assert.equal(artifacts[0].previewable, true);
    assert.equal(
      artifacts[0].previewUrl,
      `/runs/${createdRun.id}/artifacts/output-last-message/preview`
    );
    assert.equal(artifacts[0].preferredAction, "preview");
    assert.equal(
      artifacts[0].downloadUrl,
      `/runs/${createdRun.id}/artifacts/output-last-message`
    );

    const artifactDownloadResponse = await fetch(
      `${baseUrl}/runs/${createdRun.id}/artifacts/output-last-message`
    );
    assert.equal(artifactDownloadResponse.status, 200);
    assert.equal(
      artifactDownloadResponse.headers.get("content-type"),
      "text/plain; charset=utf-8"
    );
    assert.equal(
      await artifactDownloadResponse.text(),
      "first:Reply with exactly OK"
    );

    const artifactPreviewResponse = await fetch(
      `${baseUrl}/runs/${createdRun.id}/artifacts/output-last-message/preview`
    );
    assert.equal(artifactPreviewResponse.status, 200);
    assert.equal(
      artifactPreviewResponse.headers.get("content-type"),
      "text/plain; charset=utf-8"
    );
    assert.equal(
      await artifactPreviewResponse.text(),
      "first:Reply with exactly OK"
    );

    const transcriptResponse = await fetch(
      `${baseUrl}/sessions/${createdSession.id}/transcript`
    );
    assert.equal(transcriptResponse.status, 200);
    const transcript = await transcriptResponse.json();
    assert.deepEqual(
      transcript.map((message: { role: string; content: string }) => [
        message.role,
        message.content,
      ]),
      [
        ["user", "Reply with exactly OK"],
        ["assistant", "first:Reply with exactly OK"],
      ]
    );
  } finally {
    await stopProcess(child);
    assert.equal(stderr(), "");
  }
});
