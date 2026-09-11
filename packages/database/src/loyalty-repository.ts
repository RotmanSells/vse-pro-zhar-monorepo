import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";
import {
  customers,
  loyaltyAccounts,
  loyaltyLedger,
  loyaltyRankHistory,
  loyaltyRedemptions,
  loyaltyRewardVersions,
  loyaltyRewards,
  orders,
  payments,
  type CustomerRecord,
  type LoyaltyAccountRecord,
  type LoyaltyLedgerRecord,
  type LoyaltyRedemptionRecord,
  type LoyaltyRewardRecord,
  type OrderRecord,
  type PaymentRecord
} from "./schema.js";

export type LoyaltyRankCode = "spark" | "heat" | "flame" | "volcano";
export type LoyaltyLedgerEntryType = "earned" | "spent" | "correction";
export type LoyaltyRewardSourceType = "wheel_spin" | "quest_reward";
export type LoyaltyRewardDefinitionType = "fixed_discount";

export interface LoyaltyRewardDefinitionInput {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly costCoal: number;
  readonly rewardType: LoyaltyRewardDefinitionType;
  readonly fulfillmentTargetType: LoyaltyRewardDefinitionType;
  readonly fulfillmentDiscountMinor: number;
  readonly isVisible: boolean;
  readonly isArchived?: boolean;
  readonly activeFrom: Date | null;
  readonly activeUntil: Date | null;
  readonly sortOrder: number;
  readonly perCustomerUsageLimit: number | null;
  readonly actorStaffUserId: number;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly now: Date;
}

export interface LoyaltyRewardDefinitionUpdateInput {
  readonly id: number;
  readonly expectedVersion: number;
  readonly name?: string;
  readonly description?: string;
  readonly costCoal?: number;
  readonly fulfillmentDiscountMinor?: number;
  readonly isVisible?: boolean;
  readonly isArchived?: boolean;
  readonly activeFrom?: Date | null;
  readonly activeUntil?: Date | null;
  readonly sortOrder?: number;
  readonly perCustomerUsageLimit?: number | null;
  readonly actorStaffUserId: number;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly now: Date;
}

export interface LoyaltyRedemptionCheckoutSnapshot {
  readonly id: number;
  readonly customerId: number;
  readonly rewardCode: string;
  readonly rewardName: string;
  readonly rewardType: LoyaltyRewardDefinitionType;
  readonly discountMinor: number;
  readonly expiresAt: Date;
  readonly status: "pending";
}

export interface LoyaltyRedemptionResult {
  readonly redemption: LoyaltyRedemptionRecord;
  readonly coalBalance: number;
}

export interface LoyaltyRedemptionListResult {
  readonly redemptions: readonly LoyaltyRedemptionRecord[];
  readonly total: number;
}

export interface LoyaltyAccountAggregate {
  readonly account: LoyaltyAccountRecord;
  readonly ledgerXp: number;
  readonly ledgerCoal: number;
  readonly isConsistent: boolean;
}

export interface LoyaltyLedgerListResult {
  readonly entries: readonly LoyaltyLedgerRecord[];
  readonly total: number;
  readonly account: LoyaltyAccountAggregate;
}

export interface AdminLoyaltyLedgerEntry {
  readonly entry: LoyaltyLedgerRecord;
  readonly customer: Pick<CustomerRecord, "id" | "name" | "phone">;
}

export interface AdminLoyaltyLedgerListResult {
  readonly entries: readonly AdminLoyaltyLedgerEntry[];
  readonly total: number;
  readonly isConsistent: boolean;
}

export interface LoyaltyEarnCandidate {
  readonly order: OrderRecord;
  readonly payment: PaymentRecord;
}

export interface LoyaltyEarnCalculation {
  readonly xpDelta: number;
  readonly coalDelta: number;
  readonly nextRankCode: LoyaltyRankCode;
  readonly reason: string;
}

export interface LoyaltyEarnTransactionInput {
  readonly orderId: number;
  readonly ruleVersion: number;
  readonly now: Date;
  readonly calculate: (input: {
    readonly order: OrderRecord;
    readonly payment: PaymentRecord;
    readonly account: LoyaltyAccountRecord;
  }) => LoyaltyEarnCalculation;
}

export interface LoyaltyEarnResult {
  readonly status: "earned" | "already_earned" | "ineligible";
  readonly ledger: LoyaltyLedgerRecord | null;
  readonly account: LoyaltyAccountRecord | null;
  readonly rankChanged: boolean;
}

export interface LoyaltyRewardInput {
  readonly customerId: number;
  readonly sourceType: LoyaltyRewardSourceType;
  readonly sourceId: string;
  readonly ruleVersion: number;
  readonly idempotencyKey: string;
  readonly xpDelta: number;
  readonly coalDelta: number;
  readonly sourceOrderId?: number | null;
  readonly sourceOrderTotalMinor?: number | null;
  readonly sourceOrderCurrency?: string | null;
  readonly reason: string;
  readonly now: Date;
  readonly nextRankCode: (xp: number) => LoyaltyRankCode;
}

export interface LoyaltyRewardResult {
  readonly status: "applied" | "already_applied";
  readonly ledger: LoyaltyLedgerRecord;
  readonly account: LoyaltyAccountRecord;
  readonly rankChanged: boolean;
}

export interface LoyaltyLedgerFilters {
  readonly customerId?: number;
  readonly orderId?: number;
  readonly entryType?: LoyaltyLedgerEntryType;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly offset: number;
}

export class LoyaltyInvariantError extends Error {
  constructor() {
    super("Loyalty invariant is invalid");
    this.name = "LoyaltyInvariantError";
  }
}

