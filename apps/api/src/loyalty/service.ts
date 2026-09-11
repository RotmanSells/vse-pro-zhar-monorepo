import { createHash } from "node:crypto";

import {
  AdminLoyaltyLedgerResponseSchema,
  AdminLoyaltyRewardsResponseSchema,
  LoyaltyRedemptionResponseSchema,
  LoyaltyRedemptionsResponseSchema,
  LoyaltyRewardsResponseSchema,
  LoyaltyLedgerResponseSchema,
  RewardDefinitionSchema,
  RedemptionSummarySchema,
  type AdminLoyaltyRewardsResponse,
  type LoyaltyRedemptionResponse,
  type LoyaltyRedemptionsResponse,
  type LoyaltyRewardsResponse,
  type LoyaltyRewardCreateRequest,
  type LoyaltyRewardUpdateRequest,
  LoyaltySummaryResponseSchema,
  LOYALTY_EARN_RULE_VERSION,
  LOYALTY_RUBLES_PER_COAL,
  LOYALTY_XP_PER_RUBLE,
  type AdminLoyaltyLedgerResponse,
  type LoyaltyLedgerQuery,
  type LoyaltyLedgerResponse,
  type LoyaltyRank,
  type LoyaltyRankCode,
  type LoyaltyRankProgress,
  type LoyaltySummaryResponse
} from "@vse-pro-zhar/contracts";
import {
  LoyaltyInvariantError,
  LoyaltyRedemptionNotFoundError,
  type LoyaltyAccountAggregate,
  type LoyaltyLedgerFilters,
  type LoyaltyRepository
} from "@vse-pro-zhar/database";

import {
  CustomerAuthService,
  CustomerSessionError
} from "../auth/service.js";

export const LOYALTY_RANKS: readonly LoyaltyRank[] = [
  { code: "spark", name: "Искра", thresholdXp: 0, benefits: [] },
  { code: "heat", name: "Жар", thresholdXp: 1_000, benefits: [] },
  { code: "flame", name: "Пламя", thresholdXp: 5_000, benefits: [] },
  { code: "volcano", name: "Вулкан", thresholdXp: 15_000, benefits: [] }
] as const;

export class LoyaltyAuthenticationError extends Error {
  constructor() {
    super("Customer loyalty session is invalid");
    this.name = "LoyaltyAuthenticationError";
  }
}

export class LoyaltyDependencyError extends Error {
  constructor() {
    super("Loyalty dependency is unavailable");
    this.name = "LoyaltyDependencyError";
  }
}

export function rankForXp(xp: number): LoyaltyRankCode {
  if (!Number.isSafeInteger(xp) || xp < 0) throw new LoyaltyInvariantError();
  let selected: LoyaltyRankCode = "spark";
  for (const rank of LOYALTY_RANKS) {
    if (xp >= rank.thresholdXp) selected = rank.code;
  }
  return selected;
}

export function rankProgressForXp(xp: number): LoyaltyRankProgress {
  const currentRankCode = rankForXp(xp);
  const currentRankIndex = LOYALTY_RANKS.findIndex((rank) => rank.code === currentRankCode);
  if (currentRankIndex < 0) throw new LoyaltyDependencyError();

  const currentRank = LOYALTY_RANKS[currentRankIndex];
  if (currentRank === undefined) throw new LoyaltyDependencyError();
  const nextRank = LOYALTY_RANKS[currentRankIndex + 1] ?? null;
  if (nextRank === null) {
    return {
      nextRank: null,
      xpIntoCurrentRank: xp - currentRank.thresholdXp,
      xpToNextRank: 0,
      progressPercent: 100,
      isMaxRank: true
    };
  }

  const rankSpan = nextRank.thresholdXp - currentRank.thresholdXp;
  if (rankSpan <= 0 || xp < currentRank.thresholdXp || xp >= nextRank.thresholdXp) {
    throw new LoyaltyDependencyError();
  }
  const xpIntoCurrentRank = xp - currentRank.thresholdXp;
  const progressPercent = Math.max(
    0,
    Math.min(99, Math.floor((100 * xpIntoCurrentRank) / rankSpan))
  );
  return {
    nextRank,
    xpIntoCurrentRank,
    xpToNextRank: nextRank.thresholdXp - xp,
    progressPercent,
    isMaxRank: false
  };
}

