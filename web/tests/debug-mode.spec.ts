import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("rocky.product-tour.v2.state", "completed");
  });
});

test("service page only exposes updater and default model settings", async ({ page }) => {
  await page.goto("/admin/rocky");

  await expect(
    page.getByRole("heading", { name: "Rocky Windows 업데이트" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "기본 모델" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Rocky Core" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "워크스페이스" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "세션" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "스킬" })).toHaveCount(0);
});
