import { expect, test } from "@playwright/test";

import { E2E_ADMIN_URL, E2E_API_URL, E2E_CUSTOMER_URL } from "./urls";
import { loginAdmin } from "./admin-auth";

test("Customer opens confirmed loyalty state without fake rewards", async ({ browser, request }) => {
  const availability = await request.get(`${E2E_API_URL}/catalog`);
  test.skip(availability.status() === 503, "PostgreSQL is not configured for this local loyalty run");
  expect(availability.status()).toBe(200);
  const customer = await browser.newPage();
  try {
    await customer.goto(E2E_CUSTOMER_URL, { waitUntil: "domcontentloaded" });
    await customer.getByRole("button", { name: /Добавить в корзину/u }).first().click();
    const dialog = customer.getByTestId("customer-identify-modal");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Номер телефона").fill("8 (999) 555-13-01");
    await dialog.getByRole("button", { name: "Сохранить и добавить" }).click();
    await expect(customer.getByTestId("customer-identify-success")).toBeVisible();
    await customer.getByRole("button", { name: "Открыть мою лояльность" }).click();
    await expect(customer.getByTestId("passport-rank-card")).toBeVisible();
    await expect(customer.getByText("Искра")).toBeVisible();
    await expect(customer.getByTestId("passport-rank-card")).toBeVisible();
    await expect(customer.getByTestId("loyalty-progress")).toBeVisible();
    await expect(customer.getByText(/До ранга/u)).toBeVisible();
    expect(await customer.locator("input").count()).toBe(0);
    await customer.getByRole("tab", { name: "Рулетка", exact: true }).click();
    await expect(customer.getByRole("heading", { name: /Поймай искру/u })).toBeVisible();
    await customer.getByRole("button", { name: "Открыть корзину", exact: true }).click();
    await expect(customer.getByText(/Моя корзина/u)).toBeVisible();
  for (const width of [320, 375, 768, 1024]) {
    await customer.setViewportSize({ width, height: 800 });
    await customer.screenshot({ path: test.info().outputPath(`customer-${width}.png`) });
    expect(await customer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  } finally {
    await customer.close();
  }
});

test("Admin opens read-only loyalty history", async ({ page, request }) => {
  const availability = await request.get(`${E2E_API_URL}/catalog`);
  test.skip(availability.status() === 503, "PostgreSQL is not configured for this local loyalty run");
  await page.goto(E2E_ADMIN_URL, { waitUntil: "domcontentloaded" });
  await loginAdmin(page);
  await page.getByRole("button", { name: "Лояльность", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Лояльность", exact: true })).toBeVisible();
  await expect(page.getByText("Баланс нельзя менять вручную.")).toBeVisible();
  await expect(page.getByText("Redemption")).toBeVisible();
  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await page.screenshot({ path: test.info().outputPath(`admin-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const touchViolations = await page.locator("button,[role='button'],[role='tab']").evaluateAll((elements) =>
      elements.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)
          ? [{ width: Math.round(rect.width), height: Math.round(rect.height) }]
          : [];
      })
    );
    expect(touchViolations).toEqual([]);
  }
});