function rankSummary(code: string): LoyaltyRank {
  const rank = LOYALTY_RANKS.find((candidate) => candidate.code === code);
  if (rank === undefined) throw new LoyaltyDependencyError();
  return rank;
}

function toSummary(aggregate: LoyaltyAccountAggregate): LoyaltySummaryResponse {
  if (
    aggregate.account.rankVersion !== LOYALTY_EARN_RULE_VERSION ||
    rankForXp(aggregate.account.xp) !== aggregate.account.rankCode
  ) {
    throw new LoyaltyDependencyError();
  }
  const response = {
    status: "confirmed" as const,
    summary: {
      xp: aggregate.account.xp,
      coalBalance: aggregate.account.coalBalance,
      rank: rankSummary(aggregate.account.rankCode),
      ...rankProgressForXp(aggregate.account.xp),
      version: aggregate.account.version,
      updatedAt: aggregate.account.updatedAt.toISOString()
    }
  };
  const parsed = LoyaltySummaryResponseSchema.safeParse(response);
  if (!parsed.success) throw new LoyaltyDependencyError();
  return parsed.data;
}

function toLedgerEntry(entry: Awaited<ReturnType<LoyaltyRepository["listCustomerLedger"]>>["entries"][number]) {
  const response = {
    id: entry.id,
    entryType: entry.entryType,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    sourceOrderId: entry.sourceOrderId,
    xpDelta: entry.xpDelta,
    coalDelta: entry.coalDelta,
    xpBalance: entry.xpBalance,
    coalBalance: entry.coalBalance,
    reason: entry.reason,
    actorType: entry.actorType,
    actorId: entry.actorId,
    createdAt: entry.createdAt.toISOString()
  };
  const parsed = LoyaltyLedgerResponseSchema.shape.entries.element.safeParse(response);
  if (!parsed.success) throw new LoyaltyDependencyError();
  return parsed.data;
}

function unavailableLedgerResponse(
  reason: "not_configured" | "reconciliation_required",
  limit: number,
  offset: number
): LoyaltyLedgerResponse {
  return LoyaltyLedgerResponseSchema.parse({
    status: "unavailable",
    entries: [],
    pagination: { limit, offset, total: 0, hasNext: false },
    unavailableReason: reason
  });
}

function maskPhone(phone: string): string {
  const normalized = phone.trim();
  return normalized.length <= 4 ? "••••" : `•••• ${normalized.slice(-4)}`;
}

function toAdminEntry(
  result: Awaited<ReturnType<LoyaltyRepository["listAdminLedger"]>>["entries"][number]
) {
  const response = {
    id: result.entry.id,
    entryType: result.entry.entryType,
    sourceType: result.entry.sourceType,
    sourceId: result.entry.sourceId,
    sourceOrderId: result.entry.sourceOrderId,
    xpDelta: result.entry.xpDelta,
    coalDelta: result.entry.coalDelta,
    xpBalance: result.entry.xpBalance,
    coalBalance: result.entry.coalBalance,
    reason: result.entry.reason,
    actorType: result.entry.actorType,
    actorId: result.entry.actorId,
    createdAt: result.entry.createdAt.toISOString(),
    customer: {
      id: result.customer.id,
      name: result.customer.name,
      phoneMasked: maskPhone(result.customer.phone)
    }
  };
  const parsed = AdminLoyaltyLedgerResponseSchema.shape.entries.element.safeParse(response);
  if (!parsed.success) throw new LoyaltyDependencyError();
  return parsed.data;
}

function rule() {
  return {
    version: LOYALTY_EARN_RULE_VERSION,
    xpPerRuble: LOYALTY_XP_PER_RUBLE,
    rublesPerCoal: LOYALTY_RUBLES_PER_COAL,
    redemptionEnabled: true,
    expires: true
  };
}

