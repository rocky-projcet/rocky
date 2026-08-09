import { expect, test, type Locator, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("rocky.product-tour.v2.state", "completed");
    window.localStorage.setItem("rocky.locale", "ko");
  });
});

async function expectMenuBelowHeader(page: Page, trigger: Locator) {
  const header = trigger.locator("xpath=ancestor::header[1]");
  const popup = page.locator('[data-slot="select-content"]');
  const [headerBox, triggerBox, viewport] = await Promise.all([
    header.boundingBox(),
    trigger.boundingBox(),
    page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
  ]);

  expect(headerBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();

  const minimumTop = Math.max(
    triggerBox!.y + triggerBox!.height,
    headerBox!.y + headerBox!.height,
  );
  await expect
    .poll(async () => (await popup.boundingBox())?.y ?? -1)
    .toBeGreaterThanOrEqual(minimumTop);

  const popupBox = await popup.boundingBox();
  expect(popupBox).not.toBeNull();

  expect(popupBox!.x).toBeGreaterThanOrEqual(0);
  expect(popupBox!.y).toBeGreaterThanOrEqual(0);
  expect(popupBox!.x + popupBox!.width).toBeLessThanOrEqual(viewport.width);
  expect(popupBox!.y + popupBox!.height).toBeLessThanOrEqual(viewport.height);
}

test("locale menu stays below the header after repeated locale changes", async ({ page }) => {
  await page.goto("/");
  const trigger = page.locator("header").getByRole("combobox");

  for (const option of ["English", "Korean", "English"]) {
    await trigger.click();
    await expectMenuBelowHeader(page, trigger);
    await page.getByRole("option", { name: option, exact: true }).click();
  }

  await trigger.click();
  await expectMenuBelowHeader(page, trigger);
});
