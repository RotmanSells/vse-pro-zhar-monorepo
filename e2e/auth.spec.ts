import { expect, test } from "@playwright/test";

import { E2E_API_URL, E2E_CUSTOMER_URL } from "./urls";
import { completeCustomerFirstEntry } from "./customer-auth";

test("Customer completes first entry and restores the persistent session", async ({ browser, request }) => {
  const availability = await request.get(`${E2E_API_URL}/catalog`);
  test.skip(
    availability.status() === 503,
    "PostgreSQL is not configured for this local auth run"
  );
  expect(availability.status()).toBe(200);

  const customer = await browser.newPage();
  try {
    await customer.goto(E2E_CUSTOMER_URL, { waitUntil: "domcontentloaded" });
    await completeCustomerFirstEntry(customer, {
      name: "Первый Customer",
      phone: "8 (999) 555-00-01",
      birthDate: "02.01.1990"
    });
    await expect(customer.getByRole("button", { name: "Открыть мой профиль" })).toBeVisible();

    await customer.reload({ waitUntil: "domcontentloaded" });
    await expect(customer.getByTestId("customer-identify-modal")).toBeHidden();
    await expect(customer.getByRole("button", { name: "Открыть мой профиль" })).toBeVisible();
  } finally {
    await customer.close();
  }
});
