import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../src/db.js";
import { createCatalogRepository } from "../src/catalog-repository.js";
import { migrateDatabase } from "../src/migrate.js";

const databaseUrl = process.env["DATABASE_URL"];
const hasDatabaseUrl = databaseUrl !== undefined && databaseUrl.trim() !== "";

describe.skipIf(!hasDatabaseUrl)("PostgreSQL database and catalog", () => {
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

  it("applies the migration and creates the catalog tables", async () => {
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
      ORDER BY table_name
    `);
    expect(businessTables.rows).toEqual([
      { table_schema: "public", table_name: "categories" },
      { table_schema: "public", table_name: "products" }
    ]);

    const seededCategories = await client.db.execute(sql`
      SELECT slug, name
      FROM categories
      ORDER BY sort_order
    `);
    expect(seededCategories.rows).toHaveLength(7);
  });

  it("persists products, keeps minor units, and hides them from public reads", async () => {
    const repository = createCatalogRepository(client);
    const categoryResult = await client.db.execute(sql`
      SELECT id
      FROM categories
      WHERE slug = 'shashlyk'
    `);
    const category = categoryResult.rows[0];
    if (category === undefined) {
      throw new Error("Expected the seeded shashlyk category");
    }
    const categoryId = Number(category["id"]);
    const created = await repository.createProduct({
      categoryId,
      name: "Интеграционный шашлык",
      description: "Проверка catalog repository",
      priceMinor: 45_050,
      imageUrl: null,
      emoji: "🥩",
      tag: "hit",
      isVisible: true,
      sortOrder: 999
    });

    expect(created.priceMinor).toBe(45_050);
    expect(
      (await repository.getCatalog()).products.some((product) => product.id === created.id)
    ).toBe(true);

    await repository.updateProduct(created.id, { isVisible: false });
    expect(
      (await repository.getCatalog()).products.some((product) => product.id === created.id)
    ).toBe(false);
    expect(
      (await repository.getCatalog({ includeHidden: true })).products.some(
        (product) => product.id === created.id && product.isVisible === false
      )
    ).toBe(true);

    await client.db.execute(sql`DELETE FROM products WHERE id = ${created.id}`);
  });
});