function toRewardDefinition(row: Awaited<ReturnType<NonNullable<LoyaltyRepository["getReward"]>>>): ReturnType<typeof RewardDefinitionSchema.parse> {
  if (row === null) throw new LoyaltyDependencyError();
  const parsed = RewardDefinitionSchema.safeParse({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    costCoal: row.costCoal,
    rewardType: row.rewardType,
    fulfillmentTarget: { type: row.fulfillmentTargetType, discountMinor: row.fulfillmentDiscountMinor },
    isVisible: row.isVisible,
    isArchived: row.isArchived,
    activeFrom: row.activeFrom?.toISOString() ?? null,
    activeUntil: row.activeUntil?.toISOString() ?? null,
    sortOrder: row.sortOrder,
    version: row.version,
    perCustomerUsageLimit: row.perCustomerUsageLimit,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  });
  if (!parsed.success) throw new LoyaltyDependencyError();
  return parsed.data;
}

function toRedemption(row: Awaited<ReturnType<NonNullable<LoyaltyRepository["getRedemption"]>>>): ReturnType<typeof RedemptionSummarySchema.parse> {
  if (row === null) throw new LoyaltyDependencyError();
  const parsed = RedemptionSummarySchema.safeParse({
    id: row.id,
    rewardId: row.rewardId,
    rewardCode: row.rewardCode,
    rewardName: row.rewardName,
    costCoal: row.costCoal,
    rewardType: row.rewardType,
    discountMinor: row.discountMinor,
    expiresAt: row.expiresAt.toISOString(),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  });
  if (!parsed.success) throw new LoyaltyDependencyError();
  return parsed.data;
}

export class LoyaltyService {
  constructor(
    private readonly repository: LoyaltyRepository,
    private readonly authService?: CustomerAuthService,
    private readonly now: () => Date = () => new Date()
  ) {}

  private async requireCustomer(token: string | null) {
    if (this.authService === undefined) throw new LoyaltyAuthenticationError();
    try {
      return await this.authService.getActiveSession(token);
    } catch (error: unknown) {
      if (error instanceof CustomerSessionError) throw new LoyaltyAuthenticationError();
      throw error;
    }
  }

  async getSummary(token: string | null): Promise<LoyaltySummaryResponse> {
    const session = await this.requireCustomer(token);
    return this.getSummaryForCustomer(session.customer.id);
  }

  async getSummaryForCustomer(customerId: number): Promise<LoyaltySummaryResponse> {
    const aggregate = this.repository.getAccountReadOnly === undefined
      ? await this.repository.getAccount(customerId, this.now())
      : await this.repository.getAccountReadOnly(customerId, this.now());
    if (aggregate === null) return { status: "unavailable", reason: "not_configured" };
    if (
      !aggregate.isConsistent ||
      aggregate.account.rankVersion !== LOYALTY_EARN_RULE_VERSION ||
      rankForXp(aggregate.account.xp) !== aggregate.account.rankCode
    ) {
      return { status: "unavailable", reason: "reconciliation_required" };
    }
    return toSummary(aggregate);
  }

  async getLedger(token: string | null, query: LoyaltyLedgerQuery): Promise<LoyaltyLedgerResponse> {
    const session = await this.requireCustomer(token);
    const result = await this.repository.listCustomerLedger(session.customer.id, {
      limit: query.limit,
      offset: query.offset,
      ...(query.entryType === undefined ? {} : { entryType: query.entryType })
    });
    if (
      !result.account.isConsistent ||
      result.account.account.rankVersion !== LOYALTY_EARN_RULE_VERSION ||
      rankForXp(result.account.account.xp) !== result.account.account.rankCode
    ) {
      return unavailableLedgerResponse("reconciliation_required", query.limit, query.offset);
    }
    const response = {
      status: "confirmed" as const,
      entries: result.entries.map(toLedgerEntry),
      pagination: {
        limit: query.limit,
        offset: query.offset,
        total: result.total,
        hasNext: query.offset + result.entries.length < result.total
      }
    };
    const parsed = LoyaltyLedgerResponseSchema.safeParse(response);
    if (!parsed.success) throw new LoyaltyDependencyError();
    return parsed.data;
  }

