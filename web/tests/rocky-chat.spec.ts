import { expect, test } from "@playwright/test";

test("home keeps task requests inside one Rocky Core chat", async ({ page }) => {
  const nonce = Date.now().toString();
  const fileName = `nutrition-event-${nonce}.csv`;
  const userPrompt =
    `영양제 이벤트 엑셀을 상품명 기준으로 묶고 원가와 마진은 보호해서 정리해줘. 테스트 ${nonce}`;

  await page.goto("/");

  await expect(page.getByRole("button", { name: "일반" })).toBeVisible();
  await expect(page.getByRole("button", { name: "디버그" })).toBeVisible();
  await expect(page.getByRole("button", { name: "고급 관리" })).toBeVisible();

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
  await expect(page.getByText("영양제 MD 담당", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/반복 기준 후보/)).toHaveCount(0);
  await expect(page.getByText(/보호 항목/)).toHaveCount(0);
  await expect(page.getByText("작업 화면")).toHaveCount(0);
  await expect(page.getByText("확인 결과")).toHaveCount(0);
  await expect(page.getByText("세션 열기")).toHaveCount(0);

  await page.reload();

  await expect(page.getByText(userPrompt)).toBeVisible();
  await expect(page.getByRole("status").getByText("답변중")).toBeVisible();
  await expect(page.getByText("영양제 MD 담당", { exact: true })).toHaveCount(0);
  await expect(page.getByText("세션 열기")).toHaveCount(0);
});
