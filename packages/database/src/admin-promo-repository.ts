import { sql } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";
import { promoDefinitionVersions, promoDefinitions } from "./schema.js";

export type AdminPromoStatus = "active" | "inactive" | "archived";
export type AdminPromoType = "percent" | "fixed";

export interface AdminPromoRepositoryQuery {
  readonly limit: number;
  readonly offset: number;
  readonly search: string;
  readonly status?: AdminPromoStatus | undefined;
}

export interface AdminPromoCreateInput {
  readonly code: string;
  readonly description: string;
  readonly type: AdminPromoType;
  readonly value: number;
  readonly minimumOrderMinor: number;
  readonly activeFrom: Date;
  readonly activeUntil: Date | null;
  readonly globalUsageLimit: number | null;
  readonly perCustomerUsageLimit: number | null;
  readonly staffUserId: number;
}

export interface AdminPromoUpdateInput {
  readonly description?: string;
  readonly type?: AdminPromoType;
  readonly value?: number;
  readonly minimumOrderMinor?: number;
  readonly activeFrom?: Date | null;
  readonly activeUntil?: Date | null;
  readonly globalUsageLimit?: number | null;
  readonly perCustomerUsageLimit?: number | null;
  readonly isActive?: boolean;
  readonly staffUserId: number;
}

export interface AdminPromoRepositoryRow {
  readonly id: number;
  readonly code: string;
  readonly description: string;
  readonly type: AdminPromoType;
  readonly value: number;
  readonly minimumOrderMinor: number;
  readonly currency: "RUB";
  readonly activeFrom: Date;
  readonly activeUntil: Date | null;
  readonly globalUsageLimit: number | null;
  readonly perCustomerUsageLimit: number | null;
  readonly stackingPolicy: "none";
  readonly status: AdminPromoStatus;
  readonly version: number;
  readonly usageCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AdminPromoRepositoryResult {
  readonly rows: readonly AdminPromoRepositoryRow[];
  readonly total: number;
}

export interface AdminPromoRedemptionsQuery {
  readonly limit: number;
  readonly offset: number;
}

export interface AdminPromoRedemptionRepositoryRow {
  readonly id: number;
  readonly customerId: number | null;
  readonly orderId: number | null;
  readonly discountMinor: number;
  readonly preDiscountTotalMinor: number;
  readonly finalTotalMinor: number;
  readonly currency: "RUB";
  readonly status: "pending" | "succeeded" | "canceled" | "reconciliation_required";
  readonly createdAt: Date;
}

export interface AdminPromoRedemptionsResult {
  readonly promoId: number;
  readonly promoCode: string;
  readonly rows: readonly AdminPromoRedemptionRepositoryRow[];
  readonly total: number;
}

export interface AdminPromoRepository {
  list(query: AdminPromoRepositoryQuery): Promise<AdminPromoRepositoryResult>;
  get(id: number): Promise<AdminPromoRepositoryRow | null>;
  listRedemptions(id: number, query: AdminPromoRedemptionsQuery): Promise<AdminPromoRedemptionsResult | null>;
  create(input: AdminPromoCreateInput): Promise<AdminPromoRepositoryRow>;
  update(id: number, input: AdminPromoUpdateInput): Promise<AdminPromoRepositoryRow | null>;
  setActive(id: number, isActive: boolean, staffUserId: number): Promise<AdminPromoRepositoryRow | null>;
  archive(id: number, staffUserId: number): Promise<AdminPromoRepositoryRow | null>;
}

export class AdminPromoCodeConflictError extends Error {
  constructor() {
    super("Promo code already exists");
    this.name = "AdminPromoCodeConflictError";
  }
}

class AdminPromoDataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminPromoDataIntegrityError";
  }
}

type QueryRow = Record<string, unknown>;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function value(row: QueryRow, key: string): unknown {
  return row[key];
}

function safeInteger(raw: unknown, field: string): number {
  let parsed: bigint;
  try {
    parsed = typeof raw === "bigint" ? raw : BigInt(String(raw ?? ""));
  } catch {
    throw new AdminPromoDataIntegrityError(`Promo field ${field} is malformed`);
  }
  if (parsed < 0n || parsed > MAX_SAFE_INTEGER_BIGINT) throw new AdminPromoDataIntegrityError(`Promo field ${field} is out of range`);
  return Number(parsed);
}

