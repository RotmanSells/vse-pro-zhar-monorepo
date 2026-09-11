import { expect, test } from "@playwright/test";

import { E2E_ADMIN_URL, E2E_API_URL, E2E_CUSTOMER_URL } from "./urls";
import { loginAdmin } from "./admin-auth";
import { completeCustomerFirstEntry } from "./customer-auth";

test("Customer quote follows Admin price and visibility changes", async ({
  browser,
  request
}) => {
  const availability = await request.get(`${E2E_API_URL}/catalog`);

  test.skip(
    availability.status() === 503,
    "PostgreSQL is not configured for this local cart run"
  );
  expect(availability.status()).toBe(200);

  const productName = `E2E cart ${Date.now()}`;
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
    await dialog.getByLabel("Описание").fill("Проверка cart quote");
    await dialog.getByLabel("Цена (₽)").fill("321,50");
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(admin.getByText(productName)).toBeVisible();

    await customer.goto(E2E_CUSTOMER_URL, {
      waitUntil: "domcontentloaded"
    });
    await completeCustomerFirstEntry(customer);
    await expect(customer.getByText(productName)).toBeVisible();
    await customer
      .getByRole("button", { name: `Добавить в корзину ${productName}` })
      .click();
    await customer
      .getByRole("button", { name: "Открыть корзину" })
      .first()
      .click();

    const success = customer.getByTestId("cart-quote-success");
    await expect(success).toContainText("321,50₽");

    const row = admin.locator("tr").filter({ hasText: productName });
    await row.getByRole("button", { name: `Редактировать ${productName}` }).click();
    const editDialog = admin.getByRole("dialog");
    await editDialog.getByLabel("Цена (₽)").fill("444,40");
    await editDialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(row).toContainText("444,40₽");

    await customer.getByRole("button", { name: "Повторить расчёт" }).click();
    await expect(success).toContainText("444,40₽");

    await row
      .getByRole("button", { name: `Скрыть товар ${productName}` })
      .click();
    await expect(row).toContainText("Скрыто");
    await customer.getByRole("button", { name: "Повторить расчёт" }).click();
    await expect(customer.getByText("Блюдо больше недоступно")).toBeVisible();

    await customer
      .getByRole("button", { name: `Удалить ${productName} из корзины` })
      .click();
    await expect(customer.getByTestId("cart-empty")).toBeVisible();
    expect(customerRequests.some((url) => /\/orders(?:\/|$)/u.test(url))).toBe(
      false
    );
  } finally {
    await admin.close();
    await customer.close();
  }
});
