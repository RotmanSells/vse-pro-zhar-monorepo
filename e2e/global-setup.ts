import { request } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { E2E_ADMIN_URL, E2E_API_URL } from "./urls";

const STAFF_LOGIN = "e2e-admin";
const STAFF_PASSWORD = "e2e-admin-password-2026";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export default async function globalSetup(): Promise<void> {
  const context = await request.newContext({
    baseURL: E2E_API_URL,
    extraHTTPHeaders: { Origin: E2E_ADMIN_URL }
  });

  try {
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await context.get("/health");
        if (response.ok()) {
          healthy = true;
          break;
        }
      } catch {
        // The Playwright webServer may still be starting.
      }
      await delay(250);
    }

    if (!healthy) throw new Error("E2E API did not become healthy before global setup");

    const response = await context.post("/admin/auth/login", {
      data: { login: STAFF_LOGIN, password: STAFF_PASSWORD }
    });
    if (!response.ok()) {
      throw new Error(`E2E Admin bootstrap login failed with HTTP ${response.status()}`);
    }

    const storageStatePath = resolve("test-results/e2e-admin-storage.json");
    await mkdir(resolve("test-results"), { recursive: true });
    await context.storageState({ path: storageStatePath });
  } finally {
    await context.dispose();
  }
}
