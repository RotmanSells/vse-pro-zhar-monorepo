import { expect, test, type Page } from "@playwright/test";

async function expectConnected(
  page: Page,
  url: string
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
  await expect(page.getByText("Connected")).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
}

test("Customer Web reaches the Backend health endpoint", async ({ page }) => {
  await expectConnected(page, "http://localhost:8082");
});

test("Admin Web reaches the Backend health endpoint", async ({ page }) => {
  await expectConnected(page, "http://127.0.0.1:5173");
});