  async getRewards(token: string | null): Promise<LoyaltyRewardsResponse> {
    await this.requireCustomer(token);
    if (this.repository.listRewards === undefined) throw new LoyaltyDependencyError();
    const response = { status: "confirmed" as const, rewards: (await this.repository.listRewards(this.now())).map((reward) => toRewardDefinition(reward)) };
    const parsed = LoyaltyRewardsResponseSchema.safeParse(response);
    if (!parsed.success) throw new LoyaltyDependencyError();
    return parsed.data;
  }

  async getRedemptions(token: string | null, query: LoyaltyLedgerQuery): Promise<LoyaltyRedemptionsResponse> {
    const session = await this.requireCustomer(token);
    if (this.repository.listRedemptions === undefined) throw new LoyaltyDependencyError();
    const result = await this.repository.listRedemptions(session.customer.id, query.limit, query.offset);
    const response = {
      status: "confirmed" as const,
      redemptions: result.redemptions.map((redemption) => toRedemption(redemption)),
      pagination: { limit: query.limit, offset: query.offset, total: result.total, hasNext: query.offset + result.redemptions.length < result.total }
    };
    const parsed = LoyaltyRedemptionsResponseSchema.safeParse(response);
    if (!parsed.success) throw new LoyaltyDependencyError();
    return parsed.data;
  }

  async getRedemption(token: string | null, id: number): Promise<LoyaltyRedemptionResponse> {
    const session = await this.requireCustomer(token);
    if (this.repository.getRedemption === undefined) throw new LoyaltyDependencyError();
    const redemption = await this.repository.getRedemption(session.customer.id, id);
    if (redemption === null) throw new LoyaltyRedemptionNotFoundError();
    const summary = await this.getSummaryForCustomer(session.customer.id);
    if (summary.status !== "confirmed") throw new LoyaltyDependencyError();
    const response = { status: "confirmed" as const, redemption: toRedemption(redemption), coalBalance: summary.summary.coalBalance };
    const parsed = LoyaltyRedemptionResponseSchema.safeParse(response);
    if (!parsed.success) throw new LoyaltyDependencyError();
    return parsed.data;
  }

  async redeem(token: string | null, rewardId: number, idempotencyKey: string): Promise<LoyaltyRedemptionResponse> {
    const session = await this.requireCustomer(token);
    if (this.repository.redeem === undefined) throw new LoyaltyDependencyError();
    const result = await this.repository.redeem({ customerId: session.customer.id, rewardId, idempotencyKey, now: this.now() });
    const parsed = LoyaltyRedemptionResponseSchema.safeParse({ status: "confirmed", redemption: toRedemption(result.redemption), coalBalance: result.coalBalance });
    if (!parsed.success) throw new LoyaltyDependencyError();
    return parsed.data;
  }

  async getAdminRewards(): Promise<AdminLoyaltyRewardsResponse> {
    if (this.repository.listRewards === undefined) throw new LoyaltyDependencyError();
    const parsed = AdminLoyaltyRewardsResponseSchema.safeParse({ status: "confirmed", rewards: (await this.repository.listRewards(this.now(), true)).map((reward) => toRewardDefinition(reward)) });
    if (!parsed.success) throw new LoyaltyDependencyError();
    return parsed.data;
  }

  async createAdminReward(input: LoyaltyRewardCreateRequest, staffUserId: number, idempotencyKey: string, requestId: string): Promise<AdminLoyaltyRewardsResponse> {
    if (this.repository.createRewardDefinition === undefined || !Number.isSafeInteger(staffUserId) || staffUserId < 1 || idempotencyKey.trim() === "" || requestId.trim() === "") throw new LoyaltyDependencyError();
    const fingerprint = createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
    await this.repository.createRewardDefinition({
      code: input.code,
      name: input.name,
      description: input.description,
      costCoal: input.costCoal,
      rewardType: input.rewardType,
      fulfillmentTargetType: input.fulfillmentTarget.type,
      fulfillmentDiscountMinor: input.fulfillmentTarget.discountMinor,
      isVisible: input.isVisible,
      activeFrom: input.activeFrom === null ? null : new Date(input.activeFrom),
      activeUntil: input.activeUntil === null ? null : new Date(input.activeUntil),
      sortOrder: input.sortOrder,
      perCustomerUsageLimit: input.perCustomerUsageLimit,
      actorStaffUserId: staffUserId,
      requestId,
      idempotencyKey,
      payloadFingerprint: fingerprint,
      now: this.now()
    });
    return this.getAdminRewards();
  }

