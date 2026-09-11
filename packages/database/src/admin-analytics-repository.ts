import { sql } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";

export const ADMIN_ANALYTICS_TIMEZONE = "Europe/Moscow" as const;
export const ADMIN_ANALYTICS_RECENT_LIMIT = 10;
export const ADMIN_ANALYTICS_TOP_LIMIT = 10;

export const ADMIN_ANALYTICS_ORDER_STATUSES = [
  "pending_payment",
  "payment_confirmed",
  "kitchen_accepted",
  "preparing",
  "ready_for_pickup",
  "completed",
  "fulfillment_problem",
  "canceled"
] as const;

export type AdminAnalyticsOrderStatus = (typeof ADMIN_ANALYTICS_ORDER_STATUSES)[number];

export interface AdminAnalyticsWindow {
  readonly start: Date;
  readonly end: Date;
}

export interface AdminAnalyticsWindowResult {
  readonly orders: number;
  readonly revenueMinor: number;
  readonly qualifyingOrders: number;
  readonly customers: number;
  readonly reconciliationRequired: boolean;
  readonly revenueByDay: readonly { readonly date: string; readonly revenueMinor: number }[];
  readonly topDishes: readonly {
    readonly productId: number;
    readonly name: string;
    readonly quantity: number;
    readonly revenueMinor: number;
  }[];
  readonly statuses: readonly {
    readonly status: AdminAnalyticsOrderStatus;
    readonly count: number;
  }[];
  readonly pickupOrders: number;
  readonly recentOrders: readonly {
    readonly id: number;
    readonly customerName: string | null;
    readonly totalMinor: number;
    readonly status: AdminAnalyticsOrderStatus;
    readonly createdAt: Date;
  }[];
}

export interface AdminAnalyticsRepositoryResult {
  readonly current: AdminAnalyticsWindowResult;
  readonly previous: AdminAnalyticsWindowResult;
  readonly categories: {
    readonly status: "unavailable";
    readonly reason: "historical_snapshot_missing";
    readonly items: readonly [];
  };
}

export interface AdminAnalyticsRepository {
  read(input: {
    readonly current: AdminAnalyticsWindow;
    readonly previous: AdminAnalyticsWindow;
  }): Promise<AdminAnalyticsRepositoryResult>;
}

export class AdminAnalyticsDataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminAnalyticsDataIntegrityError";
  }
}

type QueryRow = Record<string, unknown>;

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const KNOWN_STATUS_SQL = sql.join(
  ADMIN_ANALYTICS_ORDER_STATUSES.map((status) => sql`${status}`),
  sql`, `
);

function rowValue(row: QueryRow, key: string): unknown {
  return row[key];
}

function readSafeInteger(value: unknown, field: string): number {
  if (value === null || value === undefined) {
    throw new AdminAnalyticsDataIntegrityError(`Analytics field ${field} is missing`);
  }

  let integer: bigint;
  try {
    integer = typeof value === "bigint" ? value : BigInt(String(value));
  } catch {
    throw new AdminAnalyticsDataIntegrityError(`Analytics field ${field} is malformed`);
  }

  if (integer < 0n || integer > MAX_SAFE_INTEGER_BIGINT) {
    throw new AdminAnalyticsDataIntegrityError(`Analytics field ${field} is out of range`);
  }

  return Number(integer);
}

function readDate(value: unknown, field: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new AdminAnalyticsDataIntegrityError(`Analytics field ${field} is malformed`);
  }
  return date;
}

function readStatus(value: unknown): AdminAnalyticsOrderStatus {
  if (typeof value !== "string" || !(ADMIN_ANALYTICS_ORDER_STATUSES as readonly string[]).includes(value)) {
    throw new AdminAnalyticsDataIntegrityError("Analytics order status is unknown");
  }
  return value as AdminAnalyticsOrderStatus;
}

function readName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new AdminAnalyticsDataIntegrityError("Analytics customer name is malformed");
  const name = value.trim();
  return name === "" ? null : name.slice(0, 160);
}

