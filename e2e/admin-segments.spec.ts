import { expect, test } from "@playwright/test";

import { loginAdmin } from "./admin-auth";
import { E2E_ADMIN_URL, E2E_API_URL } from "./urls";

test("Admin Segments is protected, server-backed and responsive", async ({ browser, request }, testInfo) => {
  expect((await request.get(`${E2E_API_URL}/admin/segments`)).status()).toBe(401);
  const page = await browser.newPage();
  await page.goto(E2E_ADMIN_URL, { waitUntil: "domcontentloaded" });
  await loginAdmin(page);
  await page.getByRole("button", { name: "Сегменты", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Сегменты клиентов", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "📊 Готовые сегменты", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Открыть сегмент/u })).toHaveCount(9);
  await expect(page.getByText("Пользовательские сегменты пока недоступны")).toBeVisible();

  await page.getByRole("button", { name: "Открыть сегмент «Постоянные»" }).click();
  await expect(page.getByRole("heading", { name: /Постоянные/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "✈ Написать сегменту" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "⇩ Экспорт CSV" })).toBeDisabled();
  const emptySegment = page.getByText("Нет клиентов в этом сегменте");
  if (await emptySegment.count() === 0) {
    await expect(page.locator(".segment-detail-card tbody tr").first()).toBeVisible();
  }

  await page.getByRole("button", { name: "＋ Создать сегмент" }).click();
  const createDialog = page.getByRole("dialog");
  await expect(createDialog).toContainText("Создание пока недоступно");
  await expect(createDialog.getByRole("button", { name: "Создать" })).toBeDisabled();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.keyboard.press("Escape");
  await expect(createDialog).toBeHidden();

  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`segments-${width}.png`), fullPage: false });
  }
  await page.close();
});
