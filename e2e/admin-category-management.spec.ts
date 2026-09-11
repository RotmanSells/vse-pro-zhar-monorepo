import { expect, test } from "@playwright/test";

import { loginAdmin } from "./admin-auth";
import { E2E_ADMIN_URL, E2E_API_URL } from "./urls";

test("Admin manages categories through the protected Backend contract", async ({ browser, request }) => {
  expect((await request.get(`${E2E_API_URL}/admin/categories`)).status()).toBe(401);

  const page = await browser.newPage();
  await page.goto(E2E_ADMIN_URL, { waitUntil: "domcontentloaded" });
  await loginAdmin(page);
  await expect(page.getByRole("heading", { name: /Категории меню/u })).toBeVisible();

  const suffix = Date.now();
  const slug = `e2e-category-${suffix}`;
  await page.getByRole("button", { name: "Добавить категорию" }).click();
  const dialog = page.getByRole("dialog", { name: "Новая категория" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Название").fill(`E2E категория ${suffix}`);
  await dialog.getByLabel("Slug").fill(slug);
  await dialog.getByLabel("Порядок").fill("9000");
  await dialog.getByRole("button", { name: "Сохранить" }).click();

  const row = page.getByRole("row", { name: new RegExp(slug, "u") });
  await expect(row).toContainText("В меню");
  await row.getByRole("button", { name: `Редактировать категорию E2E категория ${suffix}` }).click();
  const editDialog = page.getByRole("dialog", { name: "Редактировать категорию" });
  await expect(editDialog.getByLabel("Slug")).toBeDisabled();
  await editDialog.getByLabel("Название").fill(`E2E категория обновлена ${suffix}`);
  await editDialog.getByRole("button", { name: "Сохранить" }).click();

  const updatedRow = page.getByRole("row", { name: new RegExp(slug, "u") });
  await expect(updatedRow).toContainText("E2E категория обновлена");
  await updatedRow.getByRole("button", { name: `Скрыть категорию E2E категория обновлена ${suffix}` }).click();
  await expect(updatedRow).toContainText("Скрыта");
  await updatedRow.getByRole("button", { name: `Вернуть категорию E2E категория обновлена ${suffix}` }).click();
  await expect(updatedRow).toContainText("В меню");

  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.locator("button,[role='button'],[role='tab']").evaluateAll((elements) => elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)
        ? [{ width: Math.round(rect.width), height: Math.round(rect.height) }]
        : [];
    }))).toEqual([]);
  }
  await page.close();
});
