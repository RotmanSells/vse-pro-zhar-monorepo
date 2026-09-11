import { createHash } from "node:crypto";

import {
  AdminQuestsResponseSchema,
  AdminWheelResponseSchema,
  QuestDefinitionSchema,
  QuestStateResponseSchema,
  QuestProgressSchema,
  WheelPrizeSchema,
  WheelPrizePublicSchema,
  WheelSettingsSchema,
  WheelSpinResponseSchema,
  WheelStateResponseSchema,
  WheelRewardClaimStatusSchema,
  type AdminQuestsResponse,
  type AdminWheelResponse,
  type QuestDefinitionCreateRequest,
  type QuestDefinitionUpdateRequest,
  type QuestStateResponse,
  type WheelPrizeUpdateRequest,
  type WheelPrizeCreateRequest,
  type WheelSettingsUpdateRequest,
  type WheelSpinRequest,
  type WheelSpinResponse,
  type WheelStateResponse
} from "@vse-pro-zhar/contracts";
import {
  WheelSettingsNotFoundError,
  type QuestDefinitionRecord,
  type QuestProgressRecord,
  type QuestRewardClaimRecord,
  type WheelPrizeRecord,
  type WheelQuestRepository,
  type WheelSettingsRecord,
  type WheelSpinRecord
} from "@vse-pro-zhar/database";

import { CustomerAuthService, CustomerSessionError } from "../auth/service.js";

export class WheelQuestAuthenticationError extends Error {
  constructor() {
    super("Customer wheel and quest session is invalid");
    this.name = "WheelQuestAuthenticationError";
  }
}

export class WheelQuestDependencyError extends Error {
  constructor() {
    super("Wheel and quest dependency is unavailable");
    this.name = "WheelQuestDependencyError";
  }
}

export class WheelUnavailableError extends Error {
  constructor() {
    super("Wheel is unavailable");
    this.name = "WheelUnavailableError";
  }
}

export class WheelCooldownError extends Error {
  constructor() {
    super("Wheel cooldown is active");
    this.name = "WheelCooldownError";
  }
}

export class WheelLimitReachedError extends Error {
  constructor() {
    super("Wheel rolling limit is active");
    this.name = "WheelLimitReachedError";
  }
}

export class WheelNotEligibleError extends Error {
  constructor() {
    super("Customer is not eligible for wheel spin");
    this.name = "WheelNotEligibleError";
  }
}

export class WheelIdempotencyConflictError extends Error {
  constructor() {
    super("Wheel idempotency conflict");
    this.name = "WheelIdempotencyConflictError";
  }
}

export class QuestDefinitionValidationError extends Error {
  constructor() {
    super("Quest definition input is invalid");
    this.name = "QuestDefinitionValidationError";
  }
}

function toSettings(raw: WheelSettingsRecord) {
  const parsed = WheelSettingsSchema.safeParse({
    id: raw.id,
    enabled: raw.enabled,
    eligibility: raw.eligibility,
    minOrderAmountMinor: raw.minOrderAmountMinor,
    currency: raw.currency,
    cooldownSeconds: raw.cooldownSeconds,
    maxSpins: raw.maxSpins,
    limitPeriodSeconds: raw.limitPeriodSeconds,
    activeFrom: raw.activeFrom?.toISOString() ?? null,
    activeUntil: raw.activeUntil?.toISOString() ?? null,
    version: raw.version,
    updatedAt: raw.updatedAt.toISOString()
  });
  if (!parsed.success) throw new WheelQuestDependencyError();
  return parsed.data;
}

function toPublicPrize(raw: WheelPrizeRecord) {
  const parsed = WheelPrizePublicSchema.safeParse({
    id: raw.id,
    code: raw.code,
    name: raw.name,
    description: raw.description,
    type: raw.prizeType,
    value: raw.value,
    sortOrder: raw.sortOrder
  });
  if (!parsed.success) throw new WheelQuestDependencyError();
  return parsed.data;
}

function toAdminPrize(raw: WheelPrizeRecord) {
  const parsed = WheelPrizeSchema.safeParse({
    id: raw.id,
    code: raw.code,
    name: raw.name,
    description: raw.description,
    type: raw.prizeType,
    value: raw.value,
    weight: raw.weight,
    isVisible: raw.isVisible,
    activeFrom: raw.activeFrom?.toISOString() ?? null,
    activeUntil: raw.activeUntil?.toISOString() ?? null,
    sortOrder: raw.sortOrder,
    version: raw.version
  });
  if (!parsed.success) throw new WheelQuestDependencyError();
  return parsed.data;
}

