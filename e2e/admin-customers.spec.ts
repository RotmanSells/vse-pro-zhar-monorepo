import { expect, test } from "@playwright/test";

import { loginAdmin } from "./admin-auth";
import { E2E_ADMIN_URL, E2E_API_URL } from "./urls";

test("Admin Customers is protected, masked and responsive", async ({ browser, request }, testInfo) => {
  expect((await request.get(`${E2E_API_URL}/admin/customers`)).status()).toBe(401);
  const page = await browser.newPage();
  await page.goto(E2E_ADMIN_URL, { waitUntil: "domcontentloaded" });
  await loginAdmin(page);
  const responsePromise = page.waitForResponse((response) => response.url().includes("/admin/customers") && response.status() === 200);
  await page.getByRole("button", { name: "Клиенты", exact: true }).click();
  await responsePromise;
  await expect(page.getByRole("heading", { name: "Клиенты", exact: true })).toBeVisible();
  await expect(page.getByLabel("Поиск клиента")).toBeVisible();
  await expect(page.getByLabel("Номер телефона для Push")).toBeVisible();
  await expect(page.getByLabel("Заголовок Push")).toBeVisible();
  await expect(page.getByLabel("Текст Push")).toBeVisible();
  await expect(page.getByRole("button", { name: "Отправить Push" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Экспорт/ })).toBeDisabled();

  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`customers-${width}.png`), fullPage: false });
  }
  await page.close();
});
