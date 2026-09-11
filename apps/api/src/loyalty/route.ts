import {
  AdminLoyaltyLedgerResponseSchema,
  AdminLoyaltyQuerySchema,
  LoyaltyLedgerQuerySchema,
  LoyaltyLedgerResponseSchema,
  LoyaltySummaryResponseSchema,
  AdminQuestsResponseSchema,
  AdminWheelResponseSchema,
  AdminLoyaltyRewardsResponseSchema,
  IdempotencyKeySchema,
  LoyaltyRedemptionRequestSchema,
  LoyaltyRedemptionResponseSchema,
  LoyaltyRedemptionsResponseSchema,
  LoyaltyRewardsResponseSchema,
  LoyaltyRewardCreateRequestSchema,
  LoyaltyRewardUpdateRequestSchema,
  QuestDefinitionCreateRequestSchema,
  QuestDefinitionUpdateRequestSchema,
  WheelPrizeCreateRequestSchema,
  QuestStateResponseSchema,
  WheelPrizeUpdateRequestSchema,
  WheelSettingsUpdateRequestSchema,
  WheelSpinRequestSchema,
  WheelSpinResponseSchema,
  WheelStateResponseSchema
} from "@vse-pro-zhar/contracts";
import { LoyaltyInsufficientBalanceError, LoyaltyInvariantError, LoyaltyRedemptionIdempotencyConflictError, LoyaltyRedemptionLimitError, LoyaltyRedemptionNotFoundError, LoyaltyRedemptionReconciliationError, LoyaltyRedemptionUnavailableError, LoyaltyRewardCodeConflictError, LoyaltyRewardIdempotencyConflictError, LoyaltyRewardNotFoundError, LoyaltyRewardVersionConflictError, QuestDefinitionChangeNotAllowedError, QuestDefinitionCodeConflictError, QuestDefinitionIdempotencyConflictError, QuestDefinitionNotFoundError, QuestDefinitionPeriodError, QuestDefinitionVersionConflictError, WheelPrizeConflictError, WheelPrizeIdempotencyConflictError, WheelPrizeLimitError, WheelPrizeVersionConflictError, WheelSettingsConfigurationError, WheelSettingsIdempotencyConflictError, WheelSettingsNotFoundError, WheelSettingsVersionConflictError, type CustomerRepository, type LoyaltyRepository, type WheelQuestRepository } from "@vse-pro-zhar/database";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { readSession } from "../auth/route.js";
import { CustomerAuthService } from "../auth/service.js";
import type { StaffGuard } from "../auth/staff-route.js";
import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";
import {
  LoyaltyAuthenticationError,
  LoyaltyDependencyError,
  LoyaltyService
} from "./service.js";
import {
  WheelCooldownError,
  WheelLimitReachedError,
  WheelNotEligibleError,
  WheelQuestDependencyError,
  WheelQuestAuthenticationError,
  WheelQuestService,
  WheelUnavailableError,
  WheelIdempotencyConflictError,
  QuestDefinitionValidationError
} from "./wheel-quest-service.js";
import { assertSafeOrigin } from "../auth/route.js";
import { z } from "zod";

export interface LoyaltyRouteOptions {
  readonly repository?: LoyaltyRepository;
  readonly customerRepository?: CustomerRepository;
  readonly staffGuard: StaffGuard;
  readonly now?: () => Date;
  readonly wheelQuestRepository?: WheelQuestRepository;
}