function toSpin(raw: WheelSpinRecord, claimStatus: "not_applicable" | "succeeded" | "reconciliation_required") {
  const parsed = WheelSpinResponseSchema.shape.spin.safeParse({
    id: raw.id,
    sourceOrderId: raw.sourceOrderId,
    prize: {
      id: raw.prizeId,
      code: raw.prizeCode,
      name: raw.prizeName,
      description: raw.prizeDescription,
      type: raw.prizeType,
      value: raw.prizeValue,
      sortOrder: raw.prizeSortOrder
    },
    status: raw.status,
    rewardClaimStatus: claimStatus,
    createdAt: raw.createdAt.toISOString()
  });
  if (!parsed.success) throw new WheelQuestDependencyError();
  return parsed.data;
}

function toWheelClaimStatus(value: string): "not_applicable" | "succeeded" | "reconciliation_required" {
  const parsed = WheelRewardClaimStatusSchema.safeParse(value);
  if (!parsed.success) throw new WheelQuestDependencyError();
  return parsed.data;
}

function toDefinition(raw: QuestDefinitionRecord) {
  const parsed = QuestDefinitionSchema.safeParse({
    id: raw.id,
    code: raw.code,
    title: raw.title,
    description: raw.description,
    goal: raw.goal,
    unit: raw.unit,
    rewardType: raw.rewardType,
    rewardValue: raw.rewardValue,
    isVisible: raw.isVisible,
    activeFrom: raw.activeFrom?.toISOString() ?? null,
    activeUntil: raw.activeUntil?.toISOString() ?? null,
    sortOrder: raw.sortOrder,
    version: raw.version
  });
  if (!parsed.success) throw new WheelQuestDependencyError();
  return parsed.data;
}

function toQuestProgress(definition: QuestDefinitionRecord, raw: QuestProgressRecord | undefined, claim: QuestRewardClaimRecord | undefined) {
  const quest = toDefinition(definition);
  const progress = raw?.progress ?? 0;
  const status = raw?.status ?? "active";
  const claimValue = claim === undefined ? null : {
    id: claim.id,
    status: claim.status,
    rewardType: claim.rewardType,
    rewardValue: claim.rewardValue,
    createdAt: claim.createdAt.toISOString(),
    updatedAt: claim.updatedAt.toISOString()
  };
  const parsed = QuestProgressSchema.safeParse({ quest, progress, status, rewardClaim: claimValue, updatedAt: raw?.updatedAt.toISOString() ?? definition.updatedAt.toISOString() });
  if (!parsed.success) throw new WheelQuestDependencyError();
  return parsed.data;
}

function parseDateInput(value: string | null): Date | null {
  if (value === null) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new QuestDefinitionValidationError();
  return parsed;
}

function assertAdminActor(staffUserId: number, requestId: string): void {
  if (!Number.isSafeInteger(staffUserId) || staffUserId < 1 || requestId.trim() === "") throw new QuestDefinitionValidationError();
}

function fingerprint(input: QuestDefinitionCreateRequest): string {
  return createHash("sha256").update(JSON.stringify({ code: input.code, title: input.title, description: input.description, goal: input.goal, unit: input.unit, rewardType: input.rewardType, rewardValue: input.rewardValue, isVisible: input.isVisible, activeFrom: input.activeFrom, activeUntil: input.activeUntil, sortOrder: input.sortOrder })).digest("hex");
}

function wheelSettingsFingerprint(input: WheelSettingsUpdateRequest): string {
  return createHash("sha256").update(JSON.stringify({
    expectedVersion: input.expectedVersion,
    enabled: input.enabled === undefined ? "__missing__" : input.enabled,
    minOrderAmountMinor: input.minOrderAmountMinor === undefined ? "__missing__" : input.minOrderAmountMinor,
    cooldownSeconds: input.cooldownSeconds === undefined ? "__missing__" : input.cooldownSeconds,
    maxSpins: input.maxSpins === undefined ? "__missing__" : input.maxSpins,
    limitPeriodSeconds: input.limitPeriodSeconds === undefined ? "__missing__" : input.limitPeriodSeconds,
    activeFrom: input.activeFrom === undefined ? "__missing__" : input.activeFrom,
    activeUntil: input.activeUntil === undefined ? "__missing__" : input.activeUntil
  })).digest("hex");
}

function wheelPrizeFingerprint(input: WheelPrizeUpdateRequest): string {
  return createHash("sha256").update(JSON.stringify({
    expectedVersion: input.expectedVersion,
    name: input.name === undefined ? "__missing__" : input.name,
    description: input.description === undefined ? "__missing__" : input.description,
    type: input.type === undefined ? "__missing__" : input.type,
    value: input.value === undefined ? "__missing__" : input.value,
    weight: input.weight === undefined ? "__missing__" : input.weight,
    isVisible: input.isVisible === undefined ? "__missing__" : input.isVisible,
    activeFrom: input.activeFrom === undefined ? "__missing__" : input.activeFrom,
    activeUntil: input.activeUntil === undefined ? "__missing__" : input.activeUntil,
    sortOrder: input.sortOrder === undefined ? "__missing__" : input.sortOrder
  })).digest("hex");
}

