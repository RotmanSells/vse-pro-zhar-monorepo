import { expect, test } from "@playwright/test";

import { E2E_API_URL, E2E_ADMIN_URL, E2E_CUSTOMER_URL } from "./urls";
import { loginAdmin } from "./admin-auth";

test("Admin creates a fixed discount and Customer sees the confirmed insufficient-balance state", async ({ browser, page, request }) => {
  const availability = await request.get(`${E2E_API_URL}/catalog`);
  test.skip(availability.status() === 503, "PostgreSQL is not configured for this local loyalty rewards run");
  const code = `e2e-discount-${Date.now()}`.slice(0, 80);
  let created = false;
  try {
    await page.goto(E2E_ADMIN_URL, { waitUntil: "domcontentloaded" });
    await loginAdmin(page);
    await page.getByRole("button", { name: "Награды", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Награды", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Добавить награду/u }).click();
    await page.getByLabel("Код награды").fill(code);
    await page.getByLabel("Название награды").fill("E2E скидка 300 ₽");
    await page.getByLabel("Стоимость награды").fill("10");
    await page.getByLabel("Размер скидки").fill("300");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByText(code, { exact: true })).toBeVisible();
    created = true;

    const customer = await browser.newPage();
    try {
      await customer.goto(E2E_CUSTOMER_URL, { waitUntil: "domcontentloaded" });
      await customer.getByRole("button", { name: /Добавить в корзину/u }).first().click();
      const dialog = customer.getByTestId("customer-identify-modal");
      await dialog.getByLabel("Номер телефона").fill("8 (999) 555-13-55");
      await dialog.getByRole("button", { name: "Сохранить и добавить" }).click();
      await expect(customer.getByTestId("customer-identify-success")).toBeVisible();
      await customer.getByRole("button", { name: "Открыть мою лояльность" }).click();
      await expect(customer.getByText("E2E скидка 300 ₽", { exact: true }).first()).toBeVisible();
      await expect(customer.getByText("Недостаточно угольков", { exact: true }).first()).toBeVisible();
      for (const width of [320, 375, 768, 1024]) {
        await customer.setViewportSize({ width, height: 800 });
        expect(await customer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
    } finally {
      await customer.close();
    }
  } finally {
    if (created) {
      const rewardRow = page.locator("tr").filter({ hasText: code });
      await rewardRow.getByRole("button", { name: "Архивировать", exact: true }).click();
      await expect(rewardRow).toContainText("Архив");
    }
  }
});
