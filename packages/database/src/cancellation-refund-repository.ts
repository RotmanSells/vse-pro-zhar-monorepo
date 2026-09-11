import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  isNull,
  lte,
  or
} from "drizzle-orm";

import type { DatabaseClient } from "./db.js";
import {
  iikoOrderDispatches,
  orderCancellations,
  orderStatusHistory,
  orders,
  payments,
  refundEvents,
  refunds,
  staffAuditLog,
  type IikoOrderDispatchRecord,
  type OrderCancellationRecord,
  type OrderRecord,
  type PaymentRecord,
  type RefundEventRecord,
  type RefundRecord
} from "./schema.js";

export type CancellationActorTypeRecord = "customer" | "admin";
export type CancellationReasonCodeRecord = "customer_requested" | "admin_requested";
export type RefundStatusRecord =
  | "pending"
  | "succeeded"
  | "canceled"
  | "reconciliation_required";
export type RefundProviderStatusRecord = "pending" | "succeeded" | "canceled";

export interface CancellationRefundOrderState {
  readonly order: OrderRecord;
  readonly payment: PaymentRecord | null;
  readonly dispatch: IikoOrderDispatchRecord | null;
  readonly cancellation: OrderCancellationRecord | null;
  readonly refund: RefundRecord | null;
}

export interface CancelOrderInput {
  readonly orderId: number;
  readonly actorType: CancellationActorTypeRecord;
  readonly customerId?: number;
  readonly staffUserId?: number;
  readonly reasonCode: CancellationReasonCodeRecord;
  readonly idempotencyKey: string;
  readonly requestId?: string;
  readonly now: Date;
}

export interface CancelOrderResult {
  readonly state: CancellationRefundOrderState;
  readonly outcome: "accepted" | "already_canceled";
}

export interface RefundProviderResultInput {
  readonly providerRefundId: string;
  readonly providerStatus: RefundProviderStatusRecord;
  readonly paymentProviderId: string;
  readonly amountMinor: number;
  readonly currency: string;
}

export interface RefundEventInput extends RefundProviderResultInput {
  readonly provider: "yookassa";
  readonly eventType: "refund.succeeded";
  readonly eventFingerprint: string;
  readonly receivedAt: Date;
}

export interface RefundEventResult {
  readonly duplicate: boolean;
  readonly ignored: boolean;
  readonly refund: RefundRecord | null;
}

export interface ClaimedRefund {
  readonly refund: RefundRecord;
  readonly order: OrderRecord;
  readonly payment: PaymentRecord;
}

export class CancellationOrderNotFoundError extends Error {
  constructor() {
    super("Order was not found");
    this.name = "CancellationOrderNotFoundError";
  }
}

export class OrderAlreadyCanceledError extends Error {
  constructor() {
    super("Order is already canceled");
    this.name = "OrderAlreadyCanceledError";
  }
}

export class CancellationNotAllowedError extends Error {
  readonly reason:
    | "status"
    | "iiko_order_submitted"
    | "invalid_payment_state"
    | "customer_mismatch";

  constructor(reason: CancellationNotAllowedError["reason"]) {
    super("Order cancellation is not allowed");
    this.name = "CancellationNotAllowedError";
    this.reason = reason;
  }
}

export class RefundInvariantError extends Error {
  constructor() {
    super("Refund state invariant failed");
    this.name = "RefundInvariantError";
  }
}

function isCancellationEligible(status: string): boolean {
  return status === "pending_payment" || status === "payment_confirmed";
}

function isRefundStatus(value: string): value is RefundStatusRecord {
  return (
    value === "pending" ||
    value === "succeeded" ||
    value === "canceled" ||
    value === "reconciliation_required"
  );
}

function readRefundStatus(value: string): RefundStatusRecord {
  if (!isRefundStatus(value)) throw new RefundInvariantError();
  return value;
}