export class LoyaltyRewardCodeConflictError extends Error { constructor() { super("Loyalty reward code already exists"); this.name = "LoyaltyRewardCodeConflictError"; } }
export class LoyaltyRewardIdempotencyConflictError extends Error { constructor() { super("Loyalty reward idempotency key conflicts"); this.name = "LoyaltyRewardIdempotencyConflictError"; } }
export class LoyaltyRewardVersionConflictError extends Error { constructor() { super("Loyalty reward version conflicts"); this.name = "LoyaltyRewardVersionConflictError"; } }
export class LoyaltyRewardNotFoundError extends Error { constructor() { super("Loyalty reward was not found"); this.name = "LoyaltyRewardNotFoundError"; } }
export class LoyaltyRedemptionIdempotencyConflictError extends Error { constructor() { super("Loyalty redemption idempotency key conflicts"); this.name = "LoyaltyRedemptionIdempotencyConflictError"; } }
export class LoyaltyInsufficientBalanceError extends Error { constructor() { super("Loyalty balance is insufficient"); this.name = "LoyaltyInsufficientBalanceError"; } }
export class LoyaltyRedemptionLimitError extends Error { constructor() { super("Loyalty reward usage limit reached"); this.name = "LoyaltyRedemptionLimitError"; } }
export class LoyaltyRedemptionUnavailableError extends Error { constructor() { super("Loyalty redemption is unavailable"); this.name = "LoyaltyRedemptionUnavailableError"; } }
export class LoyaltyRedemptionNotFoundError extends Error { constructor() { super("Loyalty redemption was not found"); this.name = "LoyaltyRedemptionNotFoundError"; } }
export class LoyaltyRedemptionReconciliationError extends Error { constructor() { super("Loyalty redemption requires reconciliation"); this.name = "LoyaltyRedemptionReconciliationError"; } }

type DbQuery = Pick<DatabaseClient["db"], "select" | "insert" | "update">;
export type LoyaltyTransactionQuery = DbQuery;

function isSafeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647;
}

function isSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= -2_147_483_647 && value <= 2_147_483_647;
}

const REDEMPTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function validateRewardDefinitionValues(input: {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly costCoal: number;
  readonly rewardType: string;
  readonly fulfillmentTargetType: string;
  readonly fulfillmentDiscountMinor: number | null;
  readonly isVisible: boolean;
  readonly isArchived: boolean;
  readonly activeFrom: Date | null;
  readonly activeUntil: Date | null;
  readonly sortOrder: number;
  readonly perCustomerUsageLimit: number | null;
}): void {
  if (
    !/^[a-z0-9][a-z0-9_-]{0,79}$/u.test(input.code) ||
    input.name.trim() === "" || input.name.length > 160 ||
    input.description.length > 2048 ||
    !isSafeNonNegativeInteger(input.costCoal) || input.costCoal < 1 ||
    input.rewardType !== "fixed_discount" || input.fulfillmentTargetType !== "fixed_discount" ||
    input.fulfillmentDiscountMinor === null || !isSafeNonNegativeInteger(input.fulfillmentDiscountMinor) || input.fulfillmentDiscountMinor < 1 ||
    typeof input.isVisible !== "boolean" || typeof input.isArchived !== "boolean" ||
    input.isArchived && input.isVisible ||
    !isSafeNonNegativeInteger(input.sortOrder) ||
    input.perCustomerUsageLimit !== null && (!isSafeNonNegativeInteger(input.perCustomerUsageLimit) || input.perCustomerUsageLimit < 1) ||
    input.activeFrom !== null && Number.isNaN(input.activeFrom.getTime()) ||
    input.activeUntil !== null && Number.isNaN(input.activeUntil.getTime()) ||
    input.activeFrom !== null && input.activeUntil !== null && input.activeUntil <= input.activeFrom
  ) throw new LoyaltyInvariantError();
}

function validateRewardRecord(reward: LoyaltyRewardRecord): void {
  validateRewardDefinitionValues({
    code: reward.code,
    name: reward.name,
    description: reward.description,
    costCoal: reward.costCoal,
    rewardType: reward.rewardType,
    fulfillmentTargetType: reward.fulfillmentTargetType,
    fulfillmentDiscountMinor: reward.fulfillmentDiscountMinor,
    isVisible: reward.isVisible,
    isArchived: reward.isArchived,
    activeFrom: reward.activeFrom,
    activeUntil: reward.activeUntil,
    sortOrder: reward.sortOrder,
    perCustomerUsageLimit: reward.perCustomerUsageLimit
  });
  if (!isSafeNonNegativeInteger(reward.id) || reward.id < 1 || !isSafeNonNegativeInteger(reward.version) || reward.version < 1) throw new LoyaltyInvariantError();
}

function isActiveReward(reward: LoyaltyRewardRecord, now: Date): boolean {
  validateRewardRecord(reward);
  return !reward.isArchived && reward.isVisible &&
    (reward.activeFrom === null || reward.activeFrom <= now) &&
    (reward.activeUntil === null || reward.activeUntil > now);
}

function redemptionCheckoutSnapshot(redemption: LoyaltyRedemptionRecord, now: Date): LoyaltyRedemptionCheckoutSnapshot | null {
  if (
    redemption.status !== "pending" || redemption.rewardType !== "fixed_discount" ||
    redemption.fulfillmentTargetType !== "fixed_discount" ||
    !isSafeNonNegativeInteger(redemption.discountMinor) || redemption.discountMinor < 1 ||
    redemption.expiresAt <= now
  ) return null;
  return {
    id: redemption.id,
    customerId: redemption.customerId,
    rewardCode: redemption.rewardCode,
    rewardName: redemption.rewardName,
    rewardType: "fixed_discount",
    discountMinor: redemption.discountMinor,
    expiresAt: redemption.expiresAt,
    status: "pending"
  };
}

