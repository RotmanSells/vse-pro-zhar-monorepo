import { expect, test } from "@playwright/test";

import { loginAdmin } from "./admin-auth";
import { E2E_ADMIN_URL, E2E_API_URL } from "./urls";

test("Admin Dashboard is protected, server-backed and responsive", async ({ browser, request }, testInfo) => {
  expect((await request.get(`${E2E_API_URL}/admin/analytics?days=30`)).status()).toBe(401);
  const page = await browser.newPage();
  await page.goto(E2E_ADMIN_URL, { waitUntil: "domcontentloaded" });
  await loginAdmin(page);
  const initialAnalyticsResponse = page.waitForResponse((response) => response.url().includes("/admin/analytics?days=30") && response.status() === 200);
  await page.getByRole("button", { name: "Дашборд", exact: true }).click();
  const initialAnalyticsBody = await initialAnalyticsResponse.then((response) => response.json()) as { readonly revenueByDay: readonly { readonly revenueMinor: number }[] };
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(page.getByRole("heading", { name: "Дашборд", exact: true })).toBeVisible();
  await expect(page.getByText("Серверная аналитика по данным PostgreSQL")).toBeVisible();
  const hasRevenue = initialAnalyticsBody.revenueByDay.some((entry) => entry.revenueMinor > 0);
  if (hasRevenue) {
    await expect(page.getByRole("img", { name: "Выручка по дням" })).toBeVisible();
  } else {
    await expect(page.getByText("Нет данных за период").first()).toBeVisible();
  }

  const period = page.getByLabel("Период аналитики");
  for (const days of [7, 30, 90]) {
    const responsePromise = page.waitForResponse((response) => response.url().includes(`/admin/analytics?days=${days}`) && response.status() === 200);
    await period.selectOption(String(days));
    await responsePromise;
  }

  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(350);
    await expect(page.getByRole("heading", { name: "Дашборд", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`dashboard-${width}.png`), fullPage: false });
  }

  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole("button", { name: "Открыть меню" }).click();
  const sidebarBackdrop = page.locator(".sidebar-backdrop");
  await expect(sidebarBackdrop).toBeEnabled();
  await page.mouse.click(300, 450);
  await expect(sidebarBackdrop).toBeDisabled();

  await page.getByRole("button", { name: "Открыть меню" }).click();
  await page.keyboard.press("Escape");
  await expect(sidebarBackdrop).toBeDisabled();
  await page.close();
});
