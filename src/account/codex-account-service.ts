import { spawn as defaultSpawn } from "node:child_process";
import { readFile as defaultReadFile } from "node:fs/promises";
import path from "node:path";

import type {
  RuntimeChildProcess,
  SpawnLike,
} from "../runtime/runtime-types.js";
import { CliDiagnosticsService } from "./cli-diagnostics-service.js";
import {
  createCliUpdateRecord,
  resolveCliUpdatePlan,
} from "./cli-update-service.js";
import type {
  CodexAccountInfoRecord,
  CodexAccountRecord,
  CodexAccountServiceLike,
  CodexDeviceAuthRecord,
  TaskRequestTitleSummaryRecord,
} from "./codex-account-types.js";
import type { ProviderLoginMethodRecord } from "./provider-account-types.js";
import type { LatestVersionResolverLike } from "./cli-diagnostics-service.js";

interface CodexAccountServiceOptions {
  spawn?: SpawnLike;
  readFile?: ReadFileLike;
  now?: () => string;
  baseEnv?: NodeJS.ProcessEnv;
  codexBin?: string;
  cwd?: string;
  latestVersionResolver?: LatestVersionResolverLike;
}

interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

type ReadFileLike = (filePath: string, encoding: BufferEncoding) => Promise<string>;

const DEVICE_AUTH_URL_PATTERN = /https?:\/\/\S+/i;
const DEVICE_AUTH_CODE_PATTERN = /\b[A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8})+\b/;
const MAX_LOGIN_OUTPUT_LINES = 120;
const ANSI_ESCAPE_PATTERN = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const TASK_REQUEST_TITLE_MODEL = "gpt-5.4-mini";

function emptyDeviceAuthState(): CodexDeviceAuthRecord {
  return {
    status: "idle",
    mode: null,
    startedAt: null,
    completedAt: null,
    output: [],
    verificationUri: null,
    userCode: null,
    instructions: null,
    lastError: null,
  };
}

function emptyAccountInfoState(): CodexAccountInfoRecord {
  return {
    label: null,
    email: null,
    name: null,
    userId: null,
    planType: null,
    organizationTitle: null,
    authMode: null,
  };
}

function codexLoginMethods(): ProviderLoginMethodRecord[] {
  return [
    {
      id: "browser-login",
      label: "OpenAI 로그인",
      description: "기본 Codex 로그인 플로우입니다.",
      kind: "primary",
      hiddenByDefault: false,
      supported: true,
    },
    {
      id: "device-auth",
      label: "Device auth",
      description: "고급 device-code 로그인 플로우입니다.",
      kind: "advanced",
      hiddenByDefault: true,
      supported: true,
    },
    {
      id: "api-token",
      label: "API token",
      description: "고급 토큰 기반 Codex 로그인입니다.",
      kind: "advanced",
      hiddenByDefault: true,
      supported: true,
    },
  ];
}

function normalizeCommandOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
}

function waitForChildClose(
  child: RuntimeChildProcess,
  timeoutMs: number
): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), timeoutMs);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function sanitizeTerminalOutput(output: string): string {
  return output.replace(ANSI_ESCAPE_PATTERN, "").replace(/\r/g, "");
}

function splitOutputLines(output: string): string[] {
  return sanitizeTerminalOutput(output)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-MAX_LOGIN_OUTPUT_LINES);
}

