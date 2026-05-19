import { expect, test } from "@playwright/test";

test("Rocky replies expose raw progress events", async ({ page }) => {
  const now = "2026-01-01T00:00:00.000Z";
  const chatId = "reasoning-panel-test";
  const agentId = "agent-reasoning-panel";
  const sessionId = "session-reasoning-panel";
  const runId = "run-reasoning-panel";
  const answer = "Completed the requested check.";
  const events = [
    {
      source: "codex-cli",
      type: "session.bound",
      runId,
      sessionId,
      runtimeSessionId: "thread-reasoning",
      rawType: "thread.started",
      occurredAt: "2026-01-01T00:00:01.000Z",
      data: { runtimeSessionId: "thread-reasoning" },
      raw: { type: "thread.started", thread_id: "thread-reasoning" },
    },
    {
      source: "codex-cli",
      type: "run.started",
      runId,
      sessionId,
      runtimeSessionId: "thread-reasoning",
      rawType: "turn.started",
      occurredAt: "2026-01-01T00:00:02.000Z",
      data: {},
      raw: { type: "turn.started" },
    },
    {
      source: "codex-cli",
      type: "run.raw",
      runId,
      sessionId,
      runtimeSessionId: "thread-reasoning",
      rawType: "item.started",
      occurredAt: "2026-01-01T00:00:03.000Z",
      data: {},
      raw: {
        type: "item.started",
        item: { id: "cmd-1", type: "command_execution", command: "npm test" },
      },
    },
    {
      source: "codex-cli",
      type: "run.stderr",
      runId,
      sessionId,
      runtimeSessionId: "thread-reasoning",
      rawType: "stderr.line",
      occurredAt: "2026-01-01T00:00:03.500Z",
      data: { line: "stderr output should stay in logs" },
      raw: { line: "stderr output should stay in logs" },
    },
    {
      source: "codex-cli",
      type: "run.raw",
      runId,
      sessionId,
      runtimeSessionId: "thread-reasoning",
      rawType: "item.completed",
      occurredAt: "2026-01-01T00:00:03.650Z",
      data: {},
      raw: {
        type: "item.completed",
        item: {
          id: "cmd-2",
          type: "command_execution",
          command: "hidden completed command",
          output: "raw completed output only",
        },
      },
    },
    {
      source: "codex-cli",
      type: "assistant.message.completed",
      runId,
      sessionId,
      runtimeSessionId: "thread-reasoning",
      rawType: "item.completed",
      occurredAt: "2026-01-01T00:00:03.750Z",
      data: {
        itemType: "reasoning_summary",
        text: "요청 내용을 확인하고 필요한 검증 단계를 정리하고 있어요.",
      },
      raw: {
        type: "item.completed",
        item: {
          id: "reasoning-1",
          type: "reasoning_summary",
          text: "요청 내용을 확인하고 필요한 검증 단계를 정리하고 있어요.",
        },
      },
    },
    {
      source: "codex-cli",
      type: "assistant.message.completed",
      runId,
      sessionId,
      runtimeSessionId: "thread-reasoning",
      rawType: "item.completed",
      occurredAt: "2026-01-01T00:00:03.900Z",
      data: {
        itemType: "agent_message",
        text: answer,
      },
      raw: {
        type: "item.completed",
        item: {
          id: "answer-1",
          type: "agent_message",
          text: answer,
        },
      },
    },
    {
      source: "codex-cli",
      type: "run.completed",
      runId,
      sessionId,
      runtimeSessionId: "thread-reasoning",
      rawType: "process.close",
      occurredAt: "2026-01-01T00:00:04.000Z",
      data: { status: "completed" },
      raw: { type: "turn.completed" },
    },
  ];
  const sseBody = events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");

  const chat = {
    id: chatId,
    title: "Reasoning panel test",
    intent: "conversation",
    domain: "general",
    worker: {
      id: "worker-reasoning-panel",
      skillId: "general",
      domain: "general",
      displayName: "General",
      agentId,
      reason: "test",
      status: "ready",
      createdAt: now,
      updatedAt: now,
    },
    attachments: [],
    messages: [
      {
        id: "message-user",
        chatId,
        role: "user",
        intent: "conversation",
        text: "Run a check.",
        attachmentIds: [],
        domain: "general",
        workerId: "worker-reasoning-panel",
        skillCandidateIds: [],
        usedSkills: [],
        dispatchId: null,
        createdAt: now,
      },
      {
        id: "message-rocky",
        chatId,
        role: "rocky",
        intent: "conversation",
        text: answer,
        attachmentIds: [],
        domain: "general",
        workerId: "worker-reasoning-panel",
        skillCandidateIds: [],
        usedSkills: [],
        dispatchId: "dispatch-reasoning-panel",
        createdAt: now,
      },
    ],
    skillCandidates: [],
    dispatches: [
      {
        id: "dispatch-reasoning-panel",
        chatId,
        messageId: "message-user",
        skillId: "general",
        intent: "conversation",
        domain: "general",
        workerId: "worker-reasoning-panel",
        attachmentIds: [],
        originalRequest: "Run a check.",
        skillCandidateIds: [],
        protectionHints: [],
        orchestration: {
          id: "orchestration-reasoning-panel",
          status: "completed",
          agentId,
          sessionId,
          runId,
          output: answer,
          error: null,
          startedAt: now,
          endedAt: now,
          updatedAt: now,
        },
        executionStarted: true,
        createdAt: now,
      },
    ],
    orchestration: null,
    executionStarted: true,
    createdAt: now,
    updatedAt: now,
  };

  await page.route(`**/api/rocky/chats/${chatId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chat),
    });
  });
  await page.route(`**/api/sessions/${sessionId}/transcript`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "transcript-answer",
          sessionId,
          runId,
          role: "assistant",
          content: answer,
          source: "codex",
          createdAt: now,
          artifacts: [],
        },
      ]),
    });
  });
  await page.route(`**/api/runs/${runId}/events`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseBody,
    });
  });
  await page.route(`**/api/agents/${agentId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: agentId,
        name: "Reasoning Panel Agent",
        description: "",
        color: null,
        workspaceRoot: "/tmp/reasoning-panel-agent",
        runtimeHome: "/tmp/reasoning-panel-runtime",
        defaultRuntime: "codex-cli",
        sandboxPolicy: "workspace-write",
        approvalPolicy: "on-request",
        modelProfile: null,
        status: "idle",
        lifecycle: "active",
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    });
  });
  await page.route(`**/api/agents/${agentId}/workspace?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agentId,
        workspaceRoot: "/tmp/reasoning-panel-agent",
        path: "",
        parentPath: null,
        entries: [],
      }),
    });
  });
  await page.route("**/api/skills", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.goto(`/tasks/${chatId}`);

  const toggle = page.getByRole("button", { name: /진행 원본/ });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("세션 연결")).toHaveCount(0);
  await expect(page.getByText("npm test")).toHaveCount(0);

  await toggle.click();

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("세션 연결")).toBeVisible();
  await expect(page.getByText("도구 호출 시작")).toBeVisible();
  await expect(page.getByText("npm test")).toBeVisible();
  await expect(page.getByText("raw completed output only")).toHaveCount(0);
  await expect(page.getByText("hidden completed command")).toHaveCount(0);
  await expect(page.getByText("item.completed")).toHaveCount(2);
  await expect(
    page.getByText("요청 내용을 확인하고 필요한 검증 단계를 정리하고 있어요.")
  ).toBeVisible();
  await expect(page.getByText("assistant.message.completed")).toHaveCount(0);
  await expect(page.getByText("item.started")).toBeVisible();
  await expect(page.getByText("stderr output should stay in logs")).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("세션 연결")).toHaveCount(0);
  await expect(page.getByText("npm test")).toHaveCount(0);
});

test("right file preview does not reload while Rocky is answering", async ({ page }) => {
  const now = "2026-01-01T00:00:00.000Z";
  const chatId = "preview-refresh-test";
  const agentId = "agent-preview-refresh";
  const sessionId = "session-preview-refresh";
  let chatRequests = 0;
  let previewRequests = 0;

  const runningChat = () => {
    chatRequests += 1;
    const updatedAt = new Date(Date.parse(now) + chatRequests * 1000).toISOString();

    return {
      id: chatId,
      title: "미리보기 안정성 테스트",
      intent: "conversation",
      domain: "general",
      worker: {
        id: "worker-preview-refresh",
        skillId: "general",
        domain: "general",
        displayName: "General",
        agentId,
        reason: "test",
        status: "ready",
        createdAt: now,
        updatedAt,
      },
      attachments: [
        {
          id: "attachment-source",
          name: "source.md",
          contentType: "text/markdown",
          size: 20,
          workspacePath: "uploads/rocky/source.md",
          addedAt: now,
        },
      ],
      messages: [
        {
          id: "message-user",
          chatId,
          role: "user",
          intent: "conversation",
          text: "파일을 보고 답변해줘",
          attachmentIds: ["attachment-source"],
          domain: "general",
          workerId: "worker-preview-refresh",
          skillCandidateIds: [],
          usedSkills: [],
          dispatchId: null,
          createdAt: now,
        },
        {
          id: "message-rocky",
          chatId,
          role: "rocky",
          intent: "conversation",
          text: "",
          attachmentIds: [],
          domain: "general",
          workerId: "worker-preview-refresh",
          skillCandidateIds: [],
          usedSkills: [],
          dispatchId: "dispatch-preview-refresh",
          createdAt: now,
        },
      ],
      skillCandidates: [],
      dispatches: [
        {
          id: "dispatch-preview-refresh",
          chatId,
          messageId: "message-user",
          skillId: "general",
          intent: "conversation",
          domain: "general",
          workerId: "worker-preview-refresh",
          attachmentIds: ["attachment-source"],
          originalRequest: "파일을 보고 답변해줘",
          skillCandidateIds: [],
          protectionHints: [],
          orchestration: {
            id: "orchestration-preview-refresh",
            status: "running",
            agentId,
            sessionId,
            runId: null,
            output: null,
            error: null,
            startedAt: now,
            endedAt: null,
            updatedAt,
          },
          executionStarted: true,
          createdAt: now,
        },
      ],
      orchestration: null,
      executionStarted: true,
      createdAt: now,
      updatedAt,
    };
  };

  await page.route(`**/api/rocky/chats/${chatId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(runningChat()),
    });
  });
  await page.route(`**/api/sessions/${sessionId}/transcript`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
  await page.route(`**/api/agents/${agentId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: agentId,
        name: "Preview Refresh Agent",
        description: "",
        color: null,
        workspaceRoot: "/tmp/preview-refresh-agent",
        runtimeHome: "/tmp/preview-refresh-runtime",
        defaultRuntime: "codex-cli",
        sandboxPolicy: "workspace-write",
        approvalPolicy: "on-request",
        modelProfile: null,
        status: "idle",
        lifecycle: "active",
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    });
  });
  await page.route(`**/api/agents/${agentId}/workspace/file?**`, async (route) => {
    previewRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agentId,
        workspaceRoot: "/tmp/preview-refresh-agent",
        path: "uploads/rocky/source.md",
        name: "source.md",
        contentType: "text/markdown",
        size: 20,
        updatedAt: now,
        previewKind: "markdown",
        text: "stable preview body",
        lineCount: 1,
        truncated: false,
        downloadUrl: `/agents/${agentId}/workspace/file/content?path=uploads%2Frocky%2Fsource.md`,
        inlinePreviewUrl: null,
      }),
    });
  });
  await page.route("**/api/skills", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.goto(`/tasks/${chatId}`);

  await expect(page.getByText("파일 관리").first()).toBeVisible();
  await expect(page.getByText("stable preview body")).toHaveCount(0);
  await page
    .getByRole("button", { name: /source\.md uploads\/rocky\/source\.md/ })
    .click();
  await expect(page.getByText("stable preview body")).toBeVisible();
  expect(previewRequests).toBe(1);

  await page.waitForTimeout(3600);
  expect(previewRequests).toBe(1);
});

test("file management appears while Rocky creates a new outputs file", async ({ page }) => {
  const startedAt = new Date(Date.now() - 3500).toISOString();
  const chatId = "outputs-appear-running-test";
  const agentId = "agent-outputs-appear-running";
  const sessionId = "session-outputs-appear-running";
  let workspaceRequests = 0;

  const chat = {
    id: chatId,
    title: "실행 중 산출물 표시 테스트",
    intent: "conversation",
    domain: "general",
    worker: {
      id: "worker-outputs-appear-running",
      skillId: "general",
      domain: "general",
      displayName: "General",
      agentId,
      reason: "test",
      status: "ready",
      createdAt: startedAt,
      updatedAt: startedAt,
    },
    attachments: [],
    messages: [
      {
        id: "message-user",
        chatId,
        role: "user",
        intent: "conversation",
        text: "report.md 파일을 만들어줘",
        attachmentIds: [],
        domain: "general",
        workerId: "worker-outputs-appear-running",
        skillCandidateIds: [],
        usedSkills: [],
        dispatchId: null,
        createdAt: startedAt,
      },
      {
        id: "message-rocky",
        chatId,
        role: "rocky",
        intent: "conversation",
        text: "",
        attachmentIds: [],
        domain: "general",
        workerId: "worker-outputs-appear-running",
        skillCandidateIds: [],
        usedSkills: [],
        dispatchId: "dispatch-outputs-appear-running",
        createdAt: startedAt,
      },
    ],
    skillCandidates: [],
    dispatches: [
      {
        id: "dispatch-outputs-appear-running",
        chatId,
        messageId: "message-user",
        skillId: "general",
        intent: "conversation",
        domain: "general",
        workerId: "worker-outputs-appear-running",
        attachmentIds: [],
        originalRequest: "report.md 파일을 만들어줘",
        skillCandidateIds: [],
        protectionHints: [],
        orchestration: {
          id: "orchestration-outputs-appear-running",
          status: "running",
          agentId,
          sessionId,
          runId: null,
          output: null,
          error: null,
          startedAt,
          endedAt: null,
          updatedAt: startedAt,
        },
        executionStarted: true,
        createdAt: startedAt,
      },
    ],
    orchestration: null,
    executionStarted: true,
    createdAt: startedAt,
    updatedAt: startedAt,
  };

  await page.route(`**/api/rocky/chats/${chatId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chat),
    });
  });
  await page.route(`**/api/sessions/${sessionId}/transcript`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
  await page.route(`**/api/agents/${agentId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: agentId,
        name: "Outputs Appear Agent",
        description: "",
        color: null,
        workspaceRoot: "/tmp/outputs-appear-running-agent",
        runtimeHome: "/tmp/outputs-appear-running-runtime",
        defaultRuntime: "codex-cli",
        sandboxPolicy: "workspace-write",
        approvalPolicy: "on-request",
        modelProfile: null,
        status: "idle",
        lifecycle: "active",
        archivedAt: null,
        createdAt: startedAt,
        updatedAt: startedAt,
      }),
    });
  });
  await page.route(`**/api/agents/${agentId}/workspace?**`, async (route) => {
    workspaceRequests += 1;
    const taskOutputRoot = `outputs/${chatId}`;
    const entries =
      workspaceRequests >= 2
        ? [
            {
              kind: "file",
              name: "report.md",
              path: `${taskOutputRoot}/report.md`,
              contentType: "text/markdown",
              size: 24,
              updatedAt: new Date().toISOString(),
              previewKind: "markdown",
            },
          ]
        : [];

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agentId,
        workspaceRoot: "/tmp/outputs-appear-running-agent",
        path: taskOutputRoot,
        parentPath: "outputs",
        entries,
      }),
    });
  });
  await page.route("**/api/skills", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.goto(`/tasks/${chatId}`);

  await expect(page.getByText("파일 관리")).toHaveCount(0);
  await expect(page.getByText(/답변중 · \d+초/)).toBeVisible();
  await expect(page.getByText("파일 관리").first()).toBeVisible({
    timeout: 5000,
  });
  await expect(
    page.getByRole("button", {
      name: new RegExp(`report\\.md outputs/${chatId}/report\\.md`),
    })
  ).toBeVisible();
  expect(workspaceRequests).toBeGreaterThanOrEqual(2);
});

test("conversation file clicks select the file management preview panel", async ({ page }) => {
  const now = "2026-01-01T00:00:00.000Z";
  const chatId = "io-panel-click-test";
  const agentId = "agent-io-panel-click";
  const sessionId = "session-io-panel-click";
  const runId = "run-io-panel-click";
  const missingPreviewPaths: string[] = [];
  const rockyOutput = "결과를 만들었습니다. 참고 [stray.md](drafts/stray.md)";

  const chat = {
    id: chatId,
    title: "Input Output 클릭 테스트",
    intent: "conversation",
    domain: "general",
    worker: {
      id: "worker-io-panel-click",
      skillId: "general",
      domain: "general",
      displayName: "General",
      agentId,
      reason: "test",
      status: "ready",
      createdAt: now,
      updatedAt: now,
    },
    attachments: [
      {
        id: "attachment-source",
        name: "source.md",
        contentType: "text/markdown",
        size: 20,
        workspacePath: "uploads/rocky/source.md",
        addedAt: now,
      },
    ],
    messages: [
      {
        id: "message-user",
        chatId,
        role: "user",
        intent: "conversation",
        text: "source.md를 보고 output.md를 만들어줘",
        attachmentIds: ["attachment-source"],
        domain: "general",
        workerId: "worker-io-panel-click",
        skillCandidateIds: [],
        usedSkills: [],
        dispatchId: null,
        createdAt: now,
      },
      {
        id: "message-rocky",
        chatId,
        role: "rocky",
        intent: "conversation",
        text: rockyOutput,
        attachmentIds: [],
        domain: "general",
        workerId: "worker-io-panel-click",
        skillCandidateIds: [],
        usedSkills: [],
        dispatchId: "dispatch-io-panel-click",
        createdAt: now,
      },
    ],
    skillCandidates: [],
    dispatches: [
      {
        id: "dispatch-io-panel-click",
        chatId,
        messageId: "message-user",
        skillId: "general",
        intent: "conversation",
        domain: "general",
        workerId: "worker-io-panel-click",
        attachmentIds: ["attachment-source"],
        originalRequest: "source.md를 보고 output.md를 만들어줘",
        skillCandidateIds: [],
        protectionHints: [],
        orchestration: {
          id: "orchestration-io-panel-click",
          status: "completed",
          agentId,
          sessionId,
          runId,
          output: rockyOutput,
          error: null,
          startedAt: now,
          endedAt: now,
          updatedAt: now,
        },
        executionStarted: true,
        createdAt: now,
      },
    ],
    orchestration: null,
    executionStarted: true,
    createdAt: now,
    updatedAt: now,
  };

  await page.route(`**/api/rocky/chats/${chatId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chat),
    });
  });
  await page.route(`**/api/sessions/${sessionId}/transcript`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "transcript-output",
          sessionId,
          runId,
          role: "assistant",
          content: rockyOutput,
          source: "codex",
          createdAt: now,
          artifacts: [
            {
              kind: "file",
              role: "output",
              name: "output.md",
              workspaceRelativePath: "outputs/output.md",
              contentType: "text/markdown",
              presentation: "file",
              size: 32,
              previewable: true,
              previewUrl: null,
              downloadUrl: `/runs/${runId}/artifacts/output`,
              preferredAction: "preview",
            },
          ],
        },
      ]),
    });
  });
  await page.route(`**/api/agents/${agentId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: agentId,
        name: "Input Output Agent",
        description: "",
        color: null,
        workspaceRoot: "/tmp/io-panel-click-agent",
        runtimeHome: "/tmp/io-panel-click-runtime",
        defaultRuntime: "codex-cli",
        sandboxPolicy: "workspace-write",
        approvalPolicy: "on-request",
        modelProfile: null,
        status: "idle",
        lifecycle: "active",
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    });
  });
  await page.route(`**/api/agents/${agentId}/workspace/file?**`, async (route) => {
    const url = new URL(route.request().url());
    const workspacePath = url.searchParams.get("path");
    const previews: Record<string, string> = {
      "outputs/current/output.md": "output preview body",
      "uploads/rocky/source.md": "source preview body",
    };
    const text = workspacePath ? previews[workspacePath] : undefined;

    if (!workspacePath || !text) {
      if (workspacePath) {
        missingPreviewPaths.push(workspacePath);
      }
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agentId,
        workspaceRoot: "/tmp/io-panel-click-agent",
        path: workspacePath,
        name: workspacePath.split("/").at(-1),
        contentType: "text/markdown",
        size: text.length,
        updatedAt: now,
        previewKind: "markdown",
        text,
        lineCount: 1,
        truncated: false,
        downloadUrl: `/agents/${agentId}/workspace/file/content?path=${encodeURIComponent(
          workspacePath
        )}`,
        inlinePreviewUrl: null,
      }),
    });
  });
  await page.route(`**/api/agents/${agentId}/workspace/search?**`, async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("query");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agentId,
        workspaceRoot: "/tmp/io-panel-click-agent",
        path: "",
        query,
        truncated: false,
        matches:
          query === "output.md"
            ? [
                {
                  kind: "file",
                  name: "output.md",
                  path: "outputs/current/output.md",
                  contentType: "text/markdown",
                  size: 32,
                  updatedAt: now,
                  previewKind: "markdown",
                },
              ]
            : [],
      }),
    });
  });
  await page.route("**/api/skills", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.goto(`/tasks/${chatId}`);

  await expect(page.getByText("작업 시간")).toHaveCount(0);
  await expect(page.getByText("총 실행시간")).toHaveCount(0);
  await expect(page.getByText("답변 1초")).toBeVisible();
  await expect(page.getByText("파일 관리").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /output\.md outputs\/output\.md/ })
  ).toBeVisible();
  await expect(page.getByText("output preview body")).toHaveCount(0);

  await page.getByRole("button", { name: "output.md 파일" }).click();
  await expect(page.getByText("output preview body")).toBeVisible();
  await expect(page.getByText("outputs/current/output.md")).toBeVisible();

  await page
    .getByRole("button", { name: /source\.md uploads\/rocky\/source\.md/ })
    .click();
  await expect(page.getByText("source preview body")).toBeVisible();

  await page.getByRole("button", { name: "stray.md" }).click();
  await expect(page.getByText("파일을 미리볼 수 없습니다.")).toBeVisible();
  await expect(
    page.getByText("이 파일은 현재 파일 관리 목록에 없어 미리볼 수 없습니다.")
  ).toBeVisible();
  expect(missingPreviewPaths).not.toContain("drafts/stray.md");
  expect(missingPreviewPaths).toContain("outputs/output.md");
});

test("file management keeps real output paths and input section while browsing folders", async ({
  page,
}) => {
  const now = "2026-01-01T00:00:00.000Z";
  const chatId = "file-panel-folder-path-test";
  const agentId = "agent-file-panel-folder-path";
  const sessionId = "session-file-panel-folder-path";
  const runId = "run-file-panel-folder-path";
  const fileName = "매출분석_스킬_업데이트_패치.md";
  const displayedWrongPath = `outputs/${fileName}`;
  const actualPath = `outputs/정리된_산출물/patches/${fileName}`;
  const templateRunMessage = [
    "[Rocky 템플릿 실행]",
    "템플릿: 매출분석",
    "최종 산출물: Markdown",
    "템플릿 output 파일:",
    `- ${displayedWrongPath}`,
  ].join("\n");

  const chat = {
    id: chatId,
    title: "파일 관리 폴더 경로 테스트",
    intent: "template",
    domain: "data",
    worker: {
      id: "worker-file-panel-folder-path",
      skillId: "sales-analysis",
      domain: "data",
      displayName: "매출분석",
      agentId,
      reason: "test",
      status: "ready",
      createdAt: now,
      updatedAt: now,
    },
    attachments: [
      {
        id: "attachment-source",
        name: "source.csv",
        contentType: "text/csv",
        size: 24,
        workspacePath: "uploads/rocky/source.csv",
        addedAt: now,
      },
    ],
    messages: [
      {
        id: "message-template",
        chatId,
        role: "user",
        intent: "template",
        text: templateRunMessage,
        attachmentIds: ["attachment-source"],
        domain: "data",
        workerId: "worker-file-panel-folder-path",
        skillCandidateIds: [],
        usedSkills: [],
        dispatchId: null,
        createdAt: now,
      },
      {
        id: "message-rocky",
        chatId,
        role: "rocky",
        intent: "template",
        text: `완료했습니다. ${displayedWrongPath}`,
        attachmentIds: [],
        domain: "data",
        workerId: "worker-file-panel-folder-path",
        skillCandidateIds: [],
        usedSkills: [],
        dispatchId: "dispatch-file-panel-folder-path",
        createdAt: now,
      },
    ],
    skillCandidates: [],
    dispatches: [
      {
        id: "dispatch-file-panel-folder-path",
        chatId,
        messageId: "message-template",
        skillId: "sales-analysis",
        intent: "template",
        domain: "data",
        workerId: "worker-file-panel-folder-path",
        attachmentIds: ["attachment-source"],
        originalRequest: templateRunMessage,
        skillCandidateIds: [],
        protectionHints: [],
        orchestration: {
          id: "orchestration-file-panel-folder-path",
          status: "completed",
          agentId,
          sessionId,
          runId,
          output: `완료했습니다. ${displayedWrongPath}`,
          error: null,
          startedAt: now,
          endedAt: now,
          updatedAt: now,
        },
        executionStarted: true,
        createdAt: now,
      },
    ],
    orchestration: null,
    executionStarted: true,
    createdAt: now,
    updatedAt: now,
  };

  await page.route(`**/api/rocky/chats/${chatId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chat),
    });
  });
  await page.route(`**/api/sessions/${sessionId}/transcript`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "transcript-output",
          sessionId,
          runId,
          role: "assistant",
          content: `완료했습니다. ${displayedWrongPath}`,
          source: "codex",
          createdAt: now,
          artifacts: [
            {
              kind: "file",
              role: "output",
              name: fileName,
              workspaceRelativePath: actualPath,
              contentType: "text/markdown",
              presentation: "file",
              size: 32,
              previewable: true,
              previewUrl: null,
              downloadUrl: `/runs/${runId}/artifacts/output`,
              preferredAction: "preview",
            },
          ],
        },
      ]),
    });
  });
  await page.route(`**/api/agents/${agentId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: agentId,
        name: "File Panel Path Agent",
        description: "",
        color: null,
        workspaceRoot: "/tmp/file-panel-folder-path-agent",
        runtimeHome: "/tmp/file-panel-folder-path-runtime",
        defaultRuntime: "codex-cli",
        sandboxPolicy: "workspace-write",
        approvalPolicy: "on-request",
        modelProfile: null,
        status: "idle",
        lifecycle: "active",
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    });
  });
  await page.route(`**/api/agents/${agentId}/workspace?**`, async (route) => {
    const url = new URL(route.request().url());
    const workspacePath = url.searchParams.get("path") ?? "";
    const entriesByPath: Record<string, unknown[]> = {
      outputs: [
        {
          kind: "file",
          name: ".DS_Store",
          path: "outputs/.DS_Store",
          contentType: "application/octet-stream",
          size: 6,
          updatedAt: now,
          previewKind: "binary",
        },
        {
          kind: "directory",
          name: "정리된_산출물",
          path: "outputs/정리된_산출물",
          contentType: null,
          size: null,
          updatedAt: now,
          previewKind: null,
        },
      ],
      "outputs/정리된_산출물": [
        {
          kind: "directory",
          name: "patches",
          path: "outputs/정리된_산출물/patches",
          contentType: null,
          size: null,
          updatedAt: now,
          previewKind: null,
        },
      ],
      "outputs/정리된_산출물/patches": [
        {
          kind: "file",
          name: fileName,
          path: actualPath,
          contentType: "text/markdown",
          size: 32,
          updatedAt: now,
          previewKind: "markdown",
        },
      ],
    };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agentId,
        workspaceRoot: "/tmp/file-panel-folder-path-agent",
        path: workspacePath,
        parentPath:
          workspacePath === "outputs"
            ? ""
            : workspacePath === "outputs/정리된_산출물"
              ? "outputs"
              : workspacePath === "outputs/정리된_산출물/patches"
                ? "outputs/정리된_산출물"
                : null,
        entries: entriesByPath[workspacePath] ?? [],
      }),
    });
  });
  await page.route(`**/api/agents/${agentId}/workspace/file?**`, async (route) => {
    const url = new URL(route.request().url());
    const workspacePath = url.searchParams.get("path");
    if (workspacePath !== actualPath && workspacePath !== "uploads/rocky/source.csv") {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agentId,
        workspaceRoot: "/tmp/file-panel-folder-path-agent",
        path: workspacePath,
        name: workspacePath.split("/").at(-1),
        contentType: workspacePath === actualPath ? "text/markdown" : "text/csv",
        size: 32,
        updatedAt: now,
        previewKind: workspacePath === actualPath ? "markdown" : "text",
        text: workspacePath === actualPath ? "actual output preview" : "input preview",
        lineCount: 1,
        truncated: false,
        downloadUrl: `/agents/${agentId}/workspace/file/content?path=${encodeURIComponent(
          workspacePath
        )}`,
        inlinePreviewUrl: null,
      }),
    });
  });
  await page.route("**/api/skills", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  await page.goto(`/tasks/${chatId}`);

  await expect(page.getByText("파일 관리").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /매출분석_스킬_업데이트_패치\.md outputs\/매출분석_스킬_업데이트_패치\.md/ })
  ).toHaveCount(0);
  await expect(page.getByText(".DS_Store")).toHaveCount(0);

  await page
    .getByRole("button", { name: /정리된_산출물 outputs\/정리된_산출물/ })
    .click();
  const outputSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "산출물", exact: true }),
  });
  const inputSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "입력", exact: true }),
  });
  await expect(
    outputSection.getByText("outputs/정리된_산출물", { exact: true })
  ).toBeVisible();
  await expect(
    inputSection.getByText("outputs/정리된_산출물", { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /source\.csv uploads\/rocky\/source\.csv/ })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /patches outputs\/정리된_산출물\/patches/ })
  ).toBeVisible();

  await page
    .getByRole("button", { name: /patches outputs\/정리된_산출물\/patches/ })
    .click();
  await expect(
    outputSection.getByText("outputs/정리된_산출물/patches", { exact: true })
  ).toBeVisible();
  await expect(
    inputSection.getByText("outputs/정리된_산출물/patches", { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /source\.csv uploads\/rocky\/source\.csv/ })
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /매출분석_스킬_업데이트_패치\.md outputs\/정리된_산출물\/patches\/매출분석_스킬_업데이트_패치\.md/,
    })
  ).toBeVisible();
});

test("home starts Rocky work and task routes own the conversation", async ({
  page,
  request,
}) => {
  const nonce = Date.now().toString();
  const fileName = `nutrition-event-${nonce}.csv`;
  const userPrompt =
    `테스트 ${nonce}: 영양제 이벤트 엑셀을 상품명 기준으로 묶고 원가와 마진은 보호해서 정리해줘.`;

  const existingChatsResponse = await request.get("/api/rocky/chats");
  expect(existingChatsResponse.ok()).toBeTruthy();
  for (const existingChat of await existingChatsResponse.json()) {
    await request.delete(`/api/rocky/chats/${existingChat.id}`);
  }

  await page.goto("/");

  await expect(page.getByRole("link", { name: "검색" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "홈" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "작업" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "일반" })).toBeVisible();
  await expect(page.getByRole("button", { name: "디버그" })).toBeVisible();
  await expect(page.getByRole("button", { name: "고급 관리" })).toBeVisible();
  await expect(page.getByText("Rocky 기본 능력")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "이전 대화" })).toHaveCount(0);

  await page.getByLabel("자료 파일 선택").setInputFiles({
    name: fileName,
    mimeType: "text/csv",
    buffer: Buffer.from("event,product,revenue,cost\nspring,milk thistle,100,40"),
  });
  await expect(page.locator("form").getByText(fileName)).toBeVisible();

  await page.getByLabel("Rocky에게 말하기").fill(userPrompt);
  await page
    .getByRole("button", { name: /^(시작하기|보내기)$/ })
    .click();

  await expect(page).toHaveURL(/\/tasks\/[^/]+$/);
  await expect(page.getByText(userPrompt)).toBeVisible();
  await expect(page.getByRole("status").getByText("답변중")).toBeVisible();
  await expect(page.getByRole("status").getByText(/^현재 /)).toBeVisible();
  await expect(page.getByRole("button", { name: "응답 중지" })).toBeVisible();
  await expect(page.getByRole("button", { name: "이전 대화" })).toHaveCount(0);

  const taskUrl = page.url();
  await page.reload();

  await expect(page).toHaveURL(taskUrl);
  await expect(page.getByText(userPrompt)).toBeVisible();
  await expect(page.getByRole("status").getByText("답변중")).toBeVisible();

  const chatsResponse = await request.get("/api/rocky/chats");
  expect(chatsResponse.ok()).toBeTruthy();
  const chats = await chatsResponse.json();
  const createdChat = chats.find((candidate: { messages?: Array<{ text?: string }> }) =>
    candidate.messages?.some((message) => message.text === userPrompt)
  );
  expect(createdChat).toBeTruthy();
  expect(createdChat.attachments?.[0]?.workspacePath).toMatch(/^uploads\/rocky\//);

  await page.getByRole("link", { name: "작업" }).first().click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("heading", { name: "Rocky 작업 목록" })).toBeVisible();
  await expect(page.getByText(new RegExp(`테스트 ${nonce}`)).first()).toBeVisible();
  await expect(page.getByText(fileName)).toBeVisible();
  await expect(page.getByText("진행중인 작업")).toBeVisible();

  await page.getByRole("link", { name: "검색" }).first().click();
  await expect(page).toHaveURL(/\/search$/);
  await page.getByPlaceholder("템플릿 이름, 작업 요약, 파일 기준으로 검색").fill(nonce);
  await expect(page.getByText(new RegExp(`테스트 ${nonce}`)).first()).toBeVisible();

  await page.goto(taskUrl);
  await page.getByRole("button", { name: "응답 중지" }).click();
  await expect(page.getByText("답변 생성이 취소되었어요.")).toBeVisible();
  await expect(page.getByRole("button", { name: "대화 정리" })).toBeEnabled();
  await page.getByRole("button", { name: "대화 정리" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "어떤 작업을 시작할까요?" })).toBeVisible();

  const afterClearResponse = await request.get("/api/rocky/chats");
  expect(afterClearResponse.ok()).toBeTruthy();
  const chatsAfterClear = await afterClearResponse.json();
  expect(
    chatsAfterClear.some((candidate: { id?: string }) => candidate.id === createdChat.id)
  ).toBe(true);
});
