import { expect, test } from "@playwright/test";

import { E2E_API_URL, E2E_CUSTOMER_URL } from "./urls";
import { loginAdminApi } from "./admin-auth";

test("Customer identifies before add, restores session and can logout", async ({
  browser,
  request
}) => {
  const availability = await request.get(`${E2E_API_URL}/catalog`);
  test.skip(
    availability.status() === 503,
    "PostgreSQL is not configured for this local auth run"
  );
  expect(availability.status()).toBe(200);
  await loginAdminApi(request);

  const productName = `E2E auth ${Date.now()}`;
  const created = await request.post(`${E2E_API_URL}/admin/products`, {
    data: {
      categoryId: 1,
      name: productName,
      description: "Проверка customer identification",
      priceMinor: 12345,
      emoji: "🥩",
      tag: null
    }
  });
  expect(created.status()).toBe(201);
  const productId = (await created.json() as { product: { id: number } }).product.id;

  const customer = await browser.newPage();
  try {
    await customer.goto(E2E_CUSTOMER_URL, { waitUntil: "domcontentloaded" });
    await expect(customer.getByText(productName)).toBeVisible();
    await customer.getByRole("button", { name: `Добавить в корзину ${productName}` }).click();
    const dialog = customer.getByTestId("customer-identify-modal");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Номер телефона").fill("8 (999) 555-00-01");
    await dialog.getByRole("button", { name: "Сохранить и добавить" }).click();
    await expect(customer.getByTestId("customer-identify-success")).toBeVisible();

    await customer.reload({ waitUntil: "domcontentloaded" });
    await customer.getByRole("button", { name: `Добавить в корзину ${productName}` }).click();
    await customer.getByRole("button", { name: "Выйти из профиля" }).click();
    await customer.getByRole("button", { name: `Добавить в корзину ${productName}` }).click();
    await expect(customer.getByTestId("customer-identify-modal")).toBeVisible();
  } finally {
    await request.patch(`${E2E_API_URL}/admin/products/${productId}`, {
      data: { isVisible: false }
    });
    await customer.close();
  }
});
