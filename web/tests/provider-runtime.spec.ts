import { expect, test } from "@playwright/test";

test("account page shows both provider cards and CLI diagnostics", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "서비스 연결과 로컬 실행 환경" })).toBeVisible();
  const providerPanel = page.getByRole("tabpanel", { name: "AI 서비스" });
  await expect(providerPanel.getByRole("heading", { name: "Codex CLI" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(providerPanel.getByRole("heading", { name: "Claude Code" })).toBeVisible();
  await expect(providerPanel.getByText("설치 상태")).toHaveCount(2);
  await expect(providerPanel.getByText("현재 버전")).toHaveCount(2);
});

test("sidebar usage panel toggles provider usage visibility", async ({ page }) => {
  await page.goto("/agents");

  const toggle = page.getByRole("button", { name: /Codex \/ Claude/i });
  const usagePanel = toggle.locator("xpath=..");
  await toggle.click();

  await expect(usagePanel.getByText("Codex", { exact: true })).toBeVisible();
  await expect(usagePanel.getByText("Claude", { exact: true })).toBeVisible();

  await toggle.click();
  await expect(usagePanel.getByText("Codex", { exact: true })).toHaveCount(0);
});

test("sidebar settings button navigates directly to account page", async ({ page }) => {
  await page.goto("/agents");

  await page.getByRole("button", { name: "설정 열기" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "서비스 연결과 로컬 실행 환경" })).toBeVisible();
});

test("agent create dialog omits id and default runtime fields", async ({ page }) => {
  const unique = Date.now();
  const agentName = `playwright-agent-${unique}`;

  await page.goto("/agents");
  await page.getByRole("button", { name: /새 에이전트/ }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "새 에이전트 만들기" })).toBeVisible();
  await expect(dialog.getByLabel("이름")).toBeVisible();
  await expect(dialog.getByLabel("설명")).toBeVisible();
  await expect(dialog.getByLabel("ID")).toHaveCount(0);
  await expect(dialog.getByRole("combobox", { name: "기본 실행 엔진" })).toHaveCount(0);

  await dialog.getByLabel("이름").fill(agentName);
  await dialog.getByRole("button", { name: "에이전트 생성" }).click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/agents\/[^/]+$/);
  await expect(page.getByRole("heading", { name: agentName, exact: true })).toBeVisible();
});