function positiveInteger(raw: unknown, field: string): number {
  const parsed = safeInteger(raw, field);
  if (parsed < 1) throw new AdminPromoDataIntegrityError(`Promo field ${field} is invalid`);
  return parsed;
}

function text(raw: unknown, field: string): string {
  if (typeof raw !== "string") throw new AdminPromoDataIntegrityError(`Promo field ${field} is malformed`);
  return raw.trim();
}

function date(raw: unknown, field: string): Date {
  const parsed = raw instanceof Date ? new Date(raw.getTime()) : new Date(String(raw ?? ""));
  if (Number.isNaN(parsed.getTime())) throw new AdminPromoDataIntegrityError(`Promo field ${field} is malformed`);
  return parsed;
}

function nullableDate(raw: unknown, field: string): Date | null {
  return raw === null || raw === undefined ? null : date(raw, field);
}

function bool(raw: unknown, field: string): boolean {
  if (typeof raw !== "boolean") throw new AdminPromoDataIntegrityError(`Promo field ${field} is malformed`);
  return raw;
}

function status(isActive: boolean, isArchived: boolean): AdminPromoStatus {
  if (isArchived) return "archived";
  return isActive ? "active" : "inactive";
}

function nullablePositiveInteger(raw: unknown, field: string): number | null {
  return raw === null || raw === undefined ? null : positiveInteger(raw, field);
}

function parseRedemptionRow(raw: QueryRow): AdminPromoRedemptionRepositoryRow {
  const currency = text(value(raw, "currency"), "currency");
  if (currency !== "RUB") throw new AdminPromoDataIntegrityError("Promo redemption currency is unknown");
  const redemptionStatus = text(value(raw, "status"), "status");
  if (!(["pending", "succeeded", "canceled", "reconciliation_required"] as readonly string[]).includes(redemptionStatus)) throw new AdminPromoDataIntegrityError("Promo redemption status is unknown");
  return {
    id: positiveInteger(value(raw, "id"), "id"),
    customerId: nullablePositiveInteger(value(raw, "customer_id"), "customer_id"),
    orderId: nullablePositiveInteger(value(raw, "order_id"), "order_id"),
    discountMinor: safeInteger(value(raw, "discount_minor"), "discount_minor"),
    preDiscountTotalMinor: safeInteger(value(raw, "pre_discount_total_minor"), "pre_discount_total_minor"),
    finalTotalMinor: safeInteger(value(raw, "final_total_minor"), "final_total_minor"),
    currency,
    status: redemptionStatus as AdminPromoRedemptionRepositoryRow["status"],
    createdAt: date(value(raw, "created_at"), "created_at")
  };
}

function parseRow(raw: QueryRow): AdminPromoRepositoryRow {
  const promoType = text(value(raw, "promo_type"), "type");
  if (promoType !== "percent" && promoType !== "fixed") throw new AdminPromoDataIntegrityError("Promo type is unknown");
  const currency = text(value(raw, "currency"), "currency");
  if (currency !== "RUB") throw new AdminPromoDataIntegrityError("Promo currency is unknown");
  const stackingPolicy = text(value(raw, "stacking_policy"), "stacking_policy");
  if (stackingPolicy !== "none") throw new AdminPromoDataIntegrityError("Promo stacking policy is unknown");
  const active = bool(value(raw, "is_active"), "is_active");
  const archived = bool(value(raw, "is_archived"), "is_archived");
  const activeFrom = date(value(raw, "active_from"), "active_from");
  const activeUntil = nullableDate(value(raw, "active_until"), "active_until");
  if (activeUntil !== null && activeUntil <= activeFrom) throw new AdminPromoDataIntegrityError("Promo active period is invalid");
  return {
    id: positiveInteger(value(raw, "id"), "id"),
    code: text(value(raw, "code"), "code"),
    description: text(value(raw, "description"), "description"),
    type: promoType,
    value: positiveInteger(value(raw, "value"), "value"),
    minimumOrderMinor: safeInteger(value(raw, "minimum_order_minor"), "minimum_order_minor"),
    currency,
    activeFrom,
    activeUntil,
    globalUsageLimit: value(raw, "global_usage_limit") === null ? null : positiveInteger(value(raw, "global_usage_limit"), "global_usage_limit"),
    perCustomerUsageLimit: value(raw, "per_customer_usage_limit") === null ? null : positiveInteger(value(raw, "per_customer_usage_limit"), "per_customer_usage_limit"),
    stackingPolicy,
    status: status(active, archived),
    version: positiveInteger(value(raw, "version"), "version"),
    usageCount: safeInteger(value(raw, "usage_count"), "usage_count"),
    createdAt: date(value(raw, "created_at"), "created_at"),
    updatedAt: date(value(raw, "updated_at"), "updated_at")
  };
}

