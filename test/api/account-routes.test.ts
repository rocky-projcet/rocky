import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { createAgentEngineServer } from "../../src/api/agent-engine-server.js";

import type { ClaudeAccountRecord } from "../../src/account/claude-account-types.js";
import type { ClaudeStatusRecord } from "../../src/account/claude-status-types.js";
import type {
  CodexAccountRecord,
  CodexAccountServiceLike,
  TaskRequestTitleSummaryRecord,
} from "../../src/account/codex-account-types.js";
import type {
  CodexStatusRecord,
  CodexStatusServiceLike,
} from "../../src/account/codex-status-types.js";
import type {
  HardwareStatusRecord,
  HardwareStatusServiceLike,
} from "../../src/system/hardware-status-types.js";

function buildState(overrides: Partial<CodexAccountRecord> = {}): CodexAccountRecord {
  return {
    provider: "codex",
    providerLabel: "Codex CLI",
    status: "logged-out",
    statusText: "Not logged in.",
    homePath: "/srv/agent-engine",
    codexBin: "codex",
    updatedAt: "2026-03-20T00:00:00.000Z",
    accountInfo: {
      label: null,
      email: null,
      name: null,
      userId: null,
      planType: null,
      organizationTitle: null,
      authMode: null,
    },
    loginMethods: [],
    primaryLoginMethodId: "chatgpt-login",
    diagnostics: {
      command: "codex",
      resolvedPath: "/usr/local/bin/codex",
      installStatus: "installed",
      installMethod: "homebrew-cask",
      currentVersion: "0.118.0",
      rawVersionText: "codex-cli 0.118.0",
      checkedAt: "2026-03-20T00:00:00.000Z",
      latestVersion: "0.118.0",
      latestStatus: "current",
      latestCheckedAt: "2026-03-20T00:00:00.000Z",
      latestSource: "env",
      statusText: "Codex CLI is up to date.",
    },
    update: {
      status: "idle",
      supported: true,
      installMethod: "homebrew-cask",
      commandPreview: "brew upgrade --cask codex",
      startedAt: null,
      completedAt: null,
      output: [],
      lastError: null,
    },
    deviceAuth: {
      status: "idle",
      mode: null,
      startedAt: null,
      completedAt: null,
      output: [],
      verificationUri: null,
      userCode: null,
      instructions: null,
      lastError: null,
    },
    ...overrides,
  };
}

function buildClaudeState(
  overrides: Partial<ClaudeAccountRecord> = {}
): ClaudeAccountRecord {
  return {
    provider: "claude",
    providerLabel: "Claude Code",
    status: "logged-out",
    statusText: "Claude Code is not logged in.",
    homePath: "/srv/agent-engine",
    updatedAt: "2026-03-20T00:00:00.000Z",
    claudeBin: "claude",
    accountInfo: {
      label: null,
      email: null,
      name: null,
      userId: null,
      planType: null,
      organizationTitle: null,
      authMode: null,
    },
    apiProvider: "firstParty",
    loginMethods: [],
    primaryLoginMethodId: "browser-login",
    diagnostics: {
      command: "claude",
      resolvedPath: "/usr/local/bin/claude",
      installStatus: "installed",
      installMethod: "homebrew-cask",
      currentVersion: "2.1.81",
      rawVersionText: "2.1.81 (Claude Code)",
      checkedAt: "2026-03-20T00:00:00.000Z",
      latestVersion: "2.1.81",
      latestStatus: "current",
      latestCheckedAt: "2026-03-20T00:00:00.000Z",
      latestSource: "env",
      statusText: "Claude Code is up to date.",
    },
    update: {
      status: "idle",
      supported: true,
      installMethod: "homebrew-cask",
      commandPreview: "brew upgrade --cask claude-code",
      startedAt: null,
      completedAt: null,
      output: [],
      lastError: null,
    },
    browserAuth: {
      status: "idle",
      mode: null,
      startedAt: null,
      completedAt: null,
      verificationUri: null,
      instructions: null,
      lastError: null,
    },
    ...overrides,
  };
}

