import { expect, test } from "@playwright/test";

test("Rocky composer gives immediate feedback while submit is pending", async ({
  page,
}) => {
  const prompt = `immediate submit feedback ${Date.now()}`;
  const chatId = "rocky-submit-feedback-test";
  const now = new Date().toISOString();
  let releaseSendMessage: (() => void) | null = null;
  let markSendMessageStarted: (() => void) | null = null;
  const sendMessageStarted = new Promise<void>((resolve) => {
    markSendMessageStarted = resolve;
  });
  const sendMessageCanFinish = new Promise<void>((resolve) => {
    releaseSendMessage = resolve;
  });
  const chat = {
    id: chatId,
    title: "Submit feedback test",
    intent: "conversation",
    domain: "general",
    worker: null,
    attachments: [],
    messages: [],
    skillCandidates: [],
    dispatches: [],
    orchestration: null,
    executionStarted: false,
    createdAt: now,
    updatedAt: now,
  };
  const sentChat = {
    ...chat,
    messages: [
      {
        id: "message-1",
        chatId,
        role: "user",
        intent: "conversation",
        text: prompt,
        attachmentIds: [],
        domain: "general",
        workerId: null,
        skillCandidateIds: [],
        usedSkills: [],
        dispatchId: null,
        createdAt: now,
      },
    ],
  };

  await page.addInitScript(() => {
    window.localStorage.setItem("rocky.product-tour.v2.state", "completed");
  });
  await page.route(`**/api/rocky/chats/${chatId}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chat),
    });
  });
  await page.route(`**/api/rocky/chats/${chatId}/messages`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    markSendMessageStarted?.();
    await sendMessageCanFinish;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sentChat),
    });
  });

  await page.goto(`/tasks/${chatId}`);

  const composer = page
    .locator("form")
    .filter({ has: page.locator("textarea") })
    .last();
  const textarea = composer.locator("textarea");
  const submitButton = composer.locator('button[type="submit"]');

  await textarea.fill(prompt);
  await expect(submitButton).toBeEnabled();

  await submitButton.click();
  await sendMessageStarted;
  await expect(textarea).toHaveValue("");
  await expect(textarea).toBeDisabled();
  await expect(submitButton).toBeDisabled();
  await expect(submitButton.locator(".animate-spin")).toBeVisible();
  await expect(page.getByText(prompt)).toBeVisible();

  releaseSendMessage?.();
  await expect(page.getByText(prompt)).toBeVisible();
});

test("Rocky composer submits the current textarea value without waiting for a rerender", async ({
  page,
}) => {
  const prompt = `same tick submit ${Date.now()}`;
  const chatId = "rocky-same-tick-submit-test";
  const now = new Date().toISOString();
  let releaseSendMessage: (() => void) | null = null;
  let messagePosts = 0;
  let postedMessage: string | null = null;
  const sendMessageCanFinish = new Promise<void>((resolve) => {
    releaseSendMessage = resolve;
  });
  const chat = {
    id: chatId,
    title: "Same tick submit test",
    intent: "conversation",
    domain: "general",
    worker: null,
    attachments: [],
    messages: [],
    skillCandidates: [],
    dispatches: [],
    orchestration: null,
    executionStarted: false,
    createdAt: now,
    updatedAt: now,
  };
  const sentChat = {
    ...chat,
    messages: [
      {
        id: "message-1",
        chatId,
        role: "user",
        intent: "conversation",
        text: prompt,
        attachmentIds: [],
        domain: "general",
        workerId: null,
        skillCandidateIds: [],
        usedSkills: [],
        dispatchId: null,
        createdAt: now,
      },
    ],
  };

  await page.addInitScript(() => {
    window.localStorage.setItem("rocky.product-tour.v2.state", "completed");
  });
  await page.route(`**/api/rocky/chats/${chatId}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chat),
    });
  });
  await page.route(`**/api/rocky/chats/${chatId}/messages`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    messagePosts += 1;
    postedMessage = (await route.request().postDataJSON()).message;
    await sendMessageCanFinish;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sentChat),
    });
  });

  await page.goto(`/tasks/${chatId}`);

  const composer = page
    .locator("form")
    .filter({ has: page.locator("textarea") })
    .last();
  const textarea = composer.locator("textarea");

  await textarea.evaluate((node, value) => {
    const textareaNode = node as HTMLTextAreaElement;
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    valueSetter?.call(textareaNode, value);
    textareaNode.dispatchEvent(new Event("input", { bubbles: true }));
    textareaNode.form?.requestSubmit();
  }, prompt);
  await expect.poll(() => messagePosts).toBe(1);
  expect(postedMessage).toBe(prompt);
  await expect(textarea).toHaveValue("");
  await expect(textarea).toBeDisabled();
  await expect(page.getByText(prompt)).toBeVisible();

  releaseSendMessage?.();
  await expect(page.getByText(prompt)).toBeVisible();
});