function sourceIdForOrder(orderId: number): string {
  return String(orderId);
}

async function ensureAccount(
  query: DbQuery,
  customerId: number,
  now: Date,
  lock = false
): Promise<LoyaltyAccountRecord> {
  await query
    .insert(loyaltyAccounts)
    .values({ customerId, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: loyaltyAccounts.customerId });

  const statement = query
    .select()
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.customerId, customerId))
    .limit(1);
  const rows = lock ? await statement.for("update") : await statement;
  const [account] = rows;
  if (account === undefined) throw new LoyaltyInvariantError();
  return account;
}

async function readAccountAggregate(
  query: DbQuery,
  customerId: number,
  now: Date,
  lock = false
): Promise<LoyaltyAccountAggregate> {
  const account = await ensureAccount(query, customerId, now, lock);
  return readAccountAggregateForAccount(query, account);
}

async function readAccountAggregateForAccount(
  query: DbQuery,
  account: LoyaltyAccountRecord
): Promise<LoyaltyAccountAggregate> {
  const [projection] = await query
    .select({
      xp: sql<string>`coalesce(sum(${loyaltyLedger.xpDelta}), 0)`,
      coal: sql<string>`coalesce(sum(${loyaltyLedger.coalDelta}), 0)`
    })
    .from(loyaltyLedger)
    .where(eq(loyaltyLedger.loyaltyAccountId, account.id));
  const ledgerXp = Number(projection?.xp ?? 0);
  const ledgerCoal = Number(projection?.coal ?? 0);
  const isConsistent =
    isSafeNonNegativeInteger(account.xp) &&
    isSafeNonNegativeInteger(account.coalBalance) &&
    Number.isSafeInteger(account.version) &&
    account.version >= 0 &&
    isSafeInteger(ledgerXp) &&
    isSafeInteger(ledgerCoal) &&
    ledgerXp === account.xp &&
    ledgerCoal === account.coalBalance;
  return { account, ledgerXp, ledgerCoal, isConsistent };
}

async function readExistingAccountAggregate(
  query: DbQuery,
  customerId: number
): Promise<LoyaltyAccountAggregate | null> {
  const [account] = await query
    .select()
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.customerId, customerId))
    .limit(1);
  return account === undefined ? null : readAccountAggregateForAccount(query, account);
}

async function readLatestPayment(
  query: DbQuery,
  orderId: number,
  lock = false
): Promise<PaymentRecord | null> {
  const statement = query
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .orderBy(desc(payments.id))
    .limit(1);
  const rows = lock ? await statement.for("update") : await statement;
  const [payment] = rows;
  return payment ?? null;
}

function isEarnEligible(order: OrderRecord, payment: PaymentRecord | null): payment is PaymentRecord {
  return (
    order.status === "completed" &&
    payment !== null &&
    payment.status === "succeeded" &&
    payment.providerStatus === "succeeded" &&
    payment.provider === "yookassa" &&
    payment.amountMinor === order.totalMinor &&
    payment.currency === order.currency &&
    order.currency === "RUB" &&
    isSafeNonNegativeInteger(order.totalMinor)
  );
}

function validateCalculation(calculation: LoyaltyEarnCalculation): void {
  if (
    !isSafeInteger(calculation.xpDelta) ||
    calculation.xpDelta < 0 ||
    !isSafeInteger(calculation.coalDelta) ||
    calculation.coalDelta < 0 ||
    calculation.reason.trim() === "" ||
    !["spark", "heat", "flame", "volcano"].includes(calculation.nextRankCode)
  ) {
    throw new LoyaltyInvariantError();
  }
}

function validateRewardInput(input: LoyaltyRewardInput): void {
  if (
    !Number.isSafeInteger(input.customerId) || input.customerId < 1 ||
    !Number.isSafeInteger(input.ruleVersion) || input.ruleVersion < 1 ||
    input.sourceId.trim() === "" || input.idempotencyKey.trim() === "" ||
    !isSafeInteger(input.xpDelta) || input.xpDelta < 0 ||
    !isSafeInteger(input.coalDelta) || input.coalDelta < 0 ||
    input.xpDelta + input.coalDelta <= 0 || input.reason.trim() === ""
  ) throw new LoyaltyInvariantError();
  if (input.sourceOrderId !== undefined && input.sourceOrderId !== null && (!Number.isSafeInteger(input.sourceOrderId) || input.sourceOrderId < 1)) throw new LoyaltyInvariantError();
  if (input.sourceOrderTotalMinor !== undefined && input.sourceOrderTotalMinor !== null && !isSafeNonNegativeInteger(input.sourceOrderTotalMinor)) throw new LoyaltyInvariantError();
  if (input.sourceOrderCurrency !== undefined && input.sourceOrderCurrency !== null && !/^[A-Z]{3}$/u.test(input.sourceOrderCurrency)) throw new LoyaltyInvariantError();
  if (input.sourceType === "wheel_spin" && (input.sourceOrderId === undefined || input.sourceOrderId === null || input.sourceOrderTotalMinor === undefined || input.sourceOrderTotalMinor === null || input.sourceOrderCurrency === undefined || input.sourceOrderCurrency === null)) throw new LoyaltyInvariantError();
  if (input.sourceType === "quest_reward" && (input.sourceOrderId != null || input.sourceOrderTotalMinor != null || input.sourceOrderCurrency != null)) throw new LoyaltyInvariantError();
}

