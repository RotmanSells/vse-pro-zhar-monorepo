import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "../src/db.js";
import { createCatalogRepository } from "../src/catalog-repository.js";
import { createCustomerRepository } from "../src/customer-repository.js";
import { createOrderRepository } from "../src/order-repository.js";
import { createPaymentRepository } from "../src/payment-repository.js";
import { createIikoDispatchRepository } from "../src/iiko-dispatch-repository.js";
import { createAdminOrderRepository } from "../src/admin-order-repository.js";
import { createAdminSegmentRepository } from "../src/admin-segment-repository.js";
import { createAdminPromoRepository } from "../src/admin-promo-repository.js";
import { createAdminCommunicationRepository, AdminCommunicationDraftIdempotencyConflictError, AdminCommunicationDraftVersionConflictError } from "../src/admin-communication-repository.js";
import { createCancellationRefundRepository } from "../src/cancellation-refund-repository.js";
import { createStaffRepository } from "../src/staff-repository.js";
import { createLoyaltyRepository } from "../src/loyalty-repository.js";
import { createWheelQuestRepository, WheelPrizeIdempotencyConflictError, WheelPrizeVersionConflictError, WheelSettingsVersionConflictError } from "../src/wheel-quest-repository.js";
import { orders, orderStatusHistory, wheelPrizes } from "../src/schema.js";
import { migrateDatabase } from "../src/migrate.js";

const databaseUrl = process.env["DATABASE_URL"];
const hasDatabaseUrl = databaseUrl !== undefined && databaseUrl.trim() !== "";

