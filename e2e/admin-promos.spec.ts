import { expect, test } from "@playwright/test";

import { loginAdmin } from "./admin-auth";
import { E2E_ADMIN_URL, E2E_API_URL } from "./urls";

test("Admin Promos is protected, server-backed and responsive", async ({ browser, request }, testInfo) => {
  expect((await request.get(`${E2E_API_URL}/admin/promos`)).status()).toBe(401);
  const page = await browser.newPage();
  await page.goto(E2E_ADMIN_URL, { waitUntil: "domcontentloaded" });
  await loginAdmin(page);
  const responsePromise = page.waitForResponse((response) => response.url().includes("/admin/promos") && response.status() === 200);
  await page.getByRole("button", { name: "Промокоды", exact: true }).click();
  await responsePromise;
  await expect(page.getByRole("heading", { level: 1, name: "Промокоды", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Создать промокод" })).toBeVisible();
  const tableHeader = page.getByRole("columnheader", { name: "Код" });
  if (await tableHeader.count() === 0) await expect(page.getByText("Промокодов пока нет")).toBeVisible();
  await page.getByRole("button", { name: "Создать промокод" }).click();
  await expect(page.getByRole("dialog", { name: "Новый промокод" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Новый промокод" }).getByRole("textbox", { name: "Код" })).toBeVisible();
  await page.getByRole("button", { name: "Отмена" }).click();

  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`promos-${width}.png`), fullPage: false });
  }
  await page.close();
});