function mapError(error: unknown): never {
  if (error instanceof LoyaltyAuthenticationError) {
    throw new ApiRequestError("AUTHENTICATION_ERROR", 401);
  }
  if (error instanceof LoyaltyDependencyError) {
    throw new ApiRequestError("LOYALTY_UNAVAILABLE", 503);
  }
  if (error instanceof LoyaltyInsufficientBalanceError) throw new ApiRequestError("LOYALTY_INSUFFICIENT_BALANCE", 409);
  if (error instanceof LoyaltyRedemptionIdempotencyConflictError) throw new ApiRequestError("LOYALTY_IDEMPOTENCY_CONFLICT", 409);
  if (error instanceof LoyaltyRedemptionLimitError || error instanceof LoyaltyRedemptionUnavailableError) throw new ApiRequestError("LOYALTY_INVALID_TRANSITION", 409);
  if (error instanceof LoyaltyRedemptionReconciliationError) throw new ApiRequestError("LOYALTY_RECONCILIATION_REQUIRED", 503);
  if (error instanceof LoyaltyRedemptionNotFoundError) throw new ApiRequestError("NOT_FOUND", 404);
  if (error instanceof LoyaltyRewardCodeConflictError) throw new ApiRequestError("LOYALTY_REWARD_CODE_CONFLICT", 409);
  if (error instanceof LoyaltyRewardIdempotencyConflictError) throw new ApiRequestError("LOYALTY_REWARD_IDEMPOTENCY_CONFLICT", 409);
  if (error instanceof LoyaltyRewardVersionConflictError) throw new ApiRequestError("LOYALTY_REWARD_CONFLICT", 409);
  if (error instanceof LoyaltyRewardNotFoundError) throw new ApiRequestError("NOT_FOUND", 404);
  if (error instanceof WheelQuestAuthenticationError) throw new ApiRequestError("AUTHENTICATION_ERROR", 401);
  if (error instanceof WheelCooldownError) throw new ApiRequestError("LOYALTY_WHEEL_COOLDOWN", 409);
  if (error instanceof WheelLimitReachedError) throw new ApiRequestError("LOYALTY_WHEEL_LIMIT_REACHED", 409);
  if (error instanceof WheelNotEligibleError) throw new ApiRequestError("LOYALTY_WHEEL_NOT_ELIGIBLE", 409);
  if (error instanceof WheelIdempotencyConflictError) throw new ApiRequestError("LOYALTY_IDEMPOTENCY_CONFLICT", 409);
  if (error instanceof WheelPrizeLimitError) throw new ApiRequestError("LOYALTY_WHEEL_PRIZE_LIMIT", 409);
  if (error instanceof WheelPrizeConflictError) throw new ApiRequestError("LOYALTY_WHEEL_PRIZE_CONFLICT", 409);
  if (error instanceof WheelPrizeVersionConflictError) throw new ApiRequestError("LOYALTY_WHEEL_PRIZE_CONFLICT", 409);
  if (error instanceof WheelPrizeIdempotencyConflictError) throw new ApiRequestError("LOYALTY_WHEEL_PRIZE_IDEMPOTENCY_CONFLICT", 409);
  if (error instanceof WheelSettingsNotFoundError) throw new ApiRequestError("NOT_FOUND", 404);
  if (error instanceof WheelSettingsVersionConflictError || error instanceof WheelSettingsConfigurationError) throw new ApiRequestError("LOYALTY_WHEEL_SETTINGS_CONFLICT", 409);
  if (error instanceof WheelSettingsIdempotencyConflictError) throw new ApiRequestError("LOYALTY_WHEEL_SETTINGS_IDEMPOTENCY_CONFLICT", 409);
  if (error instanceof WheelUnavailableError) throw new ApiRequestError("LOYALTY_WHEEL_UNAVAILABLE", 503);
  if (error instanceof QuestDefinitionCodeConflictError) throw new ApiRequestError("LOYALTY_QUEST_CODE_CONFLICT", 409);
  if (error instanceof QuestDefinitionIdempotencyConflictError) throw new ApiRequestError("LOYALTY_QUEST_IDEMPOTENCY_CONFLICT", 409);
  if (error instanceof QuestDefinitionVersionConflictError || error instanceof QuestDefinitionChangeNotAllowedError) throw new ApiRequestError("LOYALTY_QUEST_CONFLICT", 409);
  if (error instanceof QuestDefinitionNotFoundError) throw new ApiRequestError("NOT_FOUND", 404);
  if (error instanceof QuestDefinitionPeriodError) throw new ApiRequestError("VALIDATION_ERROR", 400);
  if (error instanceof QuestDefinitionValidationError) throw new ApiRequestError("VALIDATION_ERROR", 400);
  if (error instanceof WheelQuestDependencyError || error instanceof LoyaltyInvariantError) throw new ApiRequestError("LOYALTY_QUEST_UNAVAILABLE", 503);
  throw new ApiRequestError("LOYALTY_UNAVAILABLE", 503);
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    mapError(error);
  }
}

