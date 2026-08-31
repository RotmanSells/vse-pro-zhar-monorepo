import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectCatalogSurface(
  page: Page,
  url: string,
  expected: (page: Page) => Locator
): Promise<void> {
  const pageErrors: Error[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(expected(page)).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((error) => !error.includes("503 (Service Unavailable)"))).toEqual(
    []
  );
}

test("Customer Web renders the catalog surface", async ({ page }) => {
  await expectCatalogSurface(page, "http://localhost:8082", (currentPage) =>
    currentPage.getByText("Сезон гриля открыт!")
  );
});

test("Admin Web renders the catalog surface", async ({ page }) => {
  await expectCatalogSurface(page, "http://127.0.0.1:5173", (currentPage) =>
    currentPage.getByRole("heading", { name: "Меню" })
  );
});
