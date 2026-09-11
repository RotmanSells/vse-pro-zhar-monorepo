import { expect, test } from "@playwright/test";

import { loginAdmin } from "./admin-auth";
import { E2E_ADMIN_URL } from "./urls";

test("Admin unified shell reaches every implemented section without overflow", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(E2E_ADMIN_URL, { waitUntil: "domcontentloaded" });
  await loginAdmin(page);

  const sections = [
    { nav: "Дашборд", heading: "Дашборд" },
    { nav: "Заказы", heading: "Заказы" },
    { nav: "Меню", heading: "Меню" },
    { nav: "Лояльность", heading: "Лояльность" },
    { nav: "Промокоды", heading: "Промокоды" },
    { nav: "Квесты", heading: "Квесты" },
    { nav: "Колесо фортуны", heading: "Колесо фортуны" },
    { nav: "Клиенты", heading: "Клиенты" },
    { nav: "Сегменты", heading: "Сегменты клиентов" },
    { nav: "Рассылки", heading: "История рассылок" }
  ] as const;

  for (const section of sections) {
    await page.getByRole("button", { name: section.nav, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: section.heading, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual((await page.evaluate(() => window.innerWidth)));
  }

  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });

    for (const [sectionIndex, section] of sections.entries()) {
      if (width <= 768) await page.getByRole("button", { name: "Открыть меню" }).click();
      await page.getByRole("button", { name: section.nav, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: section.heading, exact: true })).toBeVisible();
      if (width <= 768) await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
      if (width <= 768) await page.waitForTimeout(350);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`admin-section-${sectionIndex + 1}-${width}.png`), fullPage: false });
    }
  }

  expect(pageErrors).toEqual([]);
  expect(
    consoleErrors.filter(
      (error) =>
        !error.includes("401 (Unauthorized)") &&
        !error.includes("503 (Service Unavailable)") &&
        !error.includes("ERR_CONNECTION_REFUSED")
    )
  ).toEqual([]);
});
