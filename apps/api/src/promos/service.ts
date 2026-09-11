import {
  AdminPromoResponseSchema,
  AdminPromoSchema,
  AdminPromoRedemptionsResponseSchema,
  AdminPromosResponseSchema,
  type AdminPromo,
  type AdminPromoCreateRequest,
  type AdminPromoUpdateRequest,
  type AdminPromoRedemptionsQuery,
  type AdminPromosQuery
} from "@vse-pro-zhar/contracts";
import type {
  AdminPromoCreateInput,
  AdminPromoRepository,
  AdminPromoRepositoryRow,
  AdminPromoUpdateInput
} from "@vse-pro-zhar/database";

export const ADMIN_PROMO_TIMEZONE = "Europe/Moscow" as const;

export class AdminPromoValidationError extends Error {
  constructor(message = "Promo input is invalid") {
    super(message);
    this.name = "AdminPromoValidationError";
  }
}

export class AdminPromoNotFoundError extends Error {
  constructor() {
    super("Promo was not found");
    this.name = "AdminPromoNotFoundError";
  }
}

function assertClock(now: Date): void {
  if (Number.isNaN(now.getTime())) throw new AdminPromoValidationError("Promo clock is invalid");
}

function assertEconomics(type: AdminPromoRepositoryRow["type"], value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new AdminPromoValidationError("Promo value must be a positive integer");
  if (type === "percent" && value > 100) throw new AdminPromoValidationError("Percent promo value must be between 1 and 100");
  if (type === "fixed" && value > 1_000_000_000) throw new AdminPromoValidationError("Fixed promo value is too large");
}

function assertPeriod(activeFrom: Date, activeUntil: Date | null): void {
  if (Number.isNaN(activeFrom.getTime()) || (activeUntil !== null && Number.isNaN(activeUntil.getTime()))) throw new AdminPromoValidationError("Promo active period is invalid");
  if (activeUntil !== null && activeUntil <= activeFrom) throw new AdminPromoValidationError("Promo active period is invalid");
}

function toPromo(row: AdminPromoRepositoryRow): AdminPromo {
  return AdminPromoSchema.parse({
    id: row.id,
    code: row.code,
    description: row.description,
    type: row.type,
    value: row.value,
    minimumOrderMinor: row.minimumOrderMinor,
    currency: row.currency,
    activeFrom: row.activeFrom.toISOString(),
    activeUntil: row.activeUntil?.toISOString() ?? null,
    globalUsageLimit: row.globalUsageLimit,
    perCustomerUsageLimit: row.perCustomerUsageLimit,
    stackingPolicy: row.stackingPolicy,
    status: row.status,
    version: row.version,
    usageCount: row.usageCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  });
}

function createInput(input: AdminPromoCreateRequest, staffUserId: number, now: Date): AdminPromoCreateInput {
  const activeFrom = input.activeFrom === undefined || input.activeFrom === null ? now : new Date(input.activeFrom);
  const activeUntil = input.activeUntil === undefined || input.activeUntil === null ? null : new Date(input.activeUntil);
  assertEconomics(input.type, input.value);
  assertPeriod(activeFrom, activeUntil);
  if (input.minimumOrderMinor < 0) throw new AdminPromoValidationError("Minimum order must be non-negative");
  return {
    code: input.code,
    description: input.description,
    type: input.type,
    value: input.value,
    minimumOrderMinor: input.minimumOrderMinor,
    activeFrom,
    activeUntil,
    globalUsageLimit: input.globalUsageLimit,
    perCustomerUsageLimit: input.perCustomerUsageLimit,
    staffUserId
  };
}

