import { defineConfig } from "@playwright/test";

import {
  E2E_ADMIN_PORT,
  E2E_ADMIN_URL,
  E2E_API_PORT,
  E2E_API_URL,
  E2E_CUSTOMER_PORT,
  E2E_CUSTOMER_URL
} from "./e2e/urls";

export default defineConfig({
  // E2E сценарии используют одну canonical PostgreSQL database. Running
  // mutating specs in parallel makes global settings and catalog fixtures race.
  workers: 1,
  expect: {
    timeout: 15_000
  },
  globalSetup: "./e2e/global-setup.ts",
  reporter: process.env["CI"] === "true" ? "line" : "list",
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vse_pro_zhar_dev STAFF_BOOTSTRAP_LOGIN=e2e-admin STAFF_BOOTSTRAP_PASSWORD=e2e-admin-password-2026 STAFF_BOOTSTRAP_DISPLAY_NAME='E2E Admin' STAFF_BOOTSTRAP_ALLOW_EXISTING=true pnpm --filter @vse-pro-zhar/api staff:bootstrap >/dev/null 2>&1 || true; API_PORT=${E2E_API_PORT} CORS_ALLOWED_ORIGINS=${E2E_CUSTOMER_URL},${E2E_ADMIN_URL} pnpm --filter @vse-pro-zhar/api run dev:root`,
      timeout: 180_000,
      url: `${E2E_API_URL}/health`
    },
    {
      command: `E2E_API_URL=http://localhost:${E2E_API_PORT} E2E_CUSTOMER_PORT=${E2E_CUSTOMER_PORT} node e2e/start-customer.mjs`,
      timeout: 180_000,
      url: E2E_CUSTOMER_URL
    },
    {
      command: `VITE_API_URL=http://127.0.0.1:${E2E_ADMIN_PORT} VITE_PROXY_TARGET=${E2E_API_URL} pnpm --filter @vse-pro-zhar/admin exec vite --host 127.0.0.1 --port ${E2E_ADMIN_PORT}`,
      timeout: 180_000,
      url: E2E_ADMIN_URL
    }
  ]
});