function parseDeviceAuthHints(output: string): {
  verificationUri: string | null;
  userCode: string | null;
  instructions: string | null;
} {
  const sanitizedOutput = sanitizeTerminalOutput(output);
  const lines = splitOutputLines(sanitizedOutput);
  const verificationUri =
    sanitizedOutput.match(DEVICE_AUTH_URL_PATTERN)?.[0] ?? null;
  const userCode = sanitizedOutput.match(DEVICE_AUTH_CODE_PATTERN)?.[0] ?? null;
  const instructions =
    lines.find((line) => /open|visit|browser|enter/i.test(line)) ??
    lines.at(-1) ??
    null;

  return {
    verificationUri,
    userCode,
    instructions,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseJwtPayload(token: string | null): Record<string, unknown> | null {
  if (!token) {
    return null;
  }

  const payload = token.split(".")[1];
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function selectOrganizationTitle(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const organizations = value.filter(isRecord);
  const defaultOrganization =
    organizations.find((organization) => organization.is_default === true) ??
    organizations[0];

  return defaultOrganization
    ? readNonEmptyString(defaultOrganization.title)
    : null;
}

function parseAccountInfo(rawAuthState: string): CodexAccountInfoRecord {
  try {
    const parsed = JSON.parse(rawAuthState);
    if (!isRecord(parsed)) {
      return emptyAccountInfoState();
    }

    const tokens = isRecord(parsed.tokens) ? parsed.tokens : null;
    const idTokenClaims = parseJwtPayload(readNonEmptyString(tokens?.id_token));
    const accessTokenClaims = parseJwtPayload(
      readNonEmptyString(tokens?.access_token)
    );
    const accessProfileClaims = isRecord(
      accessTokenClaims?.["https://api.openai.com/profile"]
    )
      ? accessTokenClaims["https://api.openai.com/profile"]
      : null;
    const accessAuthClaims = isRecord(
      accessTokenClaims?.["https://api.openai.com/auth"]
    )
      ? accessTokenClaims["https://api.openai.com/auth"]
      : null;

    const email =
      readNonEmptyString(idTokenClaims?.email) ??
      readNonEmptyString(accessProfileClaims?.email);
    const name = readNonEmptyString(idTokenClaims?.name);
    const organizationTitle = selectOrganizationTitle(
      accessAuthClaims?.organizations
    );
    const planType = readNonEmptyString(accessAuthClaims?.chatgpt_plan_type);
    const authMode = readNonEmptyString(parsed.auth_mode);

    return {
      label: email ?? name ?? organizationTitle ?? null,
      email,
      name,
      userId: readNonEmptyString(idTokenClaims?.sub),
      planType,
      organizationTitle,
      authMode,
    };
  } catch {
    return emptyAccountInfoState();
  }
}

function buildInitialState(now: string, homePath: string | null, codexBin: string): CodexAccountRecord {
  const diagnostics: CodexAccountRecord["diagnostics"] = {
    command: codexBin,
    resolvedPath: null,
    installStatus: "not-installed",
    installMethod: "unknown",
    currentVersion: null,
    rawVersionText: null,
    checkedAt: now,
    latestVersion: null,
    latestStatus: "unknown",
    latestCheckedAt: null,
    latestSource: null,
    statusText: "CLI diagnostics have not been checked yet.",
  };

  return {
    provider: "codex",
    providerLabel: "Codex CLI",
    status: "logged-out",
    statusText: "Not logged in.",
    homePath,
    codexBin,
    updatedAt: now,
    accountInfo: emptyAccountInfoState(),
    loginMethods: codexLoginMethods(),
    primaryLoginMethodId: "browser-login",
    diagnostics,
    update: createCliUpdateRecord("codex", diagnostics),
    deviceAuth: emptyDeviceAuthState(),
  };
}

function buildLogoutStatusText(
  output: string,
  refreshed: CodexAccountRecord
): string {
  if (refreshed.status === "logged-out") {
    return output || refreshed.statusText || "Logged out.";
  }

  if (refreshed.status === "authenticated") {
    return "Codex still reports an authenticated session after logout.";
  }

  return output || refreshed.statusText || "Logout status unavailable.";
}

function buildTaskRequestTitlePrompt(prompt: string): string {
  return [
    "Summarize the user's task request into a short title.",
    "Return only the title text.",
    "Rules:",
    "- Keep the same language as the user request.",
    "- No quotes, markdown, numbering, labels, or trailing punctuation.",
    "- Prefer a concise noun phrase that captures the deliverable or main objective.",
    "- Keep it under 48 characters when possible.",
    "<user_request>",
    prompt,
    "</user_request>",
  ].join("\n");
}

function buildAgentSuggestionPrompt(input: {
  title: string;
  description: string;
  triggerLabel: string;
}): string {
  return [
    "Suggest one agent persona that would best use the given skill.",
    "Return ONE JSON object on a single line with exactly these keys: name, description, emoji.",
    "Rules:",
    "- Use the SAME language as the skill (Korean if Korean).",
    "- name: short noun phrase representing the agent persona (e.g., \"영업 도우미\", \"문서 정리 비서\"). Max 12 characters.",
    "- description: one-sentence role description focused on what this agent helps with. Max 60 characters.",
    "- emoji: a single emoji character that visually fits the persona.",
    "- Output JSON ONLY. No markdown, no code fences, no extra commentary.",
    "<skill>",
    `title: ${input.title}`,
    `description: ${input.description}`,
    `trigger: ${input.triggerLabel}`,
    "</skill>",
  ].join("\n");
}

function parseAgentSuggestion(raw: string): {
  name: string;
  description: string;
  emoji: string | null;
} | null {
  const cleaned = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  try {
    const parsed = JSON.parse(match[0]);
    if (!isRecord(parsed)) {
      return null;
    }
    const name = readNonEmptyString(parsed.name);
    const description = readNonEmptyString(parsed.description);
    if (!name || !description) {
      return null;
    }
    const emoji = readNonEmptyString(parsed.emoji);
    return { name, description, emoji };
  } catch {
    return null;
  }
}

function isJsonObjectLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}");
}

function extractTextFromAgentMessageItem(item: unknown): string | null {
  if (!isRecord(item)) {
    return null;
  }

  const directText = readNonEmptyString(item.text);
  if (directText) {
    return directText;
  }

  const content = item.content;
  if (!Array.isArray(content)) {
    return null;
  }

  const fragments = content
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      if (typeof entry.text === "string" && entry.text.trim()) {
        return entry.text.trim();
      }

      return null;
    })
    .filter((entry): entry is string => Boolean(entry));

  return fragments.length > 0 ? fragments.join(" ").trim() : null;
}

