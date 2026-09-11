import { sql, type SQL } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";

export const ADMIN_SEGMENT_TIMEZONE = "Europe/Moscow" as const;
export const ADMIN_SEGMENT_PREVIEW_LIMIT = 50;

export const ADMIN_SEGMENT_CODES = [
  "sleeping",
  "one_timer",
  "churned",
  "newbies",
  "regulars",
  "vip",
  "big_spenders",
  "coal_rich",
  "at_risk"
] as const;
export type AdminSegmentCode = (typeof ADMIN_SEGMENT_CODES)[number];

export interface AdminSegmentRepositoryQuery {
  readonly limit: number;
  readonly offset: number;
}

export interface AdminSegmentRepositoryCount {
  readonly code: AdminSegmentCode;
  readonly count: number;
  readonly unavailableReason: "not_configured" | "reconciliation_required" | null;
}

export interface AdminSegmentRepositoryPreviewRow {
  readonly id: number;
  readonly name: string;
  readonly phoneMasked: string;
  readonly orderCount: number;
  readonly spentMinor: number;
  readonly lastActivityAt: Date | null;
}

export interface AdminSegmentRepositoryPreview {
  readonly rows: readonly AdminSegmentRepositoryPreviewRow[];
  readonly total: number;
  readonly unavailableReason: "not_configured" | "reconciliation_required" | null;
}

export interface AdminSegmentRepository {
  listBuiltinCounts(now: Date): Promise<readonly AdminSegmentRepositoryCount[]>;
  preview(
    code: AdminSegmentCode,
    query: AdminSegmentRepositoryQuery,
    now: Date
  ): Promise<AdminSegmentRepositoryPreview>;
}

class AdminSegmentDataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminSegmentDataIntegrityError";
  }
}

type QueryRow = Record<string, unknown>;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const KNOWN_ORDER_STATUSES = [
  "pending_payment",
  "payment_confirmed",
  "kitchen_accepted",
  "preparing",
  "ready_for_pickup",
  "completed",
  "fulfillment_problem",
  "canceled"
] as const;
const KNOWN_ORDER_STATUS_SQL = sql.join(
  KNOWN_ORDER_STATUSES.map((status) => sql`${status}`),
  sql`, `
);

function rowValue(row: QueryRow, key: string): unknown {
  return row[key];
}

function readSafeInteger(value: unknown, field: string): number {
  let integer: bigint;
  try {
    integer = typeof value === "bigint" ? value : BigInt(String(value ?? ""));
  } catch {
    throw new AdminSegmentDataIntegrityError(`Segment field ${field} is malformed`);
  }
  if (integer < 0n || integer > MAX_SAFE_INTEGER_BIGINT) {
    throw new AdminSegmentDataIntegrityError(`Segment field ${field} is out of range`);
  }
  return Number(integer);
}

function readText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AdminSegmentDataIntegrityError(`Segment field ${field} is malformed`);
  }
  return value.trim();
}

function readPhone(value: unknown): string {
  const phone = readText(value, "phone");
  if (!/^\+[1-9][0-9]{7,14}$/u.test(phone)) {
    throw new AdminSegmentDataIntegrityError("Segment phone is malformed");
  }
  return phone.length <= 4 ? "••••" : `•••• ${phone.slice(-4)}`;
}

function readDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new AdminSegmentDataIntegrityError("Segment activity date is malformed");
  }
  return date;
}

function assertValidNow(now: Date): void {
  if (Number.isNaN(now.getTime())) throw new AdminSegmentDataIntegrityError("Segment clock is invalid");
}

