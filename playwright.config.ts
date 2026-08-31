import { defineConfig } from "@playwright/test";

export default defineConfig({
  expect: {
    timeout: 15_000
  },
  reporter: process.env["CI"] === "true" ? "line" : "list",
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "pnpm --filter @vse-pro-zhar/api run dev:root",
      timeout: 180_000,
      url: "http://127.0.0.1:3000/health"
    },
    {
      command: "pnpm --filter @vse-pro-zhar/customer run dev:root",
      timeout: 180_000,
      url: "http://localhost:8082"
    },
    {
      command: "pnpm --filter @vse-pro-zhar/admin run dev:root",
      timeout: 180_000,
      url: "http://127.0.0.1:5173"
    }
  ]
});
