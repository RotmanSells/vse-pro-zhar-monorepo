import { expect, test } from "@playwright/test";

import { E2E_API_URL, E2E_CUSTOMER_URL } from "./urls";

test("Customer Profile is server-backed, truthful and responsive", async ({ page, request }) => {
  const availability = await request.get(`${E2E_API_URL}/catalog`);
  test.skip(availability.status() === 503, "PostgreSQL is not configured for this local profile run");
  expect(availability.status()).toBe(200);

  await page.goto(E2E_CUSTOMER_URL, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Профиль", exact: true }).click();
  const dialog = page.getByTestId("customer-identify-modal");
  if (await dialog.isVisible()) {
    await dialog.getByLabel("Номер телефона").fill("8 (999) 555-14-01");
    await dialog.getByRole("button", { name: "Открыть профиль" }).click();
  }

  await expect(page.getByTestId("profile-head")).toBeVisible();
  await expect(page.getByText("До след. награды")).toBeVisible();
  await expect(page.getByTestId("profile-settings")).toContainText("Недоступно");
  await expect(page.getByText("5%", { exact: true })).toHaveCount(0);
  await expect(page.getByText("SPARK10", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Как работает бонусная система" }).click();
  await expect(page.getByTestId("profile-bonus-body")).toContainText("100 ₽");
  await expect(page.getByTestId("profile-bonus-body")).toContainText("1 XP");

  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await page.screenshot({ path: test.info().outputPath(`profile-${width}.png`), fullPage: true });
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

  await page.getByRole("button", { name: "Выйти из аккаунта" }).click();
  await expect(page.getByRole("tab", { name: "Профиль", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Профиль", exact: true }).click();
  await expect(page.getByTestId("customer-identify-modal")).toBeVisible();
});
