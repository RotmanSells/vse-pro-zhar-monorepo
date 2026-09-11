import { and, asc, desc, eq, gte, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";
import {
  customers,
  orderStatusHistory,
  orders,
  payments,
  questDefinitions,
  questDefinitionVersions,
  questEvents,
  questProgress,
  questRewardClaims,
  wheelPrizes,
  wheelPrizeVersions,
  wheelRewardClaims,
  wheelSettings,
  wheelSettingsVersions,
  wheelSpins,
  type OrderRecord,
  type QuestDefinitionRecord,
  type QuestProgressRecord,
  type QuestRewardClaimRecord,
  type WheelPrizeRecord,
  type WheelRewardClaimRecord,
  type WheelSettingsRecord,
  type WheelSettingsVersionRecord,
  type WheelSpinRecord
} from "./schema.js";
import { applyLoyaltyReward, LoyaltyInvariantError, type LoyaltyRankCode } from "./loyalty-repository.js";

export const M14_WHEEL_MIN_ORDER_AMOUNT_MINOR = 150_000;
export const M14_WHEEL_COOLDOWN_SECONDS = 86_400;
export const M14_WHEEL_LIMIT_PERIOD_SECONDS = 86_400;
export const M14_WHEEL_MAX_SPINS = 1;
export const M14_WHEEL_MAX_PRIZES = 6;
export const M14_RULE_VERSION = 1;
export const M14_WHEEL_RULE_VERSION = M14_RULE_VERSION;
export const M14_QUEST_RULE_VERSION = M14_RULE_VERSION;

export interface WheelQuestRepositoryOptions {
  readonly nextRankCode: (xp: number) => LoyaltyRankCode;
}

export interface WheelStateData {
  readonly settings: WheelSettingsRecord;
  readonly prizes: readonly WheelPrizeRecord[];
  readonly eligibility: {
    readonly canSpin: boolean;
    readonly reason: "eligible" | "disabled" | "outside_active_period" | "cooldown" | "limit_reached" | "no_eligible_order" | "reconciliation_required";
    readonly eligibleOrderId: number | null;
    readonly cooldownUntil: Date | null;
  };
  readonly spins: readonly WheelSpinRecord[];
  readonly claims: readonly WheelRewardClaimRecord[];
}

export type WheelSpinResult =
  | { readonly status: "completed" | "already_completed"; readonly spin: WheelSpinRecord; readonly claim: WheelRewardClaimRecord }
  | { readonly status: "idempotency_conflict" }
  | { readonly status: "cooldown"; readonly cooldownUntil: Date }
  | { readonly status: "limit_reached" }
  | { readonly status: "not_eligible" }
  | { readonly status: "unavailable" };

export interface QuestStateData {
  readonly definitions: readonly QuestDefinitionRecord[];
  readonly progress: readonly QuestProgressRecord[];
  readonly claims: readonly QuestRewardClaimRecord[];
}

export interface QuestProcessResult {
  readonly processedEvents: number;
  readonly rewardsApplied: number;
}

export interface WheelQuestRepository {
  getWheelState(customerId: number, now: Date): Promise<WheelStateData | null>;
  spin(input: { readonly customerId: number; readonly orderId: number; readonly idempotencyKey: string; readonly now: Date; readonly random?: () => number }): Promise<WheelSpinResult>;
  getQuestState(customerId: number, now: Date): Promise<QuestStateData | null>;
  claimNextQuestOrder(): Promise<OrderRecord | null>;
  processQuestOrder(orderId: number, now: Date): Promise<QuestProcessResult>;
  getAdminWheel(): Promise<{ readonly settings: WheelSettingsRecord; readonly prizes: readonly WheelPrizeRecord[] } | null>;
  updateWheelSettings(input: {
    readonly expectedVersion: number;
    readonly enabled?: boolean;
    readonly minOrderAmountMinor?: number;
    readonly cooldownSeconds?: number;
    readonly maxSpins?: number;
    readonly limitPeriodSeconds?: number;
    readonly activeFrom?: Date | null;
    readonly activeUntil?: Date | null;
    readonly actorStaffUserId: number;
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly payloadFingerprint: string;
    readonly now: Date;
  }): Promise<{ readonly settings: WheelSettingsRecord; readonly prizes: readonly WheelPrizeRecord[] }>;
  createWheelPrize(input: { readonly code: string; readonly name: string; readonly description: string; readonly type: "no_prize" | "coal" | "xp"; readonly value: number; readonly weight: number; readonly isVisible: boolean; readonly activeFrom: Date | null; readonly activeUntil: Date | null; readonly sortOrder: number; readonly now: Date }): Promise<WheelPrizeRecord>;
  updateWheelPrize(id: number, input: { readonly expectedVersion: number; readonly name?: string; readonly description?: string; readonly type?: "no_prize" | "coal" | "xp"; readonly value?: number; readonly weight?: number; readonly isVisible?: boolean; readonly activeFrom?: Date | null; readonly activeUntil?: Date | null; readonly sortOrder?: number; readonly actorStaffUserId: number; readonly requestId: string; readonly idempotencyKey: string; readonly payloadFingerprint: string; readonly now: Date }): Promise<WheelPrizeRecord>;
  getAdminQuests(): Promise<readonly QuestDefinitionRecord[] | null>;
  createQuest(input: {
    readonly code: string;
    readonly title: string;
    readonly description: string;
    readonly goal: number;
    readonly unit: "order" | "minor_units";
    readonly rewardType: "xp" | "coal";
    readonly rewardValue: number;
    readonly isVisible: boolean;
    readonly activeFrom: Date | null;
    readonly activeUntil: Date | null;
    readonly sortOrder: number;
    readonly actorStaffUserId: number;
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly payloadFingerprint: string;
    readonly now: Date;
  }): Promise<{ readonly definition: QuestDefinitionRecord; readonly created: boolean }>;
  updateQuest(id: number, input: {
    readonly expectedVersion: number;
    readonly title?: string;
    readonly description?: string;
    readonly goal?: number;
    readonly unit?: "order" | "minor_units";
    readonly rewardType?: "xp" | "coal";
    readonly rewardValue?: number;
    readonly isVisible?: boolean;
    readonly activeFrom?: Date | null;
    readonly activeUntil?: Date | null;
    readonly sortOrder?: number;
    readonly actorStaffUserId: number;
    readonly requestId: string;
    readonly now: Date;
  }): Promise<QuestDefinitionRecord>;
}

export class WheelIdempotencyConflictError extends Error {
  constructor() {
    super("Wheel idempotency key was already used for another order");
    this.name = "WheelIdempotencyConflictError";
  }
}

export class WheelPrizeLimitError extends Error {
  constructor() {
    super("Wheel prize limit reached");
    this.name = "WheelPrizeLimitError";
  }
}

export class WheelPrizeConflictError extends Error {
  constructor() {
    super("Wheel prize code already exists");
    this.name = "WheelPrizeConflictError";
  }
}

export class WheelPrizeVersionConflictError extends Error {
  constructor() {
    super("Wheel prize version is stale");
    this.name = "WheelPrizeVersionConflictError";
  }
}

export class WheelPrizeIdempotencyConflictError extends Error {
  constructor() {
    super("Wheel prize idempotency key was reused with different data");
    this.name = "WheelPrizeIdempotencyConflictError";
  }
}

export class WheelSettingsNotFoundError extends Error {
  constructor() {
    super("Wheel settings were not found");
    this.name = "WheelSettingsNotFoundError";
  }
}

export class WheelSettingsVersionConflictError extends Error {
  constructor() {
    super("Wheel settings version is stale");
    this.name = "WheelSettingsVersionConflictError";
  }
}

export class WheelSettingsIdempotencyConflictError extends Error {
  constructor() {
    super("Wheel settings idempotency key was reused with different data");
    this.name = "WheelSettingsIdempotencyConflictError";
  }
}

export class WheelSettingsConfigurationError extends Error {
  constructor() {
    super("Wheel settings configuration is invalid");
    this.name = "WheelSettingsConfigurationError";
  }
}

export class QuestDefinitionCodeConflictError extends Error {
  constructor() {
    super("Quest definition code already exists");
    this.name = "QuestDefinitionCodeConflictError";
  }
}

export class QuestDefinitionIdempotencyConflictError extends Error {
  constructor() {
    super("Quest definition idempotency key was reused with different data");
    this.name = "QuestDefinitionIdempotencyConflictError";
  }
}

export class QuestDefinitionVersionConflictError extends Error {
  constructor() {
    super("Quest definition version is stale");
    this.name = "QuestDefinitionVersionConflictError";
  }
}

export class QuestDefinitionNotFoundError extends Error {
  constructor() {
    super("Quest definition was not found");
    this.name = "QuestDefinitionNotFoundError";
  }
}

export class QuestDefinitionPeriodError extends Error {
  constructor() {
    super("Quest definition active period is invalid");
    this.name = "QuestDefinitionPeriodError";
  }
}

export class QuestDefinitionChangeNotAllowedError extends Error {
  constructor() {
    super("Quest definition change is not allowed after progress or claims");
    this.name = "QuestDefinitionChangeNotAllowedError";
  }
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validWheelSettingsValues(input: { readonly minOrderAmountMinor: number; readonly cooldownSeconds: number; readonly maxSpins: number; readonly limitPeriodSeconds: number; readonly activeFrom: Date | null; readonly activeUntil: Date | null }): boolean {
  return Number.isSafeInteger(input.minOrderAmountMinor) && input.minOrderAmountMinor >= 0 && input.minOrderAmountMinor <= 2_147_483_647 &&
    Number.isSafeInteger(input.cooldownSeconds) && input.cooldownSeconds >= 1 && input.cooldownSeconds <= 2_147_483_647 &&
    Number.isSafeInteger(input.maxSpins) && input.maxSpins >= 1 && input.maxSpins <= 2_147_483_647 &&
    Number.isSafeInteger(input.limitPeriodSeconds) && input.limitPeriodSeconds >= 1 && input.limitPeriodSeconds <= 2_147_483_647 &&
    (input.activeFrom === null || validDate(input.activeFrom)) && (input.activeUntil === null || validDate(input.activeUntil)) &&
    (input.activeFrom === null || input.activeUntil === null || input.activeUntil > input.activeFrom);
}

function settingsFromVersion(version: WheelSettingsVersionRecord, current: WheelSettingsRecord): WheelSettingsRecord {
  return {
    id: current.id,
    enabled: version.enabled,
    eligibility: version.eligibility,
    minOrderAmountMinor: version.minOrderAmountMinor,
    currency: version.currency,
    cooldownSeconds: version.cooldownSeconds,
    maxSpins: version.maxSpins,
    limitPeriodSeconds: version.limitPeriodSeconds,
    activeFrom: version.activeFrom,
    activeUntil: version.activeUntil,
    version: version.version,
    createdAt: current.createdAt,
    updatedAt: version.createdAt
  };
}

function assertInput(customerId: number, now: Date): void {
  if (!Number.isSafeInteger(customerId) || customerId < 1 || !validDate(now)) throw new LoyaltyInvariantError();
}

function activePeriod(from: Date | null, until: Date | null, now: Date): boolean {
  return (from === null || from.getTime() <= now.getTime()) && (until === null || until.getTime() > now.getTime());
}

export function supportedWheelPrize(prize: WheelPrizeRecord): boolean {
  return supportedWheelPrizeValues(prize.prizeType, prize.value, prize.weight);
}

function supportedWheelPrizeValues(type: string, value: number, weight: number): boolean {
  const validValue = type === "no_prize"
    ? value === 0
    : (type === "coal" || type === "xp") && value > 0;
  return validValue && Number.isSafeInteger(weight) && weight >= 0;
}

async function readSettings(query: Pick<DatabaseClient["db"], "select">): Promise<WheelSettingsRecord | null> {
  const [settings] = await query.select().from(wheelSettings).where(eq(wheelSettings.id, 1)).limit(1);
  return settings ?? null;
}

async function readWheelPrizes(query: Pick<DatabaseClient["db"], "select">, now: Date, includeHidden = false): Promise<readonly WheelPrizeRecord[]> {
  const period = and(or(isNull(wheelPrizes.activeFrom), lte(wheelPrizes.activeFrom, now)), or(isNull(wheelPrizes.activeUntil), gt(wheelPrizes.activeUntil, now)));
  const rows = includeHidden
    ? await query.select().from(wheelPrizes).orderBy(asc(wheelPrizes.sortOrder), asc(wheelPrizes.id))
    : await query.select().from(wheelPrizes).where(and(eq(wheelPrizes.isVisible, true), period)).orderBy(asc(wheelPrizes.sortOrder), asc(wheelPrizes.id));
  return rows;
}

function windowStart(now: Date, seconds: number): Date {
  if (!validDate(now) || !Number.isSafeInteger(seconds) || seconds < 1) throw new LoyaltyInvariantError();
  const milliseconds = seconds * 1_000;
  if (!Number.isSafeInteger(milliseconds)) throw new LoyaltyInvariantError();
  const start = new Date(now.getTime() - milliseconds);
  if (!validDate(start)) throw new LoyaltyInvariantError();
  return start;
}

function cooldownUntil(createdAt: Date, cooldownSeconds: number): Date {
  const milliseconds = cooldownSeconds * 1_000;
  if (!validDate(createdAt) || !Number.isSafeInteger(cooldownSeconds) || cooldownSeconds < 1 || !Number.isSafeInteger(milliseconds)) throw new LoyaltyInvariantError();
  const until = new Date(createdAt.getTime() + milliseconds);
  if (!validDate(until)) throw new LoyaltyInvariantError();
  return until;
}

async function readEligibleOrder(query: Pick<DatabaseClient["db"], "select">, customerId: number, settings: WheelSettingsRecord): Promise<OrderRecord | null> {
  const [order] = await query.select().from(orders).where(and(
    eq(orders.customerId, customerId),
    eq(orders.status, "completed"),
    eq(orders.currency, "RUB"),
    gte(orders.totalMinor, settings.minOrderAmountMinor),
    sql`EXISTS (SELECT 1 FROM "payments" p WHERE p."order_id" = ${orders.id} AND p."customer_id" = ${orders.customerId} AND p."provider" = 'yookassa' AND p."status" = 'succeeded' AND p."provider_status" = 'succeeded' AND p."currency" = 'RUB' AND p."amount_minor" = ${orders.totalMinor})`,
    sql`EXISTS (SELECT 1 FROM "order_status_history" h WHERE h."order_id" = ${orders.id} AND h."status" = 'completed')`,
    sql`NOT EXISTS (SELECT 1 FROM "wheel_spins" s WHERE s."source_order_id" = ${orders.id})`
  )).orderBy(desc(orders.updatedAt), desc(orders.id)).limit(1);
  return order ?? null;
}

async function readLatestSpin(query: Pick<DatabaseClient["db"], "select">, customerId: number, now: Date, cooldownSeconds: number): Promise<WheelSpinRecord | null> {
  const since = windowStart(now, cooldownSeconds);
  const [spin] = await query.select().from(wheelSpins).where(and(eq(wheelSpins.customerId, customerId), gt(wheelSpins.createdAt, since))).orderBy(desc(wheelSpins.createdAt), desc(wheelSpins.id)).limit(1);
  return spin ?? null;
}

async function readSpinCount(query: Pick<DatabaseClient["db"], "select">, customerId: number, now: Date, limitPeriodSeconds: number): Promise<number> {
  const since = windowStart(now, limitPeriodSeconds);
  const [row] = await query.select({ count: sql<number>`count(*)::int` }).from(wheelSpins).where(and(eq(wheelSpins.customerId, customerId), gt(wheelSpins.createdAt, since)));
  const count = Number(row?.count ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new LoyaltyInvariantError();
  return count;
}

async function readWheelClaims(query: Pick<DatabaseClient["db"], "select">, spinIds: readonly number[]): Promise<readonly WheelRewardClaimRecord[]> {
  if (spinIds.length === 0) return [];
  return query.select().from(wheelRewardClaims).where(inArray(wheelRewardClaims.spinId, [...spinIds]));
}

export function selectWeightedPrize(prizes: readonly WheelPrizeRecord[], random: () => number): WheelPrizeRecord | null {
  const active = prizes.filter(supportedWheelPrize).filter((prize) => prize.weight > 0);
  const totalWeight = active.reduce((total, prize) => total + prize.weight, 0);
  if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) return null;
  const candidate = random();
  if (!Number.isFinite(candidate) || candidate < 0 || candidate >= 1) throw new LoyaltyInvariantError();
  let cursor = Math.floor(candidate * totalWeight);
  for (const prize of active) {
    if (cursor < prize.weight) return prize;
    cursor -= prize.weight;
  }
  throw new LoyaltyInvariantError();
}

export function isWheelOrderEligible(order: Pick<OrderRecord, "status" | "totalMinor" | "currency">, payment: { readonly status: string; readonly providerStatus: string; readonly amountMinor: number; readonly currency: string } | null, minOrderAmountMinor = M14_WHEEL_MIN_ORDER_AMOUNT_MINOR): boolean {
  return order.status === "completed" && order.currency === "RUB" && Number.isSafeInteger(minOrderAmountMinor) && minOrderAmountMinor >= 0 && order.totalMinor >= minOrderAmountMinor && Number.isSafeInteger(order.totalMinor) && payment !== null && payment.status === "succeeded" && payment.providerStatus === "succeeded" && payment.currency === "RUB" && payment.amountMinor === order.totalMinor;
}

export function questProgressAfterOrder(unit: "order" | "minor_units", current: number, goal: number, orderTotalMinor: number): number {
  if (!["order", "minor_units"].includes(unit) || !Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(goal) || goal < 1 || !Number.isSafeInteger(orderTotalMinor) || orderTotalMinor < 0) throw new LoyaltyInvariantError();
  const delta = unit === "order" ? 1 : orderTotalMinor;
  return Math.min(goal, current + delta);
}

async function readLatestPayment(query: Pick<DatabaseClient["db"], "select">, orderId: number) {
  const [payment] = await query.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(desc(payments.id)).limit(1);
  return payment ?? null;
}

export function createWheelQuestRepository(client: DatabaseClient, options: WheelQuestRepositoryOptions): WheelQuestRepository {
  return {
    async getWheelState(customerId, now) {
      assertInput(customerId, now);
      return client.db.transaction(async (tx) => {
        const settings = await readSettings(tx);
        if (settings === null) return null;
        const prizes = await readWheelPrizes(tx, now);
        const hasSelectablePrize = prizes.some((prize) => supportedWheelPrize(prize) && prize.weight > 0);
        const spins = await tx.select().from(wheelSpins).where(eq(wheelSpins.customerId, customerId)).orderBy(desc(wheelSpins.createdAt), desc(wheelSpins.id)).limit(100);
        const claims = await readWheelClaims(tx, spins.map((spin) => spin.id));
        const eligibility = !hasSelectablePrize
          ? { canSpin: false as const, reason: "reconciliation_required" as const, eligibleOrderId: null, cooldownUntil: null }
          : !settings.enabled
          ? { canSpin: false as const, reason: "disabled" as const, eligibleOrderId: null, cooldownUntil: null }
          : !activePeriod(settings.activeFrom, settings.activeUntil, now)
            ? { canSpin: false as const, reason: "outside_active_period" as const, eligibleOrderId: null, cooldownUntil: null }
            : await (async () => {
                const latest = await readLatestSpin(tx, customerId, now, settings.cooldownSeconds);
                if (latest !== null) return { canSpin: false as const, reason: "cooldown" as const, eligibleOrderId: null, cooldownUntil: cooldownUntil(latest.createdAt, settings.cooldownSeconds) };
                const spinCount = await readSpinCount(tx, customerId, now, settings.limitPeriodSeconds);
                if (spinCount >= settings.maxSpins) return { canSpin: false as const, reason: "limit_reached" as const, eligibleOrderId: null, cooldownUntil: null };
                const order = await readEligibleOrder(tx, customerId, settings);
                return order === null ? { canSpin: false as const, reason: "no_eligible_order" as const, eligibleOrderId: null, cooldownUntil: null } : { canSpin: true as const, reason: "eligible" as const, eligibleOrderId: order.id, cooldownUntil: null };
              })();
        return { settings, prizes, eligibility, spins, claims };
      });
    },

    async spin(input) {
      assertInput(input.customerId, input.now);
      if (input.idempotencyKey.trim() === "" || !Number.isSafeInteger(input.orderId) || input.orderId < 1) throw new LoyaltyInvariantError();
      return client.db.transaction(async (tx) => {
        const [lockedCustomer] = await tx.select().from(customers).where(eq(customers.id, input.customerId)).limit(1).for("update");
        if (lockedCustomer === undefined) return { status: "not_eligible" as const };
        const [knownByKey] = await tx.select().from(wheelSpins).where(and(eq(wheelSpins.customerId, input.customerId), eq(wheelSpins.idempotencyKey, input.idempotencyKey))).limit(1);
        if (knownByKey !== undefined) {
          if (knownByKey.sourceOrderId !== input.orderId) return { status: "idempotency_conflict" as const };
          const [knownClaim] = await tx.select().from(wheelRewardClaims).where(eq(wheelRewardClaims.spinId, knownByKey.id)).limit(1);
          if (knownClaim === undefined) throw new LoyaltyInvariantError();
          return { status: "already_completed" as const, spin: knownByKey, claim: knownClaim };
        }
        const [knownByOrder] = await tx.select().from(wheelSpins).where(and(eq(wheelSpins.customerId, input.customerId), eq(wheelSpins.sourceOrderId, input.orderId))).limit(1);
        if (knownByOrder !== undefined) {
          const [knownClaim] = await tx.select().from(wheelRewardClaims).where(eq(wheelRewardClaims.spinId, knownByOrder.id)).limit(1);
          if (knownClaim === undefined) throw new LoyaltyInvariantError();
          return { status: "already_completed" as const, spin: knownByOrder, claim: knownClaim };
        }
        const settings = await readSettings(tx);
        if (settings === null || !settings.enabled || !activePeriod(settings.activeFrom, settings.activeUntil, input.now)) return { status: "unavailable" as const };
        const latest = await readLatestSpin(tx, input.customerId, input.now, settings.cooldownSeconds);
        if (latest !== null) return { status: "cooldown" as const, cooldownUntil: cooldownUntil(latest.createdAt, settings.cooldownSeconds) };
        const spinCount = await readSpinCount(tx, input.customerId, input.now, settings.limitPeriodSeconds);
        if (spinCount >= settings.maxSpins) return { status: "limit_reached" as const };
        const [order] = await tx.select().from(orders).where(and(eq(orders.id, input.orderId), eq(orders.customerId, input.customerId))).limit(1).for("update");
        const payment = order === undefined ? null : await readLatestPayment(tx, order.id);
        if (order === undefined || !isWheelOrderEligible(order, payment, settings.minOrderAmountMinor)) return { status: "not_eligible" as const };
        const prizes = await readWheelPrizes(tx, input.now);
        const prize = selectWeightedPrize(prizes, input.random ?? Math.random);
        if (prize === null) return { status: "unavailable" as const };
        const [spin] = await tx.insert(wheelSpins).values({
          customerId: input.customerId,
          sourceOrderId: order.id,
          idempotencyKey: input.idempotencyKey,
          prizeId: prize.id,
          prizeCode: prize.code,
          prizeName: prize.name,
          prizeDescription: prize.description,
          prizeType: prize.prizeType,
          prizeValue: prize.value,
          prizeWeight: prize.weight,
          prizeSortOrder: prize.sortOrder,
          status: "completed",
          createdAt: input.now
        }).onConflictDoNothing({ target: [wheelSpins.customerId, wheelSpins.idempotencyKey] }).returning();
        if (spin === undefined) return { status: "unavailable" as const };
        const claimStatus = prize.prizeType === "no_prize" ? "not_applicable" as const : "succeeded" as const;
        const [claim] = await tx.insert(wheelRewardClaims).values({ spinId: spin.id, customerId: input.customerId, rewardType: prize.prizeType, rewardValue: prize.value, status: claimStatus, idempotencyKey: `wheel:${spin.id}:claim`, createdAt: input.now, updatedAt: input.now }).returning();
        if (claim === undefined) throw new LoyaltyInvariantError();
        if (prize.prizeType !== "no_prize") {
          const reward = await applyLoyaltyReward(tx, {
            customerId: input.customerId,
            sourceType: "wheel_spin",
            sourceId: `wheel:spin:${spin.id}`,
            ruleVersion: M14_RULE_VERSION,
            idempotencyKey: `wheel:spin:${spin.id}:reward`,
            xpDelta: prize.prizeType === "xp" ? prize.value : 0,
            coalDelta: prize.prizeType === "coal" ? prize.value : 0,
            sourceOrderId: order.id,
            sourceOrderTotalMinor: order.totalMinor,
            sourceOrderCurrency: order.currency,
            reason: `Награда рулетки: ${prize.name}`,
            now: input.now,
            nextRankCode: options.nextRankCode
          });
          if (reward.status !== "applied" && reward.status !== "already_applied") throw new LoyaltyInvariantError();
        }
        return { status: "completed" as const, spin, claim };
      });
    },

    async getQuestState(customerId, now) {
      assertInput(customerId, now);
      return client.db.transaction(async (tx) => {
        const definitions = await tx.select().from(questDefinitions).where(and(eq(questDefinitions.isVisible, true), or(isNull(questDefinitions.activeFrom), lte(questDefinitions.activeFrom, now)), or(isNull(questDefinitions.activeUntil), gt(questDefinitions.activeUntil, now)))).orderBy(asc(questDefinitions.sortOrder), asc(questDefinitions.id));
        const progress = await tx.select().from(questProgress).where(eq(questProgress.customerId, customerId));
        const claims = await tx.select().from(questRewardClaims).where(eq(questRewardClaims.customerId, customerId));
        return { definitions, progress, claims };
      });
    },

    async claimNextQuestOrder() {
      const [order] = await client.db.select().from(orders).where(and(
        eq(orders.status, "completed"),
        eq(orders.currency, "RUB"),
        sql`EXISTS (SELECT 1 FROM "payments" p WHERE p."order_id" = ${orders.id} AND p."customer_id" = ${orders.customerId} AND p."provider" = 'yookassa' AND p."status" = 'succeeded' AND p."provider_status" = 'succeeded' AND p."currency" = 'RUB' AND p."amount_minor" = ${orders.totalMinor})`,
        sql`EXISTS (SELECT 1 FROM "order_status_history" h WHERE h."order_id" = ${orders.id} AND h."status" = 'completed' AND EXISTS (SELECT 1 FROM "quest_definitions" qd WHERE qd."is_visible" = true AND qd."created_at" <= h."created_at" AND (qd."active_from" IS NULL OR qd."active_from" <= h."created_at")))`,
        sql`NOT EXISTS (SELECT 1 FROM "quest_events" qe WHERE qe."source_order_id" = ${orders.id})`
      )).orderBy(asc(orders.updatedAt), asc(orders.id)).limit(1);
      return order ?? null;
    },

    async processQuestOrder(orderId, now) {
      if (!Number.isSafeInteger(orderId) || orderId < 1 || !validDate(now)) throw new LoyaltyInvariantError();
      return client.db.transaction(async (tx) => {
        const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for("update");
        if (order === undefined || order.status !== "completed" || order.currency !== "RUB") return { processedEvents: 0, rewardsApplied: 0 };
        const payment = await readLatestPayment(tx, order.id);
        if (!isWheelOrderEligible(order, payment)) return { processedEvents: 0, rewardsApplied: 0 };
        const [completion] = await tx.select().from(orderStatusHistory).where(and(eq(orderStatusHistory.orderId, order.id), eq(orderStatusHistory.status, "completed"))).orderBy(asc(orderStatusHistory.createdAt), asc(orderStatusHistory.id)).limit(1);
        if (completion === undefined) return { processedEvents: 0, rewardsApplied: 0 };
        const definitions = await tx.select().from(questDefinitions).where(eq(questDefinitions.isVisible, true)).orderBy(asc(questDefinitions.sortOrder), asc(questDefinitions.id));
        let processedEvents = 0;
        let rewardsApplied = 0;
        for (const definition of definitions) {
          if (completion.createdAt < definition.createdAt || !activePeriod(definition.activeFrom, definition.activeUntil, completion.createdAt)) continue;
          const [existingEvent] = await tx.select().from(questEvents).where(and(eq(questEvents.questDefinitionId, definition.id), eq(questEvents.sourceOrderId, order.id))).limit(1);
          if (existingEvent !== undefined) continue;
          await tx.insert(questProgress).values({ customerId: order.customerId, questDefinitionId: definition.id, progress: 0, status: "active", createdAt: now, updatedAt: now }).onConflictDoNothing({ target: [questProgress.customerId, questProgress.questDefinitionId] });
          const [current] = await tx.select().from(questProgress).where(and(eq(questProgress.customerId, order.customerId), eq(questProgress.questDefinitionId, definition.id))).limit(1).for("update");
          if (current === undefined) throw new LoyaltyInvariantError();
          if (current.status === "earned") continue;
          const progressAfter = questProgressAfterOrder(definition.unit as "order" | "minor_units", current.progress, definition.goal, order.totalMinor);
          const delta = progressAfter - current.progress;
          if (delta <= 0) throw new LoyaltyInvariantError();
          const eventValues = {
            customerId: order.customerId,
            questDefinitionId: definition.id,
            sourceOrderId: order.id,
            eventKey: `quest:${definition.code}:order:${order.id}:v${definition.version}`,
            delta,
            progressBefore: current.progress,
            progressAfter,
            sourceOrderTotalMinor: order.totalMinor,
            sourceOrderCurrency: order.currency,
            createdAt: completion.createdAt
          };
          const [event] = await tx.insert(questEvents).values(eventValues).onConflictDoNothing({ target: [questEvents.questDefinitionId, questEvents.sourceOrderId] }).returning();
          if (event === undefined) continue;
          processedEvents += 1;
          const earned = progressAfter >= definition.goal;
          const [updatedProgress] = await tx.update(questProgress).set({ progress: progressAfter, status: earned ? "earned" : "active", updatedAt: now, completedAt: earned ? now : null }).where(eq(questProgress.id, current.id)).returning();
          if (updatedProgress === undefined) throw new LoyaltyInvariantError();
          if (earned) {
            const [claim] = await tx.insert(questRewardClaims).values({ customerId: order.customerId, questDefinitionId: definition.id, rewardType: definition.rewardType, rewardValue: definition.rewardValue, status: "pending", idempotencyKey: `quest:${definition.code}:customer:${order.customerId}:v${definition.version}`, createdAt: now, updatedAt: now }).onConflictDoNothing({ target: [questRewardClaims.customerId, questRewardClaims.questDefinitionId] }).returning();
            const rewardClaim = claim ?? (await tx.select().from(questRewardClaims).where(and(eq(questRewardClaims.customerId, order.customerId), eq(questRewardClaims.questDefinitionId, definition.id))).limit(1))[0];
            if (rewardClaim === undefined) throw new LoyaltyInvariantError();
            if (rewardClaim.status !== "succeeded") {
              await applyLoyaltyReward(tx, {
                customerId: order.customerId,
                sourceType: "quest_reward",
                sourceId: `quest:${definition.code}:customer:${order.customerId}:v${definition.version}`,
                ruleVersion: M14_QUEST_RULE_VERSION,
                idempotencyKey: `quest:${definition.code}:customer:${order.customerId}:v${definition.version}:ledger`,
                xpDelta: definition.rewardType === "xp" ? definition.rewardValue : 0,
                coalDelta: definition.rewardType === "coal" ? definition.rewardValue : 0,
                reason: `Награда за квест: ${definition.title}`,
                now,
                nextRankCode: options.nextRankCode
              });
              const [succeeded] = await tx.update(questRewardClaims).set({ status: "succeeded", updatedAt: now, completedAt: now }).where(eq(questRewardClaims.id, rewardClaim.id)).returning();
              if (succeeded === undefined) throw new LoyaltyInvariantError();
            }
            rewardsApplied += 1;
          }
        }
        return { processedEvents, rewardsApplied };
      });
    },

    async getAdminWheel() {
      const settings = await readSettings(client.db);
      if (settings === null) return null;
      return { settings, prizes: await readWheelPrizes(client.db, new Date(), true) };
    },

    async updateWheelSettings(input) {
      if (!validDate(input.now) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
        !Number.isSafeInteger(input.actorStaffUserId) || input.actorStaffUserId < 1 || input.requestId.trim() === "" ||
        input.idempotencyKey.trim() === "" || !/^[0-9a-f]{64}$/u.test(input.payloadFingerprint)) throw new LoyaltyInvariantError();
      return client.db.transaction(async (tx) => {
        const [current] = await tx.select().from(wheelSettings).where(eq(wheelSettings.id, 1)).limit(1).for("update");
        if (current === undefined) throw new WheelSettingsNotFoundError();

        const [known] = await tx.select().from(wheelSettingsVersions).where(eq(wheelSettingsVersions.idempotencyKey, input.idempotencyKey)).limit(1);
        if (known !== undefined) {
          if (known.payloadFingerprint !== input.payloadFingerprint) throw new WheelSettingsIdempotencyConflictError();
          return { settings: settingsFromVersion(known, current), prizes: await readWheelPrizes(tx, input.now, true) };
        }
        if (current.version !== input.expectedVersion) throw new WheelSettingsVersionConflictError();
        if (current.version >= 2_147_483_647) throw new WheelSettingsConfigurationError();
        const selectablePrizes = await readWheelPrizes(tx, input.now);
        if (!selectablePrizes.some((prize) => supportedWheelPrize(prize) && prize.weight > 0)) throw new WheelSettingsConfigurationError();

        const next = {
          enabled: input.enabled ?? current.enabled,
          eligibility: current.eligibility,
          minOrderAmountMinor: input.minOrderAmountMinor ?? current.minOrderAmountMinor,
          currency: current.currency,
          cooldownSeconds: input.cooldownSeconds ?? current.cooldownSeconds,
          maxSpins: input.maxSpins ?? current.maxSpins,
          limitPeriodSeconds: input.limitPeriodSeconds ?? current.limitPeriodSeconds,
          activeFrom: input.activeFrom === undefined ? current.activeFrom : input.activeFrom,
          activeUntil: input.activeUntil === undefined ? current.activeUntil : input.activeUntil
        };
        if (next.eligibility !== "completed_paid_order" || next.currency !== "RUB" || !validWheelSettingsValues(next)) throw new WheelSettingsConfigurationError();
        const [settings] = await tx.update(wheelSettings).set({
          enabled: next.enabled,
          minOrderAmountMinor: next.minOrderAmountMinor,
          cooldownSeconds: next.cooldownSeconds,
          maxSpins: next.maxSpins,
          limitPeriodSeconds: next.limitPeriodSeconds,
          activeFrom: next.activeFrom,
          activeUntil: next.activeUntil,
          version: current.version + 1,
          updatedAt: input.now
        }).where(eq(wheelSettings.id, 1)).returning();
        if (settings === undefined) throw new WheelSettingsVersionConflictError();
        const [snapshot] = await tx.insert(wheelSettingsVersions).values({
          wheelSettingsId: settings.id,
          version: settings.version,
          action: "updated",
          enabled: settings.enabled,
          eligibility: settings.eligibility,
          minOrderAmountMinor: settings.minOrderAmountMinor,
          currency: settings.currency,
          cooldownSeconds: settings.cooldownSeconds,
          maxSpins: settings.maxSpins,
          limitPeriodSeconds: settings.limitPeriodSeconds,
          activeFrom: settings.activeFrom,
          activeUntil: settings.activeUntil,
          actorStaffUserId: input.actorStaffUserId,
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey,
          payloadFingerprint: input.payloadFingerprint,
          createdAt: input.now
        }).returning();
        if (snapshot === undefined) throw new LoyaltyInvariantError();
        return { settings, prizes: await readWheelPrizes(tx, input.now, true) };
      });
    },

    async createWheelPrize(input) {
      if (!validDate(input.now) || input.code.trim() === "" || input.name.trim() === "" || !supportedWheelPrizeValues(input.type, input.value, input.weight)) throw new LoyaltyInvariantError();
      const existing = await client.db.select({ id: wheelPrizes.id }).from(wheelPrizes).where(eq(wheelPrizes.code, input.code)).limit(1);
      if (existing.length > 0) throw new WheelPrizeConflictError();
      const allPrizes = await client.db.select({ id: wheelPrizes.id }).from(wheelPrizes);
      if (allPrizes.length >= M14_WHEEL_MAX_PRIZES) throw new WheelPrizeLimitError();
      const [created] = await client.db.insert(wheelPrizes).values({
        code: input.code,
        name: input.name,
        description: input.description,
        prizeType: input.type,
        value: input.value,
        weight: input.weight,
        isVisible: input.isVisible,
        activeFrom: input.activeFrom,
        activeUntil: input.activeUntil,
        sortOrder: input.sortOrder,
        version: 1,
        createdAt: input.now,
        updatedAt: input.now
      }).returning();
      if (created === undefined) throw new LoyaltyInvariantError();
      return created;
    },

    async updateWheelPrize(id, input) {
      if (!Number.isSafeInteger(id) || id < 1 ||
        !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
        !Number.isSafeInteger(input.actorStaffUserId) || input.actorStaffUserId < 1 ||
        input.requestId.trim() === "" || input.idempotencyKey.trim() === "" ||
        !/^[0-9a-f]{64}$/u.test(input.payloadFingerprint) || !validDate(input.now)) {
        throw new LoyaltyInvariantError();
      }
      return client.db.transaction(async (tx) => {
        const [current] = await tx.select().from(wheelPrizes).where(eq(wheelPrizes.id, id)).limit(1).for("update");
        if (current === undefined || !supportedWheelPrize(current)) throw new LoyaltyInvariantError();
        const [known] = await tx.select().from(wheelPrizeVersions).where(eq(wheelPrizeVersions.idempotencyKey, input.idempotencyKey)).limit(1);
        if (known !== undefined) {
          if (known.payloadFingerprint !== input.payloadFingerprint || known.wheelPrizeId !== id) throw new WheelPrizeIdempotencyConflictError();
          return current;
        }
        if (current.version !== input.expectedVersion) throw new WheelPrizeVersionConflictError();
        const nextType = input.type ?? current.prizeType;
        const nextValue = input.value ?? current.value;
        const nextWeight = input.weight ?? current.weight;
        const nextActiveFrom = input.activeFrom === undefined ? current.activeFrom : input.activeFrom;
        const nextActiveUntil = input.activeUntil === undefined ? current.activeUntil : input.activeUntil;
        if (!supportedWheelPrizeValues(nextType, nextValue, nextWeight) ||
          (nextActiveFrom !== null && nextActiveUntil !== null && nextActiveUntil <= nextActiveFrom)) {
          throw new LoyaltyInvariantError();
        }
        const [updated] = await tx.update(wheelPrizes).set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          prizeType: nextType,
          value: nextValue,
          weight: nextWeight,
          ...(input.isVisible === undefined ? {} : { isVisible: input.isVisible }),
          activeFrom: nextActiveFrom,
          activeUntil: nextActiveUntil,
          ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
          version: current.version + 1,
          updatedAt: input.now
        }).where(and(eq(wheelPrizes.id, id), eq(wheelPrizes.version, input.expectedVersion))).returning();
        if (updated === undefined) throw new WheelPrizeVersionConflictError();
        const [snapshot] = await tx.insert(wheelPrizeVersions).values({
          wheelPrizeId: updated.id,
          version: updated.version,
          action: "updated",
          code: updated.code,
          name: updated.name,
          description: updated.description,
          prizeType: updated.prizeType,
          value: updated.value,
          weight: updated.weight,
          isVisible: updated.isVisible,
          activeFrom: updated.activeFrom,
          activeUntil: updated.activeUntil,
          sortOrder: updated.sortOrder,
          actorStaffUserId: input.actorStaffUserId,
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey,
          payloadFingerprint: input.payloadFingerprint,
          createdAt: input.now
        }).returning();
        if (snapshot === undefined) throw new LoyaltyInvariantError();
        return updated;
      });
    },

    async getAdminQuests() {
      const definitions = await client.db.select().from(questDefinitions).orderBy(asc(questDefinitions.sortOrder), asc(questDefinitions.id));
      return definitions;
    },

    async createQuest(input) {
      if (!validDate(input.now) || !Number.isSafeInteger(input.actorStaffUserId) || input.actorStaffUserId < 1 || input.requestId.trim() === "" || input.idempotencyKey.trim() === "" || !/^[0-9a-f]{64}$/u.test(input.payloadFingerprint)) throw new LoyaltyInvariantError();
      if (!/^[a-z0-9][a-z0-9_-]{0,79}$/u.test(input.code) || input.title.trim() === "" || input.title.length > 160 || input.description.length > 2048 || !Number.isSafeInteger(input.goal) || input.goal < 1 || !Number.isSafeInteger(input.rewardValue) || input.rewardValue < 1 || !Number.isSafeInteger(input.sortOrder) || input.sortOrder < 0 || input.activeUntil !== null && input.activeFrom !== null && input.activeUntil <= input.activeFrom) throw new LoyaltyInvariantError();
      const findByIdempotencyKey = async (query: Pick<DatabaseClient["db"], "select">) => {
        const [snapshot] = await query.select().from(questDefinitionVersions).where(eq(questDefinitionVersions.idempotencyKey, input.idempotencyKey)).limit(1);
        if (snapshot === undefined) return null;
        const [definition] = await query.select().from(questDefinitions).where(eq(questDefinitions.id, snapshot.questDefinitionId)).limit(1);
        if (definition === undefined) throw new LoyaltyInvariantError();
        return { definition, fingerprint: snapshot.payloadFingerprint };
      };
      const known = await findByIdempotencyKey(client.db);
      if (known !== null) {
        if (known.fingerprint !== input.payloadFingerprint) throw new QuestDefinitionIdempotencyConflictError();
        return { definition: known.definition, created: false };
      }
      try {
        return await client.db.transaction(async (tx) => {
          const existing = await findByIdempotencyKey(tx);
          if (existing !== null) {
            if (existing.fingerprint !== input.payloadFingerprint) throw new QuestDefinitionIdempotencyConflictError();
            return { definition: existing.definition, created: false };
          }
          const [created] = await tx.insert(questDefinitions).values({
            code: input.code,
            title: input.title.trim(),
            description: input.description.trim(),
            goal: input.goal,
            unit: input.unit,
            rewardType: input.rewardType,
            rewardValue: input.rewardValue,
            isVisible: input.isVisible,
            activeFrom: input.activeFrom,
            activeUntil: input.activeUntil,
            sortOrder: input.sortOrder,
            version: 1,
            createdAt: input.now,
            updatedAt: input.now
          }).returning();
          if (created === undefined) throw new LoyaltyInvariantError();
          await tx.insert(questDefinitionVersions).values(questDefinitionSnapshot(created, "created", input.actorStaffUserId, input.requestId, input.idempotencyKey, input.payloadFingerprint));
          return { definition: created, created: true };
        });
      } catch (error: unknown) {
        if (!isUniqueViolation(error)) throw error;
        const retry = await findByIdempotencyKey(client.db);
        if (retry !== null) {
          if (retry.fingerprint !== input.payloadFingerprint) throw new QuestDefinitionIdempotencyConflictError();
          return { definition: retry.definition, created: false };
        }
        const [duplicateCode] = await client.db.select().from(questDefinitions).where(eq(questDefinitions.code, input.code)).limit(1);
        if (duplicateCode !== undefined) throw new QuestDefinitionCodeConflictError();
        throw error;
      }
    },

    async updateQuest(id, input) {
      if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || !validDate(input.now) || !Number.isSafeInteger(input.actorStaffUserId) || input.actorStaffUserId < 1 || input.requestId.trim() === "") throw new LoyaltyInvariantError();
      return client.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM quest_definitions WHERE id = ${id} FOR UPDATE`);
        const [current] = await tx.select().from(questDefinitions).where(eq(questDefinitions.id, id)).limit(1);
        if (current === undefined) throw new QuestDefinitionNotFoundError();
        if (current.version !== input.expectedVersion) throw new QuestDefinitionVersionConflictError();
        const nextUnit = input.unit ?? current.unit;
        const nextGoal = input.goal ?? current.goal;
        const nextRewardType = input.rewardType ?? current.rewardType;
        const nextRewardValue = input.rewardValue ?? current.rewardValue;
        const nextActiveFrom = input.activeFrom === undefined ? current.activeFrom : input.activeFrom;
        const nextActiveUntil = input.activeUntil === undefined ? current.activeUntil : input.activeUntil;
        if (nextActiveUntil !== null && nextActiveFrom !== null && nextActiveUntil <= nextActiveFrom) throw new QuestDefinitionPeriodError();
        const progressRows = await tx.select({ progress: questProgress.progress }).from(questProgress).where(eq(questProgress.questDefinitionId, id)).orderBy(desc(questProgress.progress)).limit(1);
        const eventRows = await tx.select({ progressAfter: questEvents.progressAfter }).from(questEvents).where(eq(questEvents.questDefinitionId, id)).orderBy(desc(questEvents.progressAfter)).limit(1);
        const claimRows = await tx.select({ id: questRewardClaims.id }).from(questRewardClaims).where(eq(questRewardClaims.questDefinitionId, id)).limit(1);
        const currentProgress = Math.max(progressRows[0]?.progress ?? 0, eventRows[0]?.progressAfter ?? 0);
        if (nextUnit !== current.unit && (progressRows.length > 0 || eventRows.length > 0)) throw new QuestDefinitionChangeNotAllowedError();
        if ((nextRewardType !== current.rewardType || nextRewardValue !== current.rewardValue) && claimRows.length > 0) throw new QuestDefinitionChangeNotAllowedError();
        if (nextGoal < currentProgress) throw new QuestDefinitionChangeNotAllowedError();
        const changed = current.title !== (input.title?.trim() ?? current.title) || current.description !== (input.description?.trim() ?? current.description) || current.goal !== nextGoal || current.unit !== nextUnit || current.rewardType !== nextRewardType || current.rewardValue !== nextRewardValue || current.isVisible !== (input.isVisible ?? current.isVisible) || current.activeFrom?.getTime() !== nextActiveFrom?.getTime() || current.activeUntil?.getTime() !== nextActiveUntil?.getTime() || current.sortOrder !== (input.sortOrder ?? current.sortOrder);
        if (!changed) return current;
        const [updated] = await tx.update(questDefinitions).set({
          ...(input.title === undefined ? {} : { title: input.title.trim() }),
          ...(input.description === undefined ? {} : { description: input.description.trim() }),
          ...(input.goal === undefined ? {} : { goal: input.goal }),
          ...(input.unit === undefined ? {} : { unit: input.unit }),
          ...(input.rewardType === undefined ? {} : { rewardType: input.rewardType }),
          ...(input.rewardValue === undefined ? {} : { rewardValue: input.rewardValue }),
          ...(input.isVisible === undefined ? {} : { isVisible: input.isVisible }),
          ...(input.activeFrom === undefined ? {} : { activeFrom: input.activeFrom }),
          ...(input.activeUntil === undefined ? {} : { activeUntil: input.activeUntil }),
          ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
          version: current.version + 1,
          updatedAt: input.now
        }).where(and(eq(questDefinitions.id, id), eq(questDefinitions.version, input.expectedVersion))).returning();
        if (updated === undefined) throw new QuestDefinitionVersionConflictError();
        const action = current.isVisible && updated.isVisible === false ? "archived" : "updated";
        await tx.insert(questDefinitionVersions).values(questDefinitionSnapshot(updated, action, input.actorStaffUserId, input.requestId));
        return updated;
      });
    }
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

function questDefinitionSnapshot(
  row: QuestDefinitionRecord,
  action: "created" | "updated" | "archived",
  actorStaffUserId: number,
  requestId: string,
  idempotencyKey?: string,
  payloadFingerprint?: string
) {
  return {
    questDefinitionId: row.id,
    version: row.version,
    action,
    code: row.code,
    title: row.title,
    description: row.description,
    goal: row.goal,
    unit: row.unit,
    rewardType: row.rewardType,
    rewardValue: row.rewardValue,
    isVisible: row.isVisible,
    activeFrom: row.activeFrom,
    activeUntil: row.activeUntil,
    sortOrder: row.sortOrder,
    actorStaffUserId,
    requestId,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(payloadFingerprint === undefined ? {} : { payloadFingerprint }),
    createdAt: row.updatedAt
  };
}