function extractExecAgentMessage(stdout: string): string | null {
  let candidate: string | null = null;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !isJsonObjectLine(line)) {
      continue;
    }

    try {
      const parsed = JSON.parse(line);
      if (!isRecord(parsed) || parsed.type !== "item.completed") {
        continue;
      }

      const item = isRecord(parsed.item) ? parsed.item : null;
      if (!item || item.type !== "agent_message") {
        continue;
      }

      candidate = extractTextFromAgentMessageItem(item) ?? candidate;
    } catch {
      // Ignore malformed CLI output and keep scanning.
    }
  }

  return candidate;
}

function normalizeTaskRequestTitle(value: string): string | null {
  const singleLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!singleLine) {
    return null;
  }

  const normalized = singleLine
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^[\-\*\d.\)\s]+/, "")
    .replace(/[.!?,:;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return normalized.length > 0 ? normalized : null;
}

export class CodexAccountService implements CodexAccountServiceLike {
  private readonly spawnImpl: SpawnLike;
  private readonly readFileImpl: ReadFileLike;
  private readonly now: () => string;
  private readonly baseEnv: NodeJS.ProcessEnv;
  private readonly codexBin: string;
  private readonly cwd: string;
  private readonly diagnosticsService: CliDiagnosticsService;
  private state: CodexAccountRecord;
  private activeLogin:
    | {
        attemptId: number;
        child: RuntimeChildProcess;
        mode: CodexDeviceAuthRecord["mode"];
      }
    | null = null;
  private activeUpdate:
    | {
        child: RuntimeChildProcess;
      }
    | null = null;
  private loginAttemptCounter = 0;
  private rawDeviceAuthOutput = "";

  constructor(options: CodexAccountServiceOptions = {}) {
    this.spawnImpl = (options.spawn ?? (defaultSpawn as unknown as SpawnLike));
    this.readFileImpl =
      options.readFile ??
      ((filePath, encoding) =>
        defaultReadFile(filePath, { encoding }));
    this.now = options.now ?? (() => new Date().toISOString());
    this.baseEnv = options.baseEnv ?? process.env;
    this.codexBin = options.codexBin ?? "codex";
    this.cwd = options.cwd ?? this.baseEnv.HOME ?? process.cwd();
    this.diagnosticsService = new CliDiagnosticsService({
      provider: "codex",
      command: this.codexBin,
      spawn: this.spawnImpl,
      now: this.now,
      baseEnv: this.baseEnv,
      latestVersionResolver: options.latestVersionResolver,
    });
    this.state = buildInitialState(this.now(), this.baseEnv.HOME ?? null, this.codexBin);
  }

  async getState(): Promise<CodexAccountRecord> {
    if (this.activeLogin || this.activeUpdate) {
      return this.snapshot();
    }

    return this.refreshStatus();
  }

  async startLogin(): Promise<CodexAccountRecord> {
    return this.startInteractiveLogin({
      args: ["login"],
      mode: "browser-login",
      pendingStatusText: "Browser login in progress.",
      defaultInstructions: "OpenAI 브라우저 로그인 플로우를 완료하세요.",
    });
  }

  async startDeviceAuth(): Promise<CodexAccountRecord> {
    return this.startInteractiveLogin({
      args: ["login", "--device-auth"],
      mode: "device-auth",
      pendingStatusText: "Device auth in progress.",
      defaultInstructions: "Codex CLI가 출력한 링크와 코드를 사용해 device auth를 완료하세요.",
    });
  }

  async logout(): Promise<CodexAccountRecord> {
    if (this.activeLogin) {
      const child = this.activeLogin.child;
      this.activeLogin = null;
      child.kill("SIGTERM");
    }
    if (this.activeUpdate) {
      throw new Error("Codex CLI update is in progress.");
    }

    const result = await this.runCommand(["logout"]);
    const output = normalizeCommandOutput(result.stdout, result.stderr);
    const refreshed = await this.refreshStatus().catch(() => this.snapshot());

    this.rawDeviceAuthOutput = "";
    this.state = {
      ...refreshed,
      statusText: buildLogoutStatusText(output, refreshed),
      updatedAt: this.now(),
      deviceAuth: emptyDeviceAuthState(),
    };

    return this.snapshot();
  }

  async loginWithApiKey(apiKey: string): Promise<CodexAccountRecord> {
    const normalizedApiKey = apiKey.trim();
    if (!normalizedApiKey) {
      throw new Error("API key is required.");
    }

    if (this.activeLogin) {
      const child = this.activeLogin.child;
      this.activeLogin = null;
      child.kill("SIGTERM");
    }
    if (this.activeUpdate) {
      throw new Error("Codex CLI update is in progress.");
    }

    const result = await this.runCommand(
      ["login", "--with-api-key"],
      normalizedApiKey
    );
    if (result.exitCode !== 0) {
      throw new Error(
        normalizeCommandOutput(result.stdout, result.stderr) ||
          `Codex API key login failed with code ${result.exitCode ?? "unknown"}.`
      );
    }

    const refreshed = await this.refreshStatus().catch(() => this.snapshot());
    this.state = {
      ...refreshed,
      updatedAt: this.now(),
      deviceAuth: {
        ...emptyDeviceAuthState(),
        mode: "api-token",
        status: "completed",
        startedAt: this.now(),
        completedAt: this.now(),
      },
    };

    return this.snapshot();
  }

  async startUpdate(): Promise<CodexAccountRecord> {
    if (this.activeUpdate) {
      return this.snapshot();
    }
    if (this.activeLogin) {
      throw new Error("Codex login is in progress.");
    }

    const current = await this.refreshStatus();
    const plan = resolveCliUpdatePlan("codex", current.diagnostics);
    if (!plan.supported) {
      throw new Error("This Codex installation cannot be updated automatically.");
    }

    const startedAt = this.now();
    this.state = {
      ...this.state,
      updatedAt: startedAt,
      update: {
        ...this.state.update,
        supported: plan.supported,
        installMethod: plan.installMethod,
        commandPreview: plan.commandPreview,
        status: "pending",
        startedAt,
        completedAt: null,
        output: [],
        lastError: null,
      },
    };

    const child = this.spawnImpl(plan.command!, plan.args, {
      cwd: this.baseEnv.HOME ?? this.cwd,
      env: this.baseEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.activeUpdate = { child };

    const handleChunk = (chunk: unknown) => {
      const output = splitOutputLines(`${this.state.update.output.join("\n")}\n${String(chunk)}`);
      this.state = {
        ...this.state,
        updatedAt: this.now(),
        update: {
          ...this.state.update,
          output,
        },
      };
    };

    child.stdout.on("data", handleChunk);
    child.stderr.on("data", handleChunk);

    child.once("error", (error) => {
      if (!this.activeUpdate || this.activeUpdate.child !== child) {
        return;
      }

      this.activeUpdate = null;
      const completedAt = this.now();
      this.state = {
        ...this.state,
        updatedAt: completedAt,
        update: {
          ...this.state.update,
          status: "failed",
          completedAt,
          lastError: error.message,
        },
      };
    });

    child.once("close", async (exitCode, signal) => {
      if (!this.activeUpdate || this.activeUpdate.child !== child) {
        return;
      }

      this.activeUpdate = null;
      const completedAt = this.now();
      const nextStatus = await this.refreshStatus().catch(() => this.snapshot());
      const failedMessage =
        signal
          ? `CLI update exited with signal ${signal}.`
          : exitCode === 0
            ? null
            : `CLI update exited with code ${exitCode ?? "unknown"}.`;

      this.state = {
        ...nextStatus,
        updatedAt: completedAt,
        update: {
          ...this.state.update,
          supported: plan.supported,
          installMethod: plan.installMethod,
          commandPreview: plan.commandPreview,
          status: failedMessage ? "failed" : "completed",
          startedAt,
          completedAt,
          output: this.state.update.output,
          lastError: failedMessage,
        },
      };
    });

    return this.snapshot();
  }

  async summarizeTaskRequestTitle(
    prompt: string
  ): Promise<TaskRequestTitleSummaryRecord> {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      throw new Error("Task request prompt is required.");
    }

    const result = await this.runCommand([
      "-C",
      this.cwd,
      "--model",
      TASK_REQUEST_TITLE_MODEL,
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--color",
      "never",
      "--skip-git-repo-check",
      buildTaskRequestTitlePrompt(normalizedPrompt),
    ]);

    if (result.exitCode !== 0) {
      throw new Error(
        normalizeCommandOutput(result.stdout, result.stderr) ||
          `Task request title summary failed with code ${result.exitCode ?? "unknown"}.`
      );
    }

    const title = normalizeTaskRequestTitle(
      extractExecAgentMessage(result.stdout) ?? result.stdout
    );
    if (!title) {
      throw new Error("Task request title summary produced an empty title.");
    }

    return {
      title,
      model: TASK_REQUEST_TITLE_MODEL,
    };
  }

  async suggestAgentForSkill(input: {
    title: string;
    description: string;
    triggerLabel: string;
  }): Promise<{
    name: string;
    description: string;
    emoji: string | null;
    model: string;
  }> {
    const title = input.title.trim();
    const description = input.description.trim();
    const triggerLabel = input.triggerLabel.trim();
    if (!title) {
      throw new Error("Skill title is required.");
    }

    const result = await this.runCommand([
      "-C",
      this.cwd,
      "--model",
      TASK_REQUEST_TITLE_MODEL,
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "exec",
      "--json",
      "--color",
      "never",
      "--skip-git-repo-check",
      buildAgentSuggestionPrompt({ title, description, triggerLabel }),
    ]);

    if (result.exitCode !== 0) {
      throw new Error(
        normalizeCommandOutput(result.stdout, result.stderr) ||
          `Agent suggestion failed with code ${result.exitCode ?? "unknown"}.`
      );
    }

    const message = extractExecAgentMessage(result.stdout) ?? result.stdout;
    const parsed = parseAgentSuggestion(message);
    if (!parsed) {
      throw new Error("Agent suggestion produced an invalid response.");
    }

    return {
      ...parsed,
      model: TASK_REQUEST_TITLE_MODEL,
    };
  }

  private async startInteractiveLogin(input: {
    args: string[];
    mode: CodexDeviceAuthRecord["mode"];
    pendingStatusText: string;
    defaultInstructions: string;
  }): Promise<CodexAccountRecord> {
    if (this.activeUpdate) {
      throw new Error("Codex CLI update is in progress.");
    }
    if (this.activeLogin) {
      const stale = this.activeLogin;
      this.activeLogin = null;
      stale.child.stdout.removeAllListeners("data");
      stale.child.stderr.removeAllListeners("data");
      stale.child.kill("SIGTERM");
      await waitForChildClose(stale.child, 2000);
      stale.child.kill("SIGKILL");
      await waitForChildClose(stale.child, 500);
    }

    const current = await this.refreshStatus();
    if (current.status === "authenticated") {
      return current;
    }

    const startedAt = this.now();
    const attemptId = ++this.loginAttemptCounter;
    this.rawDeviceAuthOutput = "";
    this.state = {
      ...this.state,
      status: "pending",
      statusText: input.pendingStatusText,
      updatedAt: startedAt,
      deviceAuth: {
        ...emptyDeviceAuthState(),
        mode: input.mode,
        status: "pending",
        startedAt,
        instructions: input.defaultInstructions,
      },
    };

    const child = this.spawnImpl(this.codexBin, input.args, {
      cwd: this.cwd,
      env: this.baseEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.activeLogin = {
      attemptId,
      child,
      mode: input.mode,
    };

    const handleChunk = (chunk: unknown) => {
      this.appendDeviceAuthOutput(String(chunk));
    };

    child.stdout.on("data", handleChunk);
    child.stderr.on("data", handleChunk);

    child.once("error", (error) => {
      if (this.activeLogin?.attemptId !== attemptId) {
        return;
      }

      this.activeLogin = null;
      const completedAt = this.now();
      this.state = {
        ...this.state,
        status: "error",
        statusText: `${input.mode === "device-auth" ? "Device auth" : "Browser login"} failed to start.`,
        updatedAt: completedAt,
        deviceAuth: {
          ...this.state.deviceAuth,
          status: "failed",
          completedAt,
          lastError: error.message,
        },
      };
    });

    child.once("close", async (exitCode, signal) => {
      if (this.activeLogin?.attemptId !== attemptId) {
        return;
      }

      this.activeLogin = null;
      const completedAt = this.now();
      const nextStatus = await this.refreshStatus().catch(() => this.snapshot());
      const loginSucceeded = nextStatus.status === "authenticated";
      const failureDetail =
        signal
          ? `${input.mode === "device-auth" ? "Device auth" : "Browser login"} exited with signal ${signal}.`
          : exitCode === 0
            ? null
            : `${input.mode === "device-auth" ? "Device auth" : "Browser login"} exited with code ${exitCode ?? "unknown"}.`;

      this.state = {
        ...nextStatus,
        updatedAt: completedAt,
        deviceAuth: {
          ...this.state.deviceAuth,
          status: loginSucceeded ? "completed" : "failed",
          completedAt,
          lastError: loginSucceeded ? null : failureDetail,
        },
      };
    });

    return this.snapshot();
  }

  private async refreshStatus(): Promise<CodexAccountRecord> {
    const diagnostics = await this.diagnosticsService.getDiagnostics();
    const update = createCliUpdateRecord("codex", diagnostics);
    const result = await this.runCommand(["login", "status"]);
    const output = normalizeCommandOutput(result.stdout, result.stderr);
    const normalizedOutput = output || "Login status unavailable.";
    const loggedOut =
      /not logged in/i.test(normalizedOutput) ||
      /logged out/i.test(normalizedOutput);
    const authenticated =
      !loggedOut &&
      /logged in/i.test(normalizedOutput);
    const homePath = this.baseEnv.HOME ?? null;
    const accountInfo = authenticated
      ? await this.loadAccountInfo(homePath)
      : emptyAccountInfoState();

    this.state = {
      ...this.state,
      status: authenticated
        ? "authenticated"
        : loggedOut
          ? "logged-out"
          : result.exitCode === 0
            ? "error"
            : "error",
      statusText: normalizedOutput,
      homePath,
      codexBin: this.codexBin,
      updatedAt: this.now(),
      accountInfo,
      loginMethods: codexLoginMethods(),
      primaryLoginMethodId: "browser-login",
      diagnostics,
      update: {
        ...this.state.update,
        supported: update.supported,
        installMethod: diagnostics.installMethod,
        commandPreview: update.commandPreview,
      },
    };

    return this.snapshot();
  }

  private appendDeviceAuthOutput(text: string): void {
    this.rawDeviceAuthOutput += text;
    const hints = parseDeviceAuthHints(this.rawDeviceAuthOutput);

    this.state = {
      ...this.state,
      updatedAt: this.now(),
      deviceAuth: {
        ...this.state.deviceAuth,
        output: splitOutputLines(this.rawDeviceAuthOutput),
        verificationUri: hints.verificationUri,
        userCode: hints.userCode,
        instructions: hints.instructions ?? this.state.deviceAuth.instructions,
      },
    };
  }

  private snapshot(): CodexAccountRecord {
    return {
      ...this.state,
      accountInfo: {
        ...this.state.accountInfo,
      },
      loginMethods: this.state.loginMethods.map((method) => ({
        ...method,
      })),
      diagnostics: {
        ...this.state.diagnostics,
      },
      update: {
        ...this.state.update,
        output: [...this.state.update.output],
      },
      deviceAuth: {
        ...this.state.deviceAuth,
        output: [...this.state.deviceAuth.output],
      },
    };
  }

  private async loadAccountInfo(homePath: string | null): Promise<CodexAccountInfoRecord> {
    if (!homePath) {
      return emptyAccountInfoState();
    }

    try {
      const authState = await this.readFileImpl(
        path.join(homePath, ".codex", "auth.json"),
        "utf8"
      );
      return parseAccountInfo(authState);
    } catch {
      return emptyAccountInfoState();
    }
  }

  private runCommand(
    args: string[],
    stdinText?: string
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl(this.codexBin, args, {
        cwd: this.cwd,
        env: this.baseEnv,
        stdio: [stdinText ? "pipe" : "ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      if (stdinText) {
        child.stdin?.write(stdinText);
        child.stdin?.end("\n");
      }

      child.once("error", reject);
      child.once("close", (exitCode, signal) => {
        resolve({
          exitCode,
          signal,
          stdout,
          stderr,
        });
      });
    });
  }
}
