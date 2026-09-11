import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDatabaseClient,
  createLoyaltyRepository,
  LoyaltyInsufficientBalanceError,
  LoyaltyRedemptionLimitError,
  migrateDatabase,
  type DatabaseClient
} from "../src/index.js";

const databaseUrl = process.env["DATABASE_URL"];
const hasDatabaseUrl = databaseUrl !== undefined && databaseUrl.trim() !== "";

describe.skipIf(!hasDatabaseUrl)("loyalty redemption PostgreSQL boundary", () => {
  let client: DatabaseClient;

  beforeAll(async () => {
    client = createDatabaseClient({ url: databaseUrl as string });
    await migrateDatabase(client);
  });

  afterAll(async () => {
    await client.close();
  });

  it("debits once, is idempotent, preserves snapshots, and rejects insufficient balance", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const login = `m135-${suffix}`.slice(0, 80);
    const phone = `+7999${String(Date.now()).slice(-7)}`;
    const staffResult = await client.db.execute(sql`
      INSERT INTO staff_users (login, display_name, password_hash)
      VALUES (${login}, 'M13.5 fixture', 'fixture-hash')
      RETURNING id
    `);
    const staffId = Number((staffResult.rows[0] as Record<string, unknown>)["id"]);
    const customerResult = await client.db.execute(sql`
      INSERT INTO customers (phone, name)
      VALUES (${phone}, 'M13.5 fixture')
      RETURNING id
    `);
    const customerId = Number((customerResult.rows[0] as Record<string, unknown>)["id"]);
    const now = new Date("2026-09-08T10:00:00.000Z");
    const accountResult = await client.db.execute(sql`
      INSERT INTO loyalty_accounts (customer_id, xp, coal_balance, rank_code, rank_version, version, created_at, updated_at)
      VALUES (${customerId}, 0, 10, 'spark', 1, 1, ${now}, ${now})
      RETURNING id
    `);
    const accountId = Number((accountResult.rows[0] as Record<string, unknown>)["id"]);
    await client.db.execute(sql`
      INSERT INTO loyalty_ledger (loyalty_account_id, customer_id, entry_type, source_type, source_id, rule_version, idempotency_key, xp_delta, coal_delta, xp_balance, coal_balance, reason, actor_type, created_at)
      VALUES (${accountId}, ${customerId}, 'earned', 'quest_reward', ${`fixture-${suffix}`}, 1, ${`fixture-ledger-${suffix}`}, 0, 10, 0, 10, 'M13.5 fixture', 'system', ${now})
    `);
    const repository = createLoyaltyRepository(client);
    let rewardId: number | null = null;
    let expensiveRewardId: number | null = null;
    try {
      const created = await repository.createRewardDefinition!({
        code: `fixture-${suffix}`.replace(/[^a-z0-9-]/gu, "").slice(0, 80),
        name: "Скидка fixture",
        description: "",
        costCoal: 3,
        rewardType: "fixed_discount",
        fulfillmentTargetType: "fixed_discount",
        fulfillmentDiscountMinor: 300,
        isVisible: true,
        activeFrom: null,
        activeUntil: null,
        sortOrder: 0,
        perCustomerUsageLimit: 1,
        actorStaffUserId: staffId,
        requestId: `request-${suffix}`,
        idempotencyKey: `reward-create-${suffix}`,
        payloadFingerprint: "a".repeat(64),
        now
      });
      rewardId = created.id;
      const first = await repository.redeem!({ customerId, rewardId, idempotencyKey: `redeem-${suffix}`, now });
      const replay = await repository.redeem!({ customerId, rewardId, idempotencyKey: `redeem-${suffix}`, now });
      expect(first.redemption.id).toBe(replay.redemption.id);
      expect(first.coalBalance).toBe(7);
      expect((await repository.listRedemptions!(customerId, 50, 0)).total).toBe(1);
      const ledgerRows = await client.db.execute(sql`SELECT COUNT(*)::text AS count FROM loyalty_ledger WHERE customer_id = ${customerId} AND source_type = 'redemption'`);
      expect(Number((ledgerRows.rows[0] as Record<string, unknown>)["count"])).toBe(1);
      await expect(repository.redeem!({ customerId, rewardId, idempotencyKey: `redeem-second-${suffix}`, now })).rejects.toBeInstanceOf(LoyaltyRedemptionLimitError);

      const updated = await repository.updateRewardDefinition!({
        id: rewardId,
        expectedVersion: created.version,
        fulfillmentDiscountMinor: 500,
        actorStaffUserId: staffId,
        requestId: `request-update-${suffix}`,
        idempotencyKey: `reward-update-${suffix}`,
        payloadFingerprint: "b".repeat(64),
        now
      });
      expect(updated.fulfillmentDiscountMinor).toBe(500);
      const snapshot = await repository.getRedemption!(customerId, first.redemption.id);
      expect(snapshot?.discountMinor).toBe(300);

      const expensive = await repository.createRewardDefinition!({
        code: `expensive-${suffix}`.replace(/[^a-z0-9-]/gu, "").slice(0, 80),
        name: "Дорогая скидка fixture",
        description: "",
        costCoal: 20,
        rewardType: "fixed_discount",
        fulfillmentTargetType: "fixed_discount",
        fulfillmentDiscountMinor: 1_000,
        isVisible: true,
        activeFrom: null,
        activeUntil: null,
        sortOrder: 1,
        perCustomerUsageLimit: null,
        actorStaffUserId: staffId,
        requestId: `request-expensive-${suffix}`,
        idempotencyKey: `reward-expensive-${suffix}`,
        payloadFingerprint: "c".repeat(64),
        now
      });
      expensiveRewardId = expensive.id;
      await expect(repository.redeem!({ customerId, rewardId: expensive.id, idempotencyKey: `redeem-expensive-${suffix}`, now })).rejects.toBeInstanceOf(LoyaltyInsufficientBalanceError);
    } finally {
      await client.db.execute(sql`DELETE FROM loyalty_redemption_orders WHERE customer_id = ${customerId}`);
      await client.db.execute(sql`DELETE FROM loyalty_ledger WHERE customer_id = ${customerId}`);
      await client.db.execute(sql`DELETE FROM loyalty_redemptions WHERE customer_id = ${customerId}`);
      if (rewardId !== null) await client.db.execute(sql`DELETE FROM loyalty_reward_versions WHERE reward_id = ${rewardId}`);
      if (expensiveRewardId !== null) await client.db.execute(sql`DELETE FROM loyalty_reward_versions WHERE reward_id = ${expensiveRewardId}`);
      if (rewardId !== null) await client.db.execute(sql`DELETE FROM loyalty_rewards WHERE id = ${rewardId}`);
      if (expensiveRewardId !== null) await client.db.execute(sql`DELETE FROM loyalty_rewards WHERE id = ${expensiveRewardId}`);
      await client.db.execute(sql`DELETE FROM loyalty_accounts WHERE customer_id = ${customerId}`);
      await client.db.execute(sql`DELETE FROM customers WHERE id = ${customerId}`);
      await client.db.execute(sql`DELETE FROM staff_users WHERE id = ${staffId}`);
    }
  });
});