async function readState(
  query: Pick<DatabaseClient["db"], "select">,
  orderId: number,
  lock = false
): Promise<CancellationRefundOrderState | null> {
  const orderStatement = query
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const orderRows = lock ? await orderStatement.for("update") : await orderStatement;
  const [order] = orderRows;
  if (order === undefined) return null;

  const paymentStatement = query
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .orderBy(desc(payments.id))
    .limit(1);
  const paymentRows = lock ? await paymentStatement.for("update") : await paymentStatement;
  const dispatchStatement = query
    .select()
    .from(iikoOrderDispatches)
    .where(eq(iikoOrderDispatches.orderId, orderId))
    .limit(1);
  const dispatchRows = lock
    ? await dispatchStatement.for("update")
    : await dispatchStatement;
  const cancellationStatement = query
    .select()
    .from(orderCancellations)
    .where(eq(orderCancellations.orderId, orderId))
    .limit(1);
  const cancellationRows = lock
    ? await cancellationStatement.for("update")
    : await cancellationStatement;
  const refundStatement = query
    .select()
    .from(refunds)
    .where(eq(refunds.orderId, orderId))
    .limit(1);
  const refundRows = lock ? await refundStatement.for("update") : await refundStatement;

  return {
    order,
    payment: paymentRows[0] ?? null,
    dispatch: dispatchRows[0] ?? null,
    cancellation: cancellationRows[0] ?? null,
    refund: refundRows[0] ?? null
  };
}

