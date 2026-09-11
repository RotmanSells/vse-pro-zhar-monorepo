import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { E2E_API_URL } from "./urls";

export const E2E_STAFF_LOGIN = "e2e-admin";
export const E2E_STAFF_PASSWORD = "e2e-admin-password-2026";

interface StoredAdminCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly expires: number;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "Strict" | "Lax" | "None";
}

interface StoredAdminState {
  readonly cookies: readonly StoredAdminCookie[];
}

function storedAdminCookie(): StoredAdminCookie {
  const state = JSON.parse(readFileSync(resolve("test-results/e2e-admin-storage.json"), "utf8")) as StoredAdminState;
  const cookie = state.cookies.find((entry) => entry.name === "vse-pro-zhar-admin-session");
  if (cookie === undefined) throw new Error("E2E Admin storage state does not contain a session cookie");
  return cookie;
}

export async function loginAdmin(page: Page): Promise<void> {
  const adminHeading = page.getByRole("heading", { name: /^(Заказы|Меню)$/u });
  if (!(await adminHeading.isVisible().catch(() => false))) {
    await page.context().addCookies([storedAdminCookie()]);
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expect(adminHeading).toBeVisible();
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Меню", exact: true })).toBeVisible();
}

export async function loginAdminApi(request: APIRequestContext): Promise<void> {
  const currentSession = await request.get(`${E2E_API_URL}/admin/auth/me`);
  if (currentSession.ok()) return;
  const response = await request.post(`${E2E_API_URL}/admin/auth/login`, {
    data: { login: E2E_STAFF_LOGIN, password: E2E_STAFF_PASSWORD }
  });
  expect(response.status()).toBe(200);
}
