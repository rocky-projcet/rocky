import test from "node:test";
import assert from "node:assert/strict";

import { CodexStatusService } from "../../src/account/codex-status-service.js";

import type { CodexAccountRecord } from "../../src/account/codex-account-types.js";

function buildAccountState(
  overrides: Partial<CodexAccountRecord> = {}
): CodexAccountRecord {
  return {
    provider: "codex",
    providerLabel: "Codex CLI",
    status: "authenticated",
    statusText: "Logged in using ChatGPT",
    homePath: "/srv/agent-engine",
    codexBin: "codex",
    updatedAt: "2026-03-30T00:00:00.000Z",
    accountInfo: {
      label: "svc-analyst@example.com",
      email: "svc-analyst@example.com",
      name: "Service Analyst",
      userId: "svc-analyst",
      planType: "plus",
      organizationTitle: "SFA",
      authMode: "chatgpt",
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
      checkedAt: "2026-03-30T00:00:00.000Z",
      latestVersion: "0.118.0",
      latestStatus: "current",
      latestCheckedAt: "2026-03-30T00:00:00.000Z",
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

test("CodexStatusService returns model, reasoning, and fresh usage snapshot", async () => {
  const files = new Map<string, string>([
    [
      "/srv/agent-engine/.codex/config.toml",
      'model = "gpt-5.4"\nmodel_reasoning_effort = "xhigh"\n',
    ],
    [
      "/srv/agent-engine/.codex/sessions/2026/03/30/rollout-2.jsonl",
      [
        '{"timestamp":"2026-03-30T01:00:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":32,"window_minutes":300,"resets_at":1774846800},"secondary":{"used_percent":57,"window_minutes":10080,"resets_at":1775428800}}}}',
      ].join("\n"),
    ],
  ]);

  const service = new CodexStatusService({
    accountService: {
      async getState() {
        return buildAccountState();
      },
      async startLogin() {
        return buildAccountState();
      },
      async startDeviceAuth() {
        return buildAccountState();
      },
      async loginWithApiKey() {
        return buildAccountState();
      },
      async logout() {
        return buildAccountState({
          status: "logged-out",
        });
      },
      async startUpdate() {
        return buildAccountState();
      },
      async summarizeTaskRequestTitle() {
        return {
          title: "요약 제목",
          model: "gpt-5.4-mini",
        };
      },
      async suggestAgentForSkill() {
        return {
          name: "추천 에이전트",
          description: "테스트용 에이전트입니다.",
          emoji: "🤖",
          model: "gpt-5.4-mini",
        };
      },
    },
    now: () => "2026-03-30T01:10:00.000Z",
    readFile: async (filePath) => {
      const content = files.get(filePath);
      assert.ok(content, `Unexpected file read: ${filePath}`);
      return content;
    },
    listSessionLogPaths: async () => [
      "/srv/agent-engine/.codex/sessions/2026/03/30/rollout-2.jsonl",
    ],
  });

  const status = await service.getStatus();

  assert.equal(status.account.label, "svc-analyst@example.com");
  assert.equal(status.account.planType, "plus");
  assert.equal(status.model, "gpt-5.4");
  assert.equal(status.reasoningEffort, "xhigh");
  assert.equal(status.fiveHour.remainingPercent, 68);
  assert.equal(status.weekly.remainingPercent, 43);
  assert.equal(status.fiveHour.status, "ok");
  assert.equal(status.weekly.status, "ok");
  assert.equal(status.status, "ok");
  assert.equal(status.refreshedAt, "2026-03-30T01:00:00.000Z");
});

test("CodexStatusService marks old usage snapshots as stale", async () => {
  const service = new CodexStatusService({
    accountService: {
      async getState() {
        return buildAccountState();
      },
      async startLogin() {
        return buildAccountState();
      },
      async startDeviceAuth() {
        return buildAccountState();
      },
      async loginWithApiKey() {
        return buildAccountState();
      },
      async logout() {
        return buildAccountState({
          status: "logged-out",
        });
      },
      async startUpdate() {
        return buildAccountState();
      },
      async summarizeTaskRequestTitle() {
        return {
          title: "요약 제목",
          model: "gpt-5.4-mini",
        };
      },
      async suggestAgentForSkill() {
        return {
          name: "추천 에이전트",
          description: "테스트용 에이전트입니다.",
          emoji: "🤖",
          model: "gpt-5.4-mini",
        };
      },
    },
    now: () => "2026-03-30T02:45:00.000Z",
    readFile: async (filePath) => {
      if (filePath.endsWith("config.toml")) {
        return 'model = "gpt-5.4"\nmodel_reasoning_effort = "high"\n';
      }

      return '{"timestamp":"2026-03-30T01:00:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":40,"window_minutes":300,"resets_at":1774846800},"secondary":{"used_percent":50,"window_minutes":10080,"resets_at":1775428800}}}}';
    },
    listSessionLogPaths: async () => [
      "/srv/agent-engine/.codex/sessions/2026/03/30/rollout-2.jsonl",
    ],
  });

  const status = await service.getStatus();

  assert.equal(status.status, "stale");
  assert.equal(status.fiveHour.status, "stale");
  assert.equal(status.weekly.status, "stale");
  assert.equal(status.statusText, "Showing the latest stale Codex usage snapshot.");
});

test("CodexStatusService selects the newest token snapshot by event timestamp across files", async () => {
  const files = new Map<string, string>([
    [
      "/srv/agent-engine/.codex/config.toml",
      'model = "gpt-5.4"\nmodel_reasoning_effort = "xhigh"\n',
    ],
    [
      "/srv/agent-engine/.codex/sessions/2026/03/25/rollout-newer-name.jsonl",
      '{"timestamp":"2026-03-27T00:20:59.971Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":0,"window_minutes":300,"resets_at":1774588840},"secondary":{"used_percent":0,"window_minutes":10080,"resets_at":1775175640}}}}',
    ],
    [
      "/srv/agent-engine/.codex/sessions/2026/03/20/rollout-older-name-resumed.jsonl",
      '{"timestamp":"2026-03-30T01:54:17.984Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":53,"window_minutes":300,"resets_at":1774841517},"secondary":{"used_percent":18,"window_minutes":10080,"resets_at":1775308218}}}}',
    ],
  ]);

  const service = new CodexStatusService({
    accountService: {
      async getState() {
        return buildAccountState();
      },
      async startLogin() {
        return buildAccountState();
      },
      async startDeviceAuth() {
        return buildAccountState();
      },
      async loginWithApiKey() {
        return buildAccountState();
      },
      async logout() {
        return buildAccountState({
          status: "logged-out",
        });
      },
      async startUpdate() {
        return buildAccountState();
      },
      async summarizeTaskRequestTitle() {
        return {
          title: "요약 제목",
          model: "gpt-5.4-mini",
        };
      },
      async suggestAgentForSkill() {
        return {
          name: "추천 에이전트",
          description: "테스트용 에이전트입니다.",
          emoji: "🤖",
          model: "gpt-5.4-mini",
        };
      },
    },
    now: () => "2026-03-30T02:00:00.000Z",
    readFile: async (filePath) => {
      const content = files.get(filePath);
      assert.ok(content, `Unexpected file read: ${filePath}`);
      return content;
    },
    listSessionLogPaths: async () => [
      "/srv/agent-engine/.codex/sessions/2026/03/25/rollout-newer-name.jsonl",
      "/srv/agent-engine/.codex/sessions/2026/03/20/rollout-older-name-resumed.jsonl",
    ],
  });

  const status = await service.getStatus();

  assert.equal(status.refreshedAt, "2026-03-30T01:54:17.984Z");
  assert.equal(status.fiveHour.remainingPercent, 47);
  assert.equal(status.weekly.remainingPercent, 82);
  assert.equal(status.status, "ok");
});

test("CodexStatusService reports unavailable when no token snapshot exists", async () => {
  const service = new CodexStatusService({
    accountService: {
      async getState() {
        return buildAccountState({
          status: "logged-out",
          statusText: "Not logged in",
          accountInfo: {
            label: null,
            email: null,
            name: null,
            userId: null,
            planType: null,
            organizationTitle: null,
            authMode: null,
          },
        });
      },
      async startLogin() {
        return buildAccountState();
      },
      async startDeviceAuth() {
        return buildAccountState();
      },
      async loginWithApiKey() {
        return buildAccountState();
      },
      async logout() {
        return buildAccountState({
          status: "logged-out",
        });
      },
      async startUpdate() {
        return buildAccountState();
      },
      async summarizeTaskRequestTitle() {
        return {
          title: "요약 제목",
          model: "gpt-5.4-mini",
        };
      },
      async suggestAgentForSkill() {
        return {
          name: "추천 에이전트",
          description: "테스트용 에이전트입니다.",
          emoji: "🤖",
          model: "gpt-5.4-mini",
        };
      },
    },
    now: () => "2026-03-30T02:45:00.000Z",
    readFile: async () => 'model = "gpt-5.4"\n',
    listSessionLogPaths: async () => [],
  });

  const status = await service.getStatus();

  assert.equal(status.account.status, "logged-out");
  assert.equal(status.status, "unavailable");
  assert.equal(status.fiveHour.remainingPercent, null);
  assert.equal(status.weekly.remainingPercent, null);
  assert.equal(status.statusText, "No Codex usage snapshot has been recorded yet.");
});