async function createRefundIntent(
  tx: Pick<DatabaseClient["db"], "insert" | "select">,
  state: CancellationRefundOrderState,
  now: Date
): Promise<RefundRecord | null> {
  const payment = state.payment;
  if (payment === null || payment.status !== "succeeded") return null;
  if (payment.providerStatus !== "succeeded") throw new CancellationNotAllowedError("invalid_payment_state");
  if (
    !Number.isSafeInteger(payment.amountMinor) ||
    payment.amountMinor < 0 ||
    payment.amountMinor !== state.order.totalMinor ||
    payment.currency !== state.order.currency
  ) {
    throw new RefundInvariantError();
  }

  if (state.refund !== null) return state.refund;
  const [refund] = await tx
    .insert(refunds)
    .values({
      orderId: state.order.id,
      paymentId: payment.id,
      provider: "yookassa",
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      idempotencyKey: randomUUID(),
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoNothing({ target: refunds.paymentId })
    .returning();
  if (refund !== undefined) return refund;
  const [raced] = await tx
    .select()
    .from(refunds)
    .where(eq(refunds.paymentId, payment.id))
    .limit(1);
  return raced ?? null;
}

export interface CancellationRefundRepository {
  findByCustomerAndOrder(
    customerId: number,
    orderId: number
  ): Promise<CancellationRefundOrderState | null>;
  findByOrderId(orderId: number): Promise<CancellationRefundOrderState | null>;
  findByProviderRefundId(providerRefundId: string): Promise<RefundRecord | null>;
  cancelOrder(input: CancelOrderInput): Promise<CancelOrderResult>;
  ensureRefundForSucceededPayment(
    paymentId: number,
    now: Date
  ): Promise<RefundRecord | null>;
  claimNextDue(now: Date, leaseMs: number): Promise<ClaimedRefund | null>;
  applyProviderResult(
    refundId: number,
    result: RefundProviderResultInput,
    now: Date
  ): Promise<RefundRecord>;
  markReconciliationRequired(
    refundId: number,
    errorCode: string,
    now: Date
  ): Promise<RefundRecord>;
  recordProviderEvent(input: RefundEventInput): Promise<RefundEventResult>;
}

export function createCancellationRefundRepository(
  client: DatabaseClient
): CancellationRefundRepository {
  return {
    async findByCustomerAndOrder(customerId, orderId) {
      const state = await readState(client.db, orderId);
      return state === null || state.order.customerId !== customerId ? null : state;
    },

    async findByOrderId(orderId) {
      return readState(client.db, orderId);
    },

    async findByProviderRefundId(providerRefundId) {
      const [refund] = await client.db
        .select()
        .from(refunds)
        .where(eq(refunds.providerRefundId, providerRefundId))
        .limit(1);
      return refund ?? null;
    },

    async cancelOrder(input) {
      return client.db.transaction(async (tx) => {
        const state = await readState(tx, input.orderId, true);
        if (state === null) throw new CancellationOrderNotFoundError();
        if (state.cancellation !== null) {
          return { state, outcome: "already_canceled" as const };
        }
        if (state.order.status === "canceled") throw new OrderAlreadyCanceledError();
        if (!isCancellationEligible(state.order.status)) {
          throw new CancellationNotAllowedError("status");
        }
        if (input.actorType === "customer" && input.customerId !== state.order.customerId) {
          throw new CancellationNotAllowedError("customer_mismatch");
        }
        if (
          state.dispatch !== null &&
          (state.dispatch.providerOrderId !== null || state.dispatch.status !== "pending")
        ) {
          throw new CancellationNotAllowedError("iiko_order_submitted");
        }

        const [cancellation] = await tx
          .insert(orderCancellations)
          .values({
            orderId: input.orderId,
            customerId: input.actorType === "customer" ? input.customerId : null,
            staffUserId: input.actorType === "admin" ? input.staffUserId : null,
            actorType: input.actorType,
            reasonCode: input.reasonCode,
            idempotencyKey: input.idempotencyKey,
            createdAt: input.now,
            updatedAt: input.now
          })
          .onConflictDoNothing({ target: orderCancellations.orderId })
          .returning();
        if (cancellation === undefined) {
          const raced = await readState(tx, input.orderId, true);
          if (raced?.cancellation === null || raced === null) {
            throw new Error("Cancellation insert returned no row");
          }
          return { state: raced, outcome: "already_canceled" as const };
        }

        const [updatedOrder] = await tx
          .update(orders)
          .set({ status: "canceled", updatedAt: input.now })
          .where(and(eq(orders.id, input.orderId), eq(orders.status, state.order.status)))
          .returning();
        if (updatedOrder === undefined) throw new Error("Canceled order update returned no row");
        await tx
          .insert(orderStatusHistory)
          .values({ orderId: input.orderId, status: "canceled", createdAt: input.now })
          .onConflictDoNothing({ target: [orderStatusHistory.orderId, orderStatusHistory.status] });
        if (input.actorType === "admin") {
          await tx.insert(staffAuditLog).values({
            staffUserId: input.staffUserId,
            action: "order_cancel",
            orderId: input.orderId,
            requestId: input.requestId ?? input.idempotencyKey,
            createdAt: input.now
          });
        }
        const nextState = await readState(tx, input.orderId, true);
        if (nextState === null) throw new Error("Canceled order disappeared");
        await createRefundIntent(tx, nextState, input.now);
        const finalState = await readState(tx, input.orderId, true);
        if (finalState === null) throw new Error("Canceled order state disappeared");
        return { state: finalState, outcome: "accepted" as const };
      });
    },

    async ensureRefundForSucceededPayment(paymentId, now) {
      return client.db.transaction(async (tx) => {
        const [sourcePayment] = await tx
          .select({ orderId: payments.orderId })
          .from(payments)
          .where(eq(payments.id, paymentId))
          .limit(1);
        if (sourcePayment === undefined) return null;
        const state = await readState(tx, sourcePayment.orderId, true);
        if (state === null || state.order.status !== "canceled") return null;
        const [lockedPayment] = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.id, paymentId), eq(payments.orderId, sourcePayment.orderId)))
          .limit(1)
          .for("update");
        if (lockedPayment === undefined) return null;
        const currentState = { ...state, payment: lockedPayment };
        return createRefundIntent(tx, currentState, now);
      });
    },

    async claimNextDue(now, leaseMs) {
      if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
        throw new Error("Invalid refund lease");
      }
      return client.db.transaction(async (tx) => {
        const [candidate] = await tx
          .select({ id: refunds.id, orderId: refunds.orderId, paymentId: refunds.paymentId })
          .from(refunds)
          .where(
            and(
              eq(refunds.status, "pending"),
              lte(refunds.nextAttemptAt, now),
              or(isNull(refunds.leaseUntil), lte(refunds.leaseUntil, now))
            )
          )
          .orderBy(asc(refunds.nextAttemptAt), asc(refunds.id))
          .limit(1);
        if (candidate === undefined) return null;

        const [order] = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, candidate.orderId))
          .limit(1)
          .for("update");
        const [payment] = await tx
          .select()
          .from(payments)
          .where(and(eq(payments.id, candidate.paymentId), eq(payments.orderId, candidate.orderId)))
          .limit(1)
          .for("update");
        const [currentRefund] = await tx
          .select()
          .from(refunds)
          .where(
            and(
              eq(refunds.id, candidate.id),
              eq(refunds.status, "pending"),
              lte(refunds.nextAttemptAt, now),
              or(isNull(refunds.leaseUntil), lte(refunds.leaseUntil, now))
            )
          )
          .limit(1)
          .for("update");
        if (order === undefined || payment === undefined || currentRefund === undefined) return null;
        const [claimed] = await tx
          .update(refunds)
          .set({
            attemptCount: currentRefund.attemptCount + 1,
            lastAttemptAt: now,
            nextAttemptAt: new Date(now.getTime() + leaseMs),
            leaseUntil: new Date(now.getTime() + leaseMs),
            updatedAt: now
          })
          .where(eq(refunds.id, currentRefund.id))
          .returning();
        if (claimed === undefined) return null;
        return { refund: claimed, order, payment };
      });
    },

    async applyProviderResult(refundId, result, now) {
      return client.db.transaction(async (tx) => {
        const [sourceRefund] = await tx
          .select({ orderId: refunds.orderId, paymentId: refunds.paymentId })
          .from(refunds)
          .where(eq(refunds.id, refundId))
          .limit(1);
        if (sourceRefund === undefined) throw new RefundInvariantError();
        const [order] = await tx.select().from(orders).where(eq(orders.id, sourceRefund.orderId)).limit(1).for("update");
        const [payment] = await tx.select().from(payments).where(eq(payments.id, sourceRefund.paymentId)).limit(1).for("update");
        const [refund] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).limit(1).for("update");
        if (order === undefined || payment === undefined || refund === undefined) throw new RefundInvariantError();
        if (
          order.status !== "canceled" ||
          payment.status !== "succeeded" ||
          payment.providerStatus !== "succeeded"
        ) throw new RefundInvariantError();
        if (
          result.providerRefundId.trim() === "" ||
          !/^[A-Z]{3}$/u.test(result.currency) ||
          result.paymentProviderId !== payment.providerPaymentId ||
          result.amountMinor !== payment.amountMinor ||
          result.amountMinor !== refund.amountMinor ||
          result.currency !== payment.currency ||
          result.currency !== refund.currency ||
          !Number.isSafeInteger(result.amountMinor) ||
          result.amountMinor < 0
        ) throw new RefundInvariantError();
        const currentStatus = readRefundStatus(refund.status);
        if (currentStatus === "succeeded" && result.providerStatus !== "succeeded") return refund;
        if (currentStatus === "canceled" && result.providerStatus === "succeeded") throw new RefundInvariantError();
        const nextStatus: RefundStatusRecord = result.providerStatus === "succeeded"
          ? "succeeded"
          : result.providerStatus === "canceled" ? "canceled" : "pending";
        const [updated] = await tx
          .update(refunds)
          .set({
            providerRefundId: result.providerRefundId,
            status: nextStatus,
            leaseUntil: null,
            nextAttemptAt:
              result.providerStatus === "pending"
                ? new Date(now.getTime() + 1_000)
                : now,
            lastErrorCode: result.providerStatus === "canceled" ? "provider_canceled" : null,
            lastConfirmedAt: result.providerStatus === "succeeded" ? now : refund.lastConfirmedAt,
            updatedAt: now
          })
          .where(eq(refunds.id, refundId))
          .returning();
        if (updated === undefined) throw new RefundInvariantError();
        return updated;
      });
    },

    async markReconciliationRequired(refundId, errorCode, now) {
      return client.db.transaction(async (tx) => {
        const [sourceRefund] = await tx
          .select({ orderId: refunds.orderId, paymentId: refunds.paymentId })
          .from(refunds)
          .where(eq(refunds.id, refundId))
          .limit(1);
        if (sourceRefund === undefined) throw new RefundInvariantError();
        await tx.select().from(orders).where(eq(orders.id, sourceRefund.orderId)).limit(1).for("update");
        await tx.select().from(payments).where(eq(payments.id, sourceRefund.paymentId)).limit(1).for("update");
        const [currentRefund] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).limit(1).for("update");
        if (currentRefund === undefined) throw new RefundInvariantError();
        if (currentRefund.status === "succeeded") return currentRefund;
        const [updated] = await tx
          .update(refunds)
          .set({
            status: "reconciliation_required",
            leaseUntil: null,
            nextAttemptAt: now,
            lastErrorCode: errorCode,
            updatedAt: now
          })
          .where(eq(refunds.id, refundId))
          .returning();
        if (updated === undefined) throw new RefundInvariantError();
        return updated;
      });
    },

    async recordProviderEvent(input) {
      return client.db.transaction(async (tx) => {
        const [event] = await tx
          .insert(refundEvents)
          .values({
            provider: input.provider,
            providerRefundId: input.providerRefundId,
            eventType: input.eventType,
            eventFingerprint: input.eventFingerprint,
            providerStatus: input.providerStatus,
            receivedAt: input.receivedAt
          })
          .onConflictDoNothing({ target: [refundEvents.provider, refundEvents.eventFingerprint] })
          .returning();
        const [sourceRefund] = await tx
          .select({ id: refunds.id, orderId: refunds.orderId, paymentId: refunds.paymentId })
          .from(refunds)
          .where(and(eq(refunds.provider, input.provider), eq(refunds.providerRefundId, input.providerRefundId)))
          .limit(1);
        if (sourceRefund === undefined) {
          return { duplicate: event === undefined, ignored: true, refund: null };
        }
        const [order] = await tx.select().from(orders).where(eq(orders.id, sourceRefund.orderId)).limit(1).for("update");
        const [payment] = await tx.select().from(payments).where(eq(payments.id, sourceRefund.paymentId)).limit(1).for("update");
        const [refund] = await tx.select().from(refunds).where(eq(refunds.id, sourceRefund.id)).limit(1).for("update");
        if (order === undefined || payment === undefined || refund === undefined) return { duplicate: false, ignored: true, refund: null };
        if (event === undefined) return { duplicate: true, ignored: false, refund };
        if (
          order.status !== "canceled" ||
          payment.status !== "succeeded" ||
          payment.providerStatus !== "succeeded" ||
          input.paymentProviderId !== payment.providerPaymentId ||
          input.amountMinor !== refund.amountMinor ||
          input.currency !== refund.currency
        ) return { duplicate: false, ignored: true, refund };
        if (refund.status === "canceled") return { duplicate: false, ignored: true, refund };
        const [updated] = await tx
          .update(refunds)
          .set({
            status: input.providerStatus === "succeeded" ? "succeeded" : input.providerStatus === "canceled" ? "canceled" : "pending",
            providerRefundId: input.providerRefundId,
            leaseUntil: null,
            lastErrorCode: input.providerStatus === "canceled" ? "provider_canceled" : null,
            lastConfirmedAt: input.providerStatus === "succeeded" ? input.receivedAt : refund.lastConfirmedAt,
            updatedAt: input.receivedAt
          })
          .where(eq(refunds.id, refund.id))
          .returning();
        return { duplicate: false, ignored: updated === undefined, refund: updated ?? refund };
      });
    }
  };
}

export type { OrderCancellationRecord, RefundEventRecord, RefundRecord };
