import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

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
  void main().catch(() => {
    console.error("database_migration_failed");
    process.exitCode = 1;
  });
}