function segmentCtes(now: Date): SQL {
  return sql`
    WITH qualifying_orders AS (
      SELECT o.id, o.customer_id, o.total_minor, o.created_at
      FROM orders o
      WHERE o.status = 'completed'
        AND o.currency = 'RUB'
        AND o.total_minor >= 0
        AND EXISTS (
          SELECT 1
          FROM payments p
          WHERE p.order_id = o.id
            AND p.status = 'succeeded'
            AND p.provider_status = 'succeeded'
            AND p.amount_minor = o.total_minor
            AND p.currency = o.currency
        )
        AND NOT EXISTS (
          SELECT 1
          FROM refunds r
          WHERE r.order_id = o.id
            AND r.status IN ('pending', 'succeeded', 'reconciliation_required')
        )
    ),
    order_stats AS (
      SELECT
        customer_id,
        COUNT(*)::text AS order_count,
        COALESCE(SUM(total_minor), 0)::text AS spent_minor,
        MIN(created_at) AS first_order_at,
        MAX(created_at) AS last_order_at
      FROM qualifying_orders
      GROUP BY customer_id
    ),
    session_activity AS (
      SELECT customer_id, MAX(last_used_at) AS last_used_at
      FROM customer_sessions
      WHERE revoked_at IS NULL
      GROUP BY customer_id
    ),
    loyalty_projection AS (
      SELECT
        customer_id,
        COALESCE(SUM(xp_delta), 0)::text AS ledger_xp,
        COALESCE(SUM(coal_delta), 0)::text AS ledger_coal
      FROM loyalty_ledger
      GROUP BY customer_id
    ),
    loyalty_stats AS (
      SELECT
        la.customer_id,
        CASE
          WHEN la.xp = COALESCE(lp.ledger_xp, '0')::integer
            AND la.coal_balance = COALESCE(lp.ledger_coal, '0')::integer
            AND la.rank_code IN ('spark', 'heat', 'flame', 'volcano')
          THEN la.coal_balance
          ELSE NULL
        END AS coal_balance
      FROM loyalty_accounts la
      LEFT JOIN loyalty_projection lp ON lp.customer_id = la.customer_id
    ),
    customer_stats AS (
      SELECT
        c.id,
        c.name,
        c.phone,
        COALESCE(os.order_count, '0')::bigint AS order_count,
        COALESCE(os.spent_minor, '0')::bigint AS spent_minor,
        os.first_order_at,
        os.last_order_at,
        ls.coal_balance,
        GREATEST(os.last_order_at, sa.last_used_at) AS last_activity_at,
        CASE
          WHEN os.last_order_at IS NULL THEN NULL
          ELSE ((${now} AT TIME ZONE ${ADMIN_SEGMENT_TIMEZONE})::date - (os.last_order_at AT TIME ZONE ${ADMIN_SEGMENT_TIMEZONE})::date)
        END AS inactive_days
      FROM customers c
      LEFT JOIN order_stats os ON os.customer_id = c.id
      LEFT JOIN session_activity sa ON sa.customer_id = c.id
      LEFT JOIN loyalty_stats ls ON ls.customer_id = c.id
    ),
    source_quality AS (
      SELECT
        EXISTS (
          SELECT 1
          FROM orders o
          WHERE o.status NOT IN (${KNOWN_ORDER_STATUS_SQL})
            OR (
              o.status = 'completed'
              AND (
                o.currency <> 'RUB'
                OR o.total_minor < 0
                OR NOT EXISTS (
                  SELECT 1
                  FROM payments p
                  WHERE p.order_id = o.id
                    AND p.status = 'succeeded'
                    AND p.provider_status = 'succeeded'
                    AND p.amount_minor = o.total_minor
                    AND p.currency = o.currency
                )
                OR EXISTS (
                  SELECT 1
                  FROM refunds r
                  WHERE r.order_id = o.id
                    AND r.status IN ('pending', 'succeeded', 'reconciliation_required')
                )
              )
            )
        ) AS order_reconciliation_required,
        EXISTS (SELECT 1 FROM loyalty_accounts) AS loyalty_configured,
        EXISTS (
          SELECT 1
          FROM loyalty_accounts la
          LEFT JOIN loyalty_projection lp ON lp.customer_id = la.customer_id
          WHERE la.xp <> COALESCE(lp.ledger_xp, '0')::integer
             OR la.coal_balance <> COALESCE(lp.ledger_coal, '0')::integer
             OR la.rank_code NOT IN ('spark', 'heat', 'flame', 'volcano')
        ) AS loyalty_reconciliation_required,
        EXISTS (
          SELECT 1
          FROM customers c
          WHERE btrim(c.name) = ''
             OR c.phone !~ '^\\+[1-9][0-9]{7,14}$'
        ) AS customer_data_reconciliation_required
    )
  `;
}