  async updateAdminReward(id: number, input: LoyaltyRewardUpdateRequest, staffUserId: number, idempotencyKey: string, requestId: string): Promise<AdminLoyaltyRewardsResponse> {
    if (this.repository.updateRewardDefinition === undefined || !Number.isSafeInteger(staffUserId) || staffUserId < 1 || idempotencyKey.trim() === "" || requestId.trim() === "") throw new LoyaltyDependencyError();
    const fingerprint = createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
    await this.repository.updateRewardDefinition({
      id,
      expectedVersion: input.expectedVersion,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.costCoal === undefined ? {} : { costCoal: input.costCoal }),
      ...(input.fulfillmentTarget === undefined ? {} : { fulfillmentDiscountMinor: input.fulfillmentTarget.discountMinor }),
      ...(input.isVisible === undefined ? {} : { isVisible: input.isVisible }),
      ...(input.isArchived === undefined ? {} : { isArchived: input.isArchived }),
      ...(input.activeFrom === undefined ? {} : { activeFrom: input.activeFrom === null ? null : new Date(input.activeFrom) }),
      ...(input.activeUntil === undefined ? {} : { activeUntil: input.activeUntil === null ? null : new Date(input.activeUntil) }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      ...(input.perCustomerUsageLimit === undefined ? {} : { perCustomerUsageLimit: input.perCustomerUsageLimit }),
      actorStaffUserId: staffUserId,
      requestId,
      idempotencyKey,
      payloadFingerprint: fingerprint,
      now: this.now()
    });
    return this.getAdminRewards();
  }

  async getAdminLedger(filters: LoyaltyLedgerFilters): Promise<AdminLoyaltyLedgerResponse> {
    const result = await this.repository.listAdminLedger(filters, this.now());
    if (!result.isConsistent) {
      return AdminLoyaltyLedgerResponseSchema.parse({
        status: "unavailable",
        entries: [],
        pagination: {
          limit: filters.limit,
          offset: filters.offset,
          total: 0,
          hasNext: false
        },
        rule: rule(),
        unavailableReason: "reconciliation_required"
      });
    }
    const response = {
      status: "confirmed" as const,
      entries: result.entries.map(toAdminEntry),
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        total: result.total,
        hasNext: filters.offset + result.entries.length < result.total
      },
      rule: rule()
    };
    const parsed = AdminLoyaltyLedgerResponseSchema.safeParse(response);
    if (!parsed.success) throw new LoyaltyDependencyError();
    return parsed.data;
  }

  async earnCompletedOrder(orderId: number, at: Date = this.now()): Promise<void> {
    await this.repository.earnCompletedOrder({
      orderId,
      ruleVersion: LOYALTY_EARN_RULE_VERSION,
      now: at,
      calculate: ({ order, account }) => {
        if (!Number.isSafeInteger(order.totalMinor) || order.totalMinor < 0) {
          throw new LoyaltyInvariantError();
        }
        const xpDelta = Math.floor(order.totalMinor / 100);
        const coalDelta = Math.floor(order.totalMinor / (100 * LOYALTY_RUBLES_PER_COAL));
        const nextXp = account.xp + xpDelta;
        if (!Number.isSafeInteger(nextXp) || nextXp < 0 || nextXp > 2_147_483_647) {
          throw new LoyaltyInvariantError();
        }
        return {
          xpDelta,
          coalDelta,
          nextRankCode: rankForXp(nextXp),
          reason: "Завершённый оплаченный заказ"
        };
      }
    });
  }
}

export function toLoyaltyRule() {
  return rule();
}