function windowCtes(window: AdminAnalyticsWindow): ReturnType<typeof sql> {
  return sql`
    window_orders AS (
      SELECT o.id, o.customer_id, o.status, o.total_minor, o.currency, o.created_at
      FROM orders o
      WHERE o.created_at >= ${window.start}
        AND o.created_at < ${window.end}
        AND o.currency = 'RUB'
        AND o.total_minor >= 0
        AND o.status IN (${KNOWN_STATUS_SQL})
    ),
    qualifying_orders AS (
      SELECT wo.*
      FROM window_orders wo
      WHERE wo.status = 'completed'
        AND EXISTS (
          SELECT 1
          FROM payments p
          WHERE p.order_id = wo.id
            AND p.status = 'succeeded'
            AND p.provider_status = 'succeeded'
            AND p.amount_minor = wo.total_minor
            AND p.currency = wo.currency
        )
        AND NOT EXISTS (
          SELECT 1
          FROM refunds r
          WHERE r.order_id = wo.id
            AND r.status IN ('pending', 'succeeded', 'reconciliation_required')
        )
    )
  `;
}

async function readSummary(client: DatabaseClient, window: AdminAnalyticsWindow): Promise<{
  readonly orders: number;
  readonly revenueMinor: number;
  readonly qualifyingOrders: number;
  readonly customers: number;
  readonly reconciliationRequired: boolean;
}> {
  const result = await client.db.execute(sql`
    WITH ${windowCtes(window)}
    SELECT
      COUNT(*)::text AS orders,
      COALESCE((SELECT SUM(total_minor) FROM qualifying_orders), 0)::text AS revenue_minor,
      (SELECT COUNT(*) FROM qualifying_orders)::text AS qualifying_orders,
      (SELECT COUNT(DISTINCT customer_id) FROM qualifying_orders)::text AS customers,
      EXISTS (
        SELECT 1
        FROM window_orders wo
        WHERE wo.status = 'completed'
          AND (
            NOT EXISTS (
              SELECT 1
              FROM payments p
              WHERE p.order_id = wo.id
                AND p.status = 'succeeded'
                AND p.provider_status = 'succeeded'
                AND p.amount_minor = wo.total_minor
                AND p.currency = wo.currency
            )
            OR EXISTS (
              SELECT 1
              FROM refunds r
              WHERE r.order_id = wo.id
                AND r.status IN ('pending', 'succeeded', 'reconciliation_required')
            )
          )
      ) AS reconciliation_required
    FROM window_orders
  `);
  const row = (result.rows[0] ?? {}) as QueryRow;
  return {
    orders: readSafeInteger(rowValue(row, "orders"), "orders"),
    revenueMinor: readSafeInteger(rowValue(row, "revenue_minor"), "revenue_minor"),
    qualifyingOrders: readSafeInteger(rowValue(row, "qualifying_orders"), "qualifying_orders"),
    customers: readSafeInteger(rowValue(row, "customers"), "customers"),
    reconciliationRequired: rowValue(row, "reconciliation_required") === true
  };
}

async function readRevenueByDay(client: DatabaseClient, window: AdminAnalyticsWindow): Promise<readonly { readonly date: string; readonly revenueMinor: number }[]> {
  const result = await client.db.execute(sql`
    WITH ${windowCtes(window)}
    SELECT
      (created_at AT TIME ZONE ${ADMIN_ANALYTICS_TIMEZONE})::date::text AS date,
      SUM(total_minor)::text AS revenue_minor
    FROM qualifying_orders
    GROUP BY 1
    ORDER BY 1 ASC
  `);
  return result.rows.map((rawRow) => {
    const row = rawRow as QueryRow;
    const date = rowValue(row, "date");
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
      throw new AdminAnalyticsDataIntegrityError("Analytics daily date is malformed");
    }
    return { date, revenueMinor: readSafeInteger(rowValue(row, "revenue_minor"), "revenue_minor") };
  });
}