function whereClause(query: AdminPromoRepositoryQuery) {
  const search = query.search.trim();
  const conditions = [sql`TRUE`];
  if (search !== "") conditions.push(sql`(p.code ILIKE ${`%${search}%`} OR p.description ILIKE ${`%${search}%`})`);
  if (query.status === "active") conditions.push(sql`p.is_archived = false AND p.is_active = true`);
  if (query.status === "inactive") conditions.push(sql`p.is_archived = false AND p.is_active = false`);
  if (query.status === "archived") conditions.push(sql`p.is_archived = true`);
  return sql.join(conditions, sql` AND `);
}

function valuesForSnapshot(row: { readonly id: number; readonly version: number; readonly code: string; readonly description: string; readonly promoType: string; readonly value: number; readonly minimumOrderMinor: number; readonly currency: string; readonly activeFrom: Date; readonly activeUntil: Date | null; readonly globalUsageLimit: number | null; readonly perCustomerUsageLimit: number | null; readonly stackingPolicy: string; readonly isActive: boolean; readonly isArchived: boolean }, actorStaffUserId: number) {
  return {
    promoDefinitionId: row.id,
    version: row.version,
    code: row.code,
    description: row.description,
    promoType: row.promoType,
    value: row.value,
    minimumOrderMinor: row.minimumOrderMinor,
    currency: row.currency,
    activeFrom: row.activeFrom,
    activeUntil: row.activeUntil,
    globalUsageLimit: row.globalUsageLimit,
    perCustomerUsageLimit: row.perCustomerUsageLimit,
    stackingPolicy: row.stackingPolicy,
    isActive: row.isActive,
    isArchived: row.isArchived,
    actorStaffUserId
  };
}

