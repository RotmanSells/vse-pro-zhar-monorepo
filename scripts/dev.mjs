import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const apiPort = process.env.API_PORT ?? "3000";
const apiHost = process.env.API_HOST ?? "127.0.0.1";
const browserApiHost = apiHost === "0.0.0.0" ? "127.0.0.1" : apiHost;
const environment = {
  ...process.env,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? `http://localhost:${apiPort}`,
  VITE_API_URL: process.env.VITE_API_URL ?? `http://${browserApiHost}:${apiPort}`,
  VITE_PROXY_TARGET: process.env.VITE_PROXY_TARGET ?? `http://${browserApiHost}:${apiPort}`
};

const child = spawn(
  "pnpm",
  [
    "--parallel",
    "--filter",
    "@vse-pro-zhar/api",
    "--filter",
    "@vse-pro-zhar/customer",
    "--filter",
    "@vse-pro-zhar/admin",
    "run",
    "dev:root"
  ],
  { env: environment, stdio: "inherit" }
);

let shuttingDown = false;
const forwardSignal = (signal) => {
  if (!shuttingDown) child.kill(signal);
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  shuttingDown = true;
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