describe.skipIf(!hasDatabaseUrl)("PostgreSQL database and catalog", () => {
  let client: DatabaseClient;

  async function createOrderTestProduct(
    name: string,
    priceMinor = 45_050
  ) {
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

    return repository.createProduct({
      categoryId: Number(category["id"]),
      name,
      description: "Order integration fixture",
      priceMinor,
      imageUrl: null,
      emoji: "🥩",
      tag: null,
      isVisible: true,
      sortOrder: 999
    });
  }

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
      { table_schema: "public", table_name: "category_versions" },
      { table_schema: "public", table_name: "communication_draft_audit" },
      { table_schema: "public", table_name: "communication_drafts" },
      { table_schema: "public", table_name: "communication_template_versions" },
      { table_schema: "public", table_name: "customer_notification_devices" },
      { table_schema: "public", table_name: "customer_notification_preferences" },
      { table_schema: "public", table_name: "customer_sessions" },
      { table_schema: "public", table_name: "customers" },
      { table_schema: "public", table_name: "iiko_order_dispatches" },
      { table_schema: "public", table_name: "loyalty_accounts" },
      { table_schema: "public", table_name: "loyalty_ledger" },
      { table_schema: "public", table_name: "loyalty_rank_history" },
      { table_schema: "public", table_name: "loyalty_redemption_orders" },
      { table_schema: "public", table_name: "loyalty_redemptions" },
      { table_schema: "public", table_name: "loyalty_reward_versions" },
      { table_schema: "public", table_name: "loyalty_rewards" },
      { table_schema: "public", table_name: "order_cancellations" },
      { table_schema: "public", table_name: "order_customer_snapshots" },
      { table_schema: "public", table_name: "order_iiko_items" },
      { table_schema: "public", table_name: "order_items" },
      { table_schema: "public", table_name: "order_status_history" },
      { table_schema: "public", table_name: "orders" },
      { table_schema: "public", table_name: "payment_events" },
      { table_schema: "public", table_name: "payments" },
      { table_schema: "public", table_name: "products" },
      { table_schema: "public", table_name: "promo_definition_versions" },
      { table_schema: "public", table_name: "promo_definitions" },
      { table_schema: "public", table_name: "promo_redemptions" },
      { table_schema: "public", table_name: "quest_definition_versions" },
      { table_schema: "public", table_name: "quest_definitions" },
      { table_schema: "public", table_name: "quest_events" },
      { table_schema: "public", table_name: "quest_progress" },
      { table_schema: "public", table_name: "quest_reward_claims" },
      { table_schema: "public", table_name: "refund_events" },
      { table_schema: "public", table_name: "refunds" },
      { table_schema: "public", table_name: "sms_auth_challenges" },
      { table_schema: "public", table_name: "staff_audit_log" },
      { table_schema: "public", table_name: "staff_sessions" },
      { table_schema: "public", table_name: "staff_users" },
      { table_schema: "public", table_name: "wheel_prize_versions" },
      { table_schema: "public", table_name: "wheel_prizes" },
      { table_schema: "public", table_name: "wheel_reward_claims" },
      { table_schema: "public", table_name: "wheel_settings" },
      { table_schema: "public", table_name: "wheel_settings_versions" },
      { table_schema: "public", table_name: "wheel_spins" }
    ]);

    const seededCategories = await client.db.execute(sql`
      SELECT slug, name
      FROM categories
      ORDER BY sort_order
    `);
    expect(seededCategories.rows.length).toBeGreaterThanOrEqual(7);
  });

  it("persists communication drafts idempotently, versions mutations, and keeps append-only audit", async () => {
    const suffix = String(Date.now());
    const login = `m165-${suffix}`.slice(0, 80);
    const staffResult = await client.db.execute(sql`
      INSERT INTO staff_users (login, display_name, password_hash)
      VALUES (${login}, 'M16.5.1 fixture', 'fixture-hash')
      RETURNING id
    `);
    const staffId = Number((staffResult.rows[0] as Record<string, unknown> | undefined)?.["id"]);
    if (!Number.isInteger(staffId)) throw new Error("Could not create communications fixture staff");
    const repository = createAdminCommunicationRepository(client);
    const input = {
      idempotencyKey: `m165-draft-${suffix}`,
      payloadFingerprint: "a".repeat(64),
      templateCode: "promo",
      templateVersion: 1,
      templateTitle: "Промо-акция",
      body: "🔥 {name}, загляни в приложение",
      channel: "push" as const,
      delaySeconds: 60,
      segmentCode: "regulars",
      segmentDefinitionId: "regulars",
      segmentDefinitionVersion: 1,
      promoDefinitionId: null,
      promoDefinitionVersion: null,
      promoCode: null,
      promoType: null,
      promoValue: null,
      createdByStaffUserId: staffId,
      createdAt: new Date("2026-09-01T10:00:00.000Z")
    };
    try {
      const created = await repository.create(input);
      expect(created.created).toBe(true);
      expect(created.draft).toMatchObject({ status: "draft", version: 1, createdByStaffUserId: staffId, segmentDefinitionVersion: 1 });
      const repeated = await repository.create(input);
      expect(repeated.created).toBe(false);
      expect(repeated.draft.id).toBe(created.draft.id);
      await expect(repository.create({ ...input, payloadFingerprint: "b".repeat(64) })).rejects.toBeInstanceOf(AdminCommunicationDraftIdempotencyConflictError);

      const updated = await repository.update(created.draft.id, { ...input, expectedVersion: 1, body: "🔥 {name}, новое сообщение", actorStaffUserId: staffId, updatedAt: new Date("2026-09-01T10:01:00.000Z") });
      expect(updated?.draft).toMatchObject({ status: "draft", version: 2, body: "🔥 {name}, новое сообщение" });
      await expect(repository.update(created.draft.id, { ...input, expectedVersion: 1, actorStaffUserId: staffId, updatedAt: new Date("2026-09-01T10:02:00.000Z") })).rejects.toBeInstanceOf(AdminCommunicationDraftVersionConflictError);

      const previewed = await repository.markPreviewed(created.draft.id, { expectedVersion: 2, previewCount: 3, previewGeneratedAt: new Date("2026-09-01T10:03:00.000Z"), previewSegmentAsOf: new Date("2026-09-01T10:03:00.000Z"), actorStaffUserId: staffId, updatedAt: new Date("2026-09-01T10:03:00.000Z") });
      expect(previewed?.draft).toMatchObject({ status: "previewed", version: 3, previewCount: 3 });
      const archived = await repository.archive(created.draft.id, 3, staffId, new Date("2026-09-01T10:04:00.000Z"));
      expect(archived?.draft).toMatchObject({ status: "archived", version: 4 });
      expect((await repository.archive(created.draft.id, 3, staffId, new Date("2026-09-01T10:05:00.000Z")))?.draft.version).toBe(4);
      const restored = await repository.restore(created.draft.id, 4, staffId, new Date("2026-09-01T10:06:00.000Z"));
      expect(restored?.draft).toMatchObject({ status: "draft", version: 5, archivedAt: null, previewCount: 3 });
      expect((await repository.get(created.draft.id))?.audit.map((entry) => entry.action)).toEqual(["restored", "archived", "previewed", "updated", "created"]);
      const columns = await client.db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'communication_drafts' ORDER BY column_name`);
      expect(columns.rows.map((row) => row["column_name"])).not.toContain("phone");
      expect(columns.rows.map((row) => row["column_name"])).not.toContain("provider_payload");
    } finally {
      await client.db.execute(sql`DELETE FROM communication_draft_audit WHERE draft_id IN (SELECT id FROM communication_drafts WHERE idempotency_key = ${input.idempotencyKey})`);
      await client.db.execute(sql`DELETE FROM communication_drafts WHERE idempotency_key = ${input.idempotencyKey}`);
      await client.db.execute(sql`DELETE FROM staff_users WHERE id = ${staffId}`);
    }
  });

  it("persists promo definitions, immutable versions and an empty redemption audit", async () => {
    const suffix = String(Date.now());
    const code = `M164${suffix.slice(-8)}`.slice(0, 32).toUpperCase();
    const login = `m164-${suffix}`.slice(0, 80);
    const staffResult = await client.db.execute(sql`
      INSERT INTO staff_users (login, display_name, password_hash)
      VALUES (${login}, 'M16.4 fixture', 'fixture-hash')
      RETURNING id
    `);
    const staffId = Number((staffResult.rows[0] as Record<string, unknown> | undefined)?.["id"]);
    if (!Number.isInteger(staffId)) throw new Error("Could not create promo fixture staff");
    const repository = createAdminPromoRepository(client);
    let promoId: number | null = null;
    try {
      const created = await repository.create({ code, description: "Fixture promo", type: "percent", value: 10, minimumOrderMinor: 0, activeFrom: new Date("2026-09-01T00:00:00.000Z"), activeUntil: null, globalUsageLimit: null, perCustomerUsageLimit: null, staffUserId: staffId });
      promoId = created.id;
      expect(created.status).toBe("active");
      expect(created.usageCount).toBe(0);
      const listed = await repository.list({ limit: 50, offset: 0, search: code });
      expect(listed.rows).toHaveLength(1);
      expect((await repository.listRedemptions(created.id, { limit: 50, offset: 0 }))?.total).toBe(0);
      const updated = await repository.update(created.id, { description: "Fixture promo updated", staffUserId: staffId });
      expect(updated?.version).toBe(2);
      const archived = await repository.archive(created.id, staffId);
      expect(archived?.status).toBe("archived");
      const versionCount = await client.db.execute(sql`SELECT COUNT(*)::text AS count FROM promo_definition_versions WHERE promo_definition_id = ${created.id}`);
      expect(Number((versionCount.rows[0] as Record<string, unknown>)["count"])).toBe(3);
    } finally {
      if (promoId !== null) {
        await client.db.execute(sql`DELETE FROM promo_definition_versions WHERE promo_definition_id = ${promoId}`);
        await client.db.execute(sql`DELETE FROM promo_definitions WHERE id = ${promoId}`);
      }
      await client.db.execute(sql`DELETE FROM staff_users WHERE id = ${staffId}`);
    }
  });

  it("evaluates built-in segments from completed paid orders at local-day boundaries", async () => {
    const repository = createAdminSegmentRepository(client);
    const now = new Date("2026-09-01T10:00:00.000Z");
    const fixturePrefix = "+7999000016";
    const customers = new Map<string, number>();
    const orderIds: number[] = [];

    async function addCustomer(key: string): Promise<number> {
      const result = await client.db.execute(sql`
        INSERT INTO customers (phone, name)
        VALUES (${`${fixturePrefix}${key}`}, ${`M16.3 ${key}`})
        RETURNING id
      `);
      const id = Number((result.rows[0] as Record<string, unknown> | undefined)?.["id"]);
      if (!Number.isInteger(id)) throw new Error("Could not create segment fixture customer");
      customers.set(key, id);
      return id;
    }

    async function addPaidOrder(customerId: number, key: string, createdAt: string, totalMinor: number): Promise<void> {
      const orderResult = await client.db.execute(sql`
        INSERT INTO orders (
          customer_id, pickup_location_id, pickup_location_name, pickup_location_address,
          pickup_location_timezone, pickup_slot_id, pickup_slot_label, pickup_slot_starts_at,
          pickup_slot_ends_at, status, total_minor, currency, idempotency_key,
          payload_fingerprint, created_at, updated_at
        ) VALUES (
          ${customerId}, 'main-grill', 'Основная точка', 'ул. Жара, 1', 'Europe/Moscow',
          ${`m163-slot-${key}`}, 'M16.3 fixture', ${createdAt}, ${createdAt}::timestamptz + interval '30 minutes',
          'completed', ${totalMinor}, 'RUB', ${`m163-order-${key}`}, ${"a".repeat(64)}, ${createdAt}, ${createdAt}
        )
        RETURNING id
      `);
      const orderId = Number((orderResult.rows[0] as Record<string, unknown> | undefined)?.["id"]);
      if (!Number.isInteger(orderId)) throw new Error("Could not create segment fixture order");
      orderIds.push(orderId);
      await client.db.execute(sql`
        INSERT INTO payments (
          order_id, customer_id, provider, provider_payment_id, amount_minor, currency,
          status, provider_status, idempotency_key, payload_fingerprint, created_at, updated_at
        ) VALUES (
          ${orderId}, ${customerId}, 'yookassa', ${`m163-payment-${key}`}, ${totalMinor}, 'RUB',
          'succeeded', 'succeeded', ${`m163-payment-key-${key}`}, ${"b".repeat(64)}, ${createdAt}, ${createdAt}
        )
      `);
    }

    try {
      const sleeping = await addCustomer("1");
      const oneTimer = await addCustomer("2");
      const churned = await addCustomer("3");
      const newbie = await addCustomer("4");
      const regular = await addCustomer("5");
      const vip = await addCustomer("6");
      const bigSpender = await addCustomer("7");
      const coalRich = await addCustomer("8");
      const atRisk = await addCustomer("9");
      await addPaidOrder(sleeping, "a", "2026-08-02T10:00:00.000Z", 10_000);
      await addPaidOrder(oneTimer, "b", "2026-08-31T10:00:00.000Z", 10_000);
      await addPaidOrder(churned, "c", "2026-08-18T10:00:00.000Z", 10_000);
      await addPaidOrder(newbie, "d", "2026-08-25T10:00:00.000Z", 10_000);
      await addPaidOrder(regular, "e1", "2026-08-01T10:00:00.000Z", 10_000);
      await addPaidOrder(regular, "e2", "2026-08-02T10:00:00.000Z", 10_000);
      await addPaidOrder(regular, "e3", "2026-08-03T10:00:00.000Z", 10_000);
      await addPaidOrder(vip, "f", "2026-08-31T10:00:00.000Z", 500_000);
      await addPaidOrder(bigSpender, "g", "2026-08-31T10:00:00.000Z", 150_000);
      await addPaidOrder(atRisk, "i", "2026-08-25T10:00:00.000Z", 10_000);
      await client.db.execute(sql`
        INSERT INTO loyalty_accounts (customer_id, xp, coal_balance, rank_code, rank_version, version)
        VALUES (${coalRich}, 0, 300, 'spark', 1, 0)
      `);

      const counts = await repository.listBuiltinCounts(now);
      const countFor = (code: (typeof counts)[number]["code"]): number => {
        const value = counts.find((entry) => entry.code === code);
        if (value === undefined) throw new Error(`Missing ${code} count`);
        expect(value.unavailableReason).toBeNull();
        return value.count;
      };
      expect(countFor("sleeping")).toBeGreaterThanOrEqual(1);
      expect(countFor("one_timer")).toBeGreaterThanOrEqual(7);
      expect(countFor("churned")).toBeGreaterThanOrEqual(1);
      expect(countFor("newbies")).toBeGreaterThanOrEqual(1);
      expect(countFor("regulars")).toBeGreaterThanOrEqual(1);
      expect(countFor("vip")).toBeGreaterThanOrEqual(1);
      expect(countFor("big_spenders")).toBeGreaterThanOrEqual(1);
      const coalCount = counts.find((entry) => entry.code === "coal_rich");
      if (coalCount === undefined) throw new Error("Missing coal_rich count");
      if (coalCount.unavailableReason === null) expect(coalCount.count).toBeGreaterThanOrEqual(1);
      else expect(coalCount.unavailableReason).toBe("reconciliation_required");
      expect(countFor("at_risk")).toBeGreaterThanOrEqual(1);
      const preview = await repository.preview("regulars", { limit: 50, offset: 0 }, now);
      // The canonical dev database can contain other legitimate regular
      // customers from earlier QA runs; this fixture must be present, not be
      // the only qualifying customer in the shared database.
      expect(preview.total).toBeGreaterThanOrEqual(1);
      expect(preview.rows.find((row) => row.name === "M16.3 5")).toMatchObject({ phoneMasked: "•••• 0165" });
    } finally {
      await client.db.execute(sql`DELETE FROM payments WHERE provider_payment_id LIKE 'm163-payment-%'`);
      await client.db.execute(sql`DELETE FROM loyalty_accounts WHERE customer_id IN (SELECT id FROM customers WHERE phone LIKE ${`${fixturePrefix}%`})`);
      if (orderIds.length > 0) await client.db.execute(sql`DELETE FROM orders WHERE id IN (${sql.join(orderIds.map((id) => sql`${id}`), sql`, `)})`);
      await client.db.execute(sql`DELETE FROM customers WHERE phone LIKE ${`${fixturePrefix}%`}`);
    }
  });

  it("upserts one customer and revokes its hashed session", async () => {
    const repository = createCustomerRepository(client);
    const now = new Date("2026-09-01T10:00:00.000Z");
    const first = await repository.upsertCustomerAndCreateSession(
      { phone: "+79990000001", name: "Тест", birthDate: "1990-01-02" },
      { tokenHash: "a".repeat(64), expiresAt: new Date("2026-10-01T10:00:00.000Z") },
      now
    );
    const second = await repository.upsertCustomerAndCreateSession(
      { phone: "+79990000001", name: "Тест обновлён", birthDate: null },
      { tokenHash: "b".repeat(64), expiresAt: new Date("2026-10-01T10:00:00.000Z") },
      now
    );

    try {
      expect(second.customer.id).toBe(first.customer.id);
      expect(second.customer.name).toBe("Тест обновлён");
      await expect(repository.findActiveSession("b".repeat(64), now)).resolves.toMatchObject({
        customer: { phone: "+79990000001" }
      });
      await repository.revokeSession("b".repeat(64), now);
      await expect(repository.findActiveSession("b".repeat(64), now)).resolves.toBeNull();
    } finally {
      await client.db.execute(sql`DELETE FROM customers WHERE phone = '+79990000001'`);
    }
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

  it("reads current public prices for cart quotes and excludes hidden products", async () => {
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
      name: "Quote шашлык",
      description: "Проверка quote boundary",
      priceMinor: 12_345,
      imageUrl: null,
      emoji: "🥩",
      tag: null,
      isVisible: true,
      sortOrder: 998
    });

    try {
      await expect(repository.getProductsForQuote([created.id])).resolves.toEqual([
        { id: created.id, priceMinor: 12_345 }
      ]);

      await repository.updateProduct(created.id, { priceMinor: 22_000 });
      await expect(repository.getProductsForQuote([created.id])).resolves.toEqual([
        { id: created.id, priceMinor: 22_000 }
      ]);

      await repository.updateProduct(created.id, { isVisible: false });
      await expect(repository.getProductsForQuote([created.id])).resolves.toEqual([]);
    } finally {
      await client.db.execute(sql`DELETE FROM products WHERE id = ${created.id}`);
    }
  });

  it("persists order snapshots and initial status history atomically with idempotent replay", async () => {
    const customerRepository = createCustomerRepository(client);
    const orderRepository = createOrderRepository(client);
    const createdAt = new Date("2026-09-01T10:00:00.000Z");
    const customer = await customerRepository.upsertCustomerAndCreateSession(
      { phone: "+79990000009", name: "Заказчик", birthDate: null },
      { tokenHash: "c".repeat(64), expiresAt: new Date("2026-10-01T10:00:00.000Z") },
      createdAt
    );
    const product = await createOrderTestProduct("Исторический шашлык");
    const input = {
      customerId: customer.customer.id,
      idempotencyKey: "integration-order-1",
      payloadFingerprint: "d".repeat(64),
      pickup: {
        locationId: "main-grill",
        locationName: "Основная точка",
        locationAddress: "Основная точка самовывоза",
        locationTimezone: "Europe/Moscow",
        slotId: "slot-1",
        slotLabel: "Сегодня, 18:00–18:30",
        slotStartsAt: new Date("2026-09-01T15:00:00.000Z"),
        slotEndsAt: new Date("2026-09-01T15:30:00.000Z")
      },
      items: [
        {
          productId: product.id,
          productName: "Исторический шашлык",
          unitPriceMinor: 45_050,
          quantity: 2,
          lineTotalMinor: 90_100
        }
      ],
      totalMinor: 90_100,
      currency: "RUB",
      status: "pending_payment" as const,
      createdAt
    };

    try {
      const first = await orderRepository.createOrder(input);
      const replay = await orderRepository.createOrder(input);
      expect(replay.order.id).toBe(first.order.id);
      expect(replay.items).toEqual(first.items);
      expect(await orderRepository.listByCustomer(customer.customer.id)).toHaveLength(1);
      expect(
        await orderRepository.findByCustomerAndId(customer.customer.id, first.order.id)
      ).toMatchObject({
        order: { totalMinor: 90_100, status: "pending_payment" },
        items: [{ productName: "Исторический шашлык", unitPriceMinor: 45_050 }]
      });
      const customerSnapshot = await client.db.execute(sql`
        SELECT phone, name
        FROM order_customer_snapshots
        WHERE order_id = ${first.order.id}
      `);
      expect(customerSnapshot.rows).toEqual([{ phone: "+79990000009", name: "Заказчик" }]);

      const history = await client.db.execute(sql`
        SELECT status
        FROM order_status_history
        WHERE order_id = ${first.order.id}
      `);
      expect(history.rows).toEqual([{ status: "pending_payment" }]);

      await expect(
        orderRepository.createOrder({ ...input, payloadFingerprint: "e".repeat(64) })
      ).rejects.toThrow("Idempotency key was already used");

      await expect(
        orderRepository.createOrder({
          ...input,
          idempotencyKey: "integration-order-rollback",
          payloadFingerprint: "f".repeat(64),
          items: [{
            productId: product.id,
            productName: "Исторический шашлык",
            unitPriceMinor: 45_050,
            quantity: 2,
            lineTotalMinor: -1
          }],
          totalMinor: 0
        })
      ).rejects.toBeDefined();
      await expect(
        orderRepository.findByIdempotencyKey(
          customer.customer.id,
          "integration-order-rollback"
        )
      ).resolves.toBeNull();
    } finally {
      await client.db.execute(sql`DELETE FROM orders WHERE customer_id = ${customer.customer.id}`);
      await client.db.execute(sql`DELETE FROM products WHERE id = ${product.id}`);
      await client.db.execute(sql`DELETE FROM customers WHERE id = ${customer.customer.id}`);
    }
  });

  it("rejects an order when its catalog snapshot changed before the transaction", async () => {
    const customerRepository = createCustomerRepository(client);
    const orderRepository = createOrderRepository(client);
    const catalogRepository = createCatalogRepository(client);
    const createdAt = new Date("2026-09-01T10:30:00.000Z");
    const customer = await customerRepository.upsertCustomerAndCreateSession(
      { phone: "+79990000011", name: "Конкурентный заказ", birthDate: null },
      { tokenHash: "h".repeat(64), expiresAt: new Date("2026-10-01T10:00:00.000Z") },
      createdAt
    );
    const product = await createOrderTestProduct("Меняющийся шашлык");

    try {
      await catalogRepository.updateProduct(product.id, { priceMinor: 50_000 });
      await expect(orderRepository.createOrder({
        customerId: customer.customer.id,
        idempotencyKey: "stale-catalog-order",
        payloadFingerprint: "9".repeat(64),
        pickup: {
          locationId: "main-grill",
          locationName: "Основная точка",
          locationAddress: "Основная точка самовывоза",
          locationTimezone: "Europe/Moscow",
          slotId: "slot-stale",
          slotLabel: "Сегодня, 18:00–18:30",
          slotStartsAt: new Date("2026-09-01T15:00:00.000Z"),
          slotEndsAt: new Date("2026-09-01T15:30:00.000Z")
        },
        items: [{
          productId: product.id,
          productName: product.name,
          unitPriceMinor: 45_050,
          quantity: 1,
          lineTotalMinor: 45_050
        }],
        totalMinor: 45_050,
        currency: "RUB",
        status: "pending_payment",
        createdAt
      })).rejects.toThrow("Order catalog snapshot changed");
    } finally {
      await client.db.execute(sql`DELETE FROM orders WHERE customer_id = ${customer.customer.id}`);
      await client.db.execute(sql`DELETE FROM products WHERE id = ${product.id}`);
      await client.db.execute(sql`DELETE FROM customers WHERE id = ${customer.customer.id}`);
    }
  });

  it("persists one payment, confirms the order transactionally, and deduplicates provider events", async () => {
    const customerRepository = createCustomerRepository(client);
    const orderRepository = createOrderRepository(client);
    const paymentRepository = createPaymentRepository(client);
    const dispatchRepository = createIikoDispatchRepository(client);
    const catalogRepository = createCatalogRepository(client);
    const createdAt = new Date("2026-09-01T11:00:00.000Z");
    const customer = await customerRepository.upsertCustomerAndCreateSession(
      { phone: "+79990000010", name: "Плательщик", birthDate: null },
      { tokenHash: "g".repeat(64), expiresAt: new Date("2026-10-01T10:00:00.000Z") },
      createdAt
    );
    const product = await createOrderTestProduct("Платёжный шашлык");
    const order = await orderRepository.createOrder({
      customerId: customer.customer.id,
      idempotencyKey: "integration-payment-order",
      payloadFingerprint: "b".repeat(64),
      pickup: {
        locationId: "main-grill",
        locationName: "Основная точка",
        locationAddress: "Основная точка самовывоза",
        locationTimezone: "Europe/Moscow",
        slotId: "slot-1",
        slotLabel: "Сегодня, 18:00–18:30",
        slotStartsAt: new Date("2026-09-01T15:00:00.000Z"),
        slotEndsAt: new Date("2026-09-01T15:30:00.000Z")
      },
      items: [{
        productId: product.id,
        productName: product.name,
        unitPriceMinor: 45_050,
        quantity: 1,
        lineTotalMinor: 45_050
      }],
      iikoItems: [{
        productId: product.id,
        iikoProductId: "10000000-0000-4000-8000-000000000001"
      }],
      totalMinor: 45_050,
      currency: "RUB",
      status: "pending_payment",
      createdAt
    });

    try {
      const first = await paymentRepository.createPayment(
        {
          customerId: customer.customer.id,
          orderId: order.order.id,
          provider: "yookassa",
          idempotencyKey: "integration-payment-1",
          payloadFingerprint: "c".repeat(64),
          amountMinor: 45_050,
          currency: "RUB",
          createdAt
        },
        async () => ({
          providerPaymentId: "yk-integration-payment-1",
          providerStatus: "pending",
          amountMinor: 45_050,
          currency: "RUB",
          confirmationType: "redirect",
          confirmationUrl: "https://yoomoney.ru/checkout/integration"
        })
      );
      await catalogRepository.updateProduct(product.id, { priceMinor: 50_000 });
      const replay = await paymentRepository.createPayment(
        {
          customerId: customer.customer.id,
          orderId: order.order.id,
          provider: "yookassa",
          idempotencyKey: "integration-payment-1",
          payloadFingerprint: "c".repeat(64),
          amountMinor: 45_050,
          currency: "RUB",
          createdAt
        },
        async () => {
          throw new Error("provider must not be called on replay");
        }
      );
      expect(replay.payment.id).toBe(first.payment.id);

      const event = await paymentRepository.processProviderEvent({
        provider: "yookassa",
        providerPaymentId: "yk-integration-payment-1",
        eventType: "payment.succeeded",
        eventFingerprint: "d".repeat(64),
        providerStatus: "succeeded",
        amountMinor: 45_050,
        currency: "RUB",
        receivedAt: new Date("2026-09-01T11:01:00.000Z")
      });
      expect(event.ignored).toBe(false);
      expect(event.payment?.status).toBe("succeeded");
      await expect(
        paymentRepository.processProviderEvent({
          provider: "yookassa",
          providerPaymentId: "yk-integration-payment-1",
          eventType: "payment.succeeded",
          eventFingerprint: "d".repeat(64),
          providerStatus: "succeeded",
          amountMinor: 45_050,
          currency: "RUB",
          receivedAt: new Date("2026-09-01T11:02:00.000Z")
        })
      ).resolves.toMatchObject({ duplicate: true });
      await expect(
        paymentRepository.processProviderEvent({
          provider: "yookassa",
          providerPaymentId: "yk-integration-payment-1",
          eventType: "payment.waiting_for_capture",
          eventFingerprint: "e".repeat(64),
          providerStatus: "waiting_for_capture",
          amountMinor: 45_050,
          currency: "RUB",
          receivedAt: new Date("2026-09-01T11:03:00.000Z")
        })
      ).resolves.toMatchObject({ ignored: true, payment: { status: "succeeded" } });
      await expect(
        orderRepository.findByCustomerAndId(customer.customer.id, order.order.id)
      ).resolves.toMatchObject({ order: { status: "payment_confirmed" } });
      const dispatches = await client.db.execute(sql`
        SELECT order_id, status, attempt_count, provider_order_id, command_id, last_error_code
        FROM iiko_order_dispatches
        WHERE order_id = ${order.order.id}
      `);
      expect(dispatches.rows).toHaveLength(1);
      expect(dispatches.rows[0]).toMatchObject({
        order_id: order.order.id,
        status: "pending",
        attempt_count: 0,
        provider_order_id: null,
        command_id: null,
        last_error_code: null
      });

      const claimTime = new Date("2026-09-01T11:04:00.000Z");
      const [firstClaim, concurrentClaim] = await Promise.all([
        dispatchRepository.claimNextDue(claimTime, 30_000),
        dispatchRepository.claimNextDue(claimTime, 30_000)
      ]);
      const claimed = firstClaim ?? concurrentClaim;
      expect([firstClaim, concurrentClaim].filter((value) => value !== null)).toHaveLength(1);
      expect(claimed).toMatchObject({
        dispatch: {
          orderId: order.order.id,
          status: "creating",
          correlationId: expect.any(String)
        },
        order: { status: "payment_confirmed", totalMinor: 45_050 },
        items: [{ productId: product.id, iikoProductId: "10000000-0000-4000-8000-000000000001" }]
      });
      if (claimed === null) throw new Error("Expected one dispatch claim");

      const resumed = await dispatchRepository.claimNextDue(
        new Date(claimTime.getTime() + 30_001),
        30_000
      );
      expect(resumed).toMatchObject({
        dispatch: {
          id: claimed.dispatch.id,
          status: "creating",
          correlationId: claimed.dispatch.correlationId
        }
      });

      expect(
        await dispatchRepository.applyOrderStatus(
          order.order.id,
          "kitchen_accepted",
          new Date("2026-09-01T11:05:00.000Z")
        )
      ).toBe(true);
      expect(
        await dispatchRepository.applyOrderStatus(
          order.order.id,
          "kitchen_accepted",
          new Date("2026-09-01T11:06:00.000Z")
        )
      ).toBe(false);
      const statusHistory = await client.db.execute(sql`
        SELECT status
        FROM order_status_history
        WHERE order_id = ${order.order.id}
        ORDER BY id
      `);
      expect(statusHistory.rows.map((row) => row["status"])).toEqual([
        "pending_payment",
        "payment_confirmed",
        "kitchen_accepted"
      ]);
    } finally {
      await client.db.execute(sql`DELETE FROM payment_events WHERE provider_payment_id = 'yk-integration-payment-1'`);
      await client.db.execute(sql`DELETE FROM payments WHERE provider_payment_id = 'yk-integration-payment-1'`);
      await client.db.execute(sql`DELETE FROM orders WHERE id = ${order.order.id}`);
      await client.db.execute(sql`DELETE FROM products WHERE id = ${product.id}`);
      await client.db.execute(sql`DELETE FROM customers WHERE id = ${customer.customer.id}`);
    }
  });

  it("does not call the payment provider when the order catalog snapshot is stale", async () => {
    const customerRepository = createCustomerRepository(client);
    const orderRepository = createOrderRepository(client);
    const paymentRepository = createPaymentRepository(client);
    const catalogRepository = createCatalogRepository(client);
    const createdAt = new Date("2026-09-01T12:00:00.000Z");
    const customer = await customerRepository.upsertCustomerAndCreateSession(
      { phone: "+79990000012", name: "Проверка платежа", birthDate: null },
      { tokenHash: "i".repeat(64), expiresAt: new Date("2026-10-01T10:00:00.000Z") },
      createdAt
    );
    const product = await createOrderTestProduct("Снимок перед оплатой");
    const order = await orderRepository.createOrder({
      customerId: customer.customer.id,
      idempotencyKey: "integration-payment-stale-order",
      payloadFingerprint: "1".repeat(64),
      pickup: {
        locationId: "main-grill",
        locationName: "Основная точка",
        locationAddress: "Основная точка самовывоза",
        locationTimezone: "Europe/Moscow",
        slotId: "slot-stale-payment",
        slotLabel: "Сегодня, 18:00–18:30",
        slotStartsAt: new Date("2026-09-01T15:00:00.000Z"),
        slotEndsAt: new Date("2026-09-01T15:30:00.000Z")
      },
      items: [{
        productId: product.id,
        productName: product.name,
        unitPriceMinor: 45_050,
        quantity: 1,
        lineTotalMinor: 45_050
      }],
      totalMinor: 45_050,
      currency: "RUB",
      status: "pending_payment",
      createdAt
    });
    let providerWasCalled = false;

    try {
      await catalogRepository.updateProduct(product.id, { name: "Новое название" });
      await expect(paymentRepository.createPayment(
        {
          customerId: customer.customer.id,
          orderId: order.order.id,
          provider: "yookassa",
          idempotencyKey: "integration-payment-stale",
          payloadFingerprint: "2".repeat(64),
          amountMinor: 45_050,
          currency: "RUB",
          createdAt
        },
        async () => {
          providerWasCalled = true;
          throw new Error("provider must not be called for a stale order");
        }
      )).rejects.toThrow("Payment order state changed");
      expect(providerWasCalled).toBe(false);
    } finally {
      await client.db.execute(sql`DELETE FROM payments WHERE order_id = ${order.order.id}`);
      await client.db.execute(sql`DELETE FROM orders WHERE id = ${order.order.id}`);
      await client.db.execute(sql`DELETE FROM products WHERE id = ${product.id}`);
      await client.db.execute(sql`DELETE FROM customers WHERE id = ${customer.customer.id}`);
    }
  });

  it("turns a late payment success into one refund intent without creating an iiko dispatch", async () => {
    const customerRepository = createCustomerRepository(client);
    const orderRepository = createOrderRepository(client);
    const paymentRepository = createPaymentRepository(client);
    const dispatchRepository = createIikoDispatchRepository(client);
    const cancellationRepository = createCancellationRefundRepository(client);
    const createdAt = new Date("2026-09-03T12:00:00.000Z");
    const customer = await customerRepository.upsertCustomerAndCreateSession(
      { phone: "+79990000031", name: "M12 late payment", birthDate: null },
      { tokenHash: "l".repeat(64), expiresAt: new Date("2026-10-01T10:00:00.000Z") },
      createdAt
    );
    const product = await createOrderTestProduct("M12 late шашлык", 13_000);
    const order = await orderRepository.createOrder({
      customerId: customer.customer.id,
      idempotencyKey: "m12-late-order",
      payloadFingerprint: "d".repeat(64),
      pickup: {
        locationId: "main-grill",
        locationName: "Основная точка",
        locationAddress: "ул. Жара, 1",
        locationTimezone: "Europe/Moscow",
        slotId: "m12-late-slot",
        slotLabel: "Сегодня, 20:00–20:30",
        slotStartsAt: new Date("2026-09-03T17:00:00.000Z"),
        slotEndsAt: new Date("2026-09-03T17:30:00.000Z")
      },
      items: [{ productId: product.id, productName: product.name, unitPriceMinor: product.priceMinor, quantity: 1, lineTotalMinor: product.priceMinor }],
      totalMinor: product.priceMinor,
      currency: "RUB",
      status: "pending_payment",
      createdAt
    });
    const payment = await paymentRepository.createPayment({
      customerId: customer.customer.id,
      orderId: order.order.id,
      provider: "yookassa",
      idempotencyKey: "m12-late-payment",
      payloadFingerprint: "e".repeat(64),
      amountMinor: product.priceMinor,
      currency: "RUB",
      createdAt
    }, async () => ({ providerPaymentId: "yk-m12-late-payment", providerStatus: "pending", amountMinor: product.priceMinor, currency: "RUB", confirmationType: null, confirmationUrl: null }));
    try {
      await cancellationRepository.cancelOrder({ orderId: order.order.id, actorType: "customer", customerId: customer.customer.id, reasonCode: "customer_requested", idempotencyKey: "m12-late-cancel", now: new Date("2026-09-03T12:01:00.000Z") });
      await paymentRepository.processProviderEvent({ provider: "yookassa", providerPaymentId: payment.payment.providerPaymentId, eventType: "payment.succeeded", eventFingerprint: "f".repeat(64), providerStatus: "succeeded", amountMinor: product.priceMinor, currency: "RUB", receivedAt: new Date("2026-09-03T12:02:00.000Z") });
      const refund = await cancellationRepository.ensureRefundForSucceededPayment(payment.payment.id, new Date("2026-09-03T12:03:00.000Z"));
      expect(refund).toMatchObject({ status: "pending", amountMinor: product.priceMinor, currency: "RUB" });
      expect(await dispatchRepository.findByOrderId(order.order.id)).toBeNull();
      expect((await cancellationRepository.findByOrderId(order.order.id))?.order.status).toBe("canceled");
    } finally {
      await client.db.execute(sql`DELETE FROM refunds WHERE payment_id = ${payment.payment.id}`);
      await client.db.execute(sql`DELETE FROM order_cancellations WHERE order_id = ${order.order.id}`);
      await client.db.execute(sql`DELETE FROM payment_events WHERE provider_payment_id = 'yk-m12-late-payment'`);
      await client.db.execute(sql`DELETE FROM payments WHERE provider_payment_id = 'yk-m12-late-payment'`);
      await client.db.execute(sql`DELETE FROM orders WHERE id = ${order.order.id}`);
      await client.db.execute(sql`DELETE FROM products WHERE id = ${product.id}`);
      await client.db.execute(sql`DELETE FROM customers WHERE id = ${customer.customer.id}`);
    }
  });

  it("locks failed fulfillment recovery, preserves correlation, and audits one concurrent retry", async () => {
    const customerRepository = createCustomerRepository(client);
    const orderRepository = createOrderRepository(client);
    const paymentRepository = createPaymentRepository(client);
    const dispatchRepository = createIikoDispatchRepository(client);
    const adminOrderRepository = createAdminOrderRepository(client);
    const staffRepository = createStaffRepository(client);
    const createdAt = new Date("2026-09-02T10:00:00.000Z");
    const login = "m11-admin-recovery";
    const customer = await customerRepository.upsertCustomerAndCreateSession(
      { phone: "+79990000020", name: "Recovery customer", birthDate: null },
      { tokenHash: "j".repeat(64), expiresAt: new Date("2026-10-01T10:00:00.000Z") },
      createdAt
    );
    const product = await createOrderTestProduct("Recovery шашлык", 10_000);
    const order = await orderRepository.createOrder({
      customerId: customer.customer.id,
      idempotencyKey: "m11-recovery-order",
      payloadFingerprint: "e".repeat(64),
      pickup: {
        locationId: "main-grill",
        locationName: "Основная точка",
        locationAddress: "ул. Жара, 1",
        locationTimezone: "Europe/Moscow",
        slotId: "m11-recovery-slot",
        slotLabel: "Сегодня, 18:00–18:30",
        slotStartsAt: new Date("2026-09-02T15:00:00.000Z"),
        slotEndsAt: new Date("2026-09-02T15:30:00.000Z")
      },
      items: [{ productId: product.id, productName: product.name, unitPriceMinor: product.priceMinor, quantity: 1, lineTotalMinor: product.priceMinor }],
      iikoItems: [{ productId: product.id, iikoProductId: "10000000-0000-4000-8000-000000000020" }],
      totalMinor: product.priceMinor,
      currency: "RUB",
      status: "pending_payment",
      createdAt
    });
    const payment = await paymentRepository.createPayment(
      {
        customerId: customer.customer.id,
        orderId: order.order.id,
        provider: "yookassa",
        idempotencyKey: "m11-recovery-payment",
        payloadFingerprint: "c".repeat(64),
        amountMinor: product.priceMinor,
        currency: "RUB",
        createdAt
      },
      async () => ({ providerPaymentId: "yk-m11-recovery", providerStatus: "pending", amountMinor: product.priceMinor, currency: "RUB", confirmationType: null, confirmationUrl: null })
    );
    await paymentRepository.processProviderEvent({ provider: "yookassa", providerPaymentId: payment.payment.providerPaymentId, eventType: "payment.succeeded", eventFingerprint: "d".repeat(64), providerStatus: "succeeded", amountMinor: product.priceMinor, currency: "RUB", receivedAt: new Date("2026-09-02T10:01:00.000Z") });
    const dispatch = await dispatchRepository.findByOrderId(order.order.id);
    if (dispatch === null) throw new Error("Expected a payment dispatch");
    await dispatchRepository.failDispatch(dispatch.id, order.order.id, "retry_exhausted", new Date("2026-09-02T10:02:00.000Z"), 3);
    const staff = await staffRepository.createUser({ login, displayName: "M11 admin", passwordHash: "scrypt$16384$8$1$fixture$fixture", createdAt });

    try {
      const listed = await adminOrderRepository.list({ status: "fulfillment_problem", limit: 10, offset: 0 });
      expect(listed.orders.some((entry) => entry.order.id === order.order.id)).toBe(true);
      const [first, second] = await Promise.all([
        adminOrderRepository.retryFulfillment({ orderId: order.order.id, staffUserId: staff.id, requestId: "request-1", now: new Date("2026-09-02T10:03:00.000Z") }),
        adminOrderRepository.retryFulfillment({ orderId: order.order.id, staffUserId: staff.id, requestId: "request-2", now: new Date("2026-09-02T10:03:00.000Z") })
      ]);
      expect([first.mode, second.mode].sort()).toEqual(["already_in_progress", "create"]);
      expect(first.order.dispatch?.correlationId).toBe(dispatch.correlationId);
      expect(second.order.dispatch?.correlationId).toBe(dispatch.correlationId);
      expect((await dispatchRepository.findByOrderId(order.order.id))?.attemptCount).toBe(0);
      const audit = await client.db.execute(sql`
        SELECT action, order_id, request_id
        FROM staff_audit_log
        WHERE staff_user_id = ${staff.id} AND order_id = ${order.order.id}
      `);
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({ action: "order_fulfillment_retry", order_id: order.order.id });
    } finally {
      await client.db.execute(sql`DELETE FROM payment_events WHERE provider_payment_id = 'yk-m11-recovery'`);
      await client.db.execute(sql`DELETE FROM payments WHERE provider_payment_id = 'yk-m11-recovery'`);
      await client.db.execute(sql`DELETE FROM staff_users WHERE id = ${staff.id}`);
      await client.db.execute(sql`DELETE FROM orders WHERE id = ${order.order.id}`);
      await client.db.execute(sql`DELETE FROM products WHERE id = ${product.id}`);
      await client.db.execute(sql`DELETE FROM customers WHERE id = ${customer.customer.id}`);
    }
  });

  it("cancels a paid order once, blocks iiko after cancellation, and confirms one full refund", async () => {
    const customerRepository = createCustomerRepository(client);
    const orderRepository = createOrderRepository(client);
    const paymentRepository = createPaymentRepository(client);
    const dispatchRepository = createIikoDispatchRepository(client);
    const cancellationRepository = createCancellationRefundRepository(client);
    const createdAt = new Date("2026-09-03T10:00:00.000Z");
    const customer = await customerRepository.upsertCustomerAndCreateSession(
      { phone: "+79990000030", name: "M12 customer", birthDate: null },
      { tokenHash: "k".repeat(64), expiresAt: new Date("2026-10-01T10:00:00.000Z") },
      createdAt
    );
    const product = await createOrderTestProduct("M12 шашлык", 12_345);
    const order = await orderRepository.createOrder({
      customerId: customer.customer.id,
      idempotencyKey: "m12-order",
      payloadFingerprint: "a".repeat(64),
      pickup: {
        locationId: "main-grill",
        locationName: "Основная точка",
        locationAddress: "ул. Жара, 1",
        locationTimezone: "Europe/Moscow",
        slotId: "m12-slot",
        slotLabel: "Сегодня, 18:00–18:30",
        slotStartsAt: new Date("2026-09-03T15:00:00.000Z"),
        slotEndsAt: new Date("2026-09-03T15:30:00.000Z")
      },
      items: [{ productId: product.id, productName: product.name, unitPriceMinor: product.priceMinor, quantity: 1, lineTotalMinor: product.priceMinor }],
      totalMinor: product.priceMinor,
      currency: "RUB",
      status: "pending_payment",
      createdAt
    });
    const payment = await paymentRepository.createPayment({
      customerId: customer.customer.id,
      orderId: order.order.id,
      provider: "yookassa",
      idempotencyKey: "m12-payment",
      payloadFingerprint: "b".repeat(64),
      amountMinor: product.priceMinor,
      currency: "RUB",
      createdAt
    }, async () => ({ providerPaymentId: "yk-m12-payment", providerStatus: "pending", amountMinor: product.priceMinor, currency: "RUB", confirmationType: null, confirmationUrl: null }));
    await paymentRepository.processProviderEvent({
      provider: "yookassa",
      providerPaymentId: payment.payment.providerPaymentId,
      eventType: "payment.succeeded",
      eventFingerprint: "c".repeat(64),
      providerStatus: "succeeded",
      amountMinor: product.priceMinor,
      currency: "RUB",
      receivedAt: new Date("2026-09-03T10:01:00.000Z")
    });

    try {
      const [first, second] = await Promise.all([
        cancellationRepository.cancelOrder({ orderId: order.order.id, actorType: "customer", customerId: customer.customer.id, reasonCode: "customer_requested", idempotencyKey: "m12-cancel", now: new Date("2026-09-03T10:02:00.000Z") }),
        cancellationRepository.cancelOrder({ orderId: order.order.id, actorType: "customer", customerId: customer.customer.id, reasonCode: "customer_requested", idempotencyKey: "m12-cancel-retry", now: new Date("2026-09-03T10:02:00.000Z") })
      ]);
      expect([first.outcome, second.outcome].sort()).toEqual(["accepted", "already_canceled"]);
      expect(first.state.order.status).toBe("canceled");
      expect(first.state.refund).toMatchObject({ amountMinor: product.priceMinor, currency: "RUB", status: "pending" });
      expect(await dispatchRepository.claimNextDue(new Date("2026-09-03T10:03:00.000Z"), 30_000)).toBeNull();

      const claimed = await cancellationRepository.claimNextDue(new Date("2026-09-03T10:03:00.000Z"), 30_000);
      expect(claimed).not.toBeNull();
      if (claimed === null) throw new Error("Expected a refund claim");
      await expect(cancellationRepository.applyProviderResult(claimed.refund.id, {
        providerRefundId: "yk-m12-wrong-refund",
        providerStatus: "succeeded",
        paymentProviderId: payment.payment.providerPaymentId,
        amountMinor: 1,
        currency: "RUB"
      }, new Date("2026-09-03T10:03:30.000Z"))).rejects.toThrow("Refund state invariant failed");
      const confirmed = await cancellationRepository.applyProviderResult(claimed.refund.id, {
        providerRefundId: "yk-m12-refund",
        providerStatus: "succeeded",
        paymentProviderId: payment.payment.providerPaymentId,
        amountMinor: product.priceMinor,
        currency: "RUB"
      }, new Date("2026-09-03T10:04:00.000Z"));
      expect(confirmed).toMatchObject({ status: "succeeded", providerRefundId: "yk-m12-refund", amountMinor: product.priceMinor });
      const refundEvent = {
        provider: "yookassa" as const,
        providerRefundId: "yk-m12-refund",
        eventType: "refund.succeeded" as const,
        eventFingerprint: "d".repeat(64),
        providerStatus: "succeeded" as const,
        paymentProviderId: payment.payment.providerPaymentId,
        amountMinor: product.priceMinor,
        currency: "RUB",
        receivedAt: new Date("2026-09-03T10:05:00.000Z")
      };
      await expect(cancellationRepository.recordProviderEvent(refundEvent)).resolves.toMatchObject({ duplicate: false, ignored: false });
      await expect(cancellationRepository.recordProviderEvent(refundEvent)).resolves.toMatchObject({ duplicate: true, ignored: false });
      const history = await client.db.execute(sql`SELECT status FROM order_status_history WHERE order_id = ${order.order.id} ORDER BY id`);
      expect(history.rows.map((row) => row["status"])).toEqual(["pending_payment", "payment_confirmed", "canceled"]);
      const refunds = await client.db.execute(sql`SELECT COUNT(*) AS count FROM refunds WHERE payment_id = ${payment.payment.id}`);
      expect(refunds.rows[0]?.["count"]).toBe("1");
    } finally {
      await client.db.execute(sql`DELETE FROM refund_events WHERE provider_refund_id = 'yk-m12-refund'`);
      await client.db.execute(sql`DELETE FROM refunds WHERE payment_id = ${payment.payment.id}`);
      await client.db.execute(sql`DELETE FROM order_cancellations WHERE order_id = ${order.order.id}`);
      await client.db.execute(sql`DELETE FROM payment_events WHERE provider_payment_id = 'yk-m12-payment'`);
      await client.db.execute(sql`DELETE FROM payments WHERE provider_payment_id = 'yk-m12-payment'`);
      await client.db.execute(sql`DELETE FROM orders WHERE id = ${order.order.id}`);
      await client.db.execute(sql`DELETE FROM products WHERE id = ${product.id}`);
      await client.db.execute(sql`DELETE FROM customers WHERE id = ${customer.customer.id}`);
    }
  });

  it("earns completed paid orders once and keeps the aggregate equal to the append-only ledger", async () => {
    const customerRepository = createCustomerRepository(client);
    const orderRepository = createOrderRepository(client);
    const paymentRepository = createPaymentRepository(client);
    const dispatchRepository = createIikoDispatchRepository(client);
    const loyaltyRepository = createLoyaltyRepository(client);
    const createdAt = new Date("2026-09-04T10:00:00.000Z");
    const customer = await customerRepository.upsertCustomerAndCreateSession(
      { phone: "+79990000041", name: "M13 loyalty", birthDate: null },
      { tokenHash: "m".repeat(64), expiresAt: new Date("2026-10-01T10:00:00.000Z") },
      createdAt
    );
    const product = await createOrderTestProduct("M13 loyalty шашлык", 150_050);
    const order = await orderRepository.createOrder({
      customerId: customer.customer.id,
      idempotencyKey: "m13-loyalty-order",
      payloadFingerprint: "1".repeat(64),
      pickup: {
        locationId: "main-grill",
        locationName: "Основная точка",
        locationAddress: "ул. Жара, 1",
        locationTimezone: "Europe/Moscow",
        slotId: "m13-loyalty-slot",
        slotLabel: "Сегодня, 13:00–13:30",
        slotStartsAt: new Date("2026-09-04T10:00:00.000Z"),
        slotEndsAt: new Date("2026-09-04T10:30:00.000Z")
      },
      items: [{ productId: product.id, productName: product.name, unitPriceMinor: product.priceMinor, quantity: 1, lineTotalMinor: product.priceMinor }],
      totalMinor: product.priceMinor,
      currency: "RUB",
      status: "pending_payment",
      createdAt
    });
    const payment = await paymentRepository.createPayment({
      customerId: customer.customer.id,
      orderId: order.order.id,
      provider: "yookassa",
      idempotencyKey: "m13-loyalty-payment",
      payloadFingerprint: "2".repeat(64),
      amountMinor: product.priceMinor,
      currency: "RUB",
      createdAt
    }, async () => ({ providerPaymentId: "yk-m13-loyalty", providerStatus: "pending", amountMinor: product.priceMinor, currency: "RUB", confirmationType: null, confirmationUrl: null }));

    try {
      await paymentRepository.processProviderEvent({
        provider: "yookassa",
        providerPaymentId: payment.payment.providerPaymentId,
        eventType: "payment.succeeded",
        eventFingerprint: "3".repeat(64),
        providerStatus: "succeeded",
        amountMinor: product.priceMinor,
        currency: "RUB",
        receivedAt: new Date("2026-09-04T10:01:00.000Z")
      });
      expect(await loyaltyRepository.earnCompletedOrder({
        orderId: order.order.id,
        ruleVersion: 1,
        now: new Date("2026-09-04T10:02:00.000Z"),
        calculate: ({ order: completedOrder, account }) => ({
          xpDelta: Math.floor(completedOrder.totalMinor / 100),
          coalDelta: Math.floor(completedOrder.totalMinor / 10_000),
          nextRankCode: account.xp + Math.floor(completedOrder.totalMinor / 100) >= 1_000 ? "heat" : "spark",
          reason: "Завершённый оплаченный заказ"
        })
      })).toMatchObject({ status: "ineligible" });
      expect(await dispatchRepository.applyOrderStatus(order.order.id, "completed", new Date("2026-09-04T10:03:00.000Z"))).toBe(true);

      const earnInput = {
        orderId: order.order.id,
        ruleVersion: 1,
        now: new Date("2026-09-04T10:04:00.000Z"),
        calculate: ({ order: completedOrder, account }: { readonly order: typeof order.order; readonly payment: typeof payment.payment; readonly account: Awaited<ReturnType<typeof loyaltyRepository.getAccount>>["account"] }) => ({
          xpDelta: Math.floor(completedOrder.totalMinor / 100),
          coalDelta: Math.floor(completedOrder.totalMinor / 10_000),
          nextRankCode: account.xp + Math.floor(completedOrder.totalMinor / 100) >= 1_000 ? "heat" as const : "spark" as const,
          reason: "Завершённый оплаченный заказ"
        })
      };
      const [first, replay] = await Promise.all([
        loyaltyRepository.earnCompletedOrder(earnInput),
        loyaltyRepository.earnCompletedOrder({ ...earnInput, now: new Date("2026-09-04T10:05:00.000Z") })
      ]);
      expect([first.status, replay.status].sort()).toEqual(["already_earned", "earned"]);
      const account = await loyaltyRepository.getAccount(customer.customer.id, new Date("2026-09-04T10:06:00.000Z"));
      expect(account).toMatchObject({ account: { xp: 1_500, coalBalance: 15, rankCode: "heat", version: 1 }, ledgerXp: 1_500, ledgerCoal: 15, isConsistent: true });
      const ledger = await client.db.execute(sql`SELECT source_order_total_minor, source_order_currency, xp_delta, coal_delta, xp_balance, coal_balance FROM loyalty_ledger WHERE customer_id = ${customer.customer.id}`);
      expect(ledger.rows).toEqual([{ source_order_total_minor: "150050", source_order_currency: "RUB", xp_delta: 1500, coal_delta: 15, xp_balance: 1500, coal_balance: 15 }]);
      const rankHistory = await client.db.execute(sql`SELECT old_rank_code, new_rank_code, xp_snapshot FROM loyalty_rank_history WHERE customer_id = ${customer.customer.id}`);
      expect(rankHistory.rows).toEqual([{ old_rank_code: "spark", new_rank_code: "heat", xp_snapshot: 1500 }]);
    } finally {
      await client.db.execute(sql`DELETE FROM loyalty_rank_history WHERE customer_id = ${customer.customer.id}`);
      await client.db.execute(sql`DELETE FROM loyalty_ledger WHERE customer_id = ${customer.customer.id}`);
      await client.db.execute(sql`DELETE FROM loyalty_accounts WHERE customer_id = ${customer.customer.id}`);
      await client.db.execute(sql`DELETE FROM payment_events WHERE provider_payment_id = 'yk-m13-loyalty'`);
      await client.db.execute(sql`DELETE FROM payments WHERE provider_payment_id = 'yk-m13-loyalty'`);
      await client.db.execute(sql`DELETE FROM orders WHERE id = ${order.order.id}`);
      await client.db.execute(sql`DELETE FROM products WHERE id = ${product.id}`);
      await client.db.execute(sql`DELETE FROM customers WHERE id = ${customer.customer.id}`);
    }
  });

  it("grants one wheel spin and three quest projections from one completed paid order", async () => {
    const customerRepository = createCustomerRepository(client);
    const orderRepository = createOrderRepository(client);
    const paymentRepository = createPaymentRepository(client);
    const wheelQuestRepository = createWheelQuestRepository(client, {
      nextRankCode: (xp) => xp >= 15_000 ? "volcano" : xp >= 5_000 ? "flame" : xp >= 1_000 ? "heat" : "spark"
    });
    const activationResult = await client.db.execute(sql`SELECT extract(epoch FROM min(active_from)) AS seconds FROM quest_definitions`);
    const activationSeconds = Number((activationResult.rows[0] as { seconds: string }).seconds);
    const createdAt = new Date(Math.max(Date.now(), activationSeconds * 1_000) + 2_000);
    const customer = await customerRepository.upsertCustomerAndCreateSession(
      { phone: "+79990000042", name: "M14 customer", birthDate: null },
      { tokenHash: "m".repeat(64), expiresAt: new Date(createdAt.getTime() + 86_400_000) },
      createdAt
    );
    const product = await createOrderTestProduct("M14 wheel шашлык", 150_000);
    const order = await orderRepository.createOrder({
      customerId: customer.customer.id,
      idempotencyKey: "m14-wheel-order",
      payloadFingerprint: "4".repeat(64),
      pickup: { locationId: "main-grill", locationName: "Основная точка", locationAddress: "ул. Жара, 1", locationTimezone: "Europe/Moscow", slotId: "m14-wheel-slot", slotLabel: "Сегодня, 18:00–18:30", slotStartsAt: createdAt, slotEndsAt: new Date(createdAt.getTime() + 1_800_000) },
      items: [{ productId: product.id, productName: product.name, unitPriceMinor: product.priceMinor, quantity: 1, lineTotalMinor: product.priceMinor }],
      totalMinor: product.priceMinor,
      currency: "RUB",
      status: "pending_payment",
      createdAt
    });
    const payment = await paymentRepository.createPayment({ customerId: customer.customer.id, orderId: order.order.id, provider: "yookassa", idempotencyKey: "m14-wheel-payment", payloadFingerprint: "5".repeat(64), amountMinor: 150_000, currency: "RUB", createdAt }, async () => ({ providerPaymentId: "yk-m14-wheel", providerStatus: "pending", amountMinor: 150_000, currency: "RUB", confirmationType: null, confirmationUrl: null }));
    try {
      await client.db.execute(sql`UPDATE payments SET status = 'succeeded', provider_status = 'succeeded', updated_at = ${createdAt} WHERE id = ${payment.payment.id}`);
      await client.db.update(orders).set({ status: "completed", updatedAt: createdAt }).where(sql`id = ${order.order.id}`);
      await client.db.insert(orderStatusHistory).values({ orderId: order.order.id, status: "completed", createdAt });
      const state = await wheelQuestRepository.getWheelState(customer.customer.id, new Date(createdAt.getTime() + 1_000));
      expect(state?.eligibility).toMatchObject({ canSpin: true, eligibleOrderId: order.order.id });
      const firstSpin = await wheelQuestRepository.spin({ customerId: customer.customer.id, orderId: order.order.id, idempotencyKey: "m14-spin", now: new Date(createdAt.getTime() + 2_000), random: () => 0.8 });
      const replay = await wheelQuestRepository.spin({ customerId: customer.customer.id, orderId: order.order.id, idempotencyKey: "m14-spin", now: new Date(createdAt.getTime() + 3_000), random: () => 0.1 });
      expect(firstSpin.status).toBe("completed");
      expect(replay.status).toBe("already_completed");
      expect((await client.db.execute(sql`SELECT count(*) AS count FROM wheel_spins WHERE customer_id = ${customer.customer.id}`)).rows).toEqual([{ count: "1" }]);
      expect(await wheelQuestRepository.processQuestOrder(order.order.id, new Date(createdAt.getTime() + 4_000))).toMatchObject({ processedEvents: 3, rewardsApplied: 1 });
      expect(await wheelQuestRepository.processQuestOrder(order.order.id, new Date(createdAt.getTime() + 5_000))).toEqual({ processedEvents: 0, rewardsApplied: 0 });
      const questClaims = await client.db.execute(sql`SELECT count(*) AS count FROM quest_reward_claims WHERE customer_id = ${customer.customer.id} AND status = 'succeeded'`);
      expect(questClaims.rows).toEqual([{ count: "1" }]);
    } finally {
      await client.db.execute(sql`DELETE FROM quest_reward_claims WHERE customer_id = ${customer.customer.id}`);
      await client.db.execute(sql`DELETE FROM quest_events WHERE customer_id = ${customer.customer.id}`);
      await client.db.execute(sql`DELETE FROM quest_progress WHERE customer_id = ${customer.customer.id}`);
      await client.db.execute(sql`DELETE FROM wheel_reward_claims WHERE customer_id = ${customer.customer.id}`);
      await client.db.execute(sql`DELETE FROM wheel_spins WHERE customer_id = ${customer.customer.id}`);
      await client.db.execute(sql`DELETE FROM loyalty_rank_history WHERE customer_id = ${customer.customer.id}`);
      await client.db.execute(sql`DELETE FROM loyalty_ledger WHERE customer_id = ${customer.customer.id}`);
      await client.db.execute(sql`DELETE FROM loyalty_accounts WHERE customer_id = ${customer.customer.id}`);
      await client.db.execute(sql`DELETE FROM payments WHERE provider_payment_id = 'yk-m14-wheel'`);
      await client.db.execute(sql`DELETE FROM order_status_history WHERE order_id = ${order.order.id}`);
      await client.db.execute(sql`DELETE FROM orders WHERE id = ${order.order.id}`);
      await client.db.execute(sql`DELETE FROM products WHERE id = ${product.id}`);
      await client.db.execute(sql`DELETE FROM customers WHERE id = ${customer.customer.id}`);
    }
  });

  it("updates wheel settings atomically, versions each change and deduplicates retries", async () => {
    const suffix = String(Date.now());
    const login = `m143-${suffix}`.slice(0, 80);
    const staffResult = await client.db.execute(sql`
      INSERT INTO staff_users (login, display_name, password_hash)
      VALUES (${login}, 'M14.3 fixture', 'fixture-hash')
      RETURNING id
    `);
    const staffId = Number((staffResult.rows[0] as Record<string, unknown> | undefined)?.["id"]);
    if (!Number.isInteger(staffId)) throw new Error("Could not create wheel settings fixture staff");
    const repository = createWheelQuestRepository(client, { nextRankCode: () => "spark" });
    const initial = await repository.getAdminWheel();
    if (initial === null) throw new Error("Expected wheel settings singleton");
    const original = initial.settings;
    const requestId = `m143-request-${suffix}`;
    const idempotencyKey = `m143-settings-${suffix}`;
    const updatedAt = new Date();
    const input = {
      expectedVersion: original.version,
      enabled: false,
      minOrderAmountMinor: 200_000,
      cooldownSeconds: 3_600,
      maxSpins: 2,
      limitPeriodSeconds: 172_800,
      activeFrom: original.activeFrom,
      activeUntil: original.activeUntil,
      actorStaffUserId: staffId,
      requestId,
      idempotencyKey,
      payloadFingerprint: "c".repeat(64),
      now: updatedAt
    };
    try {
      const updated = await repository.updateWheelSettings(input);
      expect(updated.settings).toMatchObject({ enabled: false, minOrderAmountMinor: 200_000, cooldownSeconds: 3_600, maxSpins: 2, limitPeriodSeconds: 172_800, version: original.version + 1, updatedAt });
      const repeated = await repository.updateWheelSettings(input);
      expect(repeated.settings).toMatchObject({ version: original.version + 1, enabled: false, maxSpins: 2 });
      await expect(repository.updateWheelSettings({ ...input, expectedVersion: original.version, idempotencyKey: `${idempotencyKey}-stale`, payloadFingerprint: "d".repeat(64) })).rejects.toBeInstanceOf(WheelSettingsVersionConflictError);
      const history = await client.db.execute(sql`SELECT version, actor_staff_user_id, action, request_id, idempotency_key, min_order_amount_minor, cooldown_seconds, max_spins, limit_period_seconds FROM wheel_settings_versions WHERE idempotency_key = ${idempotencyKey}`);
      expect(history.rows).toEqual([{ version: original.version + 1, actor_staff_user_id: staffId, action: "updated", request_id: requestId, idempotency_key: idempotencyKey, min_order_amount_minor: 200000, cooldown_seconds: 3600, max_spins: 2, limit_period_seconds: 172800 }]);
    } finally {
      await client.db.execute(sql`DELETE FROM wheel_settings_versions WHERE actor_staff_user_id = ${staffId}`);
      await client.db.execute(sql`UPDATE wheel_settings SET enabled = ${original.enabled}, eligibility = ${original.eligibility}, min_order_amount_minor = ${original.minOrderAmountMinor}, currency = ${original.currency}, cooldown_seconds = ${original.cooldownSeconds}, max_spins = ${original.maxSpins}, limit_period_seconds = ${original.limitPeriodSeconds}, active_from = ${original.activeFrom}, active_until = ${original.activeUntil}, version = ${original.version}, updated_at = ${original.updatedAt} WHERE id = 1`);
      await client.db.execute(sql`DELETE FROM staff_users WHERE id = ${staffId}`);
    }
  });

  it("updates wheel prize type/value atomically, versions the snapshot and deduplicates retries", async () => {
    const suffix = String(Date.now());
    const login = `m144-${suffix}`.slice(0, 80);
    const staffResult = await client.db.execute(sql`
      INSERT INTO staff_users (login, display_name, password_hash)
      VALUES (${login}, 'M14.4 fixture', 'fixture-hash')
      RETURNING id
    `);
    const staffId = Number((staffResult.rows[0] as Record<string, unknown> | undefined)?.["id"]);
    if (!Number.isInteger(staffId)) throw new Error("Could not create wheel prize fixture staff");
    const [original] = await client.db.select().from(wheelPrizes).where(sql`code = 'no_prize'`).limit(1);
    if (original === undefined) throw new Error("Expected seeded no_prize");
    const repository = createWheelQuestRepository(client, { nextRankCode: () => "spark" });
    const requestId = `m144-request-${suffix}`;
    const idempotencyKey = `m144-prize-${suffix}`;
    const input = {
      expectedVersion: original.version,
      name: "M14.4 XP prize",
      description: "Versioned prize update",
      type: "xp" as const,
      value: 111,
      weight: 20,
      isVisible: true,
      activeFrom: original.activeFrom,
      activeUntil: original.activeUntil,
      sortOrder: original.sortOrder,
      actorStaffUserId: staffId,
      requestId,
      idempotencyKey,
      payloadFingerprint: "e".repeat(64),
      now: new Date()
    };
    try {
      const updated = await repository.updateWheelPrize(original.id, input);
      expect(updated).toMatchObject({ prizeType: "xp", value: 111, weight: 20, version: original.version + 1, name: "M14.4 XP prize" });
      const repeated = await repository.updateWheelPrize(original.id, input);
      expect(repeated).toMatchObject({ id: original.id, prizeType: "xp", value: 111, version: original.version + 1 });
      await expect(repository.updateWheelPrize(original.id, { ...input, payloadFingerprint: "f".repeat(64) })).rejects.toBeInstanceOf(WheelPrizeIdempotencyConflictError);
      await expect(repository.updateWheelPrize(original.id, { ...input, expectedVersion: original.version, idempotencyKey: `${idempotencyKey}-stale`, payloadFingerprint: "a".repeat(64) })).rejects.toBeInstanceOf(WheelPrizeVersionConflictError);
      const history = await client.db.execute(sql`
        SELECT version, action, code, prize_type, value, weight, actor_staff_user_id, request_id, idempotency_key
        FROM wheel_prize_versions
        WHERE idempotency_key = ${idempotencyKey}
      `);
      expect(history.rows).toEqual([{ version: original.version + 1, action: "updated", code: original.code, prize_type: "xp", value: 111, weight: 20, actor_staff_user_id: staffId, request_id: requestId, idempotency_key: idempotencyKey }]);
    } finally {
      await client.db.execute(sql`DELETE FROM wheel_prize_versions WHERE actor_staff_user_id = ${staffId}`);
      await client.db.execute(sql`
        UPDATE wheel_prizes
        SET name = ${original.name}, description = ${original.description}, prize_type = ${original.prizeType}, value = ${original.value}, weight = ${original.weight}, is_visible = ${original.isVisible}, active_from = ${original.activeFrom}, active_until = ${original.activeUntil}, sort_order = ${original.sortOrder}, version = ${original.version}, updated_at = ${original.updatedAt}
        WHERE id = ${original.id}
      `);
      await client.db.execute(sql`DELETE FROM staff_users WHERE id = ${staffId}`);
    }
  });
});
