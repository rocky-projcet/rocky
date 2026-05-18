import { expect, test, type APIRequestContext } from "@playwright/test";

function runRecord(input: {
  agentId: string;
  prompt: string;
  runId: string;
  sessionId: string;
}) {
  const now = new Date().toISOString();

  return {
    id: input.runId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    runtimeRunId: null,
    triggerType: "manual",
    status: "completed",
    runtimeKind: "codex-cli",
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    prompt: input.prompt,
    startedAt: now,
    endedAt: now,
    summary: null,
    runtimeSessionId: null,
    outputLastMessagePath: null,
    resultPath: `runs/${input.runId}/result.json`,
    eventsPath: `runs/${input.runId}/events.jsonl`,
    artifactsDir: `runs/${input.runId}/artifacts`,
  };
}

async function createSessionFixture(
  request: APIRequestContext,
  suffix: string
) {
  const agentId = `session-submit-feedback-agent-${suffix}`;
  const createAgentResponse = await request.post("/api/agents", {
    data: {
      id: agentId,
      name: `Session Submit Feedback Agent ${suffix}`,
      defaultRuntime: "codex-cli",
    },
  });
  expect(createAgentResponse.ok()).toBeTruthy();

  const createSessionResponse = await request.post(`/api/agents/${agentId}/sessions`, {
    data: {
      title: `session submit feedback ${suffix}`,
      runtimeKind: "codex-cli",
    },
  });
  expect(createSessionResponse.ok()).toBeTruthy();

  return {
    agentId,
    session: await createSessionResponse.json(),
  };
}

test("session workspace composer gives immediate feedback while send is pending", async ({
  page,
  request,
}) => {
  const suffix = Date.now().toString();
  const prompt = `session immediate submit feedback ${suffix}`;
  const { agentId, session } = await createSessionFixture(request, suffix);
  const runId = `session-submit-feedback-run-${suffix}`;
  let releaseSendMessage: (() => void) | null = null;
  let markSendMessageStarted: (() => void) | null = null;
  let markSendMessageFinished: (() => void) | null = null;
  let postedPrompt: string | null = null;
  const sendMessageStarted = new Promise<void>((resolve) => {
    markSendMessageStarted = resolve;
  });
  const sendMessageCanFinish = new Promise<void>((resolve) => {
    releaseSendMessage = resolve;
  });
  const sendMessageFinished = new Promise<void>((resolve) => {
    markSendMessageFinished = resolve;
  });

  await page.route(`**/api/sessions/${session.id}/messages`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    postedPrompt = (await route.request().postDataJSON()).prompt;
    markSendMessageStarted?.();
    await sendMessageCanFinish;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify(runRecord({ agentId, prompt, runId, sessionId: session.id })),
    });
    markSendMessageFinished?.();
  });

  await page.goto(`/agents/${agentId}/sessions/${session.id}`);

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
  expect(postedPrompt).toBe(prompt);
  await expect(textarea).toHaveValue("");
  await expect(textarea).toBeDisabled();
  await expect(submitButton).toBeDisabled();
  await expect(submitButton.locator(".animate-spin")).toBeVisible();
  await expect(page.getByText(prompt)).toBeVisible();

  releaseSendMessage?.();
  await sendMessageFinished;
});

test("session workspace composer restores draft and files when send fails", async ({
  page,
  request,
}) => {
  const suffix = Date.now().toString();
  const prompt = `session restore failed submit ${suffix}`;
  const fileName = `feedback-${suffix}.txt`;
  const { agentId, session } = await createSessionFixture(request, suffix);
  let messagePosts = 0;

  await page.route(`**/api/sessions/${session.id}/messages`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    messagePosts += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "forced submit failure" }),
    });
  });

  await page.goto(`/agents/${agentId}/sessions/${session.id}`);

  const composer = page
    .locator("form")
    .filter({ has: page.locator("textarea") })
    .last();
  const textarea = composer.locator("textarea");
  const submitButton = composer.locator('button[type="submit"]');

  await composer.getByTestId("compact-file-attachment-input").setInputFiles({
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from("restore me"),
  });
  await expect(composer.getByText(fileName)).toBeVisible();
  await textarea.fill(prompt);

  await submitButton.click();
  await expect.poll(() => messagePosts).toBe(1);
  await expect(textarea).toHaveValue(prompt);
  await expect(composer.getByText(fileName)).toBeVisible();
  await expect(submitButton).toBeEnabled();
});
