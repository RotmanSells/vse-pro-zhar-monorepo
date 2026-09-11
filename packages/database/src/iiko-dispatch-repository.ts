import { and, asc, eq, inArray, lte, ne } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";
import {
  customers,
  iikoOrderDispatches,
  orderIikoItems,
  orderItems,
  orderStatusHistory,
  orders,
  type IikoOrderDispatchRecord,
  type OrderItemRecord,
  type OrderRecord
} from "./schema.js";

export type IikoDispatchStatus =
  | "pending"
  | "creating"
  | "command_pending"
  | "submitted"
  | "failed";

export type FulfillmentOrderStatus =
  | "pending_payment"
  | "payment_confirmed"
  | "kitchen_accepted"
  | "preparing"
  | "ready_for_pickup"
  | "completed"
  | "fulfillment_problem"
  | "canceled";

export interface IikoDispatchOrderItem extends OrderItemRecord {
  readonly iikoProductId: string | null;
}

export interface IikoDispatchOrder {
  readonly dispatch: IikoOrderDispatchRecord;
  readonly order: OrderRecord;
  readonly customer: { readonly phone: string; readonly name: string };
  readonly items: readonly IikoDispatchOrderItem[];
}

export interface IikoDispatchUpdate {
  readonly status: IikoDispatchStatus;
  readonly nextAttemptAt: Date;
  readonly attemptCount?: number;
  readonly providerOrderId?: string | null;
  readonly commandId?: string | null;
  readonly lastErrorCode?: string | null;
}

export interface IikoDispatchRepository {
  claimNextDue(now: Date, leaseMs: number): Promise<IikoDispatchOrder | null>;
  updateDispatch(id: number, update: IikoDispatchUpdate, now: Date): Promise<void>;
  failDispatch(
    id: number,
    orderId: number,
    errorCode: string,
    now: Date,
    attemptCount?: number
  ): Promise<void>;
  applyOrderStatus(
    orderId: number,
    status: Exclude<FulfillmentOrderStatus, "pending_payment" | "payment_confirmed" | "canceled">,
    now: Date
  ): Promise<boolean>;
  findByOrderId(orderId: number): Promise<IikoOrderDispatchRecord | null>;
}

const DUE_STATUSES: readonly IikoDispatchStatus[] = [
  "pending",
  "creating",
  "command_pending",
  "submitted"
];

const STATUS_RANK: Readonly<Record<FulfillmentOrderStatus, number>> = {
  pending_payment: 0,
  payment_confirmed: 1,
  kitchen_accepted: 2,
  preparing: 3,
  ready_for_pickup: 4,
  completed: 5,
  fulfillment_problem: 99,
  canceled: 100
};

function toDispatchOrder(
  dispatch: IikoOrderDispatchRecord,
  order: OrderRecord,
  customer: { readonly phone: string; readonly name: string },
  itemRows: readonly IikoDispatchOrderItem[]
): IikoDispatchOrder {
  return { dispatch, order, customer, items: itemRows };
}

async function readDispatchOrder(
  tx: Pick<DatabaseClient["db"], "select">,
  dispatch: IikoOrderDispatchRecord
): Promise<IikoDispatchOrder | null> {
  const [joined] = await tx
    .select({ order: orders, customer: customers })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(orders.id, dispatch.orderId))
    .limit(1);
  if (joined === undefined) return null;

  const itemRows = await tx
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      productName: orderItems.productName,
      unitPriceMinor: orderItems.unitPriceMinor,
      quantity: orderItems.quantity,
      lineTotalMinor: orderItems.lineTotalMinor,
      iikoProductId: orderIikoItems.iikoProductId
    })
    .from(orderItems)
    .leftJoin(orderIikoItems, eq(orderIikoItems.orderItemId, orderItems.id))
    .where(eq(orderItems.orderId, dispatch.orderId))
    .orderBy(asc(orderItems.id));

  return toDispatchOrder(
    dispatch,
    joined.order,
    { phone: joined.customer.phone, name: joined.customer.name },
    itemRows
  );
}

function assertDispatchStatus(value: string): IikoDispatchStatus {
  if (DUE_STATUSES.includes(value as IikoDispatchStatus) || value === "failed") {
    return value as IikoDispatchStatus;
  }
  throw new Error("Invalid iiko dispatch status in database");
}