function membershipCondition(code: AdminSegmentCode, now: Date): SQL {
  switch (code) {
    case "sleeping": return sql`cs.inactive_days >= 30`;
    case "one_timer": return sql`cs.order_count = 1`;
    case "churned": return sql`cs.inactive_days >= 14 AND cs.inactive_days < 30`;
    case "newbies": return sql`cs.order_count = 1 AND cs.first_order_at >= (((${now} AT TIME ZONE ${ADMIN_SEGMENT_TIMEZONE})::date - 7) AT TIME ZONE ${ADMIN_SEGMENT_TIMEZONE})`;
    case "regulars": return sql`cs.order_count >= 3`;
    case "vip": return sql`cs.spent_minor >= 500000`;
    case "big_spenders": return sql`cs.order_count > 0 AND cs.spent_minor >= (150000 * cs.order_count)`;
    case "coal_rich": return sql`cs.coal_balance >= 300`;
    case "at_risk": return sql`cs.inactive_days >= 7 AND cs.inactive_days < 14`;
  }
}

function unavailableReason(
  code: AdminSegmentCode,
  quality: { readonly orderReconciliationRequired: boolean; readonly loyaltyConfigured: boolean; readonly loyaltyReconciliationRequired: boolean; readonly customerDataReconciliationRequired: boolean }
): "not_configured" | "reconciliation_required" | null {
  if (quality.customerDataReconciliationRequired) return "reconciliation_required";
  if (code === "coal_rich") {
    if (!quality.loyaltyConfigured) return "not_configured";
    if (quality.loyaltyReconciliationRequired) return "reconciliation_required";
    return null;
  }
  return quality.orderReconciliationRequired ? "reconciliation_required" : null;
}

function qualityFromRow(row: QueryRow) {
  const readBoolean = (key: string): boolean => {
    const value = rowValue(row, key);
    if (typeof value !== "boolean") throw new AdminSegmentDataIntegrityError(`Segment quality field ${key} is malformed`);
    return value;
  };
  return {
    orderReconciliationRequired: readBoolean("order_reconciliation_required"),
    loyaltyConfigured: readBoolean("loyalty_configured"),
    loyaltyReconciliationRequired: readBoolean("loyalty_reconciliation_required"),
    customerDataReconciliationRequired: readBoolean("customer_data_reconciliation_required")
  };
}

function countSelect(now: Date): SQL {
  return sql`
    SELECT
      COUNT(cs.id) FILTER (WHERE cs.inactive_days >= 30)::text AS sleeping,
      COUNT(cs.id) FILTER (WHERE cs.order_count = 1)::text AS one_timer,
      COUNT(cs.id) FILTER (WHERE cs.inactive_days >= 14 AND cs.inactive_days < 30)::text AS churned,
      COUNT(cs.id) FILTER (WHERE cs.order_count = 1 AND cs.first_order_at >= (((${now} AT TIME ZONE ${ADMIN_SEGMENT_TIMEZONE})::date - 7) AT TIME ZONE ${ADMIN_SEGMENT_TIMEZONE}))::text AS newbies,
      COUNT(cs.id) FILTER (WHERE cs.order_count >= 3)::text AS regulars,
      COUNT(cs.id) FILTER (WHERE cs.spent_minor >= 500000)::text AS vip,
      COUNT(cs.id) FILTER (WHERE cs.order_count > 0 AND cs.spent_minor >= (150000 * cs.order_count))::text AS big_spenders,
      COUNT(cs.id) FILTER (WHERE cs.coal_balance >= 300)::text AS coal_rich,
      COUNT(cs.id) FILTER (WHERE cs.inactive_days >= 7 AND cs.inactive_days < 14)::text AS at_risk,
      sq.order_reconciliation_required,
      sq.loyalty_configured,
      sq.loyalty_reconciliation_required,
      sq.customer_data_reconciliation_required
    FROM source_quality sq
    LEFT JOIN customer_stats cs ON true
    GROUP BY sq.order_reconciliation_required, sq.loyalty_configured, sq.loyalty_reconciliation_required, sq.customer_data_reconciliation_required
  `;
}

