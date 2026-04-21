import { expect, test } from "@playwright/test";

test("home keeps the nutrition MD request inside one Rocky chat", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "무엇을 도와드릴까요?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rocky" })).toHaveCount(0);
  await expect(page.getByText("에이전트")).toHaveCount(0);
  await expect(page.getByText("AI", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "고급 관리" }).click();
  await page.getByRole("link", { name: "에이전트" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await page.getByRole("link", { name: "홈" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.getByLabel("자료 파일 선택").setInputFiles({
    name: "nutrition-event.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("event,product,revenue,cost\nspring,milk thistle,100,40"),
  });
  await expect(page.getByText("nutrition-event.csv")).toBeVisible();

  await page
    .getByLabel("Rocky에게 말하기")
    .fill("영양제 이벤트 엑셀을 상품명 기준으로 묶고 원가와 마진은 보호해서 정리해줘.");
  await page.getByRole("button", { name: "시작하기" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("영양제 MD 자료로 보고 정리할게요.")).toBeVisible();
  await expect(page.getByText("영양제 MD 담당", { exact: true })).toBeVisible();
  await expect(page.getByText(/반복 기준 후보/)).toBeVisible();
  await expect(page.getByText(/보호 항목/)).toBeVisible();
  await expect(page.getByText("작업 화면")).toHaveCount(0);
  await expect(page.getByText("확인 결과")).toHaveCount(0);

  await page.getByText("반복해서 쓸 기준 후보", { exact: true }).click();
  await expect(page.getByText("상품명 표기 묶기")).toBeVisible();
  await expect(page.getByText("민감 자료 보호")).toBeVisible();
});
