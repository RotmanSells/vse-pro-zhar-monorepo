import { expect, test } from "@playwright/test";

import { E2E_ADMIN_URL } from "./urls";
import { loginAdmin } from "./admin-auth";

test("Admin edits the complete server-owned Wheel settings snapshot", async ({ page }) => {
  await page.goto(E2E_ADMIN_URL, { waitUntil: "domcontentloaded" });
  await loginAdmin(page);
  await page.getByRole("button", { name: "Колесо фортуны", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Глобальные настройки", exact: false })).toBeVisible();
  await expect(page.getByLabel("Условие доступности")).toHaveText("Завершённый оплаченный заказ");

  const minimum = page.getByLabel("Минимальная сумма заказа");
  const cooldown = page.getByLabel("Cooldown");
  const maxSpins = page.getByLabel("Лимит вращений");
  const period = page.getByLabel("Период лимита");
  await minimum.fill("2000");
  await cooldown.fill("3600");
  await maxSpins.fill("2");
  await period.fill("172800");
  await page.getByRole("button", { name: "Сохранить настройки", exact: true }).click();
  await expect(page.getByText("Настройки сохранены.", { exact: false })).toBeVisible();
  await expect(minimum).toHaveValue("2000");
  await expect(cooldown).toHaveValue("3600");
  await expect(maxSpins).toHaveValue("2");
  await expect(period).toHaveValue("172800");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Колесо фортуны", exact: true }).click();
  await expect(page.getByLabel("Минимальная сумма заказа")).toHaveValue("2000");
  await expect(page.getByLabel("Cooldown")).toHaveValue("3600");
  await expect(page.getByLabel("Лимит вращений")).toHaveValue("2");
  await expect(page.getByLabel("Период лимита")).toHaveValue("172800");
  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: test.info().outputPath(`wheel-settings-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const touchViolations = await page.locator("button,[role='button'],[role='switch']").evaluateAll((elements) => elements.flatMap((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44) ? [{ width: Math.round(rect.width), height: Math.round(rect.height) }] : []; }));
    expect(touchViolations).toEqual([]);
  }

  await page.getByLabel("Минимальная сумма заказа").fill("1500");
  await page.getByLabel("Cooldown").fill("86400");
  await page.getByLabel("Лимит вращений").fill("1");
  await page.getByLabel("Период лимита").fill("86400");
  await page.getByRole("button", { name: "Сохранить настройки", exact: true }).click();
  await expect(page.getByText("Настройки сохранены.", { exact: false })).toBeVisible();
});