function buildStatus(overrides: Partial<CodexStatusRecord> = {}): CodexStatusRecord {
  return {
    provider: "codex",
    account: {
      status: "authenticated",
      statusText: "Logged in using ChatGPT",
      label: "svc-analyst@example.com",
      authMode: "chatgpt",
      planType: "plus",
    },
    diagnostics: {
      command: "codex",
      resolvedPath: "/usr/local/bin/codex",
      installStatus: "installed",
      installMethod: "homebrew-cask",
      currentVersion: "0.118.0",
      rawVersionText: "codex-cli 0.118.0",
      checkedAt: "2026-03-20T00:00:00.000Z",
      latestVersion: "0.118.0",
      latestStatus: "current",
      latestCheckedAt: "2026-03-20T00:00:00.000Z",
      latestSource: "env",
      statusText: "Codex CLI is up to date.",
    },
    model: "gpt-5.4",
    reasoningEffort: "high",
    fiveHour: {
      status: "ok",
      windowMinutes: 300,
      usedPercent: 38,
      remainingPercent: 62,
      resetAt: "2026-03-20T05:00:00.000Z",
    },
    weekly: {
      status: "ok",
      windowMinutes: 10080,
      usedPercent: 61,
      remainingPercent: 39,
      resetAt: "2026-03-27T00:00:00.000Z",
    },
    usageSummary: null,
    refreshedAt: "2026-03-20T00:00:00.000Z",
    status: "ok",
    statusText: "Codex usage snapshot is current.",
    ...overrides,
  };
}

function buildClaudeStatus(
  overrides: Partial<ClaudeStatusRecord> = {}
): ClaudeStatusRecord {
  return {
    provider: "claude",
    account: {
      status: "authenticated",
      statusText: "Claude Code is authenticated.",
      label: "claude-user",
      authMode: "oauth",
      planType: null,
    },
    diagnostics: {
      command: "claude",
      resolvedPath: "/usr/local/bin/claude",
      installStatus: "installed",
      installMethod: "homebrew-cask",
      currentVersion: "2.1.81",
      rawVersionText: "2.1.81 (Claude Code)",
      checkedAt: "2026-03-20T00:00:00.000Z",
      latestVersion: "2.1.81",
      latestStatus: "current",
      latestCheckedAt: "2026-03-20T00:00:00.000Z",
      latestSource: "env",
      statusText: "Claude Code is up to date.",
    },
    model: null,
    reasoningEffort: null,
    fiveHour: {
      status: "unavailable",
      windowMinutes: 300,
      usedPercent: null,
      remainingPercent: null,
      resetAt: null,
    },
    weekly: {
      status: "unavailable",
      windowMinutes: 10080,
      usedPercent: null,
      remainingPercent: null,
      resetAt: null,
    },
    usageSummary: null,
    refreshedAt: null,
    status: "unavailable",
    statusText: "Claude Code usage telemetry is not available yet.",
    ...overrides,
  };
}

function buildHardwareStatus(
  overrides: Partial<HardwareStatusRecord> = {}
): HardwareStatusRecord {
  return {
    hostname: "rocky.local",
    platform: "darwin",
    arch: "arm64",
    refreshedAt: "2026-03-20T00:00:00.000Z",
    cpu: {
      model: "Apple M2",
      physicalCores: null,
      logicalCores: 8,
      speedGHz: null,
      usagePercent: 31.4,
      normalizedLoadPercent: 24.5,
      loadAverage: {
        oneMinute: 1.96,
        fiveMinute: 1.41,
        fifteenMinute: 1.08,
      },
    },
    memory: {
      kind: "unified",
      totalBytes: 24 * 1024 ** 3,
      usedBytes: 12 * 1024 ** 3,
      freeBytes: 12 * 1024 ** 3,
      availableBytes: 12 * 1024 ** 3,
      usedPercent: 50,
      swapTotalBytes: 4 * 1024 ** 3,
      swapUsedBytes: 512 * 1024 ** 2,
    },
    gpus: [
      {
        name: "Apple M2",
        vendor: "Apple",
        coreCount: 8,
        memoryKind: "unified",
        memoryBytes: 24 * 1024 ** 3,
        utilizationPercent: null,
        note: "GPU 코어 8개 · CPU와 GPU가 통합 메모리를 공유합니다.",
      },
    ],
    storage: {
      path: "/Users/rocky",
      totalBytes: 512 * 1024 ** 3,
      usedBytes: 321 * 1024 ** 3,
      availableBytes: 191 * 1024 ** 3,
      usedPercent: 62.7,
    },
    ...overrides,
  };
}

