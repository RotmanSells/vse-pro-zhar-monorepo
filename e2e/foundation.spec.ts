import { expect, test, type Locator, type Page } from "@playwright/test";

import { E2E_ADMIN_URL, E2E_API_URL, E2E_CUSTOMER_URL } from "./urls";
import { loginAdmin } from "./admin-auth";

async function expectCatalogSurface(
  page: Page,
  url: string,
  expected: (page: Page) => Locator
): Promise<void> {
  const pageErrors: Error[] = [];
  const consoleErrors: string[] = [];
  const failedNonMediaRequests: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error);
  });
  page.on("requestfailed", (request) => {
    if (!/\/media\/[0-9a-f-]+\.webp$/u.test(new URL(request.url()).pathname)) {
      failedNonMediaRequests.push(request.url());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (url === E2E_ADMIN_URL) await loginAdmin(page);
  await expect(expected(page)).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(failedNonMediaRequests).toEqual([]);
  expect(
    consoleErrors.filter(
      (error) =>
        !error.includes("503 (Service Unavailable)") &&
        !error.includes("401 (Unauthorized)") &&
        !error.includes("Failed to load resource: net::ERR_CONNECTION_REFUSED")
    )
  ).toEqual([]);
}

test("Customer Web renders the catalog surface", async ({ page }) => {
  await expectCatalogSurface(page, E2E_CUSTOMER_URL, (currentPage) =>
    currentPage.getByText("Сезон гриля открыт!")
  );
});

test("Admin Web renders the catalog surface", async ({ page, request }) => {
  const availability = await request.get(`${E2E_API_URL}/catalog`);
  test.skip(availability.status() === 503, "PostgreSQL is not configured for this local smoke run");
  await expectCatalogSurface(page, E2E_ADMIN_URL, (currentPage) =>
    currentPage.getByRole("heading", { name: "Меню", exact: true })
  );
});
