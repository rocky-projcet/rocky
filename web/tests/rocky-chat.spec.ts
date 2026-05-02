import { expect, test } from "@playwright/test";

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

  await expect(page.getByText("Input / Output").first()).toBeVisible();
  await expect(page.getByText("stable preview body")).toBeVisible();
  expect(previewRequests).toBe(1);

  await page.waitForTimeout(3600);
  expect(previewRequests).toBe(1);
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
