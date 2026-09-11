import { sql } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";

export interface AdminCustomerRepositoryQuery {
  readonly limit: number;
  readonly offset: number;
  readonly search: string;
}

export interface AdminCustomerRepositoryRow {
  readonly id: number;
  readonly name: string;
  readonly phone: string;
  readonly orderCount: number;
  readonly spentMinor: number;
  readonly coalBalance: number | null;
  readonly xp: number | null;
  readonly rank: "spark" | "heat" | "flame" | "volcano" | null;
  readonly lastActivityAt: Date | null;
}

export interface AdminCustomerRepositoryResult {
  readonly rows: readonly AdminCustomerRepositoryRow[];
  readonly total: number;
}

export interface AdminCustomerRepository {
  list(query: AdminCustomerRepositoryQuery): Promise<AdminCustomerRepositoryResult>;
}

class AdminCustomerDataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminCustomerDataIntegrityError";
  }
}

type QueryRow = Record<string, unknown>;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function rowValue(row: QueryRow, key: string): unknown {
  return row[key];
}

function readSafeInteger(value: unknown, field: string): number {
  let integer: bigint;
  try {
    integer = typeof value === "bigint" ? value : BigInt(String(value ?? ""));
  } catch {
    throw new AdminCustomerDataIntegrityError(`Customer field ${field} is malformed`);
  }
  if (integer < 0n || integer > MAX_SAFE_INTEGER_BIGINT) {
    throw new AdminCustomerDataIntegrityError(`Customer field ${field} is out of range`);
  }
  return Number(integer);
}

function readText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AdminCustomerDataIntegrityError(`Customer field ${field} is malformed`);
  }
  return value.trim();
}

function readPhone(value: unknown): string {
  const phone = readText(value, "phone");
  return phone.length <= 4 ? "••••" : `•••• ${phone.slice(-4)}`;
}

function readRank(value: unknown): AdminCustomerRepositoryRow["rank"] {
  if (value === null || value === undefined) return null;
  if (value === "spark" || value === "heat" || value === "flame" || value === "volcano") return value;
  throw new AdminCustomerDataIntegrityError("Customer rank is unknown");
}

function readDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new AdminCustomerDataIntegrityError("Customer activity date is malformed");
  return date;
}

function searchCondition(search: string) {
  return sql`(${search} = '' OR c.name ILIKE '%' || ${search} || '%' OR c.phone LIKE '%' || ${search} || '%')`;
}

const customerAggregates = sql`
  WITH qualifying_orders AS (
    SELECT o.id, o.customer_id, o.total_minor, o.currency, o.created_at
    FROM orders o
    WHERE o.status = 'completed'
      AND o.currency = 'RUB'
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
      o.customer_id,
      COUNT(*)::text AS order_count,
      COALESCE(SUM(q.total_minor), 0)::text AS spent_minor,
      MAX(o.created_at) AS last_order_at
    FROM orders o
    LEFT JOIN qualifying_orders q ON q.id = o.id
    GROUP BY o.customer_id
  ),
  loyalty_projection AS (
    SELECT
      customer_id,
      COALESCE(SUM(xp_delta), 0)::text AS ledger_xp,
      COALESCE(SUM(coal_delta), 0)::text AS ledger_coal
    FROM loyalty_ledger
    GROUP BY customer_id
  ),
  session_activity AS (
    SELECT customer_id, MAX(last_used_at) AS last_used_at
    FROM customer_sessions
    WHERE revoked_at IS NULL
    GROUP BY customer_id
  )
`;

export function createAdminCustomerRepository(client: DatabaseClient): AdminCustomerRepository {
  return {
    async list(query) {
      const condition = searchCondition(query.search);
      const countResult = await client.db.execute(sql`
        ${customerAggregates}
        SELECT COUNT(*)::text AS total
        FROM customers c
        WHERE ${condition}
      `);
      const countRow = (countResult.rows[0] ?? {}) as QueryRow;
      const total = readSafeInteger(rowValue(countRow, "total"), "total");

      const result = await client.db.execute(sql`
        ${customerAggregates}
        SELECT
          c.id,
          c.name,
          c.phone,
          COALESCE(os.order_count, '0') AS order_count,
          COALESCE(os.spent_minor, '0') AS spent_minor,
          CASE
            WHEN la.id IS NULL THEN NULL
            WHEN la.xp = COALESCE(lp.ledger_xp, '0')::integer
              AND la.coal_balance = COALESCE(lp.ledger_coal, '0')::integer
            THEN la.coal_balance
            ELSE NULL
          END AS coal_balance,
          CASE
            WHEN la.id IS NULL THEN NULL
            WHEN la.xp = COALESCE(lp.ledger_xp, '0')::integer
              AND la.coal_balance = COALESCE(lp.ledger_coal, '0')::integer
            THEN la.xp
            ELSE NULL
          END AS xp,
          CASE
            WHEN la.id IS NULL THEN NULL
            WHEN la.xp = COALESCE(lp.ledger_xp, '0')::integer
              AND la.coal_balance = COALESCE(lp.ledger_coal, '0')::integer
            THEN la.rank_code
            ELSE NULL
          END AS rank,
          GREATEST(os.last_order_at, sa.last_used_at) AS last_activity_at
        FROM customers c
        LEFT JOIN order_stats os ON os.customer_id = c.id
        LEFT JOIN loyalty_accounts la ON la.customer_id = c.id
        LEFT JOIN loyalty_projection lp ON lp.customer_id = c.id
        LEFT JOIN session_activity sa ON sa.customer_id = c.id
        WHERE ${condition}
        ORDER BY COALESCE(os.spent_minor, '0')::bigint DESC, c.id ASC
        LIMIT ${query.limit}
        OFFSET ${query.offset}
      `);

      const rows = result.rows.map((rawRow) => {
        const row = rawRow as QueryRow;
        return {
          id: readSafeInteger(rowValue(row, "id"), "id"),
          name: readText(rowValue(row, "name"), "name"),
          phone: readPhone(rowValue(row, "phone")),
          orderCount: readSafeInteger(rowValue(row, "order_count"), "order_count"),
          spentMinor: readSafeInteger(rowValue(row, "spent_minor"), "spent_minor"),
          coalBalance: rowValue(row, "coal_balance") === null ? null : readSafeInteger(rowValue(row, "coal_balance"), "coal_balance"),
          xp: rowValue(row, "xp") === null ? null : readSafeInteger(rowValue(row, "xp"), "xp"),
          rank: readRank(rowValue(row, "rank")),
          lastActivityAt: readDate(rowValue(row, "last_activity_at"))
        } satisfies AdminCustomerRepositoryRow;
      });

      return { rows, total };
    }
  };
}
