import { expect, test } from "@playwright/test";

import { E2E_ADMIN_URL, E2E_API_URL, E2E_CUSTOMER_URL } from "./urls";
import { loginAdmin } from "./admin-auth";

test("Customer opens pickup checkout and stays fail-closed without configured iiko availability", async ({
  browser,
  request
}) => {
  const catalogResponse = await request.get(`${E2E_API_URL}/catalog`);
  test.skip(
    catalogResponse.status() === 503,
    "PostgreSQL is not configured for this local checkout run"
  );
  expect(catalogResponse.status()).toBe(200);

  const productName = `E2E checkout ${Date.now()}`;
  const admin = await browser.newPage();
  const customer = await browser.newPage();
  const customerRequests: string[] = [];
  customer.on("request", (browserRequest) => {
    customerRequests.push(browserRequest.url());
  });

  try {
    await admin.goto(E2E_ADMIN_URL, { waitUntil: "domcontentloaded" });
    await loginAdmin(admin);
    await admin.getByRole("button", { name: "Добавить блюдо" }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel("Название").fill(productName);
    await dialog.getByLabel("Категория").selectOption({ label: "Шашлык" });
    await dialog.getByLabel("Описание").fill("Проверка pickup checkout");
    await dialog.getByLabel("Цена (₽)").fill("321,50");
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(admin.getByText(productName)).toBeVisible();

    await customer.goto(E2E_CUSTOMER_URL, { waitUntil: "domcontentloaded" });
    await expect(customer.getByText(productName)).toBeVisible();
    await customer
      .getByRole("button", { name: `Добавить в корзину ${productName}` })
      .click();
    const identifyDialog = customer.getByTestId("customer-identify-modal");
    await identifyDialog.getByLabel("Номер телефона").fill("8 (999) 123-45-67");
    await identifyDialog.getByRole("button", { name: "Сохранить и добавить" }).click();
    await expect(customer.getByTestId("customer-identify-success")).toBeVisible();
    await customer.getByRole("button", { name: "Открыть корзину" }).first().click();
    await expect(customer.getByTestId("cart-quote-success")).toContainText("321,50₽");

    await customer.getByRole("button", { name: "Оформить самовывоз" }).click();
    await expect(customer.getByText("Проверка оформления")).toBeVisible();
    await expect(customer.getByTestId("checkout-pickup-options")).toBeVisible();
    // The default selection is the earliest slot. Move to the latest slot so
    // this test cannot cross a 30-minute boundary while asserting the iiko
    // fail-closed response.
    const availableSlots = customer.getByRole("button", { name: /Выбрать время/u });
    await expect(availableSlots).not.toHaveCount(0);
    await availableSlots.last().click();
    await expect(customer.getByTestId("checkout-quote-error")).toContainText(
      "Самовывоз временно недоступен"
    );
    expect(customerRequests.some((url) => /\/(orders|payments|iiko)(?:\/|$)/u.test(url))).toBe(
      false
    );
    const row = admin.locator("tr").filter({ hasText: productName });
    await row.getByRole("button", { name: `Скрыть товар ${productName}` }).click();
  } finally {
    await admin.close();
    await customer.close();
  }
});