test("task request model options stay engine-scoped for agent runtime selection", async ({
  page,
  request,
}) => {
  const unique = Date.now();
  const agentId = `playwright-claude-${unique}`;
  const createAgentResponse = await request.post("/api/agents", {
    data: {
      id: agentId,
      name: `playwright-claude-${unique}`,
      defaultRuntime: "claude-code",
    },
  });
  expect(createAgentResponse.ok()).toBeTruthy();

  await page.goto(`/agents/${agentId}`);

  await page.getByRole("button", { name: "작업 요청하기" }).click();
  const requestDialog = page.getByRole("dialog");
  await expect(requestDialog.getByRole("combobox", { name: /실행 엔진/i })).toContainText(
    "Claude Code"
  );
  await requestDialog.getByRole("combobox", { name: /실행 엔진/i }).click();
  await expect(page.getByText("Codex CLI").last()).toBeVisible();
  await expect(page.getByText("Claude Code").last()).toBeVisible();
  await expect(page.getByText("Ollama").last()).toBeVisible();
  await page.getByText("Claude Code").last().click();
  await expect(
    requestDialog.getByRole("combobox", { name: /실행 모델/i })
  ).toContainText("Default (recommended) · Sonnet 4.6");

  await requestDialog.getByRole("combobox", { name: /실행 모델/i }).click();
  await expect(page.getByText("Opus · Opus 4.6")).toBeVisible();
  await expect(page.getByText("Sonnet (1M context) · Sonnet 4.6")).toBeVisible();
  await expect(page.getByText("Opus (1M context) · Opus 4.6")).toBeVisible();
  await expect(page.getByText("Haiku · Haiku 4.5")).toBeVisible();
  await expect(page.getByText("GPT-5.4")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(requestDialog.getByRole("combobox", { name: "추론 수준" })).toBeVisible();
  await expect(requestDialog.getByText("응답 속도")).toHaveCount(0);

  await requestDialog.getByRole("combobox", { name: /실행 엔진/i }).click();
  await page.getByText("Codex CLI").last().click();
  await expect(
    requestDialog.getByRole("combobox", { name: /실행 모델/i })
  ).toContainText("GPT-5.4");
  await requestDialog.getByRole("combobox", { name: /실행 모델/i }).click();
  await expect(page.getByText("GPT-5.4 mini")).toBeVisible();
  await expect(page.getByText("Default (recommended) · Sonnet 4.6")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(requestDialog.getByRole("combobox", { name: "추론 수준" })).toBeVisible();
  await expect(requestDialog.getByRole("combobox", { name: "응답 속도" })).toBeVisible();

  await requestDialog.getByRole("combobox", { name: /실행 엔진/i }).click();
  await page.getByText("Ollama").last().click();
  await expect(
    requestDialog.getByRole("combobox", { name: /Ollama 실행기/i })
  ).toContainText("Codex");
  await requestDialog.getByRole("combobox", { name: /Ollama 실행기/i }).click();
  await expect(page.getByText("Claude").last()).toBeVisible();
  await page.getByText("Claude").last().click();
  await expect(
    requestDialog.getByRole("combobox", { name: /Ollama 실행기/i })
  ).toContainText("Claude");
  await requestDialog.getByRole("button", { name: "취소" }).click();
});

test("task request dialog lists selected upload files before submission", async ({
  page,
  request,
}) => {
  const unique = Date.now();
  const agentId = `playwright-upload-${unique}`;
  const createAgentResponse = await request.post("/api/agents", {
    data: {
      id: agentId,
      name: `playwright-upload-${unique}`,
      defaultRuntime: "codex-cli",
    },
  });
  expect(createAgentResponse.ok()).toBeTruthy();

  await page.goto(`/agents/${agentId}`);
  await page.getByRole("button", { name: "작업 요청하기" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("compact-file-attachment-input").setInputFiles({
    name: "brief.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hi"),
  });

  await expect(dialog.getByText("brief.txt")).toBeVisible();
  await expect(dialog.getByText("2 B · 워크스페이스 참고 파일")).toBeVisible();
});

test("task request dialog stays inside short viewports", async ({ page, request }) => {
  const unique = Date.now();
  const agentId = `playwright-viewport-${unique}`;
  const createAgentResponse = await request.post("/api/agents", {
    data: {
      id: agentId,
      name: `playwright-viewport-${unique}`,
      defaultRuntime: "codex-cli",
    },
  });
  expect(createAgentResponse.ok()).toBeTruthy();

  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto(`/agents/${agentId}`);
  const requestButton = page.getByRole("button", { name: "작업 요청하기" }).first();
  await requestButton.scrollIntoViewIfNeeded();
  await requestButton.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "작업 요청 시작" })).toBeVisible();

  const dialogBounds = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
    };
  });
  const bodyMetrics = await dialog.getByTestId("task-request-dialog-body").evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return {
      overflowY: styles.overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    };
  });

  expect(dialogBounds.top).toBeGreaterThanOrEqual(0);
  expect(dialogBounds.bottom).toBeLessThanOrEqual(640);
  expect(["auto", "scroll"]).toContain(bodyMetrics.overflowY);
  expect(bodyMetrics.scrollHeight).toBeGreaterThan(bodyMetrics.clientHeight);
});