export class WheelQuestService {
  constructor(
    private readonly repository: WheelQuestRepository,
    private readonly authService: CustomerAuthService,
    private readonly now: () => Date = () => new Date()
  ) {}

  private async requireCustomer(token: string | null) {
    try {
      return await this.authService.getActiveSession(token);
    } catch (error: unknown) {
      if (error instanceof CustomerSessionError) throw new WheelQuestAuthenticationError();
      throw error;
    }
  }

  async getWheel(token: string | null): Promise<WheelStateResponse> {
    const session = await this.requireCustomer(token);
    const data = await this.repository.getWheelState(session.customer.id, this.now());
    if (data === null) return { status: "unavailable", reason: "not_configured" };
    const settings = toSettings(data.settings);
    const prizes = data.prizes.map(toPublicPrize);
    const claimBySpin = new Map(data.claims.map((claim) => [claim.spinId, claim]));
    const spins = data.spins.map((spin) => {
      const claim = claimBySpin.get(spin.id);
      if (claim === undefined) throw new WheelQuestDependencyError();
      return toSpin(spin, toWheelClaimStatus(claim.status));
    });
    const parsed = WheelStateResponseSchema.safeParse({
      status: "confirmed",
      settings,
      prizes,
      eligibility: {
        canSpin: data.eligibility.canSpin,
        reason: data.eligibility.reason,
        eligibleOrderId: data.eligibility.eligibleOrderId,
        cooldownUntil: data.eligibility.cooldownUntil?.toISOString() ?? null
      },
      spins
    });
    if (!parsed.success) throw new WheelQuestDependencyError();
    return parsed.data;
  }

  async spin(token: string | null, input: WheelSpinRequest, idempotencyKey: string): Promise<WheelSpinResponse> {
    const session = await this.requireCustomer(token);
    if (idempotencyKey.trim() === "") throw new WheelQuestDependencyError();
    const result = await this.repository.spin({ customerId: session.customer.id, orderId: input.orderId, idempotencyKey, now: this.now() });
    if (result.status === "idempotency_conflict") throw new WheelIdempotencyConflictError();
    if (result.status === "cooldown") throw new WheelCooldownError();
    if (result.status === "limit_reached") throw new WheelLimitReachedError();
    if (result.status === "not_eligible") throw new WheelNotEligibleError();
    if (result.status === "unavailable") throw new WheelUnavailableError();
    const response = { status: "completed" as const, spin: toSpin(result.spin, toWheelClaimStatus(result.claim.status)) };
    const parsed = WheelSpinResponseSchema.safeParse(response);
    if (!parsed.success) throw new WheelQuestDependencyError();
    return parsed.data;
  }

  async getQuests(token: string | null): Promise<QuestStateResponse> {
    const session = await this.requireCustomer(token);
    const data = await this.repository.getQuestState(session.customer.id, this.now());
    if (data === null) return { status: "unavailable", reason: "not_configured" };
    const progressByDefinition = new Map(data.progress.filter((row) => row.customerId === session.customer.id).map((row) => [row.questDefinitionId, row]));
    const claimByDefinition = new Map(data.claims.filter((row) => row.customerId === session.customer.id).map((row) => [row.questDefinitionId, row]));
    const response = { status: "confirmed" as const, quests: data.definitions.map((definition) => toQuestProgress(definition, progressByDefinition.get(definition.id), claimByDefinition.get(definition.id))) };
    const parsed = QuestStateResponseSchema.safeParse(response);
    if (!parsed.success) throw new WheelQuestDependencyError();
    return parsed.data;
  }

  async getAdminWheel(): Promise<AdminWheelResponse> {
    const data = await this.repository.getAdminWheel();
    if (data === null) throw new WheelSettingsNotFoundError();
    const parsed = AdminWheelResponseSchema.safeParse({ status: "confirmed", settings: toSettings(data.settings), prizes: data.prizes.map(toAdminPrize) });
    if (!parsed.success) throw new WheelQuestDependencyError();
    return parsed.data;
  }