test("Rocky composer ignores Enter while IME composition is active", async ({
  page,
}) => {
  const prompt = `ime composing enter ${Date.now()}`;
  const chatId = "rocky-ime-composition-test";
  const now = new Date().toISOString();
  let messagePosts = 0;
  const chat = {
    id: chatId,
    title: "IME composition test",
    intent: "conversation",
    domain: "general",
    worker: null,
    attachments: [],
    messages: [],
    skillCandidates: [],
    dispatches: [],
    orchestration: null,
    executionStarted: false,
    createdAt: now,
    updatedAt: now,
  };
  const sentChat = {
    ...chat,
    messages: [
      {
        id: "message-1",
        chatId,
        role: "user",
        intent: "conversation",
        text: prompt,
        attachmentIds: [],
        domain: "general",
        workerId: null,
        skillCandidateIds: [],
        usedSkills: [],
        dispatchId: null,
        createdAt: now,
      },
    ],
  };

  await page.addInitScript(() => {
    window.localStorage.setItem("rocky.product-tour.v2.state", "completed");
  });
  await page.route(`**/api/rocky/chats/${chatId}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chat),
    });
  });
  await page.route(`**/api/rocky/chats/${chatId}/messages`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    messagePosts += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sentChat),
    });
  });

  await page.goto(`/tasks/${chatId}`);

  const composer = page
    .locator("form")
    .filter({ has: page.locator("textarea") })
    .last();
  const textarea = composer.locator("textarea");

  await textarea.fill(prompt);
  await textarea.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true,
    isComposing: true,
  });
  await page.waitForTimeout(200);
  expect(messagePosts).toBe(0);
  await expect(textarea).toHaveValue(prompt);

  await textarea.press("Enter");
  await expect.poll(() => messagePosts).toBe(1);
});

test("agent task composer gives immediate feedback while task creation is pending", async ({
  page,
  request,
}) => {
  const unique = Date.now();
  const agentId = `submit-feedback-agent-${unique}`;
  const agentName = `Submit Feedback Agent ${unique}`;
  const prompt = `start task immediately ${unique}`;
  const chatId = `submit-feedback-chat-${unique}`;
  const now = new Date().toISOString();
  let releaseCreateChat: (() => void) | null = null;
  let markCreateChatStarted: (() => void) | null = null;
  const createChatStarted = new Promise<void>((resolve) => {
    markCreateChatStarted = resolve;
  });
  const createChatCanFinish = new Promise<void>((resolve) => {
    releaseCreateChat = resolve;
  });
  const chat = {
    id: chatId,
    title: "Submit feedback task",
    intent: "conversation",
    domain: "general",
    worker: { agentId, sessionId: null },
    attachments: [],
    messages: [
      {
        id: "message-1",
        chatId,
        role: "user",
        intent: "conversation",
        text: prompt,
        attachmentIds: [],
        domain: "general",
        workerId: agentId,
        skillCandidateIds: [],
        usedSkills: [],
        dispatchId: null,
        createdAt: now,
      },
    ],
    skillCandidates: [],
    dispatches: [],
    orchestration: null,
    executionStarted: false,
    createdAt: now,
    updatedAt: now,
  };

  const createAgentResponse = await request.post("/api/agents", {
    data: {
      id: agentId,
      name: agentName,
      defaultRuntime: "codex-cli",
    },
  });
  expect(createAgentResponse.ok()).toBeTruthy();

  await page.addInitScript(() => {
    window.localStorage.setItem("rocky.product-tour.v2.state", "completed");
    window.localStorage.setItem("rocky.mini-tour.v1.task-composer", "fired");
  });
  await page.route("**/api/rocky/chats", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    markCreateChatStarted?.();
    await createChatCanFinish;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chat),
    });
  });
  await page.route(`**/api/rocky/chats/${chatId}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(chat),
    });
  });

  await page.goto(`/agents/${agentId}`);

  const composer = page
    .locator("form")
    .filter({ has: page.locator("textarea") })
    .last();
  const textarea = composer.locator("textarea");
  const submitButton = composer.getByRole("button", { name: "실행하기" });

  await textarea.fill(prompt);
  await expect(submitButton).toBeEnabled();

  await submitButton.click();
  await createChatStarted;
  await expect(textarea).toHaveValue("");
  await expect(textarea).toBeDisabled();
  await expect(submitButton).toBeDisabled();
  await expect(submitButton.locator(".animate-spin")).toBeVisible();

  releaseCreateChat?.();
  await expect(page).toHaveURL(new RegExp(`/tasks/${chatId}$`));
});