test("account routes expose global login status, device auth start, and logout", async () => {
  const calls: string[] = [];
  const fakeService: CodexAccountServiceLike = {
    async getState() {
      calls.push("get");
      return buildState();
    },
    async startLogin() {
      calls.push("login");
      return buildState({
        status: "pending",
        statusText: "Login in progress.",
      });
    },
    async startDeviceAuth() {
      calls.push("start");
      return buildState({
        status: "pending",
        statusText: "Device auth in progress.",
        deviceAuth: {
          ...buildState().deviceAuth,
          status: "pending",
          startedAt: "2026-03-20T00:00:01.000Z",
          output: ["Open https://auth.example.test/device and enter code ABCD-EFGH"],
          verificationUri: "https://auth.example.test/device",
          userCode: "ABCD-EFGH",
          instructions: "Open the verification link from Codex CLI and complete the browser flow.",
        },
      });
    },
    async loginWithApiKey() {
      calls.push("token");
      return buildState({
        status: "authenticated",
        statusText: "Logged in using API key.",
      });
    },
    async logout() {
      calls.push("logout");
      return buildState({
        statusText: "Logged out",
      });
    },
    async startUpdate() {
      calls.push("update");
      return buildState({
        update: {
          ...buildState().update,
          status: "pending",
          startedAt: "2026-03-20T00:00:02.000Z",
        },
      });
    },
    async summarizeTaskRequestTitle() {
      calls.push("summarize");
      return {
        title: "경쟁사 기능 비교",
        model: "gpt-5.4-mini",
      } satisfies TaskRequestTitleSummaryRecord;
    },
  };
  const fakeStatusService: CodexStatusServiceLike = {
    async getStatus() {
      calls.push("status");
      return buildStatus();
    },
  };
  const fakeClaudeAccountService = {
    async getState() {
      calls.push("claude-get");
      return buildClaudeState();
    },
    async startBrowserLogin(mode?: "claudeai" | "console") {
      calls.push(mode === "console" ? "claude-console" : "claude-login");
      return buildClaudeState({
        status: "pending",
        statusText: "Claude login in progress.",
        browserAuth: {
          ...buildClaudeState().browserAuth,
          status: "pending",
          mode: mode ?? "claudeai",
          verificationUri: "https://claude.example.test/oauth",
          instructions: "Open the verification link and finish logging in.",
        },
      });
    },
    async logout() {
      calls.push("claude-logout");
      return buildClaudeState();
    },
    async startUpdate() {
      calls.push("claude-update");
      return buildClaudeState({
        update: {
          ...buildClaudeState().update,
          status: "pending",
          startedAt: "2026-03-20T00:00:02.000Z",
        },
      });
    },
  };
  const fakeClaudeStatusService = {
    async getStatus() {
      calls.push("claude-status");
      return buildClaudeStatus();
    },
  };
  const fakeHardwareStatusService: HardwareStatusServiceLike = {
    async getStatus() {
      calls.push("hardware");
      return buildHardwareStatus();
    },
  };

  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "account-routes-"));
  const server = createAgentEngineServer({
    stateRoot,
    codexAccountService: fakeService,
    codexStatusService: fakeStatusService,
    claudeAccountService: fakeClaudeAccountService,
    claudeStatusService: fakeClaudeStatusService,
    hardwareStatusService: fakeHardwareStatusService,
    now: () => "2026-03-20T00:00:00.000Z",
  });

  await server.listen({
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const address = server.server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const getResponse = await fetch(`${baseUrl}/account`);
    assert.equal(getResponse.status, 200);
    assert.equal((await getResponse.json() as CodexAccountRecord).status, "logged-out");

    const statusResponse = await fetch(`${baseUrl}/codex-status`);
    assert.equal(statusResponse.status, 200);
    assert.equal((await statusResponse.json() as CodexStatusRecord).fiveHour.remainingPercent, 62);

    const loginResponse = await fetch(`${baseUrl}/account/login/device`, {
      method: "POST",
    });
    assert.equal(loginResponse.status, 202);
    assert.equal((await loginResponse.json() as CodexAccountRecord).status, "pending");

    const primaryLoginResponse = await fetch(`${baseUrl}/account/login`, {
      method: "POST",
    });
    assert.equal(primaryLoginResponse.status, 202);
    assert.equal((await primaryLoginResponse.json() as CodexAccountRecord).status, "pending");

    const tokenLoginResponse = await fetch(`${baseUrl}/account/login/api-key`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        apiKey: "sk-test",
      }),
    });
    assert.equal(tokenLoginResponse.status, 200);
    assert.equal((await tokenLoginResponse.json() as CodexAccountRecord).status, "authenticated");

    const logoutResponse = await fetch(`${baseUrl}/account/logout`, {
      method: "POST",
    });
    assert.equal(logoutResponse.status, 200);
    assert.equal((await logoutResponse.json() as CodexAccountRecord).statusText, "Logged out");

    const updateResponse = await fetch(`${baseUrl}/account/update`, {
      method: "POST",
    });
    assert.equal(updateResponse.status, 202);
    assert.equal((await updateResponse.json() as CodexAccountRecord).update.status, "pending");

    const providersResponse = await fetch(`${baseUrl}/account/providers`);
    assert.equal(providersResponse.status, 200);
    const providersPayload = await providersResponse.json() as {
      providers: Array<CodexAccountRecord | ClaudeAccountRecord>;
      updatedAt: string;
    };
    assert.equal(providersPayload.providers.length, 2);
    assert.equal(providersPayload.updatedAt, "2026-03-20T00:00:00.000Z");

    const providerStatusesResponse = await fetch(`${baseUrl}/account/providers/status`);
    assert.equal(providerStatusesResponse.status, 200);
    const providerStatusesPayload = await providerStatusesResponse.json() as {
      providers: Array<CodexStatusRecord | ClaudeStatusRecord>;
      updatedAt: string;
    };
    assert.equal(providerStatusesPayload.providers.length, 2);

    const hardwareResponse = await fetch(`${baseUrl}/settings/hardware`);
    assert.equal(hardwareResponse.status, 200);
    const hardwarePayload = await hardwareResponse.json() as HardwareStatusRecord;
    assert.equal(hardwarePayload.platform, "darwin");
    assert.equal(hardwarePayload.memory.kind, "unified");
    assert.equal(hardwarePayload.gpus[0]?.name, "Apple M2");

    const claudeAccountResponse = await fetch(`${baseUrl}/claude/account`);
    assert.equal(claudeAccountResponse.status, 200);
    assert.equal((await claudeAccountResponse.json() as ClaudeAccountRecord).provider, "claude");

    const claudeStatusResponse = await fetch(`${baseUrl}/claude-status`);
    assert.equal(claudeStatusResponse.status, 200);
    assert.equal((await claudeStatusResponse.json() as ClaudeStatusRecord).provider, "claude");

    const claudeLoginResponse = await fetch(`${baseUrl}/claude/account/login`, {
      method: "POST",
    });
    assert.equal(claudeLoginResponse.status, 202);
    assert.equal((await claudeLoginResponse.json() as ClaudeAccountRecord).status, "pending");

    const claudeConsoleResponse = await fetch(`${baseUrl}/claude/account/login/console`, {
      method: "POST",
    });
    assert.equal(claudeConsoleResponse.status, 202);
    assert.equal(
      (await claudeConsoleResponse.json() as ClaudeAccountRecord).browserAuth.mode,
      "console"
    );

    const claudeLogoutResponse = await fetch(`${baseUrl}/claude/account/logout`, {
      method: "POST",
    });
    assert.equal(claudeLogoutResponse.status, 200);

    const claudeUpdateResponse = await fetch(`${baseUrl}/claude/account/update`, {
      method: "POST",
    });
    assert.equal(claudeUpdateResponse.status, 202);
    assert.equal(
      (await claudeUpdateResponse.json() as ClaudeAccountRecord).update.status,
      "pending"
    );

    const summarizeResponse = await fetch(`${baseUrl}/account/task-request-title`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt: "이번 주 경쟁사 기능 출시 내용 정리해줘",
      }),
    });
    assert.equal(summarizeResponse.status, 200);
    assert.deepEqual(
      (await summarizeResponse.json()) as TaskRequestTitleSummaryRecord,
      {
        title: "경쟁사 기능 비교",
        model: "gpt-5.4-mini",
      }
    );

    assert.deepEqual(calls, [
      "get",
      "status",
      "start",
      "login",
      "token",
      "logout",
      "update",
      "get",
      "claude-get",
      "status",
      "claude-status",
      "hardware",
      "claude-get",
      "claude-status",
      "claude-login",
      "claude-console",
      "claude-logout",
      "claude-update",
      "summarize",
    ]);
  } finally {
    await server.close();
  }
});
