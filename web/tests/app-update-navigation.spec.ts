import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("rocky.product-tour.v2.state", "completed");
  });
});

test("sidebar service entry opens the Rocky Windows updater", async ({ page }) => {
  await page.goto("/");

  const serviceLink = page.getByRole("link", { name: "서비스", exact: true });
  await expect(serviceLink).toBeVisible();
  await serviceLink.click();

  await expect(page).toHaveURL(/\/admin\/rocky$/);
  const updateHeading = page.getByRole("heading", {
    name: "Rocky Windows 업데이트",
  });
  await expect(updateHeading).toBeVisible();
  await expect(updateHeading).toBeInViewport();
  await expect(page.getByRole("button", { name: "업데이트 확인" })).toBeVisible();
});
