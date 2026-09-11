import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CatalogCategoryIdempotencyConflictError,
  CatalogCategoryVersionConflictError,
  createCatalogRepository
} from "../src/catalog-repository.js";
import { createDatabaseClient, type DatabaseClient } from "../src/db.js";
import { migrateDatabase } from "../src/migrate.js";
import { products } from "../src/schema.js";

const databaseUrl = process.env["DATABASE_URL"];
const hasDatabaseUrl = databaseUrl !== undefined && databaseUrl.trim() !== "";

describe.skipIf(!hasDatabaseUrl)("PostgreSQL Admin category management", () => {
  let client: DatabaseClient;

  beforeAll(async () => {
    client = createDatabaseClient({ url: databaseUrl as string });
    await migrateDatabase(client);
  });

  afterAll(async () => {
    await client.close();
  });

  it("versions category mutations idempotently and preserves products", async () => {
    const suffix = String(Date.now());
    const slug = `m167-${suffix}`;
    const createKey = `m167-create-${suffix}`;
    const updateKey = `m167-update-${suffix}`;
    const hideKey = `m167-hide-${suffix}`;
    const staffLogin = `m167-${suffix}`.slice(0, 80);
    const staffResult = await client.db.execute(sql`
      INSERT INTO staff_users (login, display_name, password_hash)
      VALUES (${staffLogin}, 'M16.7 fixture', 'fixture-hash')
      RETURNING id
    `);
    const staffId = Number((staffResult.rows[0] as Record<string, unknown>)["id"]);
    const repository = createCatalogRepository(client);
    let categoryId: number | null = null;
    let productId: number | null = null;

    try {
      const created = await repository.createCategory(
        { slug, name: "M16.7 категория", sortOrder: 9_000, isVisible: true },
        {
          actorStaffUserId: staffId,
          requestId: `request-create-${suffix}`,
          idempotencyKey: createKey,
          payloadFingerprint: "a".repeat(64),
          now: new Date("2026-09-01T10:00:00.000Z")
        }
      );
      categoryId = created.id;
      expect(created.version).toBe(1);

      const repeated = await repository.createCategory(
        { slug, name: "M16.7 категория", sortOrder: 9_000, isVisible: true },
        {
          actorStaffUserId: staffId,
          requestId: `request-create-retry-${suffix}`,
          idempotencyKey: createKey,
          payloadFingerprint: "a".repeat(64),
          now: new Date("2026-09-01T10:01:00.000Z")
        }
      );
      expect(repeated.id).toBe(created.id);
      expect(repeated.version).toBe(1);
      await expect(repository.createCategory(
        { slug, name: "Другая категория", sortOrder: 9_000, isVisible: true },
        {
          actorStaffUserId: staffId,
          requestId: `request-create-conflict-${suffix}`,
          idempotencyKey: createKey,
          payloadFingerprint: "b".repeat(64),
          now: new Date("2026-09-01T10:02:00.000Z")
        }
      )).rejects.toBeInstanceOf(CatalogCategoryIdempotencyConflictError);

      const productRows = await client.db.insert(products).values({
        categoryId: created.id,
        name: "M16.7 блюдо",
        description: "Fixture",
        priceMinor: 1_000,
        imageUrl: null,
        emoji: "🥩",
        tag: null,
        isVisible: true,
        sortOrder: 1
      }).returning({ id: products.id });
      productId = productRows[0]?.id ?? null;

      const updated = await repository.updateCategory(created.id, {
        name: "M16.7 обновлённая",
        sortOrder: 9_001,
        expectedVersion: 1
      }, {
        actorStaffUserId: staffId,
        requestId: `request-update-${suffix}`,
        idempotencyKey: updateKey,
        payloadFingerprint: "c".repeat(64),
        now: new Date("2026-09-01T10:03:00.000Z")
      });
      expect(updated).toMatchObject({ name: "M16.7 обновлённая", version: 2 });

      const repeatedUpdate = await repository.updateCategory(created.id, {
        name: "M16.7 обновлённая",
        sortOrder: 9_001,
        expectedVersion: 1
      }, {
        actorStaffUserId: staffId,
        requestId: `request-update-retry-${suffix}`,
        idempotencyKey: updateKey,
        payloadFingerprint: "c".repeat(64),
        now: new Date("2026-09-01T10:04:00.000Z")
      });
      expect(repeatedUpdate?.version).toBe(2);
      await expect(repository.updateCategory(created.id, {
        name: "Не должно сохраниться",
        expectedVersion: 1
      }, {
        actorStaffUserId: staffId,
        requestId: `request-stale-${suffix}`,
        idempotencyKey: `m167-stale-${suffix}`,
        payloadFingerprint: "d".repeat(64),
        now: new Date("2026-09-01T10:05:00.000Z")
      })).rejects.toBeInstanceOf(CatalogCategoryVersionConflictError);

      const hidden = await repository.updateCategory(created.id, {
        isVisible: false,
        expectedVersion: 2
      }, {
        actorStaffUserId: staffId,
        requestId: `request-hide-${suffix}`,
        idempotencyKey: hideKey,
        payloadFingerprint: "e".repeat(64),
        now: new Date("2026-09-01T10:06:00.000Z")
      });
      expect(hidden).toMatchObject({ isVisible: false, version: 3 });

      const listed = await repository.getAdminCategories?.();
      expect(listed?.find((category) => category.id === created.id)).toMatchObject({
        productCount: 1,
        isVisible: false,
        version: 3
      });
      const history = await client.db.execute(sql`
        SELECT action, version, actor_staff_user_id, request_id
        FROM category_versions
        WHERE category_id = ${created.id}
        ORDER BY version
      `);
      expect(history.rows).toEqual([
        {
          action: "created",
          version: 1,
          actor_staff_user_id: staffId,
          request_id: `request-create-${suffix}`
        },
        {
          action: "updated",
          version: 2,
          actor_staff_user_id: staffId,
          request_id: `request-update-${suffix}`
        },
        {
          action: "archived",
          version: 3,
          actor_staff_user_id: staffId,
          request_id: `request-hide-${suffix}`
        }
      ]);
    } finally {
      if (productId !== null) await client.db.execute(sql`DELETE FROM products WHERE id = ${productId}`);
      if (categoryId !== null) await client.db.execute(sql`DELETE FROM category_versions WHERE category_id = ${categoryId}`);
      if (categoryId !== null) await client.db.execute(sql`DELETE FROM categories WHERE id = ${categoryId}`);
      await client.db.execute(sql`DELETE FROM staff_users WHERE id = ${staffId}`);
    }
  });
});
