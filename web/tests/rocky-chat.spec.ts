import { expect, test } from "@playwright/test";

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
