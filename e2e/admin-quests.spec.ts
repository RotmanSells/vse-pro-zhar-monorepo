import { expect, test } from "@playwright/test";

import { loginAdmin } from "./admin-auth";
import { E2E_ADMIN_URL, E2E_API_URL } from "./urls";

test("Admin quest definitions use protected Backend mutations and stay responsive", async ({ browser, request }, testInfo) => {
  expect((await request.get(`${E2E_API_URL}/admin/loyalty/quests`)).status()).toBe(401);
  const page = await browser.newPage();
  await page.goto(E2E_ADMIN_URL, { waitUntil: "domcontentloaded" });
  await loginAdmin(page);
  const responsePromise = page.waitForResponse((response) => response.url().includes("/admin/loyalty/quests") && response.status() === 200);
  await page.getByRole("button", { name: "Квесты", exact: true }).click();
  await responsePromise;
  await expect(page.getByRole("heading", { level: 1, name: "Квесты", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Добавить квест" })).toBeVisible();
  await expect(page.getByText("first_order", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Добавить квест" }).click();
  const createDialog = page.getByRole("dialog", { name: "Новый квест" });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByLabel("Код")).toBeEditable();
  await expect(createDialog.getByLabel("Тип награды")).toHaveValue("xp");
  await page.getByRole("button", { name: "Отмена" }).click();

  await page.getByRole("button", { name: "Изменить квест first_order" }).click();
  const editDialog = page.getByRole("dialog", { name: "Редактировать квест" });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByLabel("Код")).toHaveValue("first_order");
  await expect(editDialog.getByLabel("Код")).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "Отмена" }).click();

  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.locator("button,[role='button'],[role='tab']").evaluateAll((elements) => elements.flatMap((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44) ? [{ width: Math.round(rect.width), height: Math.round(rect.height) }] : []; }))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`quests-${width}.png`), fullPage: false });
  }
  await page.close();
});