export async function applyLoyaltyReward(
  query: LoyaltyTransactionQuery,
  input: LoyaltyRewardInput
): Promise<LoyaltyRewardResult> {
  validateRewardInput(input);
  return (async () => {
    const account = await ensureAccount(query, input.customerId, input.now, true);
    const existing = await query
      .select()
      .from(loyaltyLedger)
      .where(and(
        eq(loyaltyLedger.sourceType, input.sourceType),
        eq(loyaltyLedger.sourceId, input.sourceId),
        eq(loyaltyLedger.ruleVersion, input.ruleVersion)
      ))
      .limit(1);
    const already = existing[0];
    if (already !== undefined) return { status: "already_applied" as const, ledger: already, account, rankChanged: false };

    const nextXp = account.xp + input.xpDelta;
    const nextCoal = account.coalBalance + input.coalDelta;
    if (!isSafeNonNegativeInteger(nextXp) || !isSafeNonNegativeInteger(nextCoal)) throw new LoyaltyInvariantError();
    const nextRankCode = input.nextRankCode(nextXp);
    if (!["spark", "heat", "flame", "volcano"].includes(nextRankCode)) throw new LoyaltyInvariantError();
    const nextVersion = account.version + 1;
    if (!isSafeNonNegativeInteger(nextVersion)) throw new LoyaltyInvariantError();

    const [ledger] = await query
      .insert(loyaltyLedger)
      .values({
        loyaltyAccountId: account.id,
        customerId: input.customerId,
        entryType: "earned",
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceOrderId: input.sourceOrderId ?? null,
        ruleVersion: input.ruleVersion,
        idempotencyKey: input.idempotencyKey,
        xpDelta: input.xpDelta,
        coalDelta: input.coalDelta,
        xpBalance: nextXp,
        coalBalance: nextCoal,
        sourceOrderTotalMinor: input.sourceOrderTotalMinor ?? null,
        sourceOrderCurrency: input.sourceOrderCurrency ?? null,
        reason: input.reason,
        actorType: "system",
        actorId: null,
        createdAt: input.now
      })
      .onConflictDoNothing({ target: [loyaltyLedger.sourceType, loyaltyLedger.sourceId, loyaltyLedger.ruleVersion] })
      .returning();
    if (ledger === undefined) {
      const [replayed] = await query.select().from(loyaltyLedger).where(and(eq(loyaltyLedger.sourceType, input.sourceType), eq(loyaltyLedger.sourceId, input.sourceId), eq(loyaltyLedger.ruleVersion, input.ruleVersion))).limit(1);
      if (replayed === undefined) throw new LoyaltyInvariantError();
      return { status: "already_applied" as const, ledger: replayed, account, rankChanged: false };
    }
    const rankChanged = account.rankCode !== nextRankCode;
    const [updatedAccount] = await query.update(loyaltyAccounts).set({
      xp: nextXp,
      coalBalance: nextCoal,
      rankCode: nextRankCode,
      rankVersion: input.ruleVersion,
      version: nextVersion,
      updatedAt: input.now
    }).where(eq(loyaltyAccounts.id, account.id)).returning();
    if (updatedAccount === undefined) throw new LoyaltyInvariantError();
    if (rankChanged) await query.insert(loyaltyRankHistory).values({
      loyaltyAccountId: account.id,
      customerId: input.customerId,
      oldRankCode: account.rankCode,
      newRankCode: nextRankCode,
      xpSnapshot: nextXp,
      createdAt: input.now
    });
    return { status: "applied" as const, ledger, account: updatedAccount, rankChanged };
  })();
}

async function readAllAccountsConsistency(
  query: DbQuery,
  now: Date
): Promise<boolean> {
  const accounts = await query.select({ id: loyaltyAccounts.id, customerId: loyaltyAccounts.customerId }).from(loyaltyAccounts);
  for (const account of accounts) {
    const aggregate = await readAccountAggregate(query, account.customerId, now);
    if (!aggregate.isConsistent) return false;
  }
  return true;
}

export interface LoyaltyRepository {
  getAccount(customerId: number, now: Date): Promise<LoyaltyAccountAggregate>;
  getAccountReadOnly?(customerId: number, now: Date): Promise<LoyaltyAccountAggregate | null>;
  listCustomerLedger(
    customerId: number,
    filters: Omit<LoyaltyLedgerFilters, "customerId" | "orderId"> & { readonly orderId?: number }
  ): Promise<LoyaltyLedgerListResult>;
  listAdminLedger(
    filters: LoyaltyLedgerFilters,
    now: Date
  ): Promise<AdminLoyaltyLedgerListResult>;
  claimNextEligibleOrder(ruleVersion: number): Promise<LoyaltyEarnCandidate | null>;
  earnCompletedOrder(input: LoyaltyEarnTransactionInput): Promise<LoyaltyEarnResult>;
  applyReward?: (input: LoyaltyRewardInput) => Promise<LoyaltyRewardResult>;
  listRewards?(now: Date, includeArchived?: boolean): Promise<readonly LoyaltyRewardRecord[]>;
  getReward?(id: number): Promise<LoyaltyRewardRecord | null>;
  listRedemptions?(customerId: number, limit: number, offset: number): Promise<LoyaltyRedemptionListResult>;
  getRedemption?(customerId: number, id: number): Promise<LoyaltyRedemptionRecord | null>;
  getRedemptionForCheckout?(customerId: number, id: number, now: Date): Promise<LoyaltyRedemptionCheckoutSnapshot | null>;
  redeem?(input: { readonly customerId: number; readonly rewardId: number; readonly idempotencyKey: string; readonly now: Date }): Promise<LoyaltyRedemptionResult>;
  createRewardDefinition?(input: LoyaltyRewardDefinitionInput): Promise<LoyaltyRewardRecord>;
  updateRewardDefinition?(input: LoyaltyRewardDefinitionUpdateInput): Promise<LoyaltyRewardRecord>;
}

