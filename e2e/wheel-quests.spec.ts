import { expect, test } from "@playwright/test";

import { E2E_ADMIN_URL, E2E_CUSTOMER_URL } from "./urls";
import { loginAdmin } from "./admin-auth";

test("Customer opens server-owned Wheel without demo mode or client rewards", async ({ page }) => {
  await page.goto(E2E_CUSTOMER_URL, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Сезон гриля открыт!")).toBeVisible();
  await page.getByRole("tab", { name: "Рулетка" }).click();
  const dialog = page.getByTestId("customer-identify-modal");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Номер телефона").fill("8 (999) 555-14-01");
  await dialog.getByRole("button", { name: "Открыть рулетку" }).click();
  await expect(page.getByText("🎡 Поймай искру", { exact: true })).toBeVisible();
  await expect(page.getByText(/Сделайте заказ от/u)).toBeVisible();
  await expect(page.getByText(/Демо/u)).toHaveCount(0);
  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await page.screenshot({ path: test.info().outputPath(`wheel-customer-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("Admin manages only Wheel and Quest definitions", async ({ page }) => {
  await page.goto(E2E_ADMIN_URL, { waitUntil: "domcontentloaded" });
  await loginAdmin(page);
  await page.getByRole("button", { name: "Колесо фортуны", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Колесо фортуны", exact: true })).toBeVisible();
  await expect(page.getByText("Награды и веса настраивает Admin. Backend принимает максимум 6 definitions.")).toBeVisible();
  await expect(page.getByText("1 spin / 24 часа", { exact: true })).toBeVisible();
  await expect(page.getByText("1 500 ₽", { exact: true })).toBeVisible();
  const prizeRow = page.locator("tr").filter({ hasText: "no_prize" });
  await expect(prizeRow).toBeVisible();
  await expect(page.getByLabel("Вес no_prize")).toHaveValue("50");
  await page.getByLabel("Тип no_prize").selectOption("xp");
  await page.getByLabel("Значение no_prize").fill("111");
  await page.getByLabel("Название no_prize").fill("Искра рядом QA");
  const firstPrizeUpdate = page.waitForResponse((response) => response.url().includes("/admin/loyalty/wheel/prizes/") && response.request().method() === "PATCH");
  await prizeRow.getByRole("button", { name: "Сохранить", exact: true }).click();
  const firstPrizeResponse = await firstPrizeUpdate;
  if (!firstPrizeResponse.ok()) throw new Error(`First Wheel prize update failed: ${firstPrizeResponse.status()} ${await firstPrizeResponse.text()}`);
  await expect(page.getByLabel("Тип no_prize")).toHaveValue("xp");
  await expect(page.getByLabel("Значение no_prize")).toHaveValue("111");
  await expect(page.getByLabel("Название no_prize")).toHaveValue("Искра рядом QA");
  await page.getByLabel("Тип no_prize").selectOption("no_prize");
  await page.getByLabel("Значение no_prize").fill("0");
  await page.getByLabel("Название no_prize").fill("Искра рядом");
  const secondPrizeUpdate = page.waitForResponse((response) => response.url().includes("/admin/loyalty/wheel/prizes/") && response.request().method() === "PATCH");
  await prizeRow.getByRole("button", { name: "Сохранить", exact: true }).click();
  const secondPrizeResponse = await secondPrizeUpdate;
  const secondPrizeResponseBody = await secondPrizeResponse.text();
  if (!secondPrizeResponse.ok()) throw new Error(`Second Wheel prize update failed: ${secondPrizeResponse.status()} ${secondPrizeResponseBody}`);
  await expect(page.getByLabel("Тип no_prize")).toHaveValue("no_prize");
  await expect(page.getByLabel("Значение no_prize")).toHaveValue("0");
  await expect(page.getByLabel("Название no_prize")).toHaveValue("Искра рядом");
  await page.getByRole("button", { name: "Квесты", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Квесты", exact: true })).toBeVisible();
  await expect(page.getByText("first_order")).toBeVisible();
  await expect(page.getByText("Прогресс и claims создаются только processor-ом")).toBeVisible();
  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await page.screenshot({ path: test.info().outputPath(`quests-admin-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const touchViolations = await page.locator("button,[role='button'],[role='tab']").evaluateAll((elements) => elements.flatMap((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44) ? [{ width: Math.round(rect.width), height: Math.round(rect.height) }] : []; }));
    expect(touchViolations).toEqual([]);
  }
});