export function createIikoDispatchRepository(
  client: DatabaseClient
): IikoDispatchRepository {
  return {
    async claimNextDue(now, leaseMs) {
      if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
        throw new Error("Invalid iiko dispatch lease");
      }

      return client.db.transaction(async (tx) => {
        const [candidateRow] = await tx
          .select({ dispatch: iikoOrderDispatches })
          .from(iikoOrderDispatches)
          .innerJoin(orders, eq(orders.id, iikoOrderDispatches.orderId))
          .where(
            and(
              inArray(iikoOrderDispatches.status, [...DUE_STATUSES]),
              lte(iikoOrderDispatches.nextAttemptAt, now),
              ne(orders.status, "canceled")
            )
          )
          .orderBy(asc(iikoOrderDispatches.nextAttemptAt), asc(iikoOrderDispatches.id))
          .limit(1);

        const candidate = candidateRow?.dispatch;
        if (candidate === undefined) return null;
        const [lockedOrder] = await tx
          .select({ id: orders.id, status: orders.status })
          .from(orders)
          .where(eq(orders.id, candidate.orderId))
          .limit(1)
          .for("update");
        if (lockedOrder === undefined || lockedOrder.status === "canceled") return null;
        const [lockedCandidate] = await tx
          .select()
          .from(iikoOrderDispatches)
          .where(
            and(
              eq(iikoOrderDispatches.id, candidate.id),
              inArray(iikoOrderDispatches.status, [...DUE_STATUSES]),
              lte(iikoOrderDispatches.nextAttemptAt, now)
            )
          )
          .limit(1)
          .for("update");
        if (lockedCandidate === undefined) return null;
        const currentStatus = assertDispatchStatus(lockedCandidate.status);
        const [claimed] = await tx
          .update(iikoOrderDispatches)
          .set({
            status: currentStatus === "pending" ? "creating" : currentStatus,
            lastAttemptAt: now,
            nextAttemptAt: new Date(now.getTime() + leaseMs),
            updatedAt: now
          })
          .where(eq(iikoOrderDispatches.id, lockedCandidate.id))
          .returning();
        if (claimed === undefined) return null;
        return readDispatchOrder(tx, claimed);
      });
    },

    async updateDispatch(id, update, now) {
      const values = {
        status: update.status,
        nextAttemptAt: update.nextAttemptAt,
        updatedAt: now,
        ...(update.attemptCount === undefined
          ? {}
          : { attemptCount: update.attemptCount }),
        ...(update.providerOrderId === undefined
          ? {}
          : { providerOrderId: update.providerOrderId }),
        ...(update.commandId === undefined ? {} : { commandId: update.commandId }),
        ...(update.lastErrorCode === undefined
          ? {}
          : { lastErrorCode: update.lastErrorCode })
      };
      await client.db
        .update(iikoOrderDispatches)
        .set(values)
        .where(eq(iikoOrderDispatches.id, id));
    },

    async failDispatch(id, orderId, errorCode, now, attemptCount) {
      await client.db.transaction(async (tx) => {
        const [order] = await tx
          .select({ status: orders.status })
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1)
          .for("update");
        if (order === undefined) return;
        const currentStatus = order.status as FulfillmentOrderStatus;
        if (currentStatus === "completed" || currentStatus === "canceled") return;

        const [dispatch] = await tx
          .update(iikoOrderDispatches)
          .set({
            status: "failed",
            nextAttemptAt: now,
            lastErrorCode: errorCode,
            updatedAt: now,
            ...(attemptCount === undefined ? {} : { attemptCount })
          })
          .where(eq(iikoOrderDispatches.id, id))
          .returning({ id: iikoOrderDispatches.id });
        if (dispatch === undefined) return;

        if (currentStatus !== "fulfillment_problem") {
          await tx
            .update(orders)
            .set({ status: "fulfillment_problem", updatedAt: now })
            .where(eq(orders.id, orderId));
          await tx
            .insert(orderStatusHistory)
            .values({ orderId, status: "fulfillment_problem", createdAt: now })
            .onConflictDoNothing({
              target: [orderStatusHistory.orderId, orderStatusHistory.status]
            });
        }
      });
    },

    async applyOrderStatus(orderId, status, now) {
      return client.db.transaction(async (tx) => {
        const [order] = await tx
          .select({ status: orders.status })
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1)
          .for("update");
        if (order === undefined) return false;

        const currentStatus = order.status as FulfillmentOrderStatus;
        if (currentStatus === "canceled") return false;
        if (
          currentStatus !== "fulfillment_problem" &&
          STATUS_RANK[status] <= (STATUS_RANK[currentStatus] ?? -1)
        ) {
          return false;
        }

        const [updated] = await tx
          .update(orders)
          .set({ status, updatedAt: now })
          .where(eq(orders.id, orderId))
          .returning({ id: orders.id });
        if (updated === undefined) return false;

        await tx
          .insert(orderStatusHistory)
          .values({ orderId, status, createdAt: now })
          .onConflictDoNothing({
            target: [orderStatusHistory.orderId, orderStatusHistory.status]
          });
        return true;
      });
    },

    async findByOrderId(orderId) {
      const [dispatch] = await client.db
        .select()
        .from(iikoOrderDispatches)
        .where(eq(iikoOrderDispatches.orderId, orderId))
        .limit(1);
      return dispatch ?? null;
    }
  };
}