export function registerLoyaltyRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  options: LoyaltyRouteOptions
): LoyaltyService | null {
  const now = options.now ?? (() => new Date());
  const service = options.repository === undefined
    ? null
    : new LoyaltyService(
        options.repository,
        options.customerRepository === undefined
          ? undefined
          : new CustomerAuthService(options.customerRepository, config, now),
        now
      );
  const wheelQuestService = options.wheelQuestRepository === undefined || options.customerRepository === undefined
    ? null
    : new WheelQuestService(
        options.wheelQuestRepository,
        new CustomerAuthService(options.customerRepository, config, now),
        now
      );
  const getService = (): LoyaltyService => {
    if (service === null) throw new ApiRequestError("LOYALTY_UNAVAILABLE", 503);
    return service;
  };

  app.get("/loyalty", async (request, reply) => {
    const { token } = readSession(request);
    const response = await run(() => getService().getSummary(token));
    return reply.send(LoyaltySummaryResponseSchema.parse(response));
  });

  app.get("/loyalty/ledger", async (request, reply) => {
    const query = LoyaltyLedgerQuerySchema.safeParse(request.query);
    if (!query.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const { token } = readSession(request);
    const response = await run(() => getService().getLedger(token, query.data));
    return reply.send(LoyaltyLedgerResponseSchema.parse(response));
  });

  app.get("/loyalty/rewards", async (request, reply) => {
    const { token } = readSession(request);
    const response = await run(() => getService().getRewards(token));
    return reply.send(LoyaltyRewardsResponseSchema.parse(response));
  });

  app.post("/loyalty/redemptions", async (request, reply) => {
    assertSafeOrigin(request, config);
    const input = LoyaltyRedemptionRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const idempotencyKey = readIdempotency(request);
    const { token } = readSession(request);
    const response = await run(() => getService().redeem(token, input.data.rewardId, idempotencyKey));
    return reply.code(201).send(LoyaltyRedemptionResponseSchema.parse(response));
  });

  app.get("/loyalty/redemptions", async (request, reply) => {
    const query = LoyaltyLedgerQuerySchema.safeParse(request.query);
    if (!query.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const { token } = readSession(request);
    const response = await run(() => getService().getRedemptions(token, query.data));
    return reply.send(LoyaltyRedemptionsResponseSchema.parse(response));
  });

  app.get("/loyalty/redemptions/:id", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).strict().safeParse(request.params);
    if (!params.success) throw new ApiRequestError("NOT_FOUND", 404);
    const { token } = readSession(request);
    const response = await run(() => getService().getRedemption(token, params.data.id));
    return reply.send(LoyaltyRedemptionResponseSchema.parse(response));
  });

  const getWheelQuestService = (): WheelQuestService => {
    if (wheelQuestService === null) throw new ApiRequestError("LOYALTY_WHEEL_UNAVAILABLE", 503);
    return wheelQuestService;
  };
  const readIdempotency = (request: FastifyRequest): string => {
    const raw = request.headers["idempotency-key"];
    const value = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
    const parsed = IdempotencyKeySchema.safeParse(value);
    if (!parsed.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    return parsed.data;
  };

  app.get("/loyalty/wheel", async (request, reply) => {
    const { token } = readSession(request);
    const response = await run(() => getWheelQuestService().getWheel(token));
    return reply.send(WheelStateResponseSchema.parse(response));
  });

  app.post("/loyalty/wheel/spin", async (request, reply) => {
    assertSafeOrigin(request, config);
    const input = WheelSpinRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const idempotencyKey = readIdempotency(request);
    const { token } = readSession(request);
    const response = await run(() => getWheelQuestService().spin(token, input.data, idempotencyKey));
    return reply.send(WheelSpinResponseSchema.parse(response));
  });

  app.get("/loyalty/quests", async (request, reply) => {
    const { token } = readSession(request);
    const response = await run(() => getWheelQuestService().getQuests(token));
    return reply.send(QuestStateResponseSchema.parse(response));
  });

  app.get("/admin/loyalty/ledger", async (request, reply) => {
    await options.staffGuard.require(request);
    const query = AdminLoyaltyQuerySchema.safeParse(request.query);
    if (!query.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => getService().getAdminLedger({
      limit: query.data.limit,
      offset: query.data.offset,
      ...(query.data.customerId === undefined ? {} : { customerId: query.data.customerId }),
      ...(query.data.orderId === undefined ? {} : { orderId: query.data.orderId }),
      ...(query.data.entryType === undefined ? {} : { entryType: query.data.entryType })
    }));
    return reply.send(AdminLoyaltyLedgerResponseSchema.parse(response));
  });

  app.get("/admin/loyalty/rewards", async (request, reply) => {
    await options.staffGuard.require(request);
    const response = await run(() => getService().getAdminRewards());
    return reply.send(AdminLoyaltyRewardsResponseSchema.parse(response));
  });

  app.post("/admin/loyalty/rewards", async (request, reply) => {
    assertSafeOrigin(request, config);
    const staff = await options.staffGuard.require(request);
    const input = LoyaltyRewardCreateRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const idempotencyKey = readIdempotency(request);
    const response = await run(() => getService().createAdminReward(input.data, staff.user.id, idempotencyKey, request.id));
    return reply.code(201).send(AdminLoyaltyRewardsResponseSchema.parse(response));
  });

  app.patch("/admin/loyalty/rewards/:id", async (request, reply) => {
    assertSafeOrigin(request, config);
    const staff = await options.staffGuard.require(request);
    const params = z.object({ id: z.coerce.number().int().positive() }).strict().safeParse(request.params);
    const input = LoyaltyRewardUpdateRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const idempotencyKey = readIdempotency(request);
    const response = await run(() => getService().updateAdminReward(params.data.id, input.data, staff.user.id, idempotencyKey, request.id));
    return reply.send(AdminLoyaltyRewardsResponseSchema.parse(response));
  });

  app.get("/admin/loyalty/wheel", async (request, reply) => {
    await options.staffGuard.require(request);
    const response = await run(() => getWheelQuestService().getAdminWheel());
    return reply.send(AdminWheelResponseSchema.parse(response));
  });

  app.patch("/admin/loyalty/wheel/settings", async (request, reply) => {
    assertSafeOrigin(request, config);
    const staff = await options.staffGuard.require(request);
    const input = WheelSettingsUpdateRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const idempotencyKey = readIdempotency(request);
    const response = await run(() => getWheelQuestService().updateWheelSettings(input.data, staff.user.id, idempotencyKey, request.id));
    return reply.send(AdminWheelResponseSchema.parse(response));
  });

  const m14Params = z.object({ id: z.coerce.number().int().positive() }).strict();
  app.post("/admin/loyalty/wheel/prizes", async (request, reply) => {
    await options.staffGuard.require(request);
    assertSafeOrigin(request, config);
    const input = WheelPrizeCreateRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => getWheelQuestService().createWheelPrize(input.data));
    return reply.code(201).send(AdminWheelResponseSchema.parse(response));
  });

  app.patch("/admin/loyalty/wheel/prizes/:id", async (request, reply) => {
    assertSafeOrigin(request, config);
    const staff = await options.staffGuard.require(request);
    const params = m14Params.safeParse(request.params);
    const input = WheelPrizeUpdateRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const idempotencyKey = readIdempotency(request);
    const response = await run(() => getWheelQuestService().updateWheelPrize(params.data.id, input.data, staff.user.id, idempotencyKey, request.id));
    return reply.send(AdminWheelResponseSchema.parse(response));
  });

  app.get("/admin/loyalty/quests", async (request, reply) => {
    assertSafeOrigin(request, config);
    await options.staffGuard.require(request);
    const response = await run(() => getWheelQuestService().getAdminQuests());
    return reply.send(AdminQuestsResponseSchema.parse(response));
  });

  app.post("/admin/loyalty/quests", async (request, reply) => {
    assertSafeOrigin(request, config);
    const staff = await options.staffGuard.require(request);
    const input = QuestDefinitionCreateRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const idempotencyKey = readIdempotency(request);
    const response = await run(() => getWheelQuestService().createQuest(input.data, staff.user.id, idempotencyKey, request.id));
    return reply.code(response.created ? 201 : 200).send(AdminQuestsResponseSchema.parse(response.response));
  });

  app.patch("/admin/loyalty/quests/:id", async (request, reply) => {
    assertSafeOrigin(request, config);
    const staff = await options.staffGuard.require(request);
    const params = m14Params.safeParse(request.params);
    const input = QuestDefinitionUpdateRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => getWheelQuestService().updateQuest(params.data.id, input.data, staff.user.id, request.id));
    return reply.send(AdminQuestsResponseSchema.parse(response));
  });

  return service;
}