export function createLoyaltyRepository(client: DatabaseClient): LoyaltyRepository {
  return {
    async getAccount(customerId, now) {
      return client.db.transaction((tx) => readAccountAggregate(tx, customerId, now));
    },

    async getAccountReadOnly(customerId) {
      return readExistingAccountAggregate(client.db, customerId);
    },

    async listCustomerLedger(customerId, filters) {
      return client.db.transaction(async (tx) => {
        const account = await readAccountAggregate(tx, customerId, new Date());
        const conditions = [eq(loyaltyLedger.customerId, customerId), eq(loyaltyLedger.loyaltyAccountId, account.account.id)];
        if (filters.entryType !== undefined) conditions.push(eq(loyaltyLedger.entryType, filters.entryType));
        if (filters.from !== undefined) conditions.push(gte(loyaltyLedger.createdAt, filters.from));
        if (filters.to !== undefined) conditions.push(lte(loyaltyLedger.createdAt, filters.to));
        if (filters.orderId !== undefined) conditions.push(eq(loyaltyLedger.sourceOrderId, filters.orderId));
        const where = and(...conditions);
        const [countRow, rows] = await Promise.all([
          tx.select({ count: sql<string>`count(*)` }).from(loyaltyLedger).where(where),
          tx
            .select()
            .from(loyaltyLedger)
            .where(where)
            .orderBy(desc(loyaltyLedger.createdAt), desc(loyaltyLedger.id))
            .limit(filters.limit)
            .offset(filters.offset)
        ]);
        return {
          entries: rows,
          total: Number(countRow[0]?.count ?? 0),
          account
        };
      });
    },

    async listAdminLedger(filters, now) {
      const conditions = [] as ReturnType<typeof eq>[];
      if (filters.customerId !== undefined) conditions.push(eq(loyaltyLedger.customerId, filters.customerId));
      if (filters.orderId !== undefined) conditions.push(eq(loyaltyLedger.sourceOrderId, filters.orderId));
      if (filters.entryType !== undefined) conditions.push(eq(loyaltyLedger.entryType, filters.entryType));
      if (filters.from !== undefined) conditions.push(gte(loyaltyLedger.createdAt, filters.from) as ReturnType<typeof eq>);
      if (filters.to !== undefined) conditions.push(lte(loyaltyLedger.createdAt, filters.to) as ReturnType<typeof eq>);
      const where = conditions.length === 0 ? undefined : and(...conditions);
      const isConsistent = await readAllAccountsConsistency(client.db, now);
      if (!isConsistent) return { entries: [], total: 0, isConsistent: false };
      const [countRow, rows] = await Promise.all([
        client.db.select({ count: sql<string>`count(*)` }).from(loyaltyLedger).where(where),
        client.db
          .select({
            entry: loyaltyLedger,
            customer: { id: customers.id, name: customers.name, phone: customers.phone }
          })
          .from(loyaltyLedger)
          .innerJoin(customers, eq(customers.id, loyaltyLedger.customerId))
          .where(where)
          .orderBy(desc(loyaltyLedger.createdAt), desc(loyaltyLedger.id))
          .limit(filters.limit)
          .offset(filters.offset)
      ]);
      return {
        entries: rows,
        total: Number(countRow[0]?.count ?? 0),
        isConsistent: true
      };
    },

    async claimNextEligibleOrder(ruleVersion) {
      const [candidate] = await client.db
        .select({ order: orders, payment: payments })
        .from(orders)
        .innerJoin(
          payments,
          and(
            eq(payments.orderId, orders.id),
            eq(payments.customerId, orders.customerId),
            eq(payments.status, "succeeded"),
            eq(payments.providerStatus, "succeeded"),
            eq(payments.provider, "yookassa"),
            eq(payments.currency, orders.currency)
          )
        )
        .where(
          and(
            eq(orders.status, "completed"),
            eq(orders.currency, "RUB"),
            sql`payments."amount_minor" = orders."total_minor"`,
            sql`orders."total_minor" <= 214748364700`,
            sql`NOT EXISTS (SELECT 1 FROM "loyalty_ledger" l WHERE l."source_type" = 'completed_order' AND l."source_order_id" = "orders"."id" AND l."rule_version" = ${ruleVersion})`
          )
        )
        .orderBy(asc(orders.updatedAt), asc(orders.id))
        .limit(1);
      return candidate === undefined ? null : candidate;
    },

    async earnCompletedOrder({ orderId, ruleVersion, now, calculate }) {
      if (!Number.isSafeInteger(orderId) || orderId < 1 || !Number.isSafeInteger(ruleVersion) || ruleVersion < 1) {
        throw new LoyaltyInvariantError();
      }
      return client.db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1)
          .for("update");
        if (order === undefined) return { status: "ineligible" as const, ledger: null, account: null, rankChanged: false };
        const payment = await readLatestPayment(tx, order.id, true);
        if (!isEarnEligible(order, payment)) {
          return { status: "ineligible" as const, ledger: null, account: null, rankChanged: false };
        }

        const account = await ensureAccount(tx, order.customerId, now, true);
        const sourceId = sourceIdForOrder(order.id);
        const [existing] = await tx
          .select()
          .from(loyaltyLedger)
          .where(
            and(
              eq(loyaltyLedger.sourceType, "completed_order"),
              eq(loyaltyLedger.sourceId, sourceId),
              eq(loyaltyLedger.ruleVersion, ruleVersion)
            )
          )
          .limit(1);
        if (existing !== undefined) {
          return { status: "already_earned" as const, ledger: existing, account, rankChanged: false };
        }
        const calculation = calculate({ order, payment, account });
        validateCalculation(calculation);
        const nextXp = account.xp + calculation.xpDelta;
        const nextCoal = account.coalBalance + calculation.coalDelta;
        if (!isSafeNonNegativeInteger(nextXp) || !isSafeNonNegativeInteger(nextCoal)) {
          throw new LoyaltyInvariantError();
        }
        const nextVersion = account.version + 1;
        if (!isSafeNonNegativeInteger(nextVersion)) throw new LoyaltyInvariantError();

        const [ledger] = await tx
          .insert(loyaltyLedger)
          .values({
            loyaltyAccountId: account.id,
            customerId: order.customerId,
            entryType: "earned",
            sourceType: "completed_order",
            sourceId,
            sourceOrderId: order.id,
            ruleVersion,
            idempotencyKey: `loyalty:completed-order:${order.id}:v${ruleVersion}`,
            xpDelta: calculation.xpDelta,
            coalDelta: calculation.coalDelta,
            xpBalance: nextXp,
            coalBalance: nextCoal,
            sourceOrderTotalMinor: order.totalMinor,
            sourceOrderCurrency: order.currency,
            reason: calculation.reason,
            actorType: "system",
            actorId: null,
            createdAt: now
          })
          .onConflictDoNothing({
            target: [loyaltyLedger.sourceType, loyaltyLedger.sourceId, loyaltyLedger.ruleVersion]
          })
          .returning();
        if (ledger === undefined) {
          const [replayed] = await tx
            .select()
            .from(loyaltyLedger)
            .where(
              and(
                eq(loyaltyLedger.sourceType, "completed_order"),
                eq(loyaltyLedger.sourceId, sourceId),
                eq(loyaltyLedger.ruleVersion, ruleVersion)
              )
            )
            .limit(1);
          if (replayed === undefined) throw new LoyaltyInvariantError();
          return { status: "already_earned" as const, ledger: replayed, account, rankChanged: false };
        }

        const rankChanged = account.rankCode !== calculation.nextRankCode;
        const [updatedAccount] = await tx
          .update(loyaltyAccounts)
          .set({
            xp: nextXp,
            coalBalance: nextCoal,
            rankCode: calculation.nextRankCode,
            rankVersion: ruleVersion,
            version: nextVersion,
            updatedAt: now
          })
          .where(eq(loyaltyAccounts.id, account.id))
          .returning();
        if (updatedAccount === undefined) throw new LoyaltyInvariantError();
        if (rankChanged) {
          await tx.insert(loyaltyRankHistory).values({
            loyaltyAccountId: account.id,
            customerId: order.customerId,
            oldRankCode: account.rankCode,
            newRankCode: calculation.nextRankCode,
            xpSnapshot: nextXp,
            createdAt: now
          });
        }
        return { status: "earned" as const, ledger, account: updatedAccount, rankChanged };
      });
    },

    async applyReward(input) {
      return client.db.transaction((tx) => applyLoyaltyReward(tx, input));
    },

    async listRewards(now, includeArchived = false) {
      const rows = await client.db
        .select()
        .from(loyaltyRewards)
        .where(includeArchived ? undefined : and(eq(loyaltyRewards.isVisible, true), eq(loyaltyRewards.isArchived, false)))
        .orderBy(asc(loyaltyRewards.sortOrder), asc(loyaltyRewards.id));
      return rows.filter((reward) => {
        validateRewardRecord(reward);
        return includeArchived || isActiveReward(reward, now);
      });
    },

    async getReward(id) {
      if (!Number.isSafeInteger(id) || id < 1) return null;
      const [reward] = await client.db.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, id)).limit(1);
      return reward ?? null;
    },

    async listRedemptions(customerId, limit, offset) {
      if (!Number.isSafeInteger(customerId) || customerId < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw new LoyaltyInvariantError();
      const where = eq(loyaltyRedemptions.customerId, customerId);
      const [countRow, rows] = await Promise.all([
        client.db.select({ count: sql<string>`count(*)` }).from(loyaltyRedemptions).where(where),
        client.db.select().from(loyaltyRedemptions).where(where).orderBy(desc(loyaltyRedemptions.createdAt), desc(loyaltyRedemptions.id)).limit(limit).offset(offset)
      ]);
      return { redemptions: rows, total: Number(countRow[0]?.count ?? 0) };
    },

    async getRedemption(customerId, id) {
      if (!Number.isSafeInteger(customerId) || customerId < 1 || !Number.isSafeInteger(id) || id < 1) return null;
      const [redemption] = await client.db.select().from(loyaltyRedemptions).where(and(eq(loyaltyRedemptions.customerId, customerId), eq(loyaltyRedemptions.id, id))).limit(1);
      return redemption ?? null;
    },

    async getRedemptionForCheckout(customerId, id, now) {
      if (!Number.isSafeInteger(customerId) || customerId < 1 || !Number.isSafeInteger(id) || id < 1) return null;
      const [redemption] = await client.db.select().from(loyaltyRedemptions).where(and(eq(loyaltyRedemptions.customerId, customerId), eq(loyaltyRedemptions.id, id))).limit(1);
      return redemption === undefined ? null : redemptionCheckoutSnapshot(redemption, now);
    },

    async redeem(input) {
      if (!Number.isSafeInteger(input.customerId) || input.customerId < 1 || !Number.isSafeInteger(input.rewardId) || input.rewardId < 1 || input.idempotencyKey.trim() === "" || Number.isNaN(input.now.getTime())) throw new LoyaltyInvariantError();
      return client.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(loyaltyRedemptions).where(eq(loyaltyRedemptions.idempotencyKey, input.idempotencyKey)).limit(1);
        if (existing !== undefined) {
          if (existing.customerId !== input.customerId || existing.rewardId !== input.rewardId) throw new LoyaltyRedemptionIdempotencyConflictError();
          const [ledger] = await tx.select().from(loyaltyLedger).where(and(eq(loyaltyLedger.sourceType, "redemption"), eq(loyaltyLedger.sourceId, String(existing.id)))).limit(1);
          if (ledger === undefined) throw new LoyaltyRedemptionReconciliationError();
          return { redemption: existing, coalBalance: ledger.coalBalance };
        }

        const account = await ensureAccount(tx, input.customerId, input.now, true);
        const aggregate = await readAccountAggregateForAccount(tx, account);
        if (!aggregate.isConsistent) throw new LoyaltyRedemptionReconciliationError();
        const [reward] = await tx.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, input.rewardId)).limit(1).for("update");
        if (reward === undefined || !isActiveReward(reward, input.now)) throw new LoyaltyRedemptionUnavailableError();
        const usageRow = await tx.select({ count: sql<string>`count(*)` }).from(loyaltyRedemptions).where(and(eq(loyaltyRedemptions.customerId, input.customerId), eq(loyaltyRedemptions.rewardId, reward.id), inArray(loyaltyRedemptions.status, ["pending", "succeeded"])));
        const usageCount = Number(usageRow[0]?.count ?? 0);
        if (reward.perCustomerUsageLimit !== null && usageCount >= reward.perCustomerUsageLimit) throw new LoyaltyRedemptionLimitError();
        if (aggregate.account.coalBalance < reward.costCoal) throw new LoyaltyInsufficientBalanceError();
        const expiresAt = reward.activeUntil ?? new Date(input.now.getTime() + REDEMPTION_TTL_MS);
        const discountMinor = reward.fulfillmentDiscountMinor;
        if (expiresAt <= input.now || discountMinor === null || !isSafeNonNegativeInteger(discountMinor) || discountMinor < 1) throw new LoyaltyRedemptionUnavailableError();
        const [redemption] = await tx.insert(loyaltyRedemptions).values({
          loyaltyAccountId: account.id,
          customerId: input.customerId,
          rewardId: reward.id,
          rewardCode: reward.code,
          rewardName: reward.name,
          costCoal: reward.costCoal,
          rewardType: reward.rewardType,
          fulfillmentTargetType: reward.fulfillmentTargetType,
          discountMinor,
          expiresAt,
          idempotencyKey: input.idempotencyKey,
          status: "pending",
          createdAt: input.now,
          updatedAt: input.now
        }).onConflictDoNothing({ target: loyaltyRedemptions.idempotencyKey }).returning();
        if (redemption === undefined) {
          const [raced] = await tx.select().from(loyaltyRedemptions).where(eq(loyaltyRedemptions.idempotencyKey, input.idempotencyKey)).limit(1);
          if (raced === undefined || raced.customerId !== input.customerId || raced.rewardId !== input.rewardId) throw new LoyaltyRedemptionIdempotencyConflictError();
          const [ledger] = await tx.select().from(loyaltyLedger).where(and(eq(loyaltyLedger.sourceType, "redemption"), eq(loyaltyLedger.sourceId, String(raced.id)))).limit(1);
          if (ledger === undefined) throw new LoyaltyRedemptionReconciliationError();
          return { redemption: raced, coalBalance: ledger.coalBalance };
        }
        const nextCoal = account.coalBalance - reward.costCoal;
        const nextVersion = account.version + 1;
        if (!isSafeNonNegativeInteger(nextCoal) || !isSafeNonNegativeInteger(nextVersion)) throw new LoyaltyInvariantError();
        const [ledger] = await tx.insert(loyaltyLedger).values({
          loyaltyAccountId: account.id,
          customerId: input.customerId,
          entryType: "spent",
          sourceType: "redemption",
          sourceId: String(redemption.id),
          sourceOrderId: null,
          ruleVersion: 1,
          idempotencyKey: `loyalty:redemption:${redemption.id}:v1`,
          xpDelta: 0,
          coalDelta: -reward.costCoal,
          xpBalance: account.xp,
          coalBalance: nextCoal,
          sourceOrderTotalMinor: null,
          sourceOrderCurrency: null,
          reason: `Обмен на награду «${reward.name.trim()}»`,
          actorType: "customer",
          actorId: input.customerId,
          createdAt: input.now
        }).returning();
        if (ledger === undefined) throw new LoyaltyRedemptionReconciliationError();
        const [updatedAccount] = await tx.update(loyaltyAccounts).set({ coalBalance: nextCoal, version: nextVersion, updatedAt: input.now }).where(eq(loyaltyAccounts.id, account.id)).returning();
        if (updatedAccount === undefined) throw new LoyaltyInvariantError();
        return { redemption, coalBalance: nextCoal };
      });
    },

    async createRewardDefinition(input) {
      validateRewardDefinitionValues({ ...input, isArchived: input.isArchived ?? false });
      if (!Number.isSafeInteger(input.actorStaffUserId) || input.actorStaffUserId < 1 || input.requestId.trim() === "" || !/^[0-9a-f]{64}$/u.test(input.payloadFingerprint) || input.idempotencyKey.trim() === "") throw new LoyaltyInvariantError();
      return client.db.transaction(async (tx) => {
        const [existingOperation] = await tx.select().from(loyaltyRewardVersions).where(eq(loyaltyRewardVersions.idempotencyKey, input.idempotencyKey)).limit(1);
        if (existingOperation !== undefined) {
          if (existingOperation.payloadFingerprint !== input.payloadFingerprint) throw new LoyaltyRewardIdempotencyConflictError();
          const [existingReward] = await tx.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, existingOperation.rewardId)).limit(1);
          if (existingReward === undefined) throw new LoyaltyInvariantError();
          return existingReward;
        }
        const [codeConflict] = await tx.select({ id: loyaltyRewards.id }).from(loyaltyRewards).where(eq(loyaltyRewards.code, input.code)).limit(1);
        if (codeConflict !== undefined) throw new LoyaltyRewardCodeConflictError();
        const [reward] = await tx.insert(loyaltyRewards).values({
          code: input.code,
          name: input.name.trim(),
          description: input.description,
          costCoal: input.costCoal,
          rewardType: input.rewardType,
          fulfillmentTargetType: input.fulfillmentTargetType,
          fulfillmentDiscountMinor: input.fulfillmentDiscountMinor,
          isVisible: input.isVisible,
          isArchived: input.isArchived ?? false,
          activeFrom: input.activeFrom,
          activeUntil: input.activeUntil,
          sortOrder: input.sortOrder,
          perCustomerUsageLimit: input.perCustomerUsageLimit,
          createdAt: input.now,
          updatedAt: input.now
        }).returning();
        if (reward === undefined) throw new LoyaltyInvariantError();
        await tx.insert(loyaltyRewardVersions).values({
          rewardId: reward.id,
          version: reward.version,
          action: "created",
          code: reward.code,
          name: reward.name,
          description: reward.description,
          costCoal: reward.costCoal,
          rewardType: reward.rewardType,
          fulfillmentTargetType: reward.fulfillmentTargetType,
          fulfillmentDiscountMinor: reward.fulfillmentDiscountMinor ?? 0,
          isVisible: reward.isVisible,
          isArchived: reward.isArchived,
          activeFrom: reward.activeFrom,
          activeUntil: reward.activeUntil,
          sortOrder: reward.sortOrder,
          perCustomerUsageLimit: reward.perCustomerUsageLimit,
          actorStaffUserId: input.actorStaffUserId,
          requestId: input.requestId,
          payloadFingerprint: input.payloadFingerprint,
          idempotencyKey: input.idempotencyKey,
          createdAt: input.now
        });
        return reward;
      });
    },

    async updateRewardDefinition(input) {
      if (!Number.isSafeInteger(input.id) || input.id < 1 || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || !Number.isSafeInteger(input.actorStaffUserId) || input.actorStaffUserId < 1 || input.requestId.trim() === "" || !/^[0-9a-f]{64}$/u.test(input.payloadFingerprint) || input.idempotencyKey.trim() === "") throw new LoyaltyInvariantError();
      return client.db.transaction(async (tx) => {
        const [existingOperation] = await tx.select().from(loyaltyRewardVersions).where(eq(loyaltyRewardVersions.idempotencyKey, input.idempotencyKey)).limit(1);
        if (existingOperation !== undefined) {
          if (existingOperation.payloadFingerprint !== input.payloadFingerprint || existingOperation.rewardId !== input.id) throw new LoyaltyRewardIdempotencyConflictError();
          const [existingReward] = await tx.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, input.id)).limit(1);
          if (existingReward === undefined) throw new LoyaltyRewardNotFoundError();
          return existingReward;
        }
        const [current] = await tx.select().from(loyaltyRewards).where(eq(loyaltyRewards.id, input.id)).limit(1).for("update");
        if (current === undefined) throw new LoyaltyRewardNotFoundError();
        if (current.version !== input.expectedVersion) throw new LoyaltyRewardVersionConflictError();
        const nextIsArchived = input.isArchived ?? current.isArchived;
        const nextIsVisible = nextIsArchived ? false : (input.isVisible ?? current.isVisible);
        const next = {
          code: current.code,
          name: input.name?.trim() ?? current.name,
          description: input.description ?? current.description,
          costCoal: input.costCoal ?? current.costCoal,
          rewardType: current.rewardType,
          fulfillmentTargetType: current.fulfillmentTargetType,
          fulfillmentDiscountMinor: input.fulfillmentDiscountMinor ?? current.fulfillmentDiscountMinor,
          isVisible: nextIsVisible,
          isArchived: nextIsArchived,
          activeFrom: input.activeFrom === undefined ? current.activeFrom : input.activeFrom,
          activeUntil: input.activeUntil === undefined ? current.activeUntil : input.activeUntil,
          sortOrder: input.sortOrder ?? current.sortOrder,
          perCustomerUsageLimit: input.perCustomerUsageLimit === undefined ? current.perCustomerUsageLimit : input.perCustomerUsageLimit
        };
        validateRewardDefinitionValues(next);
        const [updated] = await tx.update(loyaltyRewards).set({ ...next, version: current.version + 1, updatedAt: input.now }).where(and(eq(loyaltyRewards.id, input.id), eq(loyaltyRewards.version, input.expectedVersion))).returning();
        if (updated === undefined) throw new LoyaltyRewardVersionConflictError();
        await tx.insert(loyaltyRewardVersions).values({
          rewardId: updated.id,
          version: updated.version,
          action: updated.isArchived ? "archived" : "updated",
          code: updated.code,
          name: updated.name,
          description: updated.description,
          costCoal: updated.costCoal,
          rewardType: updated.rewardType,
          fulfillmentTargetType: updated.fulfillmentTargetType,
          fulfillmentDiscountMinor: updated.fulfillmentDiscountMinor ?? 0,
          isVisible: updated.isVisible,
          isArchived: updated.isArchived,
          activeFrom: updated.activeFrom,
          activeUntil: updated.activeUntil,
          sortOrder: updated.sortOrder,
          perCustomerUsageLimit: updated.perCustomerUsageLimit,
          actorStaffUserId: input.actorStaffUserId,
          requestId: input.requestId,
          payloadFingerprint: input.payloadFingerprint,
          idempotencyKey: input.idempotencyKey,
          createdAt: input.now
        });
        return updated;
      });
    }
  };
}
