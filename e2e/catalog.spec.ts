import { expect, test } from "@playwright/test";

import { E2E_ADMIN_URL, E2E_API_URL, E2E_CUSTOMER_URL } from "./urls";
import { loginAdmin } from "./admin-auth";
import { completeCustomerFirstEntry } from "./customer-auth";

test("Admin publishes and hides a product seen by Customer", async ({
  browser,
  request
}) => {
  const availability = await request.get(`${E2E_API_URL}/catalog`);

  test.skip(
    availability.status() === 503,
    "PostgreSQL is not configured for this local smoke run"
  );
  expect(availability.status()).toBe(200);

  const productName = `E2E шашлык ${Date.now()}`;
  const admin = await browser.newPage();

  await admin.goto(E2E_ADMIN_URL, { waitUntil: "domcontentloaded" });
  await loginAdmin(admin);
  await admin.getByRole("button", { name: "Добавить блюдо" }).click();

  const dialog = admin.getByRole("dialog");
  await dialog.getByLabel("Название").fill(productName);
  await dialog.getByLabel("Категория").selectOption({ label: "Шашлык" });
  await dialog.getByLabel("Описание").fill("Проверка вертикального среза");
  await dialog.getByLabel("Цена (₽)").fill("321,50");
  await dialog.getByLabel("Фото с компьютера").setInputFiles({
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    ),
    mimeType: "image/png",
    name: "dish.png"
  });
  await expect(
    dialog.getByText("Фото сконвертировано в WebP и загружено.")
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Сохранить" }).click();

  await expect(admin.getByText(productName)).toBeVisible();

  const customer = await browser.newPage();
  await customer.goto(E2E_CUSTOMER_URL, { waitUntil: "domcontentloaded" });
  await completeCustomerFirstEntry(customer);
  await expect(customer.getByText(productName)).toBeVisible();
  const search = customer.getByLabel("Поиск блюд");
  await search.fill(productName.slice(0, 18));
  await expect(customer.getByText(productName)).toBeVisible();
  await search.fill("блюдо которого нет");
  await expect(customer.getByText(/ничего не найдено/u)).toBeVisible();
  await customer.getByLabel("Очистить поиск").click();
  await expect(customer.getByText(productName)).toBeVisible();

  const row = admin.locator("tr").filter({ hasText: productName });
  await row
    .getByRole("button", { name: `Скрыть товар ${productName}` })
    .click();
  await expect(row.getByText("Скрыто")).toBeVisible();

  await customer.reload({ waitUntil: "domcontentloaded" });
  await expect(customer.getByText(productName)).toHaveCount(0);

  await admin.close();
  await customer.close();
});