  async updateWheelSettings(input: WheelSettingsUpdateRequest, staffUserId: number, idempotencyKey: string, requestId: string): Promise<AdminWheelResponse> {
    assertAdminActor(staffUserId, requestId);
    if (idempotencyKey.trim() === "") throw new QuestDefinitionValidationError();
    const data = await this.repository.updateWheelSettings({
      expectedVersion: input.expectedVersion,
      now: this.now(),
      actorStaffUserId: staffUserId,
      requestId,
      idempotencyKey,
      payloadFingerprint: wheelSettingsFingerprint(input),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.minOrderAmountMinor === undefined ? {} : { minOrderAmountMinor: input.minOrderAmountMinor }),
      ...(input.cooldownSeconds === undefined ? {} : { cooldownSeconds: input.cooldownSeconds }),
      ...(input.maxSpins === undefined ? {} : { maxSpins: input.maxSpins }),
      ...(input.limitPeriodSeconds === undefined ? {} : { limitPeriodSeconds: input.limitPeriodSeconds }),
      ...(input.activeFrom === undefined ? {} : { activeFrom: parseDateInput(input.activeFrom) }),
      ...(input.activeUntil === undefined ? {} : { activeUntil: parseDateInput(input.activeUntil) })
    });
    const parsed = AdminWheelResponseSchema.safeParse({ status: "confirmed", settings: toSettings(data.settings), prizes: data.prizes.map(toAdminPrize) });
    if (!parsed.success) throw new WheelQuestDependencyError();
    return parsed.data;
  }

  async createWheelPrize(input: WheelPrizeCreateRequest): Promise<AdminWheelResponse> {
    await this.repository.createWheelPrize({
      code: input.code,
      name: input.name,
      description: input.description,
      type: input.type,
      value: input.value,
      weight: input.weight,
      isVisible: input.isVisible,
      activeFrom: parseDateInput(input.activeFrom),
      activeUntil: parseDateInput(input.activeUntil),
      sortOrder: input.sortOrder,
      now: this.now()
    });
    return this.getAdminWheel();
  }

  async updateWheelPrize(id: number, input: WheelPrizeUpdateRequest, staffUserId: number, idempotencyKey: string, requestId: string): Promise<AdminWheelResponse> {
    assertAdminActor(staffUserId, requestId);
    if (idempotencyKey.trim() === "") throw new QuestDefinitionValidationError();
    await this.repository.updateWheelPrize(id, {
      expectedVersion: input.expectedVersion,
      now: this.now(),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.value === undefined ? {} : { value: input.value }),
      ...(input.weight === undefined ? {} : { weight: input.weight }),
      ...(input.isVisible === undefined ? {} : { isVisible: input.isVisible }),
      ...(input.activeFrom === undefined ? {} : { activeFrom: parseDateInput(input.activeFrom) }),
      ...(input.activeUntil === undefined ? {} : { activeUntil: parseDateInput(input.activeUntil) }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      actorStaffUserId: staffUserId,
      requestId,
      idempotencyKey,
      payloadFingerprint: wheelPrizeFingerprint(input)
    });
    return this.getAdminWheel();
  }

  async getAdminQuests(): Promise<AdminQuestsResponse> {
    const quests = await this.repository.getAdminQuests();
    if (quests === null) throw new WheelQuestDependencyError();
    const parsed = AdminQuestsResponseSchema.safeParse({ status: "confirmed", quests: quests.map(toDefinition) });
    if (!parsed.success) throw new WheelQuestDependencyError();
    return parsed.data;
  }

  async createQuest(input: QuestDefinitionCreateRequest, staffUserId: number, idempotencyKey: string, requestId: string): Promise<{ readonly response: AdminQuestsResponse; readonly created: boolean }> {
    assertAdminActor(staffUserId, requestId);
    if (idempotencyKey.trim() === "") throw new QuestDefinitionValidationError();
    const created = await this.repository.createQuest({
      code: input.code,
      title: input.title,
      description: input.description,
      goal: input.goal,
      unit: input.unit,
      rewardType: input.rewardType,
      rewardValue: input.rewardValue,
      isVisible: input.isVisible,
      activeFrom: parseDateInput(input.activeFrom),
      activeUntil: parseDateInput(input.activeUntil),
      sortOrder: input.sortOrder,
      actorStaffUserId: staffUserId,
      requestId,
      idempotencyKey,
      payloadFingerprint: fingerprint(input),
      now: this.now()
    });
    return { response: await this.getAdminQuests(), created: created.created };
  }

  async updateQuest(id: number, input: QuestDefinitionUpdateRequest, staffUserId: number, requestId: string): Promise<AdminQuestsResponse> {
    assertAdminActor(staffUserId, requestId);
    await this.repository.updateQuest(id, {
      expectedVersion: input.expectedVersion,
      now: this.now(),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.goal === undefined ? {} : { goal: input.goal }),
      ...(input.unit === undefined ? {} : { unit: input.unit }),
      ...(input.rewardType === undefined ? {} : { rewardType: input.rewardType }),
      ...(input.rewardValue === undefined ? {} : { rewardValue: input.rewardValue }),
      ...(input.isVisible === undefined ? {} : { isVisible: input.isVisible }),
      ...(input.activeFrom === undefined ? {} : { activeFrom: parseDateInput(input.activeFrom) }),
      ...(input.activeUntil === undefined ? {} : { activeUntil: parseDateInput(input.activeUntil) }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      actorStaffUserId: staffUserId,
      requestId
    });
    return this.getAdminQuests();
  }
}
