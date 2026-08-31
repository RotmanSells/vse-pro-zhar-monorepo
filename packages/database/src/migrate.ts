import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { formatDatabaseFailure } from "./config/env.js";
import { createDatabaseClient, type DatabaseClient } from "./db.js";

export const migrationsFolder = resolve(
  fileURLToPath(new URL("../drizzle", import.meta.url))
);

export async function migrateDatabase(
  client: DatabaseClient,
  folder = migrationsFolder
): Promise<void> {
  await migrate(client.db, { migrationsFolder: folder });
}

async function main(): Promise<void> {
  const client = createDatabaseClient();

  try {
    await migrateDatabase(client);
  } finally {
    await client.close();
  }
}

const entryPath = process.argv[1];
const isMainModule =
  entryPath !== undefined && fileURLToPath(import.meta.url) === resolve(entryPath);

if (isMainModule) {
  void main().catch((error: unknown) => {
    console.error(formatDatabaseFailure("migration", error));
    process.exitCode = 1;
  });
}