test("task request runtime selections persist into the session workspace and survive refresh", async ({
  page,
  request,
}) => {
  const unique = Date.now();
  const agentId = `playwright-session-selection-${unique}`;
  const createAgentResponse = await request.post("/api/agents", {
    data: {
      id: agentId,
      name: `playwright-session-selection-${unique}`,
      defaultRuntime: "codex-cli",
    },
  });
  expect(createAgentResponse.ok()).toBeTruthy();

  await page.goto(`/agents/${agentId}`);
  await page.getByRole("button", { name: "작업 요청하기" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "실행 모델" }).click();
  await page.getByText("GPT-5.4 mini").last().click();
  await dialog.getByRole("combobox", { name: "추론 수준" }).click();
  await page.getByText("매우 높음").last().click();
  await dialog.getByRole("combobox", { name: "응답 속도" }).click();
  await page.getByText("Fast").last().click();
  await dialog.getByLabel("작업 요청 내용").fill("선택한 런타임 옵션 유지 테스트");
  await dialog.getByRole("button", { name: "작업 요청 시작" }).click();

  await expect(page).toHaveURL(new RegExp(`/agents/${agentId}/sessions/[^/]+$`), {
    timeout: 20_000,
  });
  const sessionId = page.url().split("/").pop();
  expect(sessionId).toBeTruthy();

  const sessionResponse = await request.get(`/api/sessions/${sessionId}`);
  expect(sessionResponse.ok()).toBeTruthy();
  const sessionRecord = await sessionResponse.json();

  expect(sessionRecord.runtimeConfig.model).toBe("gpt-5.4-mini");
  expect(sessionRecord.runtimeConfig.reasoningEffort).toBe("xhigh");
  expect(sessionRecord.runtimeConfig.serviceTier).toBe("fast");

  await expect(page.getByRole("button", { name: /GPT-5\.4 mini.*매우 높음.*Fast/ })).toBeVisible();

  await page.reload();

  await expect(page.getByRole("button", { name: /GPT-5\.4 mini.*매우 높음.*Fast/ })).toBeVisible();
});

test("session workspace keeps the last runtime selections across refresh", async ({
  page,
  request,
}) => {
  const unique = Date.now();
  const agentId = `playwright-sticky-session-${unique}`;
  const createAgentResponse = await request.post("/api/agents", {
    data: {
      id: agentId,
      name: `playwright-sticky-session-${unique}`,
      defaultRuntime: "codex-cli",
    },
  });
  expect(createAgentResponse.ok()).toBeTruthy();

  const createSessionResponse = await request.post(`/api/agents/${agentId}/sessions`, {
    data: {
      title: "sticky session test",
      runtimeKind: "codex-cli",
      model: "gpt-5.4-mini",
      reasoningEffort: "xhigh",
      serviceTier: "fast",
    },
  });
  expect(createSessionResponse.ok()).toBeTruthy();
  const createdSession = await createSessionResponse.json();

  await page.goto(`/agents/${agentId}/sessions/${createdSession.id}`);

  const modelSettingsButton = page.getByRole("button", {
    name: /GPT-5\.4 mini.*매우 높음.*Fast/,
  });
  await expect(modelSettingsButton).toBeVisible();
  await modelSettingsButton.click();

  const modelSelect = page.getByRole("combobox", { name: "모델" });
  const reasoningSelect = page.getByRole("combobox", { name: "추론 수준" });
  const serviceTierSelect = page.getByRole("combobox", { name: "응답 속도" });

  await expect(modelSelect).toContainText("GPT-5.4 mini");
  await expect(reasoningSelect).toContainText("매우 높음");
  await expect(serviceTierSelect).toContainText("Fast");

  await modelSelect.click();
  await page.getByText("GPT-5.4", { exact: true }).last().click();
  await reasoningSelect.click();
  await page.getByText("높음", { exact: true }).last().click();
  await serviceTierSelect.click();
  await page.getByText("기본", { exact: true }).last().click();

  await expect(modelSelect).toContainText("GPT-5.4");
  await expect(reasoningSelect).toContainText("높음");
  await expect(serviceTierSelect).toContainText("기본");

  await page.reload();

  await expect(page.getByRole("button", { name: /GPT-5\.4.*높음/ })).toBeVisible();
  await page.getByRole("button", { name: /GPT-5\.4.*높음/ }).click();
  await expect(page.getByRole("combobox", { name: "모델" })).toContainText("GPT-5.4");
  await expect(page.getByRole("combobox", { name: "추론 수준" })).toContainText("높음");
  await expect(page.getByRole("combobox", { name: "응답 속도" })).toContainText("기본");
});

test("single task dialog exposes save-and-run action", async ({ page, request }) => {
  const unique = Date.now();
  const agentId = `playwright-task-${unique}`;
  const createAgentResponse = await request.post("/api/agents", {
    data: {
      id: agentId,
      name: `playwright-task-${unique}`,
      defaultRuntime: "codex-cli",
    },
  });
  expect(createAgentResponse.ok()).toBeTruthy();

  await page.goto(`/agents/${agentId}`);
  await page.getByRole("tab", { name: "단일 작업" }).click();
  await page.getByRole("button", { name: "저장된 작업 만들기" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "단일 작업 저장" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "단일 작업 저장" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "저장 후 실행" })).toBeVisible();
});

