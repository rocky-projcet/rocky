import path from "node:path";

import type { AgentSessionOverrides } from "../agents/agent-types.js";
import type {
  RuntimeArtifactRef,
  RuntimeConversationMessage,
  RuntimeOllamaLaunchTarget,
  RuntimeRequest,
  RuntimeReasoningEffort,
  RuntimeRunResult,
  RuntimeRunStart,
  RuntimeServiceTier,
  RuntimeSession,
} from "../runtime/runtime-types.js";
import {
  normalizeRuntimeOllamaLaunchTarget,
  normalizeRuntimeServiceTier,
} from "../runtime/runtime-types.js";
import {
  artifactDownloadPath,
  artifactPreviewPath,
  buildArtifactViewMetadata,
  contentTypeForArtifactPath,
  isInlinePreviewAllowed,
} from "../runtime/runtime-artifact-metadata.js";
import type {
  AgentRunPaths,
  AgentRunRecord,
  AgentSessionArtifactManifestEntry,
  AgentSessionKind,
  AgentSessionLifecycle,
  AgentSessionMessage,
  AgentSessionMessageBlock,
  AgentSessionRecord,
  AgentSessionTurnInput,
} from "./session-types.js";

const USER_REQUEST_OPEN = "<user_request>";
const USER_REQUEST_CLOSE = "</user_request>";
const FENCED_CODE_PATTERN = /```([^\n`]*)\n([\s\S]*?)```/g;
const SHELL_FENCE_PATTERN = /```(?:bash|sh|shell)\n([\s\S]*?)```/i;
const RUN_COMMAND_PATTERN =
  /\b(?:run|execute)\s+['"`]([^'"`\n]+)['"`]/i;
const INTERPRETER_RUN_COMMAND_PATTERN =
  /\b(?:then\s+)?(?:run|execute)\s+[`'"]?((?:python3?|python|(?:\.\/)?\.venv\/bin\/python)\s+[./\w-]+\.py)\b[`'"]?/i;
const DIRECTORY_LISTING_PATTERN =
  /(ls\s+-la|directory listing|list files|show files|file list|파일 목록|디렉터리 목록)/i;
const UV_VENV_INTENT_PATTERN =
  /(?:(?:uv).*(?:venv|virtualenv|가상환경)|(?:venv|virtualenv|가상환경).*(?:uv))/i;
const CREATE_INTENT_PATTERN =
  /(create|make|setup|set up|bootstrap|initialize|init|prepare|만들|생성|구성|세팅|준비|초기화)/i;
const NPM_INSTALL_INTENT_PATTERN =
  /(?:(?:npm).*(?:install|dependencies?|packages?|의존성|패키지|모듈|설치|깔아)|(?:dependencies?|packages?|의존성|패키지|모듈).*(?:npm).*(?:install|설치|깔아))/i;
const BROWSER_AUTOMATION_PATTERN =
  /(playwright|puppeteer|selenium|chromium|chrome|browser|브라우저)/i;
const BROWSER_AUTOMATION_ACTION_PATTERN =
  /(login|log in|sign in|authenticate|launch|open|start|run|execute|manual login|persistent context|로그인|인증|열어|띄워|실행)/i;
const WORKSPACE_ARTIFACT_ACTION_PATTERN =
  /(create|make|generate|write|save|export|render|build|produce|prepare|compose|convert|set-content|out-file|new-item|만들|생성|작성|저장|내보내|출력|제작|변환|준비)/i;
const WORKSPACE_ARTIFACT_TARGET_PATTERN =
  /(outputs\/|output|deliverable|artifact|pptx?|powerpoint|presentation|deck|slides?|pdf|docx?|xlsx?|csv|report|document|image|video|audio|chart|산출물|결과물|PPT|피피티|파워포인트|발표자료|슬라이드|보고서|문서|엑셀|스프레드시트|이미지|영상|오디오|차트)/i;
const SHELL_WRAPPER_PATTERN =
  /^(?:\/bin\/)?(?:bash|sh)\s+-lc\s+(['"])([\s\S]*)\1$/i;
const SHELL_METACHARACTER_PATTERN = /[|&;><`$()]/;
const INTERPRETER_VERSION_FLAGS = new Set(["--version", "-V", "-v"]);
const BLOCKED_UNSANDBOXED_EXECUTABLES = new Set([
  "sudo",
  "su",
  "ssh",
  "scp",
  "sftp",
  "nc",
  "ncat",
  "netcat",
  "telnet",
  "apt",
  "apt-get",
  "yum",
  "dnf",
  "brew",
  "git",
  "docker",
  "kubectl",
  "podman",
]);
const UNSANDBOXED_INSPECTION_EXECUTABLES = new Set([
  "pwd",
  "ls",
  "rg",
  "cat",
  "sed",
  "find",
  "head",
  "tail",
  "wc",
  "stat",
  "sort",
  "grep",
]);
const UNSANDBOXED_WORKSPACE_EXECUTABLES = new Set([
  "python",
  "python3",
  "node",
  "bash",
  "sh",
]);
const UNSANDBOXED_NETWORK_FETCH_EXECUTABLES = new Set(["curl", "wget"]);
const UNSANDBOXED_PACKAGE_MANAGER_EXECUTABLES = new Set([
  "pip",
  "pip3",
  "npm",
  "uv",
]);

export function resolveSessionServiceStateRoot(stateRoot?: string): string {
  return path.resolve(
    stateRoot ?? path.join(process.cwd(), ".runtime", "agent-engine")
  );
}

export function truncateSummary(value: string | null, maxLength = 160): string | null {
  if (!value) {
    return null;
  }

  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return null;
  }

  return compact.length <= maxLength
    ? compact
    : `${compact.slice(0, maxLength - 3)}...`;
}

function extractRuntimeConfigOverrideValue(
  configOverrides: string[] | undefined,
  key: string
): string | null {
  for (const entry of configOverrides ?? []) {
    const match = entry.match(
      new RegExp(`^\\s*${key}\\s*=\\s*["']?([^"']+)["']?\\s*$`)
    );
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function normalizeReasoningEffort(
  value: string | null | undefined
): RuntimeReasoningEffort | null {
  return value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
    ? value
    : null;
}

function normalizeServiceTier(
  value: string | null | undefined
): RuntimeServiceTier | null {
  return normalizeRuntimeServiceTier(value);
}

function normalizeOllamaLaunchTarget(
  value: string | null | undefined
): RuntimeOllamaLaunchTarget | null {
  return normalizeRuntimeOllamaLaunchTarget(value);
}

export function buildMessageRecord({
  id,
  sessionId,
  runId,
  role,
  content,
  artifacts,
  source,
  createdAt,
}: {
  id: string;
  sessionId: string;
  runId: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  artifacts?: AgentSessionArtifactManifestEntry[];
  source: string;
  createdAt: string;
}): AgentSessionMessage {
  const normalizedArtifacts = normalizeArtifacts(artifacts, runId);

  return {
    id,
    sessionId,
    runId,
    role,
    content,
    blocks: buildMessageBlocks(content, normalizedArtifacts),
    artifacts: normalizedArtifacts,
    source,
    createdAt,
  };
}

export function buildMessageBlocks(
  content: string,
  artifacts: AgentSessionArtifactManifestEntry[] = []
): AgentSessionMessageBlock[] {
  const blocks = parseContentBlocks(content);

  for (const artifact of artifacts) {
    if (
      artifact.role === "output-last-message" &&
      artifact.contentType.startsWith("text/plain")
    ) {
      continue;
    }

    if (artifact.presentation === "image") {
      blocks.push({
        type: "image",
        artifactRole: artifact.role,
        alt: artifact.name,
      });
      continue;
    }

    if (artifact.presentation === "chart") {
      blocks.push({
        type: "chart",
        artifactRole: artifact.role,
        title: artifact.name,
      });
      continue;
    }

    blocks.push({
      type: "file",
      artifactRole: artifact.role,
      label: artifact.name,
    });
  }

  return blocks.length > 0 ? blocks : [{ type: "text", text: content }];
}

export function hydrateSessionMessage(
  message: AgentSessionMessage
): AgentSessionMessage {
  const artifacts = normalizeArtifacts(message.artifacts, message.runId);

  return {
    ...message,
    artifacts,
    blocks:
      message.blocks && message.blocks.length > 0
        ? message.blocks
        : buildMessageBlocks(message.content, artifacts),
  };
}

export function buildArtifactManifestEntry(
  runId: string,
  artifactRef: RuntimeArtifactRef,
  size: number | null
): AgentSessionArtifactManifestEntry {
  const view = buildArtifactViewMetadata({
    runId,
    role: artifactRef.role,
    filePath: artifactRef.path,
  });

  return {
    kind: artifactRef.kind,
    role: artifactRef.role,
    name: view.name,
    ...(artifactRef.workspaceRelativePath
      ? { workspaceRelativePath: artifactRef.workspaceRelativePath }
      : {}),
    contentType: view.contentType,
    presentation: view.presentation,
    size,
    previewable: view.previewable,
    previewUrl: view.previewUrl,
    downloadUrl: view.downloadUrl,
    preferredAction: view.preferredAction,
  };
}

export function buildSessionRecord(
  agentId: string,
  runtimeSession: RuntimeSession,
  title: string | null,
  kind: AgentSessionKind = "task-request"
): AgentSessionRecord {
  return {
    id: runtimeSession.id,
    agentId,
    kind,
    runtimeKind: runtimeSession.runtimeKind,
    runtimeSessionId: runtimeSession.runtimeSessionId,
    authProfileId: runtimeSession.config.authProfileId,
    title,
    status: "active",
    lifecycle: "active",
    archivedAt: null,
    workspaceRoot: runtimeSession.workspaceRoot,
    runtimeHome: runtimeSession.runtimeHome,
    runtimeConfig: runtimeSession.config,
    createdAt: runtimeSession.createdAt,
    lastActivityAt: runtimeSession.updatedAt,
  };
}

export function normalizeSessionLifecycle(
  lifecycle: string | null | undefined
): AgentSessionLifecycle {
  return lifecycle === "archived" ? "archived" : "active";
}

export function normalizeSessionKind(
  kind: string | null | undefined
): AgentSessionKind {
  return kind === "single-task" ? "single-task" : "task-request";
}

export function hydrateSessionRecord(
  session: AgentSessionRecord &
    Partial<Pick<AgentSessionRecord, "kind" | "lifecycle" | "archivedAt">>
): AgentSessionRecord {
  const lifecycle = normalizeSessionLifecycle(session.lifecycle);
  const kind = normalizeSessionKind(session.kind);
  const authProfileId =
    session.authProfileId ?? session.runtimeConfig?.authProfileId ?? null;
  const reasoningEffort = normalizeReasoningEffort(
    session.runtimeConfig?.reasoningEffort ??
      extractRuntimeConfigOverrideValue(
        session.runtimeConfig?.configOverrides,
        "model_reasoning_effort"
      )
  );
  const serviceTier = normalizeServiceTier(
    session.runtimeConfig?.serviceTier ??
      extractRuntimeConfigOverrideValue(
        session.runtimeConfig?.configOverrides,
        "service_tier"
      )
  );
  const ollamaLaunchTarget =
    session.runtimeKind === "ollama"
      ? normalizeOllamaLaunchTarget(session.runtimeConfig?.ollamaLaunchTarget)
      : null;

  return {
    ...session,
    kind,
    authProfileId,
    runtimeConfig: {
      ...session.runtimeConfig,
      authProfileId,
      ollamaLaunchTarget,
      reasoningEffort,
      serviceTier,
    },
    lifecycle,
    archivedAt:
      lifecycle === "archived" ? session.archivedAt ?? session.lastActivityAt : null,
  };
}

export function sessionStatusFromRunStatus(
  status: RuntimeRunResult["status"]
): AgentSessionRecord["status"] {
  if (status === "failed") {
    return "failed";
  }

  if (status === "cancelled") {
    return "cancelled";
  }

  return "active";
}

export function runtimeSessionOverridesFromRecord(
  session: AgentSessionRecord
): AgentSessionOverrides {
  return {
    sessionId: session.id,
    runtimeKind: session.runtimeKind,
    runtimeSessionId: session.runtimeSessionId,
    workspaceRoot: session.workspaceRoot,
    runtimeHome: session.runtimeHome,
    codexBin: session.runtimeConfig.codexBin,
    sandbox: session.runtimeConfig.sandbox,
    approval: session.runtimeConfig.approval,
    profile: session.runtimeConfig.profile,
    authProfileId: session.authProfileId,
    model: session.runtimeConfig.model,
    ollamaLaunchTarget: session.runtimeConfig.ollamaLaunchTarget ?? null,
    reasoningEffort: session.runtimeConfig.reasoningEffort ?? null,
    serviceTier: session.runtimeConfig.serviceTier ?? null,
    fullAuto: session.runtimeConfig.fullAuto,
    dangerouslyBypassApprovalsAndSandbox:
      session.runtimeConfig.dangerouslyBypassApprovalsAndSandbox,
    additionalWritableDirs: session.runtimeConfig.additionalWritableDirs,
    configOverrides: session.runtimeConfig.configOverrides,
    enableFeatures: session.runtimeConfig.enableFeatures,
    disableFeatures: session.runtimeConfig.disableFeatures,
    skipGitRepoCheck: session.runtimeConfig.skipGitRepoCheck,
    ephemeral: session.runtimeConfig.ephemeral,
  };
}

export function buildRuntimePrompt(
  session: AgentSessionRecord,
  prompt: string,
  extraSystemInstructions: string[] = []
): string {
  return [
    buildRuntimeSystemPrompt(session, prompt, extraSystemInstructions),
    USER_REQUEST_OPEN,
    prompt,
    USER_REQUEST_CLOSE,
  ].join("\n");
}

export function buildRuntimeSystemPrompt(
  session: AgentSessionRecord,
  prompt = "",
  extraSystemInstructions: string[] = []
): string {
  const sandbox = session.runtimeConfig.sandbox;
  const shellExecutionHint = detectShellExecutionHint(prompt);
  const runtimeRules = buildRuntimeRules(sandbox);
  const shellExecutionRules = buildShellExecutionRules(
    sandbox,
    shellExecutionHint !== null
  );

  return [
    "<runtime_policy>",
    `workspace_root=${session.workspaceRoot}`,
    `runtime_home=${session.runtimeHome}`,
    `sandbox=${sandbox}`,
    "</runtime_policy>",
    "<skill_policy>",
    "- User-facing agent skills are the agent's installed local skills only.",
    "- Read-only system skills may exist for platform support, but they are internal and must not be listed, described, or categorized in user-facing skill inventory answers.",
    "- In writable managed sessions, `skills/` is the writable authoring directory for new or edited agent-local skills; installed skills remain available under `.agents/skills/`.",
    "- Repository-root developer skills from parent directories are unavailable in this agent session. Do not list, mention, or use them in user-facing skill inventory answers.",
    "- Do not create, modify, shadow, or copy the read-only system skills `openai-docs`, `skill-creator`, or `skill-installer`.",
    "- When applying an installed user-facing skill, inspect the matching skill directory under `.agents/skills/`, read its `SKILL.md`, and inspect packaged files in that skill directory before asking the user to upload missing inputs.",
    "- Generic file searches can skip hidden skill directories, so explicitly inspect `.agents/skills/` when a needed input may be bundled with an installed skill.",
    "- When asked for uploaded, available, current, or listed files, distinguish newly attached files from packaged files included with installed skills; include packaged input filenames from the turn context when present.",
    "- Do not answer that no usable files exist only because attachment metadata is empty; skill-packaged input files in the turn context are already available inputs.",
    "- When asked to list available, installed, or equipped skills, report only the display names of the agent's installed local skills. If none exist, say that no skills are installed for this agent.",
    "- Do not expose internal skill identifiers, invocation strings, file paths, or storage categories in user-facing answers.",
    "- Never use the literal phrases `workspace-local`, `호출 ID`, `SKILL.md`, `.agents/skills`, `system`, or `read-only` in user-facing skill inventory answers.",
    "</skill_policy>",
    ...(shellExecutionHint
      ? [
        "<required_command_execution>",
        `mode=${shellExecutionHint.mode}`,
        ...(shellExecutionHint.command
          ? [`command=${shellExecutionHint.command}`]
          : []),
        ...(shellExecutionHint.suggestedCommand
          ? [`suggested_command=${shellExecutionHint.suggestedCommand}`]
          : []),
        "- You must use a command_execution step before the final answer for this request.",
        "- If no command_execution step occurs, reply exactly COMMAND_NOT_RUN.",
        ...(shellExecutionHint.mode === "exact"
          ? [
              "- If the command succeeds, return the real stdout in a fenced text block before any extra commentary.",
              "- If the command fails, report only the exact stderr and exit status produced by that command_execution step.",
            ]
          : [
              "- If the suggested command succeeds, use its stdout as evidence but answer in the user-facing format requested instead of dumping raw directory metadata.",
              "- If the suggested command fails, report the exact stderr and exit status produced by that command_execution step.",
            ]),
        "</required_command_execution>",
      ]
      : []),
    ...(extraSystemInstructions.length > 0
      ? [
          "<turn_instructions>",
          ...extraSystemInstructions.map((instruction) => `- ${instruction}`),
          "</turn_instructions>",
        ]
      : []),
    "<runtime_rules>",
    ...runtimeRules,
    ...shellExecutionRules,
    "</runtime_rules>",
  ].join("\n");
}

function buildRuntimeRules(
  sandbox: AgentSessionRecord["runtimeConfig"]["sandbox"]
): string[] {
  const workspaceBoundaryRules = [
    "- Only inspect, reference, or modify files and directories under workspace_root.",
    "- Do not inspect, mention, or reason from parent directories, sibling repositories, or any absolute path outside workspace_root.",
    "- Do not use `..` traversal or absolute filesystem paths outside workspace_root in commands, file operations, or explanations.",
    "- If relevant information appears to be outside workspace_root, say that it is unavailable from the current session instead of claiming you checked it.",
  ];
  const evidenceRules = [
    "- Do not cite bwrap, sandbox, permission, or missing stdout unless a command_execution step or runtime stderr actually produced that evidence.",
    "- Do not say that a command was attempted unless a command_execution step actually ran.",
  ];

  if (sandbox === "read-only") {
    return [
      "- The sandbox is read-only. Do not claim that you created or modified files.",
      "- If the user asks for a file write, explain that the sandbox is read-only and provide the content or next steps instead.",
      "- Reserved system skill namespaces are read-only platform assets. Do not create or modify `.agents/skills/.system`, `skills/.system`, `system`, `system-*`, `openai-docs`, `skill-creator`, or `skill-installer` from this session.",
      ...workspaceBoundaryRules,
      ...evidenceRules,
    ];
  }

  return [
    `- The sandbox is ${sandbox}. Treat it as writable within the workspace unless a command execution proves otherwise.`,
    "- The current working directory for shell commands is already the workspace root.",
    "- If the user asks you to create or modify files in the workspace, attempt the write directly before claiming the filesystem is read-only.",
    "- Only create agent-local skills under `skills/<skill-id>/` using a non-system skill id.",
    "- Do not create new skills directly under `.agents/skills`; Rocky indexes writable skills from `skills/` into the installed skill bridge.",
    "- Reserved system skill namespaces are not allowed in this session. Do not create or modify `.agents/skills/.system`, `skills/.system`, `system`, `system-*`, `openai-docs`, `skill-creator`, or `skill-installer`.",
    "- Prefer relative paths for workspace file writes.",
    ...workspaceBoundaryRules,
    "- If a write fails, report the exact command and the observed stderr/stdout.",
    ...evidenceRules,
  ];
}

function buildShellExecutionRules(
  sandbox: AgentSessionRecord["runtimeConfig"]["sandbox"],
  includeShellRules: boolean
): string[] {
  if (!includeShellRules) {
    return [];
  }

  if (sandbox === "read-only") {
    return [
      "- Read-only shell inspection is allowed. Use the relevant read command and report the real stdout/stderr.",
      "- Prefer concrete inspection commands like pwd, ls -la, rg --files, and sed -n when they fit the request.",
      "- For file-list requests, a root directory listing alone is incomplete when the turn context lists skill-packaged input files; include those filenames separately without exposing hidden storage paths.",
    ];
  }

  return [
    "- Shell command execution is available for inspection and workspace changes in this session.",
    "- If the user asks for directory listings, file contents, workspace state, or command output, run the relevant shell command first and base the answer on the real stdout/stderr.",
    "- If the user asks you to run a workspace script like python3 hello.py, execute that exact command and base the answer on the real stdout/stderr.",
    "- A previous shell failure does not prove the next command will fail. Attempt the requested command unless this turn's command_execution proves otherwise.",
    "- Prefer concrete inspection commands like pwd, ls -la, rg --files, and sed -n when they fit the request.",
    "- For file-list requests, a root directory listing alone is incomplete when the turn context lists skill-packaged input files; include those filenames separately without exposing hidden storage paths.",
    "- Do not use apply_patch for simple file creation or edits unless you have already confirmed that the workspace is a compatible project checkout.",
  ];
}

export function detectShellExecutionHint(prompt: string): {
  mode: "exact" | "suggested";
  command?: string;
  suggestedCommand?: string;
} | null {
  const fencedMatch = prompt.match(SHELL_FENCE_PATTERN);
  const fencedCommand = fencedMatch?.[1]?.trim();
  if (fencedCommand && !fencedCommand.includes("\n")) {
    return {
      mode: "exact",
      command: fencedCommand,
    };
  }

  const explicitCommandMatch = prompt.match(RUN_COMMAND_PATTERN);
  const explicitCommand = explicitCommandMatch?.[1]?.trim();
  if (explicitCommand) {
    return {
      mode: "exact",
      command: explicitCommand,
    };
  }

  const interpreterCommandMatch = prompt.match(INTERPRETER_RUN_COMMAND_PATTERN);
  const interpreterCommand = interpreterCommandMatch?.[1]?.trim();
  if (interpreterCommand) {
    return {
      mode: "exact",
      command: interpreterCommand,
    };
  }

  if (DIRECTORY_LISTING_PATTERN.test(prompt)) {
    return {
      mode: "suggested",
      suggestedCommand: "ls -la",
    };
  }

  if (
    UV_VENV_INTENT_PATTERN.test(prompt) &&
    CREATE_INTENT_PATTERN.test(prompt)
  ) {
    return {
      mode: "suggested",
      suggestedCommand: "uv venv --seed .venv",
    };
  }

  if (NPM_INSTALL_INTENT_PATTERN.test(prompt)) {
    return {
      mode: "suggested",
      suggestedCommand: "npm install",
    };
  }

  return null;
}

export function extractUserPrompt(runtimePrompt: string): string {
  const start = runtimePrompt.indexOf(`${USER_REQUEST_OPEN}\n`);
  const end = runtimePrompt.lastIndexOf(`\n${USER_REQUEST_CLOSE}`);

  if (start === -1 || end === -1 || end <= start) {
    return runtimePrompt;
  }

  return runtimePrompt.slice(start + USER_REQUEST_OPEN.length + 1, end);
}

export function buildOllamaConversationMessages({
  session,
  transcript,
  prompt,
  extraSystemInstructions = [],
}: {
  session: AgentSessionRecord;
  transcript: AgentSessionMessage[];
  prompt: string;
  extraSystemInstructions?: string[];
}): RuntimeConversationMessage[] {
  const messages: RuntimeConversationMessage[] = [
    {
      role: "system",
      content: buildRuntimeSystemPrompt(
        session,
        prompt,
        extraSystemInstructions
      ),
    },
  ];

  for (const message of transcript) {
    if (message.role === "system") {
      continue;
    }

    if (message.role === "user" || message.role === "assistant") {
      const content = message.content.trim();
      if (content) {
        messages.push({
          role: message.role,
          content,
        });
      }
    }
  }

  messages.push({
    role: "user",
    content: prompt,
  });

  return messages;
}

function unwrapShellCommand(command: string): string {
  const trimmed = command.trim();
  const wrappedMatch = trimmed.match(SHELL_WRAPPER_PATTERN);
  if (!wrappedMatch?.[2]) {
    return trimmed;
  }

  return wrappedMatch[2].trim();
}

function tokenizeShellCommand(command: string): string[] | null {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escapeNext = false;

  for (const char of command) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escapeNext = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escapeNext || quote) {
    return null;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens.length > 0 ? tokens : null;
}

function isUnsafePathToken(token: string): boolean {
  if (token.includes("://") || token.startsWith("~")) {
    return true;
  }

  return token === ".." || token.startsWith("../") || token.split("/").includes("..");
}

function isWorkspaceScopedToken(token: string): boolean {
  if (isUnsafePathToken(token)) {
    return false;
  }

  if (!path.isAbsolute(token)) {
    return true;
  }

  return false;
}

function isLikelyPathToken(token: string): boolean {
  if (!token || token.startsWith("-") || token.includes("://")) {
    return false;
  }

  return token.includes("/") || token.startsWith(".") || /\.[A-Za-z0-9]+$/.test(token);
}

function getExecutableBasename(tokens: string[]): string {
  return path.basename(tokens[0] ?? "");
}

function hasBlockedExecutable(executable: string): boolean {
  return Boolean(executable) && BLOCKED_UNSANDBOXED_EXECUTABLES.has(executable);
}

function isBrowserAutomationCommand(command: string): boolean {
  const normalized = unwrapShellCommand(command);
  if (!normalized || normalized.includes("\n")) {
    return false;
  }

  if (BROWSER_AUTOMATION_PATTERN.test(normalized)) {
    return true;
  }

  const tokens = tokenizeShellCommand(normalized);
  if (!tokens?.length) {
    return false;
  }

  const executable = getExecutableBasename(tokens);
  if (["playwright", "chromium", "chrome", "google-chrome"].includes(executable)) {
    return true;
  }

  if (!["npm", "pnpm", "yarn", "bun", "bunx", "npx", "node", "python", "python3"].includes(executable)) {
    return false;
  }

  return tokens.some((token) => {
    const basename = path.basename(token).toLowerCase();
    return (
      /^login(?::|$)/i.test(token) ||
      basename === "login.js" ||
      basename === "login.ts" ||
      basename === "login.mjs" ||
      BROWSER_AUTOMATION_PATTERN.test(token)
    );
  });
}

export function isSafeReadOnlyShellCommand(command: string): boolean {
  const normalized = unwrapShellCommand(command);
  if (!normalized || normalized.includes("\n") || SHELL_METACHARACTER_PATTERN.test(normalized)) {
    return false;
  }

  const tokens = tokenizeShellCommand(normalized);
  if (!tokens?.length) {
    return false;
  }

  const executable = getExecutableBasename(tokens);
  if (
    !executable ||
    hasBlockedExecutable(executable) ||
    !UNSANDBOXED_INSPECTION_EXECUTABLES.has(executable)
  ) {
    return false;
  }

  return tokens.slice(1).every((token) => {
    if (!token) {
      return false;
    }
    if (token.startsWith("-")) {
      return true;
    }
    return isWorkspaceScopedToken(token);
  });
}

export function isSafeWorkspaceInterpreterCommand(command: string): boolean {
  const normalized = unwrapShellCommand(command);
  if (!normalized || normalized.includes("\n") || SHELL_METACHARACTER_PATTERN.test(normalized)) {
    return false;
  }

  const tokens = tokenizeShellCommand(normalized);
  if (!tokens?.length) {
    return false;
  }

  const executable = getExecutableBasename(tokens);
  if (
    !executable ||
    hasBlockedExecutable(executable) ||
    !UNSANDBOXED_WORKSPACE_EXECUTABLES.has(executable)
  ) {
    return false;
  }

  if (tokens.length === 2 && INTERPRETER_VERSION_FLAGS.has(tokens[1] ?? "")) {
    return true;
  }

  const scriptIndex = tokens.findIndex((token, index) => index > 0 && !token.startsWith("-"));
  if (scriptIndex <= 0) {
    return false;
  }

  if (tokens.slice(1, scriptIndex).length > 0) {
    return false;
  }

  if (!isWorkspaceScopedToken(tokens[scriptIndex] ?? "")) {
    return false;
  }

  return tokens.slice(scriptIndex + 1).every(isWorkspaceScopedToken);
}

export function isSafeWorkspaceNetworkCommand(command: string): boolean {
  const normalized = unwrapShellCommand(command);
  if (!normalized || normalized.includes("\n") || SHELL_METACHARACTER_PATTERN.test(normalized)) {
    return false;
  }

  const tokens = tokenizeShellCommand(normalized);
  if (!tokens?.length) {
    return false;
  }

  const executable = getExecutableBasename(tokens);
  if (
    !executable ||
    hasBlockedExecutable(executable) ||
    !UNSANDBOXED_NETWORK_FETCH_EXECUTABLES.has(executable)
  ) {
    return false;
  }

  if (executable === "curl") {
    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index] ?? "";
      const nextToken = tokens[index + 1] ?? "";

      if (
        token === "-K" ||
        token === "--config" ||
        token === "-T" ||
        token === "--upload-file" ||
        token === "-F" ||
        token === "--form" ||
        token === "-d" ||
        token === "--data" ||
        token === "--data-raw" ||
        token === "--data-binary" ||
        token === "--data-urlencode" ||
        token === "-X" ||
        token === "--request"
      ) {
        return false;
      }

      if (token === "-o" || token === "--output") {
        if (!isWorkspaceScopedToken(nextToken)) {
          return false;
        }
        index += 1;
        continue;
      }

      if (token.startsWith("--output=")) {
        if (!isWorkspaceScopedToken(token.slice("--output=".length))) {
          return false;
        }
        continue;
      }

      if (!token.startsWith("-") && token.includes("://")) {
        continue;
      }

      if (!token.startsWith("-") && isLikelyPathToken(token) && !isWorkspaceScopedToken(token)) {
        return false;
      }
    }

    return true;
  }

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const nextToken = tokens[index + 1] ?? "";

    if (
      token === "-e" ||
      token === "--execute" ||
      token === "--post-data" ||
      token === "--post-file" ||
      token === "--method" ||
      token === "--body-data" ||
      token === "--body-file"
    ) {
      return false;
    }

    if (
      token === "-O" ||
      token === "--output-document" ||
      token === "-P" ||
      token === "--directory-prefix"
    ) {
      if (!isWorkspaceScopedToken(nextToken)) {
        return false;
      }
      index += 1;
      continue;
    }

    if (
      token.startsWith("--output-document=") &&
      !isWorkspaceScopedToken(token.slice("--output-document=".length))
    ) {
      return false;
    }

    if (
      token.startsWith("--directory-prefix=") &&
      !isWorkspaceScopedToken(token.slice("--directory-prefix=".length))
    ) {
      return false;
    }

    if (!token.startsWith("-") && token.includes("://")) {
      continue;
    }

    if (!token.startsWith("-") && isLikelyPathToken(token) && !isWorkspaceScopedToken(token)) {
      return false;
    }
  }

  return true;
}

export function isSafeWorkspacePackageManagerCommand(command: string): boolean {
  const normalized = unwrapShellCommand(command);
  if (!normalized || normalized.includes("\n") || SHELL_METACHARACTER_PATTERN.test(normalized)) {
    return false;
  }

  const tokens = tokenizeShellCommand(normalized);
  if (!tokens?.length) {
    return false;
  }

  const executable = getExecutableBasename(tokens);
  if (
    !executable ||
    hasBlockedExecutable(executable) ||
    !(
      UNSANDBOXED_PACKAGE_MANAGER_EXECUTABLES.has(executable) ||
      UNSANDBOXED_WORKSPACE_EXECUTABLES.has(executable)
    )
  ) {
    return false;
  }

  if (UNSANDBOXED_WORKSPACE_EXECUTABLES.has(executable)) {
    if (tokens[1] !== "-m" || tokens[2] !== "pip" || tokens[3] !== "install") {
      return false;
    }

    for (let index = 4; index < tokens.length; index += 1) {
      const token = tokens[index] ?? "";
      const nextToken = tokens[index + 1] ?? "";

      if (
        token === "--user" ||
        token === "--system" ||
        token === "--break-system-packages" ||
        token === "--python"
      ) {
        return false;
      }

      if (
        token === "--target" ||
        token === "-t" ||
        token === "--prefix" ||
        token === "--root"
      ) {
        if (!isWorkspaceScopedToken(nextToken)) {
          return false;
        }
        index += 1;
        continue;
      }

      if (
        (token.startsWith("--target=") && !isWorkspaceScopedToken(token.slice("--target=".length))) ||
        (token.startsWith("--prefix=") && !isWorkspaceScopedToken(token.slice("--prefix=".length))) ||
        (token.startsWith("--root=") && !isWorkspaceScopedToken(token.slice("--root=".length)))
      ) {
        return false;
      }

      if (!token.startsWith("-") && isLikelyPathToken(token) && !isWorkspaceScopedToken(token)) {
        return false;
      }
    }

    return true;
  }

  if (executable === "npm") {
    const subcommand = tokens[1] ?? "";
    if (!["install", "ci"].includes(subcommand)) {
      return false;
    }

    for (let index = 2; index < tokens.length; index += 1) {
      const token = tokens[index] ?? "";
      const nextToken = tokens[index + 1] ?? "";

      if (
        token === "-g" ||
        token === "--global" ||
        token === "--location=global"
      ) {
        return false;
      }

      if (token === "--prefix") {
        if (!isWorkspaceScopedToken(nextToken)) {
          return false;
        }
        index += 1;
        continue;
      }

      if (token.startsWith("--prefix=") && !isWorkspaceScopedToken(token.slice(9))) {
        return false;
      }

      if (!token.startsWith("-") && isLikelyPathToken(token) && !isWorkspaceScopedToken(token)) {
        return false;
      }
    }

    return true;
  }

  if (executable === "uv") {
    const firstSubcommand = tokens[1] ?? "";
    const secondSubcommand = tokens[2] ?? "";

    if (
      !(
        (firstSubcommand === "pip" && secondSubcommand === "install") ||
        firstSubcommand === "sync" ||
        firstSubcommand === "venv"
      )
    ) {
      return false;
    }

    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index] ?? "";
      const nextToken = tokens[index + 1] ?? "";

      if (token === "--system" || token === "--python") {
        return false;
      }

      if (
        token === "--project" ||
        token === "--directory" ||
        token === "--python-preference"
      ) {
        if (!isWorkspaceScopedToken(nextToken)) {
          return false;
        }
        index += 1;
        continue;
      }

      if (
        token.startsWith("--project=") &&
        !isWorkspaceScopedToken(token.slice("--project=".length))
      ) {
        return false;
      }

      if (
        token.startsWith("--directory=") &&
        !isWorkspaceScopedToken(token.slice("--directory=".length))
      ) {
        return false;
      }
    }

    return true;
  }

  const subcommand = tokens[1] ?? "";
  if (subcommand !== "install") {
    return false;
  }

  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const nextToken = tokens[index + 1] ?? "";

    if (
      token === "--user" ||
      token === "--system" ||
      token === "--break-system-packages" ||
      token === "--python"
    ) {
      return false;
    }

    if (
      token === "--target" ||
      token === "-t" ||
      token === "--prefix" ||
      token === "--root"
    ) {
      if (!isWorkspaceScopedToken(nextToken)) {
        return false;
      }
      index += 1;
      continue;
    }

    if (
      (token.startsWith("--target=") && !isWorkspaceScopedToken(token.slice("--target=".length))) ||
      (token.startsWith("--prefix=") && !isWorkspaceScopedToken(token.slice("--prefix=".length))) ||
      (token.startsWith("--root=") && !isWorkspaceScopedToken(token.slice("--root=".length)))
    ) {
      return false;
    }

    if (!token.startsWith("-") && isLikelyPathToken(token) && !isWorkspaceScopedToken(token)) {
      return false;
    }
  }

  return true;
}

export function shouldUseUnsandboxedShellBypass(prompt: string): boolean {
  const shellExecutionHint = detectShellExecutionHint(prompt);
  if (!shellExecutionHint) {
    return false;
  }

  if (shellExecutionHint.mode === "suggested") {
    return true;
  }

  return shellExecutionHint.command
    ? (
      isSafeReadOnlyShellCommand(shellExecutionHint.command) ||
      isSafeWorkspaceInterpreterCommand(shellExecutionHint.command) ||
      isSafeWorkspaceNetworkCommand(shellExecutionHint.command) ||
      isSafeWorkspacePackageManagerCommand(shellExecutionHint.command)
    )
    : false;
}

export function shouldUseBrowserAutomationBypass(prompt: string): boolean {
  const shellExecutionHint = detectShellExecutionHint(prompt);
  if (shellExecutionHint?.command && isBrowserAutomationCommand(shellExecutionHint.command)) {
    return true;
  }

  if (
    shellExecutionHint?.suggestedCommand &&
    isBrowserAutomationCommand(shellExecutionHint.suggestedCommand)
  ) {
    return true;
  }

  return (
    BROWSER_AUTOMATION_PATTERN.test(prompt) &&
    BROWSER_AUTOMATION_ACTION_PATTERN.test(prompt)
  );
}

function hasWorkspaceArtifactIntent(prompt: string): boolean {
  return (
    WORKSPACE_ARTIFACT_ACTION_PATTERN.test(prompt) &&
    WORKSPACE_ARTIFACT_TARGET_PATTERN.test(prompt)
  );
}

export function shouldUseManagedWorkspaceExecutionBypass({
  session,
  input,
}: {
  session: AgentSessionRecord;
  input: AgentSessionTurnInput;
}): boolean {
  if (session.runtimeConfig.sandbox === "read-only") {
    return false;
  }

  if (input.dangerouslyBypassApprovalsAndSandbox === false) {
    return false;
  }

  if (
    session.kind === "single-task" ||
    input.triggerType === "manual_task" ||
    input.triggerType === "scheduled" ||
    input.triggerType === "event"
  ) {
    return true;
  }

  return (
    shouldUseUnsandboxedShellBypass(input.prompt) ||
    hasWorkspaceArtifactIntent(input.prompt)
  );
}

export function buildRuntimeRequest({
  session,
  input,
  runId,
  runPaths,
  authSource,
}: {
  session: AgentSessionRecord;
  input: AgentSessionTurnInput;
  runId: string;
  runPaths: AgentRunPaths;
  authSource?: RuntimeRequest["authSource"];
}): RuntimeRequest {
  const browserAutomationBypass = shouldUseBrowserAutomationBypass(input.prompt);
  const managedWorkspaceExecutionBypass =
    shouldUseManagedWorkspaceExecutionBypass({
      session,
      input,
    });
  const requestedBypass =
    input.dangerouslyBypassApprovalsAndSandbox ??
    session.runtimeConfig.dangerouslyBypassApprovalsAndSandbox;

  return {
    sessionId: session.id,
    runId,
    prompt: buildRuntimePrompt(
      session,
      input.prompt,
      input.extraSystemInstructions ?? []
    ),
    dangerouslyBypassApprovalsAndSandbox:
      requestedBypass ||
      browserAutomationBypass ||
      managedWorkspaceExecutionBypass,
    additionalWritableDirs: input.additionalWritableDirs,
    configOverrides: input.configOverrides,
    enableFeatures: input.enableFeatures,
    disableFeatures: input.disableFeatures,
    skipGitRepoCheck: input.skipGitRepoCheck,
    ephemeral: input.ephemeral,
    outputLastMessagePath: runPaths.outputLastMessagePath,
    images: input.images,
    extraEnv: input.extraEnv,
    authSource: authSource ?? null,
    seedAuthFromCurrentHome: input.seedAuthFromCurrentHome,
  };
}

export function buildRunningRunRecord({
  session,
  input,
  runId,
  started,
  runPaths,
}: {
  session: AgentSessionRecord;
  input: AgentSessionTurnInput;
  runId: string;
  started: RuntimeRunStart;
  runPaths: AgentRunPaths;
}): AgentRunRecord {
  return {
    id: runId,
    agentId: session.agentId,
    sessionId: session.id,
    runtimeRunId: started.runId ?? runId,
    triggerType: input.triggerType ?? "interactive",
    status: "running",
    runtimeKind: session.runtimeKind,
    ollamaLaunchTarget: session.runtimeConfig.ollamaLaunchTarget ?? null,
    model: session.runtimeConfig.model ?? null,
    reasoningEffort: session.runtimeConfig.reasoningEffort ?? null,
    serviceTier: session.runtimeConfig.serviceTier ?? null,
    prompt: input.prompt,
    startedAt: started.startedAt,
    endedAt: null,
    summary: null,
    runtimeSessionId: session.runtimeSessionId,
    outputLastMessagePath: runPaths.outputLastMessagePath,
    resultPath: runPaths.resultPath,
    eventsPath: runPaths.eventsPath,
    artifactsDir: runPaths.artifactsDir,
  };
}

export function applyStartedRunToSession(
  session: AgentSessionRecord,
  prompt: string,
  startedAt: string
): void {
  session.status = "running";
  session.lastActivityAt = startedAt;
  if (!session.title) {
    session.title = truncateSummary(prompt, 72);
  }
}

export function buildUserTurnMessage(
  sessionId: string,
  runId: string,
  prompt: string,
  createdAt: string
): AgentSessionMessage {
  return buildMessageRecord({
    id: `${runId}:user`,
    sessionId,
    runId,
    role: "user",
    content: prompt,
    source: "user-turn",
    createdAt,
  });
}

function normalizeArtifacts(
  artifacts: AgentSessionArtifactManifestEntry[] | undefined,
  runId?: string | null
): AgentSessionArtifactManifestEntry[] {
  if (!Array.isArray(artifacts)) {
    return [];
  }

  return artifacts.map((artifact) => {
    if (!runId) {
      return { ...artifact };
    }

    const previewable = isInlinePreviewAllowed(artifact.contentType);
    return {
      ...artifact,
      previewable,
      previewUrl: previewable ? artifactPreviewPath(runId, artifact.role) : null,
      downloadUrl: artifactDownloadPath(runId, artifact.role),
      preferredAction: previewable ? "preview" : "download",
    };
  });
}

function parseContentBlocks(content: string): AgentSessionMessageBlock[] {
  if (!content) {
    return [];
  }

  const blocks: AgentSessionMessageBlock[] = [];
  let cursor = 0;

  for (const match of content.matchAll(FENCED_CODE_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const leadingText = content.slice(cursor, matchIndex);
    appendTextBlock(blocks, leadingText);

    const language = match[1]?.trim() || null;
    const code = stripTrailingNewline(match[2] ?? "");
    blocks.push({
      type: "code",
      code,
      language,
    });

    cursor = matchIndex + match[0].length;
  }

  appendTextBlock(blocks, content.slice(cursor));
  return blocks;
}

function appendTextBlock(
  blocks: AgentSessionMessageBlock[],
  text: string
): void {
  if (!text) {
    return;
  }

  blocks.push({
    type: "text",
    text,
  });
}

function stripTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}