async function readTopDishes(client: DatabaseClient, window: AdminAnalyticsWindow): Promise<readonly {
  readonly productId: number;
  readonly name: string;
  readonly quantity: number;
  readonly revenueMinor: number;
}[]> {
  const result = await client.db.execute(sql`
    WITH ${windowCtes(window)}
    SELECT
      oi.product_id,
      oi.product_name AS name,
      SUM(oi.quantity)::text AS quantity,
      SUM(oi.line_total_minor)::text AS revenue_minor
    FROM order_items oi
    INNER JOIN qualifying_orders qo ON qo.id = oi.order_id
    GROUP BY oi.product_id, oi.product_name
    ORDER BY SUM(oi.quantity) DESC, SUM(oi.line_total_minor) DESC, oi.product_id ASC
    LIMIT ${ADMIN_ANALYTICS_TOP_LIMIT}
  `);
  return result.rows.map((rawRow) => {
    const row = rawRow as QueryRow;
    const name = rowValue(row, "name");
    if (typeof name !== "string" || name.trim() === "") {
      throw new AdminAnalyticsDataIntegrityError("Analytics product snapshot is malformed");
    }
    const productId = readSafeInteger(rowValue(row, "product_id"), "product_id");
    if (productId < 1) throw new AdminAnalyticsDataIntegrityError("Analytics product snapshot id is invalid");
    return {
      productId,
      name: name.trim().slice(0, 160),
      quantity: readSafeInteger(rowValue(row, "quantity"), "quantity"),
      revenueMinor: readSafeInteger(rowValue(row, "revenue_minor"), "revenue_minor")
    };
  });
}

async function readStatuses(client: DatabaseClient, window: AdminAnalyticsWindow): Promise<readonly { readonly status: AdminAnalyticsOrderStatus; readonly count: number }[]> {
  const result = await client.db.execute(sql`
    WITH ${windowCtes(window)}
    SELECT status, COUNT(*)::text AS count
    FROM window_orders
    GROUP BY status
    ORDER BY status ASC
  `);
  return result.rows.map((rawRow) => {
    const row = rawRow as QueryRow;
    return {
      status: readStatus(rowValue(row, "status")),
      count: readSafeInteger(rowValue(row, "count"), "count")
    };
  });
}

async function readPickupOrders(client: DatabaseClient, window: AdminAnalyticsWindow): Promise<number> {
  const result = await client.db.execute(sql`
    WITH ${windowCtes(window)}
    SELECT COUNT(*)::text AS count
    FROM window_orders
  `);
  const row = (result.rows[0] ?? {}) as QueryRow;
  return readSafeInteger(rowValue(row, "count"), "pickup_orders");
}

async function readRecentOrders(client: DatabaseClient, window: AdminAnalyticsWindow): Promise<readonly {
  readonly id: number;
  readonly customerName: string | null;
  readonly totalMinor: number;
  readonly status: AdminAnalyticsOrderStatus;
  readonly createdAt: Date;
}[]> {
  const result = await client.db.execute(sql`
    WITH ${windowCtes(window)}
    SELECT
      wo.id,
      COALESCE(NULLIF(BTRIM(ocs.name), ''), NULLIF(BTRIM(c.name), '')) AS customer_name,
      wo.total_minor::text AS total_minor,
      wo.status,
      wo.created_at
    FROM window_orders wo
    INNER JOIN customers c ON c.id = wo.customer_id
    LEFT JOIN order_customer_snapshots ocs ON ocs.order_id = wo.id
    ORDER BY wo.created_at DESC, wo.id DESC
    LIMIT ${ADMIN_ANALYTICS_RECENT_LIMIT}
  `);
  return result.rows.map((rawRow) => {
    const row = rawRow as QueryRow;
    return {
      id: readSafeInteger(rowValue(row, "id"), "id"),
      customerName: readName(rowValue(row, "customer_name")),
      totalMinor: readSafeInteger(rowValue(row, "total_minor"), "total_minor"),
      status: readStatus(rowValue(row, "status")),
      createdAt: readDate(rowValue(row, "created_at"), "created_at")
    };
  });
}

async function readWindow(client: DatabaseClient, window: AdminAnalyticsWindow): Promise<AdminAnalyticsWindowResult> {
  const [summary, revenueByDay, topDishes, statuses, pickupOrders, recentOrders] = await Promise.all([
    readSummary(client, window),
    readRevenueByDay(client, window),
    readTopDishes(client, window),
    readStatuses(client, window),
    readPickupOrders(client, window),
    readRecentOrders(client, window)
  ]);
  return { ...summary, revenueByDay, topDishes, statuses, pickupOrders, recentOrders };
}

export function createAdminAnalyticsRepository(client: DatabaseClient): AdminAnalyticsRepository {
  return {
    async read(input) {
      const [current, previous] = await Promise.all([
        readWindow(client, input.current),
        readWindow(client, input.previous)
      ]);
      return {
        current,
        previous,
        categories: {
          status: "unavailable",
          reason: "historical_snapshot_missing",
          items: []
        }
      };
    }
  };
}
