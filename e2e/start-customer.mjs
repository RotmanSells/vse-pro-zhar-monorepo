import { spawn } from "node:child_process";
import { access, mkdtemp, rename, rm } from "node:fs/promises";
import { renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const customerRoot = join(repositoryRoot, "apps", "customer");
const customerEnvPath = join(customerRoot, ".env.local");
const backupDirectory = await mkdtemp(join(tmpdir(), "vse-pro-zhar-e2e-"));
const backupPath = join(backupDirectory, ".env.local");
const customerPort = process.env["E2E_CUSTOMER_PORT"] ?? "8082";
const apiUrl = process.env["E2E_API_URL"] ?? "http://localhost:3000";

let envBackedUp = false;
let restored = false;

async function restoreCustomerEnv() {
  if (restored) return;
  restored = true;
  if (envBackedUp) await rename(backupPath, customerEnvPath);
  await rm(backupDirectory, { force: true, recursive: true });
}

function restoreCustomerEnvSync() {
  if (restored) return;
  restored = true;
  if (envBackedUp) renameSync(backupPath, customerEnvPath);
  rmSync(backupDirectory, { force: true, recursive: true });
}

try {
  try {
    await access(customerEnvPath);
    await rename(customerEnvPath, backupPath);
    envBackedUp = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const child = spawn(
    "pnpm",
    ["--filter", "@vse-pro-zhar/customer", "exec", "expo", "start", "--web", "--localhost", "--clear", "--port", customerPort],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        EXPO_NO_DOTENV: "1",
        EXPO_PUBLIC_API_URL: apiUrl
      },
      stdio: "inherit"
    }
  );

  const forwardSignal = (signal) => {
    restoreCustomerEnvSync();
    child.kill(signal);
  };
  process.once("SIGINT", forwardSignal);
  process.once("SIGTERM", forwardSignal);

  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      process.exitCode = code ?? 1;
      resolve();
    });
  });

  process.off("SIGINT", forwardSignal);
  process.off("SIGTERM", forwardSignal);
} finally {
  await restoreCustomerEnv();
}
