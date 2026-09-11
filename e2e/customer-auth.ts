import { expect, type Page } from "@playwright/test";

export interface CustomerIdentityOptions {
  readonly name?: string;
  readonly phone?: string;
  readonly birthDate?: string;
}

export async function completeCustomerFirstEntry(
  page: Page,
  options: CustomerIdentityOptions = {}
): Promise<void> {
  const dialog = page.getByTestId("customer-identify-modal");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Создайте профиль" })).toBeVisible();
  await dialog.getByLabel("Имя").fill(options.name ?? "Тестовый клиент");
  await dialog.getByLabel("Номер телефона").fill(options.phone ?? "8 (999) 555-20-01");
  if (options.birthDate !== undefined) {
    await dialog.getByLabel("Дата рождения (необязательно)").fill(options.birthDate);
  }
  await dialog.getByRole("button", { name: "Начать пользоваться приложением" }).click();
  await expect(dialog).toBeHidden();
}
