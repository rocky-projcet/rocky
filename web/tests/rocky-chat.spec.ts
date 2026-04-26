import { expect, test } from "@playwright/test";

test("home keeps task requests inside one Rocky Core chat", async ({ page, request }) => {
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

  await expect(page.getByRole("button", { name: "일반" })).toBeVisible();
  await expect(page.getByRole("button", { name: "디버그" })).toBeVisible();
  await expect(page.getByRole("button", { name: "고급 관리" })).toBeVisible();
  await expect(page.getByRole("button", { name: /PPT 능력/ })).toBeVisible();
  await page.getByRole("button", { name: /PPT 능력/ }).click();
  await expect(page.getByText("PPT 능력 사용법")).toBeVisible();
  await expect(page.getByText("PPT 능력을 어떻게 쓰면 되는지 알려줘")).toHaveCount(0);

  const guideChatsResponse = await request.get("/api/rocky/chats");
  expect(guideChatsResponse.ok()).toBeTruthy();
  const guideChats = await guideChatsResponse.json();
  const guideChat = guideChats.find((candidate: { title?: string }) =>
    candidate.title === "PPT 능력"
  );
  expect(guideChat).toBeTruthy();

  await page.getByRole("button", { name: "대화 정리" }).click();
  await request.delete(`/api/rocky/chats/${guideChat.id}`);

  await page.getByLabel("자료 파일 선택").setInputFiles({
    name: `deck-${nonce}.pptx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from("pptx-placeholder"),
  });
  await expect(
    page.getByRole("button", { name: /^(시작하기|보내기)$/ })
  ).toBeEnabled();
  await page
    .getByRole("button", { name: /^(시작하기|보내기)$/ })
    .click();
  await expect(page.getByText("Please review the attached file.")).toBeVisible();

  const attachmentOnlyChatsResponse = await request.get("/api/rocky/chats");
  expect(attachmentOnlyChatsResponse.ok()).toBeTruthy();
  const attachmentOnlyChats = await attachmentOnlyChatsResponse.json();
  const attachmentOnlyChat = attachmentOnlyChats.find(
    (candidate: {
      attachments?: Array<{ workspacePath?: string | null }>;
      messages?: Array<{ text?: string }>;
    }) =>
      candidate.messages?.some(
        (message) => message.text === "Please review the attached file."
      )
  );
  expect(attachmentOnlyChat).toBeTruthy();
  expect(attachmentOnlyChat.attachments?.[0]?.workspacePath).toMatch(
    /^uploads\/rocky\//
  );

  await page.getByRole("button", { name: "대화 정리" }).click();
  await request.delete(`/api/rocky/chats/${attachmentOnlyChat.id}`);

  await page.getByRole("button", { name: "고급 관리" }).click();
  const advancedMenu = page.locator("#advanced-management-subtree");
  await expect(advancedMenu.getByRole("link", { name: "에이전트" })).toBeVisible();
  await expect(advancedMenu.getByRole("link", { name: "보관함" })).toBeVisible();
  await expect(advancedMenu.getByRole("link", { name: "Rocky 관리" })).toHaveCount(0);
  await expect(page.getByText("AI", { exact: true })).toHaveCount(0);

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

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(userPrompt)).toBeVisible();
  await expect(page.getByRole("status").getByText("답변중")).toBeVisible();
  await expect(page.getByRole("status").getByText(/^현재 /)).toBeVisible();
  await expect(page.getByText("최근 진행 내용")).toHaveCount(0);
  await expect(page.getByText("영양제 MD 담당", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/반복 기준 후보/)).toHaveCount(0);
  await expect(page.getByText(/보호 항목/)).toHaveCount(0);
  await expect(page.getByText("작업 화면")).toHaveCount(0);
  await expect(page.getByText("확인 결과")).toHaveCount(0);
  await expect(page.getByText("세션 열기")).toHaveCount(0);

  await page.reload();

  await expect(page.getByText(userPrompt)).toBeVisible();
  await expect(page.getByRole("status").getByText("답변중")).toBeVisible();
  await expect(page.getByRole("status").getByText(/^현재 /)).toBeVisible();
  await expect(page.getByText("최근 진행 내용")).toHaveCount(0);
  await expect(page.getByText("영양제 MD 담당", { exact: true })).toHaveCount(0);
  await expect(page.getByText("세션 열기")).toHaveCount(0);

  const chatsResponse = await request.get("/api/rocky/chats");
  expect(chatsResponse.ok()).toBeTruthy();
  const chats = await chatsResponse.json();
  const createdChat = chats.find((candidate: { messages?: Array<{ text?: string }> }) =>
    candidate.messages?.some((message) => message.text === userPrompt)
  );
  expect(createdChat).toBeTruthy();

  await page.getByRole("button", { name: "대화 정리" }).click();
  await expect(page.getByRole("heading", { name: "무엇을 도와드릴까요?" })).toBeVisible();
  await expect(page.getByText(userPrompt)).toHaveCount(0);

  const afterClearResponse = await request.get("/api/rocky/chats");
  expect(afterClearResponse.ok()).toBeTruthy();
  const chatsAfterClear = await afterClearResponse.json();
  expect(
    chatsAfterClear.some((candidate: { id?: string }) => candidate.id === createdChat.id)
  ).toBe(true);

  await page.getByRole("button", { name: "이전 대화" }).click();
  const historyDialog = page.getByRole("dialog", { name: "이전 대화" });
  await expect(historyDialog).toBeVisible();
  await expect(historyDialog.getByTestId(`previous-chat-delete-${createdChat.id}`)).toBeVisible();

  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await historyDialog
    .getByTestId(`previous-chat-delete-${createdChat.id}`)
    .click();

  await expect
    .poll(async () => {
      const refreshedResponse = await request.get("/api/rocky/chats");
      const refreshedChats = await refreshedResponse.json();
      return refreshedChats.some((candidate: { id?: string }) => candidate.id === createdChat.id);
    }, { timeout: 20_000 })
    .toBe(false);
});
