import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabaseClient } from "./db.js";
import { formatDatabaseFailure } from "./config/env.js";

async function main(): Promise<void> {
  const client = createDatabaseClient();

  try {
    await client.probe();
  } finally {
    await client.close();
  }
}

const entryPath = process.argv[1];
const isMainModule =
  entryPath !== undefined && fileURLToPath(import.meta.url) === resolve(entryPath);

if (isMainModule) {
  void main().catch((error: unknown) => {
    console.error(formatDatabaseFailure("probe", error));
    process.exitCode = 1;
  });
}
