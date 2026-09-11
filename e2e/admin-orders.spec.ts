import { expect, test } from "@playwright/test";

import { loginAdmin } from "./admin-auth";
import { E2E_ADMIN_URL, E2E_API_URL } from "./urls";

test("Admin Orders is staff-only and does not call iiko from the browser", async ({ page, request }) => {
  const catalog = await request.get(`${E2E_API_URL}/catalog`);
  test.skip(catalog.status() === 503, "PostgreSQL is not configured for this local Admin Orders run");
  expect((await request.get(`${E2E_API_URL}/admin/orders`)).status()).toBe(401);
  const iikoRequests: string[] = [];
  page.on("request", (browserRequest) => { if (browserRequest.url().includes("iiko")) iikoRequests.push(browserRequest.url()); });
  await page.goto(E2E_ADMIN_URL, { waitUntil: "domcontentloaded" });
  await loginAdmin(page);
  await page.getByRole("button", { name: "Заказы", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Заказы", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Все заказы/ })).toBeVisible();
  expect(iikoRequests).toEqual([]);
});
