# Locale Dropdown Position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the header locale menu below its trigger and inside the viewport after repeated Korean and English locale changes.

**Architecture:** Preserve the shared Select defaults and opt only the locale switcher out of Base UI's item-aligned popup mode. Protect the user-visible geometry with a Playwright regression test that exercises real locale transitions in the running application.

**Tech Stack:** React 19, TypeScript, Base UI Select, Playwright

## Global Constraints

- Do not change the shared `SelectContent` default.
- Do not change locale labels, trigger width, header layout, locale persistence, or static DOM translation.
- Keep Base UI's regular bottom positioning, right alignment, and collision handling, with an 8-pixel locale-menu offset that clears the header boundary.

---

### Task 1: Anchor the Locale Menu Below Its Trigger

**Files:**
- Create: `web/tests/locale-switcher-position.spec.ts`
- Modify: `web/src/shared/components/locale-switcher.tsx`

**Interfaces:**
- Consumes: `LocaleSwitcher`, `I18nProvider`, and Base UI `SelectContent`'s `alignItemWithTrigger?: boolean` positioner prop.
- Produces: Locale menu geometry where `popup.top >= trigger.bottom`, `popup.top >= header.bottom`, and every popup edge remains within the viewport after locale changes.

- [x] **Step 1: Write the failing browser regression test**

```typescript
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
```

- [x] **Step 2: Run the focused test and verify the current item-aligned popup fails the geometry assertion**

Run: `npm --prefix web run test:e2e -- locale-switcher-position.spec.ts`

Expected: FAIL because the popup top is above the trigger bottom and overlaps the header.

- [x] **Step 3: Opt the locale menu out of item-aligned positioning**

```tsx
<SelectContent
  align="end"
  alignItemWithTrigger={false}
  className="rounded-2xl"
  sideOffset={8}
>
```

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npm --prefix web run test:e2e -- locale-switcher-position.spec.ts`

Expected: PASS.

- [x] **Step 5: Run build and repository regression checks**

Run: `npm run web:build`

Expected: TypeScript and Vite build complete successfully.

Run: `npm test`

Expected: 351 or more tests pass with zero failures.

- [x] **Step 6: Commit the implementation**

```bash
git add web/tests/locale-switcher-position.spec.ts web/src/shared/components/locale-switcher.tsx docs/superpowers/specs/2026-08-09-locale-dropdown-position-design.md docs/superpowers/plans/2026-08-09-locale-dropdown-position.md
git commit -m "fix: keep locale dropdown below header (#130)"
```