export function createAdminPromoRepository(client: DatabaseClient): AdminPromoRepository {
  async function readOne(id: number): Promise<AdminPromoRepositoryRow | null> {
    const result = await client.db.execute(sql`
      SELECT p.*, COALESCE((SELECT COUNT(*) FROM promo_redemptions r WHERE r.promo_definition_id = p.id AND r.status = 'succeeded'), 0)::text AS usage_count
      FROM promo_definitions p
      WHERE p.id = ${id}
      LIMIT 1
    `);
    const raw = result.rows[0] as QueryRow | undefined;
    return raw === undefined ? null : parseRow(raw);
  }

  async function withCodeConflict<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505") throw new AdminPromoCodeConflictError();
      throw error;
    }
  }

  async function snapshot(tx: Pick<DatabaseClient["db"], "insert">, row: Parameters<typeof valuesForSnapshot>[0], actorStaffUserId: number): Promise<void> {
    await tx.insert(promoDefinitionVersions).values(valuesForSnapshot(row, actorStaffUserId));
  }

  return {
    async list(query) {
      const where = whereClause(query);
      const result = await client.db.execute(sql`
        SELECT p.*, COALESCE((SELECT COUNT(*) FROM promo_redemptions r WHERE r.promo_definition_id = p.id AND r.status = 'succeeded'), 0)::text AS usage_count
        FROM promo_definitions p
        WHERE ${where}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ${query.limit} OFFSET ${query.offset}
      `);
      const totalResult = await client.db.execute(sql`SELECT COUNT(*)::text AS total FROM promo_definitions p WHERE ${where}`);
      return {
        rows: result.rows.map((row) => parseRow(row as QueryRow)),
        total: safeInteger((totalResult.rows[0] as QueryRow | undefined)?.["total"], "total")
      };
    },

    get: readOne,

    async listRedemptions(id, query) {
      const promo = await readOne(id);
      if (promo === null) return null;
      const result = await client.db.execute(sql`
        SELECT id, customer_id, order_id, discount_minor, pre_discount_total_minor, final_total_minor, currency, status, created_at
        FROM promo_redemptions
        WHERE promo_definition_id = ${id}
        ORDER BY created_at DESC, id DESC
        LIMIT ${query.limit} OFFSET ${query.offset}
      `);
      const totalResult = await client.db.execute(sql`SELECT COUNT(*)::text AS total FROM promo_redemptions WHERE promo_definition_id = ${id}`);
      return {
        promoId: promo.id,
        promoCode: promo.code,
        rows: result.rows.map((rawRow) => parseRedemptionRow(rawRow as QueryRow)),
        total: safeInteger((totalResult.rows[0] as QueryRow | undefined)?.["total"], "redemption_total")
      };
    },

    async create(input) {
      return withCodeConflict(async () => {
        const row = await client.db.transaction(async (tx) => {
          const [created] = await tx.insert(promoDefinitions).values({
            code: input.code,
            description: input.description,
            promoType: input.type,
            value: input.value,
            minimumOrderMinor: input.minimumOrderMinor,
            currency: "RUB",
            activeFrom: input.activeFrom,
            activeUntil: input.activeUntil,
            globalUsageLimit: input.globalUsageLimit,
            perCustomerUsageLimit: input.perCustomerUsageLimit,
            stackingPolicy: "none",
            isActive: true,
            isArchived: false,
            version: 1,
            createdByStaffUserId: input.staffUserId,
            updatedByStaffUserId: input.staffUserId
          }).returning();
          if (created === undefined) throw new Error("Promo insert returned no row");
          await snapshot(tx, created, input.staffUserId);
          return created;
        });
        const result = await readOne(row.id);
        if (result === null) throw new Error("Created promo could not be read");
        return result;
      });
    },

    async update(id, input) {
      return withCodeConflict(async () => {
        const updated = await client.db.transaction(async (tx) => {
          const [current] = await tx.select().from(promoDefinitions).where(sql`${promoDefinitions.id} = ${id}`).limit(1);
          if (current === undefined) return null;
          const [next] = await tx.update(promoDefinitions).set({
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.type === undefined ? {} : { promoType: input.type }),
            ...(input.value === undefined ? {} : { value: input.value }),
            ...(input.minimumOrderMinor === undefined ? {} : { minimumOrderMinor: input.minimumOrderMinor }),
            ...(input.activeFrom === undefined || input.activeFrom === null ? {} : { activeFrom: input.activeFrom }),
            ...(input.activeUntil === undefined ? {} : { activeUntil: input.activeUntil }),
            ...(input.globalUsageLimit === undefined ? {} : { globalUsageLimit: input.globalUsageLimit }),
            ...(input.perCustomerUsageLimit === undefined ? {} : { perCustomerUsageLimit: input.perCustomerUsageLimit }),
            ...(input.isActive === undefined ? {} : { isActive: input.isActive, isArchived: input.isActive ? current.isArchived : current.isArchived }),
            updatedByStaffUserId: input.staffUserId,
            version: sql`${promoDefinitions.version} + 1`,
            updatedAt: new Date()
          }).where(sql`${promoDefinitions.id} = ${id}`).returning();
          if (next === undefined) return null;
          await snapshot(tx, next, input.staffUserId);
          return next;
        });
        if (updated === null) return null;
        return readOne(updated.id);
      });
    },

    async setActive(id, isActive, staffUserId) {
      return this.update(id, { isActive, staffUserId });
    },

    async archive(id, staffUserId) {
      const updated = await client.db.transaction(async (tx) => {
        const [current] = await tx.select().from(promoDefinitions).where(sql`${promoDefinitions.id} = ${id}`).limit(1);
        if (current === undefined) return null;
        const [next] = await tx.update(promoDefinitions).set({
          isActive: false,
          isArchived: true,
          updatedByStaffUserId: staffUserId,
          version: sql`${promoDefinitions.version} + 1`,
          updatedAt: new Date()
        }).where(sql`${promoDefinitions.id} = ${id}`).returning();
        if (next === undefined) return null;
        await snapshot(tx, next, staffUserId);
        return next;
      });
      return updated === null ? null : readOne(updated.id);
    }
  };
}