test("agent detail opens preview from cards and keeps session navigation on the action rail", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });

  const unique = Date.now();
  const agentId = `playwright-detail-${unique}`;
  const titles = Array.from(
    { length: 14 },
    (_, index) => `preview request ${String(index + 1).padStart(2, "0")}`
  );

  const createAgentResponse = await request.post("/api/agents", {
    data: {
      id: agentId,
      name: `playwright-detail-${unique}`,
      defaultRuntime: "codex-cli",
    },
  });
  expect(createAgentResponse.ok()).toBeTruthy();

  for (const title of titles) {
    const createSessionResponse = await request.post(`/api/agents/${agentId}/sessions`, {
      data: {
        title,
        runtimeKind: "codex-cli",
      },
    });
    expect(createSessionResponse.ok()).toBeTruthy();
  }

  await page.goto(`/agents/${agentId}`);

  await expect(page.getByRole("tab", { name: "작업 요청" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "단일 작업" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "메신저 연동" })).toBeVisible();

  const pageHasVerticalScroll = await page.evaluate(() => {
    const scroller = document.scrollingElement;
    if (!scroller) {
      return false;
    }

    return scroller.scrollHeight > scroller.clientHeight + 2;
  });

  expect(pageHasVerticalScroll).toBeFalsy();

  const requestListMetrics = await page.getByTestId("agent-detail-request-list").evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return {
      overflowY: styles.overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    };
  });

  expect(["auto", "scroll"]).toContain(requestListMetrics.overflowY);
  expect(requestListMetrics.scrollHeight).toBeGreaterThan(requestListMetrics.clientHeight);

  const firstRequestCard = page
    .locator('[data-testid^="agent-request-card-"]')
    .filter({ hasText: titles[0] })
    .first();
  const firstRequestSessionTrigger = firstRequestCard.getByRole("button", {
    name: "작업 요청 세션 열기",
  });

  await firstRequestSessionTrigger.click();
  await expect(page).toHaveURL(new RegExp(`/agents/${agentId}/sessions/[^/]+$`));

  await page.goto(`/agents/${agentId}`);
  await firstRequestCard.click();
  await expect(page).toHaveURL(new RegExp(`/agents/${agentId}$`));
  await expect(page.getByTestId("agent-request-preview-stack")).toBeVisible();
  const firstPreview = page.getByTestId(/agent-request-preview-window-/).first();
  await expect(
    page.getByTestId("agent-request-preview-stack").getByText(titles[0], { exact: true })
  ).toBeVisible();
  await expect(firstPreview.getByText("응답")).toBeVisible();
  await expect(firstPreview.getByLabel("메시지 입력")).toBeVisible();
  await expect(firstPreview.getByRole("button", { name: "모델 설정" })).toBeVisible();
  await expect(firstPreview.getByRole("button", { name: "파일 추가" })).toBeVisible();
  await expect(firstPreview.getByRole("link", { name: "전체 작업 열기" })).toBeVisible();

  const composerSpacing = await firstPreview.evaluate((element) => {
    const textarea = element.querySelector('[aria-label="메시지 입력"]');
    const actions = element.querySelector('[data-testid="agent-request-preview-composer-actions"]');
    if (!(textarea instanceof HTMLElement) || !(actions instanceof HTMLElement)) {
      return null;
    }

    const textareaRect = textarea.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();

    return actionsRect.top - textareaRect.bottom;
  });
  expect(composerSpacing).not.toBeNull();
  expect(composerSpacing ?? Infinity).toBeLessThanOrEqual(24);

  await page.getByRole("tab", { name: "단일 작업" }).click();
  await expect(page.getByRole("heading", { name: "저장된 재사용 작업" })).toBeVisible();

  await page.getByRole("tab", { name: "메신저 연동" }).click();
  await expect(page.getByRole("heading", { name: "대화 채널 연결" })).toBeVisible();
});