function queryCountValue(row: QueryRow, code: AdminSegmentCode): number {
  return readSafeInteger(rowValue(row, code), code);
}

export function createAdminSegmentRepository(client: DatabaseClient): AdminSegmentRepository {
  return {
    async listBuiltinCounts(now) {
      assertValidNow(now);
      const result = await client.db.execute(sql`${segmentCtes(now)} ${countSelect(now)}`);
      const row = (result.rows[0] ?? {}) as QueryRow;
      const quality = qualityFromRow(row);
      return ADMIN_SEGMENT_CODES.map((code) => ({
        code,
        count: queryCountValue(row, code),
        unavailableReason: unavailableReason(code, quality)
      }));
    },

    async preview(code, query, now) {
      assertValidNow(now);
      if (!ADMIN_SEGMENT_CODES.includes(code)) throw new AdminSegmentDataIntegrityError("Segment code is unknown");
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > ADMIN_SEGMENT_PREVIEW_LIMIT || !Number.isInteger(query.offset) || query.offset < 0) {
        throw new AdminSegmentDataIntegrityError("Segment preview bounds are invalid");
      }

      const condition = membershipCondition(code, now);
      const countResult = await client.db.execute(sql`
        ${segmentCtes(now)}
        SELECT COUNT(cs.id)::text AS total,
          sq.order_reconciliation_required,
          sq.loyalty_configured,
          sq.loyalty_reconciliation_required,
          sq.customer_data_reconciliation_required
        FROM source_quality sq
        LEFT JOIN customer_stats cs ON ${condition}
        GROUP BY sq.order_reconciliation_required, sq.loyalty_configured, sq.loyalty_reconciliation_required, sq.customer_data_reconciliation_required
      `);
      const countRow = (countResult.rows[0] ?? {}) as QueryRow;
      const quality = qualityFromRow(countRow);
      const reason = unavailableReason(code, quality);
      if (reason !== null) return { rows: [], total: 0, unavailableReason: reason };
      const total = readSafeInteger(rowValue(countRow, "total"), "total");

      const rowsResult = await client.db.execute(sql`
        ${segmentCtes(now)}
        SELECT cs.id, cs.name, cs.phone, cs.order_count, cs.spent_minor, cs.last_activity_at
        FROM customer_stats cs
        WHERE ${condition}
        ORDER BY cs.spent_minor DESC, cs.id ASC
        LIMIT ${query.limit}
        OFFSET ${query.offset}
      `);
      const rows = rowsResult.rows.map((rawRow) => {
        const row = rawRow as QueryRow;
        return {
          id: readSafeInteger(rowValue(row, "id"), "id"),
          name: readText(rowValue(row, "name"), "name"),
          phoneMasked: readPhone(rowValue(row, "phone")),
          orderCount: readSafeInteger(rowValue(row, "order_count"), "order_count"),
          spentMinor: readSafeInteger(rowValue(row, "spent_minor"), "spent_minor"),
          lastActivityAt: readDate(rowValue(row, "last_activity_at"))
        } satisfies AdminSegmentRepositoryPreviewRow;
      });
      return { rows, total, unavailableReason: null };
    }
  };
}
