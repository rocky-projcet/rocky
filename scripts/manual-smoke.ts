#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { CodexCliRuntime } from "../src/index.js";

import type { RuntimeEvent } from "../src/runtime/runtime-types.js";

function printUsage(): void {
  console.error(`Usage:
  npm run smoke -- --prompt "Reply with exactly OK"
  node dist/scripts/manual-smoke.js --prompt "Reply with exactly OK"

Options:
  --prompt <text>           Prompt to send to Codex. Required unless passed as the first positional argument.
  --pptx-smoke              Run the v0.1.1 PPTX artifact creation smoke prompt.
  --workspace <path>        Workspace root to run in. Defaults to the current directory.
  --runtime-home <path>     Isolated runtime home. Defaults to .runtime/manual-smoke under the workspace.
  --sandbox <mode>          Codex sandbox mode. Defaults to read-only.
  --profile <name>          Optional Codex profile.
  --model <name>            Optional Codex model.
  --skip-git-repo-check     Pass --skip-git-repo-check to codex.
  --ephemeral               Pass --ephemeral to codex.
  --output-last-message     Persist the final message to a file and print the path.
  --full-auto               Pass --full-auto to codex.
  --dangerously-bypass-approvals-and-sandbox
                            Pass the matching Codex flag. Use only in a trusted environment.
  --help                    Show this help.
`);
}

function buildPptxSmokePrompt(): string {
  return [
    "Create a valid minimal PowerPoint file at outputs/manual-smoke/pptx-smoke.pptx.",
    "Use only workspace-local files and commands. If a presentation package is unavailable, use Python's standard-library zipfile module to write the minimal .pptx package directly.",
    "Verify that outputs/manual-smoke/pptx-smoke.pptx exists before the final answer.",
    "Reply with exactly: PPTX_SMOKE_OK outputs/manual-smoke/pptx-smoke.pptx",
  ].join("\n");
}

function formatEvent(event: RuntimeEvent): string {
  const data =
    event.data && Object.keys(event.data).length > 0
      ? ` ${JSON.stringify(event.data)}`
      : "";
  return `[${event.occurredAt}] ${event.type}${data}`;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      prompt: { type: "string" },
      "pptx-smoke": { type: "boolean" },
      workspace: { type: "string" },
      "runtime-home": { type: "string" },
      sandbox: { type: "string" },
      profile: { type: "string" },
      model: { type: "string" },
      "skip-git-repo-check": { type: "boolean" },
      ephemeral: { type: "boolean" },
      "output-last-message": { type: "boolean" },
      "full-auto": { type: "boolean" },
      "dangerously-bypass-approvals-and-sandbox": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printUsage();
    return;
  }

  const pptxSmoke = values["pptx-smoke"] ?? false;
  const prompt =
    values.prompt ??
    (pptxSmoke ? buildPptxSmokePrompt() : positionals.join(" ").trim());
  if (!prompt) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const workspaceRoot = path.resolve(values.workspace ?? process.cwd());
  const runtimeHome = path.resolve(
    values["runtime-home"] ?? path.join(workspaceRoot, ".runtime", "manual-smoke")
  );
  const outputLastMessagePath = values["output-last-message"] || pptxSmoke
    ? path.join(runtimeHome, "last-message.txt")
    : null;

  const runtime = new CodexCliRuntime();
  const session = await runtime.createSession({
    workspaceRoot,
    runtimeHome,
    sandbox: values.sandbox ?? (pptxSmoke ? "workspace-write" : "read-only"),
    profile: values.profile ?? null,
    model: values.model ?? null,
    skipGitRepoCheck: values["skip-git-repo-check"] ?? true,
    ephemeral: values.ephemeral ?? false,
    fullAuto: values["full-auto"] ?? false,
    dangerouslyBypassApprovalsAndSandbox:
      values["dangerously-bypass-approvals-and-sandbox"] ?? pptxSmoke,
  });

  console.error(`Workspace: ${workspaceRoot}`);
  console.error(`Runtime home: ${runtimeHome}`);
  console.error(`Session ID: ${session.id}`);

  const run = await runtime.sendTurn({
    sessionId: session.id,
    prompt,
    outputLastMessagePath,
  });

  const streamPromise = (async () => {
    for await (const event of runtime.streamEvents(run.runId)) {
      console.log(formatEvent(event));
    }
  })();

  const result = await runtime.getRunResult(run.runId);
  await streamPromise;

  console.error(`Run ID: ${run.runId}`);
  console.error(`Status: ${result.status}`);
  console.error(`Runtime session ID: ${result.runtimeSessionId ?? "unbound"}`);

  if (outputLastMessagePath) {
    console.error(`Last message path: ${outputLastMessagePath}`);
  }

  if (result.warnings.length > 0) {
    console.error(`Warnings: ${JSON.stringify(result.warnings)}`);
  }

  if (result.errors.length > 0) {
    console.error(`Errors: ${JSON.stringify(result.errors)}`);
  }

  if (result.stderr.length > 0) {
    console.error(`Stderr lines: ${JSON.stringify(result.stderr)}`);
  }

  if (result.artifactRefs.length > 0) {
    console.error(`Artifact refs: ${JSON.stringify(result.artifactRefs)}`);
  }

  if (result.messages.length > 0) {
    console.error(`Messages: ${JSON.stringify(result.messages)}`);
  }

  if (result.lastMessage) {
    console.error("Last message:");
    console.error(result.lastMessage);
  }

  process.exitCode = result.status === "completed" ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
