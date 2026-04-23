import { expect, test } from "@playwright/test";

test("debug mode reveals Rocky management routes and screen", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "고급 관리" })).toBeVisible();
  const advancedMenu = page.locator("#advanced-management-subtree");
  await expect(advancedMenu.getByRole("link", { name: "Rocky 관리" })).toHaveCount(0);

  await page.goto("/rocky/agent");

  await expect(
    page.getByRole("heading", { name: "Rocky 관리 화면은 디버그 모드에서만 표시합니다" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "고급 관리" })).toBeVisible();
  await expect(advancedMenu.getByRole("link", { name: "Rocky 관리" })).toHaveCount(0);

  await page.getByRole("button", { name: "디버그 모드로 보기" }).click();

  await expect(page.getByRole("button", { name: "고급 관리" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rocky 관리" })).toBeVisible();
  await expect(page.getByText("Rocky Core")).toBeVisible();
  await expect(page.getByText("메인 오케스트레이터")).toBeVisible();

  await expect(advancedMenu.getByRole("link", { name: "에이전트" })).toBeVisible();
  await expect(advancedMenu.getByRole("link", { name: "Rocky 관리" })).toBeVisible();
});
