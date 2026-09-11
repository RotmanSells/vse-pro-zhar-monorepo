import { and, asc, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";
import {
  customers,
  iikoOrderDispatches,
  orderCancellations,
  orderCustomerSnapshots,
  orderIikoItems,
  orderItems,
  orderStatusHistory,
  orders,
  payments,
  refundEvents,
  refunds,
  staffAuditLog,
  type CustomerRecord,
  type IikoOrderDispatchRecord,
  type OrderCancellationRecord,
  type OrderItemRecord,
  type OrderRecord,
  type OrderStatusHistoryRecord,
  type PaymentRecord,
  type RefundRecord,
  type RefundEventRecord
} from "./schema.js";

export type AdminOrderStatus =
  | "pending_payment"
  | "payment_confirmed"
  | "kitchen_accepted"
  | "preparing"
  | "ready_for_pickup"
  | "completed"
  | "fulfillment_problem"
  | "canceled";
export type AdminPaymentStatus = "pending" | "succeeded" | "canceled";
export type AdminFulfillmentStatus =
  | "pending"
  | "creating"
  | "command_pending"
  | "submitted"
  | "failed";

export interface AdminOrderFilters {
  readonly status?: AdminOrderStatus;
  readonly fulfillmentStatus?: AdminFulfillmentStatus;
  readonly paymentStatus?: AdminPaymentStatus | "none";
  readonly from?: Date;
  readonly to?: Date;
  readonly search?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface AdminOrderResult {
  readonly order: OrderRecord;
  readonly customer: Pick<CustomerRecord, "id" | "phone" | "name">;
  readonly items: readonly OrderItemRecord[];
  readonly payment: PaymentRecord | null;
  readonly dispatch: IikoOrderDispatchRecord | null;
  readonly history: readonly OrderStatusHistoryRecord[];
  readonly cancellation?: OrderCancellationRecord | null;
  readonly refund?: RefundRecord | null;
  readonly refundEvents?: readonly RefundEventRecord[];
}

export interface AdminOrderListResult {
  readonly orders: readonly AdminOrderResult[];
  readonly total: number;
}

export interface AdminRecoveryResult {
  readonly order: AdminOrderResult;
  readonly mode: "create" | "reconcile" | "already_in_progress";
}

export class AdminRecoveryNotAllowedError extends Error {
  readonly reason:
    | "order_not_found"
    | "payment_not_confirmed"
    | "order_not_recoverable"
    | "invalid_snapshot"
    | "terminal_provider_rejection";

  constructor(reason: AdminRecoveryNotAllowedError["reason"]) {
    super("Fulfillment recovery is not allowed");
    this.name = "AdminRecoveryNotAllowedError";
    this.reason = reason;
  }
}

function queryWhere(conditions: readonly ReturnType<typeof eq>[]) {
  return conditions.length === 0 ? undefined : and(...conditions);
}

async function readLatestPayment(
  query: Pick<DatabaseClient["db"], "select">,
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

async function readAdminOrder(
  query: Pick<DatabaseClient["db"], "select">,
  orderId: number
): Promise<AdminOrderResult | null> {
  const [row] = await query
    .select({
      order: orders,
      customer: {
        id: customers.id,
        phone: customers.phone,
        name: customers.name
      }
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (row === undefined) return null;

  const [items, dispatch, history, payment, customerSnapshot, cancellation, refund] = await Promise.all([
    query
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.id)),
    query
      .select()
      .from(iikoOrderDispatches)
      .where(eq(iikoOrderDispatches.orderId, orderId))
      .limit(1),
    query
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(asc(orderStatusHistory.createdAt), asc(orderStatusHistory.id)),
    readLatestPayment(query, orderId),
    query
      .select({
        id: orderCustomerSnapshots.customerId,
        phone: orderCustomerSnapshots.phone,
        name: orderCustomerSnapshots.name
      })
      .from(orderCustomerSnapshots)
      .where(eq(orderCustomerSnapshots.orderId, orderId))
      .limit(1),
    query
      .select()
      .from(orderCancellations)
      .where(eq(orderCancellations.orderId, orderId))
      .limit(1),
    query
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, orderId))
      .limit(1)
  ]);
  const refundEventRows = refund[0]?.providerRefundId === null || refund[0] === undefined
    ? []
    : await query
        .select()
        .from(refundEvents)
        .where(eq(refundEvents.providerRefundId, refund[0].providerRefundId))
        .orderBy(asc(refundEvents.receivedAt), asc(refundEvents.id));

  return {
    order: row.order,
    customer: customerSnapshot[0] ?? row.customer,
    items,
    payment,
    dispatch: dispatch[0] ?? null,
    history,
    cancellation: cancellation[0] ?? null,
    refund: refund[0] ?? null,
    refundEvents: refundEventRows
  };
}

function isTerminalRecoveryCode(value: string | null): boolean {
  if (value === null) return false;
  return (
    value === "provider_order_mismatch" ||
    value === "provider_cancelled" ||
    value === "missing_mapping_snapshot" ||
    value === "malformed_order_snapshot" ||
    value === "missing_command_id" ||
    value === "missing_provider_order_id" ||
    value === "iiko_not_configured" ||
    value === "terminal" ||
    value.startsWith("provider_rejected")
  );
}

export interface AdminOrderRepository {
  list(filters: AdminOrderFilters): Promise<AdminOrderListResult>;
  findById(orderId: number): Promise<AdminOrderResult | null>;
  retryFulfillment(input: {
    readonly orderId: number;
    readonly staffUserId: number;
    readonly requestId: string;
    readonly now: Date;
  }): Promise<AdminRecoveryResult>;
}

export function createAdminOrderRepository(client: DatabaseClient): AdminOrderRepository {
  return {
    async list(filters) {
      const conditions: ReturnType<typeof eq>[] = [];
      if (filters.status !== undefined) conditions.push(eq(orders.status, filters.status));
      if (filters.from !== undefined) conditions.push(gte(orders.createdAt, filters.from));
      if (filters.to !== undefined) conditions.push(sql`${orders.createdAt} <= ${filters.to}` as ReturnType<typeof eq>);
      if (filters.fulfillmentStatus !== undefined) {
        conditions.push(
          sql`EXISTS (SELECT 1 FROM "iiko_order_dispatches" d WHERE d."order_id" = "orders"."id" AND d."status" = ${filters.fulfillmentStatus})` as ReturnType<typeof eq>
        );
      }
      if (filters.paymentStatus !== undefined) {
        if (filters.paymentStatus === "none") {
          conditions.push(
            sql`NOT EXISTS (SELECT 1 FROM "payments" p WHERE p."order_id" = "orders"."id")` as ReturnType<typeof eq>
          );
        } else {
          conditions.push(
            sql`EXISTS (
              SELECT 1 FROM "payments" p
              WHERE p."order_id" = "orders"."id"
                AND p."id" = (SELECT MAX(p2."id") FROM "payments" p2 WHERE p2."order_id" = "orders"."id")
                AND p."status" = ${filters.paymentStatus}
            )` as ReturnType<typeof eq>
          );
        }
      }
      if (filters.search !== undefined && filters.search !== "") {
        const numericSearch = /^\d+$/u.test(filters.search) ? Number(filters.search) : null;
        conditions.push(
          (numericSearch !== null && Number.isSafeInteger(numericSearch)
            ? or(eq(orders.id, numericSearch), ilike(customers.phone, `%${filters.search}%`))
            : ilike(customers.phone, `%${filters.search}%`)) as ReturnType<typeof eq>
        );
      }

      const where = queryWhere(conditions);
      const [countRow, rows] = await Promise.all([
        client.db
          .select({ count: sql<string>`count(*)` })
          .from(orders)
          .innerJoin(customers, eq(customers.id, orders.customerId))
          .where(where),
        client.db
          .select({
            order: orders,
            customer: {
              id: customers.id,
              phone: customers.phone,
              name: customers.name
            }
          })
          .from(orders)
          .innerJoin(customers, eq(customers.id, orders.customerId))
          .where(where)
          .orderBy(desc(orders.createdAt), desc(orders.id))
          .limit(filters.limit)
          .offset(filters.offset)
      ]);

      const orderIds = rows.map((row) => row.order.id);
      if (orderIds.length === 0) return { orders: [], total: Number(countRow[0]?.count ?? 0) };
      const [itemRows, paymentRows, dispatchRows, historyRows, customerSnapshotRows, cancellationRows, refundRows] = await Promise.all([
        client.db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)).orderBy(asc(orderItems.id)),
        client.db.select().from(payments).where(inArray(payments.orderId, orderIds)).orderBy(desc(payments.id)),
        client.db.select().from(iikoOrderDispatches).where(inArray(iikoOrderDispatches.orderId, orderIds)),
        client.db.select().from(orderStatusHistory).where(inArray(orderStatusHistory.orderId, orderIds)).orderBy(asc(orderStatusHistory.createdAt), asc(orderStatusHistory.id)),
        client.db.select().from(orderCustomerSnapshots).where(inArray(orderCustomerSnapshots.orderId, orderIds)),
        client.db.select().from(orderCancellations).where(inArray(orderCancellations.orderId, orderIds)),
        client.db.select().from(refunds).where(inArray(refunds.orderId, orderIds))
      ]);
      const itemMap = new Map<number, OrderItemRecord[]>();
      for (const item of itemRows) itemMap.set(item.orderId, [...(itemMap.get(item.orderId) ?? []), item]);
      const paymentMap = new Map<number, PaymentRecord>();
      for (const payment of paymentRows) if (!paymentMap.has(payment.orderId)) paymentMap.set(payment.orderId, payment);
      const dispatchMap = new Map(dispatchRows.map((dispatch) => [dispatch.orderId, dispatch]));
      const historyMap = new Map<number, OrderStatusHistoryRecord[]>();
      for (const entry of historyRows) historyMap.set(entry.orderId, [...(historyMap.get(entry.orderId) ?? []), entry]);
      const customerSnapshotMap = new Map(customerSnapshotRows.map((snapshot) => [snapshot.orderId, { id: snapshot.customerId, phone: snapshot.phone, name: snapshot.name }]));
      const cancellationMap = new Map(cancellationRows.map((cancellation) => [cancellation.orderId, cancellation]));
      const refundMap = new Map(refundRows.map((refund) => [refund.orderId, refund]));
      return {
        total: Number(countRow[0]?.count ?? 0),
        orders: rows.map((row) => ({
          order: row.order,
          customer: customerSnapshotMap.get(row.order.id) ?? row.customer,
          items: itemMap.get(row.order.id) ?? [],
          payment: paymentMap.get(row.order.id) ?? null,
          dispatch: dispatchMap.get(row.order.id) ?? null,
          history: historyMap.get(row.order.id) ?? [],
          cancellation: cancellationMap.get(row.order.id) ?? null,
          refund: refundMap.get(row.order.id) ?? null
        }))
      };
    },

    findById(orderId) {
      return readAdminOrder(client.db, orderId);
    },

    async retryFulfillment({ orderId, staffUserId, requestId, now }) {
      return client.db.transaction(async (tx) => {
        const [lockedOrder] = await tx
          .select({ id: orders.id, status: orders.status, totalMinor: orders.totalMinor, currency: orders.currency })
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1)
          .for("update");
        if (lockedOrder === undefined) throw new AdminRecoveryNotAllowedError("order_not_found");
        if (lockedOrder.status === "completed") {
          throw new AdminRecoveryNotAllowedError("order_not_recoverable");
        }

        const [dispatch] = await tx
          .select()
          .from(iikoOrderDispatches)
          .where(eq(iikoOrderDispatches.orderId, orderId))
          .limit(1)
          .for("update");
        if (dispatch === undefined) throw new AdminRecoveryNotAllowedError("order_not_recoverable");
        if (lockedOrder.status !== "fulfillment_problem") {
          const current = await readAdminOrder(tx, orderId);
          if (current === null) throw new AdminRecoveryNotAllowedError("order_not_found");
          return { order: current, mode: "already_in_progress" as const };
        }

        const payment = await readLatestPayment(tx, orderId, true);
        if (payment === null || payment.status !== "succeeded" || payment.providerStatus !== "succeeded") {
          throw new AdminRecoveryNotAllowedError("payment_not_confirmed");
        }
        if (dispatch.status === "failed" && isTerminalRecoveryCode(dispatch.lastErrorCode)) {
          throw new AdminRecoveryNotAllowedError(
            dispatch.lastErrorCode === "missing_mapping_snapshot" || dispatch.lastErrorCode === "malformed_order_snapshot"
              ? "invalid_snapshot"
              : "terminal_provider_rejection"
          );
        }
        if (dispatch.status !== "failed") {
          const current = await readAdminOrder(tx, orderId);
          if (current === null) throw new AdminRecoveryNotAllowedError("order_not_found");
          return { order: current, mode: "already_in_progress" as const };
        }

        const snapshotRows = await tx
          .select({
            productId: orderItems.productId,
            productName: orderItems.productName,
            unitPriceMinor: orderItems.unitPriceMinor,
            quantity: orderItems.quantity,
            lineTotalMinor: orderItems.lineTotalMinor,
            iikoProductId: orderIikoItems.iikoProductId
          })
          .from(orderItems)
          .leftJoin(orderIikoItems, eq(orderIikoItems.orderItemId, orderItems.id))
          .where(eq(orderItems.orderId, orderId))
          .orderBy(asc(orderItems.id));
        let snapshotTotalMinor = 0;
        const snapshotValid = snapshotRows.length > 0 && snapshotRows.every((item) => {
          const lineTotal = item.unitPriceMinor * item.quantity;
          snapshotTotalMinor += item.lineTotalMinor;
          return (
            item.productId > 0 &&
            item.productName.trim() !== "" &&
            Number.isSafeInteger(item.unitPriceMinor) &&
            item.unitPriceMinor >= 0 &&
            Number.isSafeInteger(item.quantity) &&
            item.quantity >= 1 &&
            item.quantity <= 99 &&
            Number.isSafeInteger(item.lineTotalMinor) &&
            item.lineTotalMinor >= 0 &&
            Number.isSafeInteger(lineTotal) &&
            lineTotal === item.lineTotalMinor &&
            item.iikoProductId !== null &&
            item.iikoProductId.trim() !== ""
          );
        });
        if (!snapshotValid || !Number.isSafeInteger(snapshotTotalMinor) || snapshotTotalMinor !== lockedOrder.totalMinor || !/^[A-Z]{3}$/u.test(lockedOrder.currency)) {
          throw new AdminRecoveryNotAllowedError("invalid_snapshot");
        }

        const mode = dispatch.providerOrderId === null ? "create" : "reconcile";
        await tx
          .update(iikoOrderDispatches)
          .set({
            status: mode === "create" ? "pending" : "submitted",
            attemptCount: 0,
            nextAttemptAt: now,
            lastErrorCode: null,
            updatedAt: now
          })
          .where(eq(iikoOrderDispatches.id, dispatch.id));
        await tx.insert(staffAuditLog).values({
          staffUserId,
          action: "order_fulfillment_retry",
          orderId,
          requestId,
          createdAt: now
        });
        const current = await readAdminOrder(tx, orderId);
        if (current === null) throw new AdminRecoveryNotAllowedError("order_not_found");
        return { order: current, mode };
      });
    }
  };
}
