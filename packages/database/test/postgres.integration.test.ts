import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../src/db.js";
import { migrateDatabase } from "../src/migrate.js";

const databaseUrl = process.env["DATABASE_URL"];
const hasDatabaseUrl = databaseUrl !== undefined && databaseUrl.trim() !== "";

describe.skipIf(!hasDatabaseUrl)("PostgreSQL database foundation", () => {
  let client: DatabaseClient;

  beforeAll(() => {
    client = createDatabaseClient({ url: databaseUrl as string });
  });

  afterAll(async () => {
    await client.close();
  });

  it("connects and executes a PostgreSQL probe", async () => {
    await expect(client.probe()).resolves.toBeUndefined();
  });

  it("applies the migration mechanism without business tables", async () => {
    await migrateDatabase(client);

    const migrationTables = await client.db.execute(sql`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = 'drizzle'
        AND table_name = '__drizzle_migrations'
    `);
    expect(migrationTables.rows).toHaveLength(1);

    const businessTables = await client.db.execute(sql`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name NOT LIKE '__drizzle%'
    `);
    expect(businessTables.rows).toEqual([]);
  });
});