function updateInput(input: AdminPromoUpdateRequest, current: AdminPromoRepositoryRow, staffUserId: number): AdminPromoUpdateInput {
  const type = input.type ?? current.type;
  const value = input.value ?? current.value;
  const activeFrom = input.activeFrom === undefined || input.activeFrom === null ? current.activeFrom : new Date(input.activeFrom);
  const activeUntil = input.activeUntil === undefined ? current.activeUntil : input.activeUntil === null ? null : new Date(input.activeUntil);
  assertEconomics(type, value);
  assertPeriod(activeFrom, activeUntil);
  if ((input.minimumOrderMinor ?? current.minimumOrderMinor) < 0) throw new AdminPromoValidationError("Minimum order must be non-negative");
  return {
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.type === undefined ? {} : { type }),
    ...(input.value === undefined ? {} : { value }),
    ...(input.minimumOrderMinor === undefined ? {} : { minimumOrderMinor: input.minimumOrderMinor }),
    ...(input.activeFrom === undefined || input.activeFrom === null ? {} : { activeFrom }),
    ...(input.activeUntil === undefined ? {} : { activeUntil }),
    ...(input.globalUsageLimit === undefined ? {} : { globalUsageLimit: input.globalUsageLimit }),
    ...(input.perCustomerUsageLimit === undefined ? {} : { perCustomerUsageLimit: input.perCustomerUsageLimit }),
    ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    staffUserId
  };
}

export async function getAdminPromos(repository: AdminPromoRepository, query: AdminPromosQuery, now: Date) {
  assertClock(now);
  const result = await repository.list(query);
  return AdminPromosResponseSchema.parse({
    status: "confirmed",
    timezone: ADMIN_PROMO_TIMEZONE,
    currency: "RUB",
    promos: result.rows.map(toPromo),
    pagination: {
      limit: query.limit,
      offset: query.offset,
      total: result.total,
      hasNext: query.offset + result.rows.length < result.total
    },
    customerCheckout: { status: "unavailable", reason: "owner_decision_required" }
  });
}

export async function getAdminPromoRedemptions(repository: AdminPromoRepository, id: number, query: AdminPromoRedemptionsQuery) {
  const result = await repository.listRedemptions(id, query);
  if (result === null) throw new AdminPromoNotFoundError();
  return AdminPromoRedemptionsResponseSchema.parse({
    status: "confirmed",
    promoId: result.promoId,
    promoCode: result.promoCode,
    redemptions: result.rows.map((row) => ({
      id: row.id,
      customerId: row.customerId,
      orderId: row.orderId,
      discountMinor: row.discountMinor,
      preDiscountTotalMinor: row.preDiscountTotalMinor,
      finalTotalMinor: row.finalTotalMinor,
      currency: row.currency,
      status: row.status,
      createdAt: row.createdAt.toISOString()
    })),
    pagination: {
      limit: query.limit,
      offset: query.offset,
      total: result.total,
      hasNext: query.offset + result.rows.length < result.total
    }
  });
}

export async function createAdminPromo(repository: AdminPromoRepository, input: AdminPromoCreateRequest, staffUserId: number, now: Date) {
  assertClock(now);
  const created = await repository.create(createInput(input, staffUserId, now));
  return AdminPromoResponseSchema.parse({ promo: toPromo(created) });
}

export async function updateAdminPromo(repository: AdminPromoRepository, id: number, input: AdminPromoUpdateRequest, staffUserId: number) {
  const current = await repository.get(id);
  if (current === null) throw new AdminPromoNotFoundError();
  if (current.status === "archived" && input.isActive === true) throw new AdminPromoValidationError("Archived promo cannot be activated");
  const updated = await repository.update(id, updateInput(input, current, staffUserId));
  if (updated === null) throw new AdminPromoNotFoundError();
  return AdminPromoResponseSchema.parse({ promo: toPromo(updated) });
}

export async function setAdminPromoActive(repository: AdminPromoRepository, id: number, isActive: boolean, staffUserId: number) {
  const current = await repository.get(id);
  if (current === null) throw new AdminPromoNotFoundError();
  if (current.status === "archived" && isActive) throw new AdminPromoValidationError("Archived promo cannot be activated");
  const updated = await repository.setActive(id, isActive, staffUserId);
  if (updated === null) throw new AdminPromoNotFoundError();
  return AdminPromoResponseSchema.parse({ promo: toPromo(updated) });
}

export async function archiveAdminPromo(repository: AdminPromoRepository, id: number, staffUserId: number) {
  const archived = await repository.archive(id, staffUserId);
  if (archived === null) throw new AdminPromoNotFoundError();
  return AdminPromoResponseSchema.parse({ promo: toPromo(archived) });
}
