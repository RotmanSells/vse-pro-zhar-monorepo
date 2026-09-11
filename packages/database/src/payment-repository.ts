import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";
import {
  orderStatusHistory,
  orders,
  iikoOrderDispatches,
  paymentEvents,
  payments,
  type PaymentRecord
} from "./schema.js";

export type PaymentStatusRecord = "pending" | "succeeded" | "canceled";
export type PaymentProviderStatusRecord =
  | "pending"
  | "waiting_for_capture"
  | "succeeded"
  | "canceled";

export interface PaymentProviderSnapshotInput {
  readonly providerPaymentId: string;
  readonly providerStatus: PaymentProviderStatusRecord;
  readonly amountMinor: number;
  readonly currency: string;
  readonly confirmationType: "redirect" | null;
  readonly confirmationUrl: string | null;
}

export interface CreatePaymentInput {
  readonly customerId: number;
  readonly orderId: number;
  readonly provider: "yookassa";
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly createdAt: Date;
}

export interface PaymentAggregate {
  readonly payment: PaymentRecord;
}

export class PaymentIdempotencyConflictError extends Error {
  constructor() {
    super("Payment idempotency key was already used with another request");
    this.name = "PaymentIdempotencyConflictError";
  }
}

export class PaymentOrderStateChangedError extends Error {
  constructor() {
    super("Payment order state changed during creation");
    this.name = "PaymentOrderStateChangedError";
  }
}

export interface PaymentProviderEventInput {
  readonly provider: "yookassa";
  readonly providerPaymentId: string;
  readonly eventType: string;
  readonly eventFingerprint: string;
  readonly providerStatus: PaymentProviderStatusRecord;
  readonly amountMinor: number;
  readonly currency: string;
  readonly receivedAt: Date;
}

export interface PaymentEventResult {
  readonly duplicate: boolean;
  readonly ignored: boolean;
  readonly payment: PaymentRecord | null;
}

export interface PaymentRepository {
  findByCustomerAndOrder(
    customerId: number,
    orderId: number
  ): Promise<PaymentAggregate | null>;
  findByCustomerAndIdempotencyKey(
    customerId: number,
    idempotencyKey: string
  ): Promise<PaymentAggregate | null>;
  findByProviderPaymentId(providerPaymentId: string): Promise<PaymentAggregate | null>;
  createPayment(
    input: CreatePaymentInput,
    createProviderPayment: () => Promise<PaymentProviderSnapshotInput>
  ): Promise<PaymentAggregate>;
  processProviderEvent(input: PaymentProviderEventInput): Promise<PaymentEventResult>;
}

function checkFingerprint(
  payment: PaymentRecord,
  payloadFingerprint: string
): void {
  if (payment.payloadFingerprint !== payloadFingerprint) {
    throw new PaymentIdempotencyConflictError();
  }
}

function isActiveStatus(status: string): status is "pending" | "succeeded" {
  return status === "pending" || status === "succeeded";
}

function readPaymentAggregate(payment: PaymentRecord): PaymentAggregate {
  return { payment };
}

export function createPaymentRepository(client: DatabaseClient): PaymentRepository {
  return {
    async findByCustomerAndOrder(customerId, orderId) {
      const [payment] = await client.db
        .select()
        .from(payments)
        .where(and(eq(payments.customerId, customerId), eq(payments.orderId, orderId)))
        .orderBy(desc(payments.id))
        .limit(1);
      return payment === undefined ? null : readPaymentAggregate(payment);
    },

    async findByCustomerAndIdempotencyKey(customerId, idempotencyKey) {
      const [payment] = await client.db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.customerId, customerId),
            eq(payments.idempotencyKey, idempotencyKey)
          )
        )
        .limit(1);
      return payment === undefined ? null : readPaymentAggregate(payment);
    },

    async findByProviderPaymentId(providerPaymentId) {
      const [payment] = await client.db
        .select()
        .from(payments)
        .where(eq(payments.providerPaymentId, providerPaymentId))
        .limit(1);
      return payment === undefined ? null : readPaymentAggregate(payment);
    },

    async createPayment(input, createProviderPayment) {
      return client.db.transaction(async (tx) => {
        // Keep the order locked while calling YooKassa. The first production
        // release is a single process, but this row lock also prevents two
        // concurrent API requests from creating two active provider payments.
        const lockedOrder = await tx.execute(sql`
          SELECT id, total_minor, currency, status
          FROM orders
          WHERE id = ${input.orderId} AND customer_id = ${input.customerId}
          FOR UPDATE
        `);
        if (lockedOrder.rows.length === 0) {
          throw new PaymentOrderStateChangedError();
        }
        const lockedOrderRow = lockedOrder.rows[0] as {
          total_minor: string | number;
          currency: string;
          status: string;
        };
        if (
          Number(lockedOrderRow.total_minor) !== input.amountMinor ||
          lockedOrderRow.currency !== input.currency ||
          lockedOrderRow.status !== "pending_payment"
        ) {
          throw new PaymentOrderStateChangedError();
        }

        const [existingByKey] = await tx
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.customerId, input.customerId),
              eq(payments.idempotencyKey, input.idempotencyKey)
            )
          )
          .limit(1);
        if (existingByKey !== undefined) {
          checkFingerprint(existingByKey, input.payloadFingerprint);
          return readPaymentAggregate(existingByKey);
        }

        const activePayments = await tx
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.orderId, input.orderId),
              inArray(payments.status, ["pending", "succeeded"])
            )
          )
          .orderBy(asc(payments.id))
          .limit(1);
        const activePayment = activePayments[0];
        if (activePayment !== undefined && isActiveStatus(activePayment.status)) {
          return readPaymentAggregate(activePayment);
        }

        const lockedItems = await tx.execute(sql`
          SELECT
            oi.product_id,
            oi.product_name,
            oi.unit_price_minor,
            oi.quantity,
            oi.line_total_minor,
            p.name AS current_product_name,
            p.price_minor AS current_unit_price_minor,
            p.is_visible AS product_is_visible,
            c.is_visible AS category_is_visible
          FROM order_items oi
          INNER JOIN products p ON p.id = oi.product_id
          INNER JOIN categories c ON c.id = p.category_id
          WHERE oi.order_id = ${input.orderId}
          ORDER BY oi.id ASC
          FOR SHARE OF p, c
        `);
        if (lockedItems.rows.length === 0) {
          throw new PaymentOrderStateChangedError();
        }
        let lockedTotalMinor = 0;
        for (const rawRow of lockedItems.rows) {
          const row = rawRow as {
            product_name: string;
            unit_price_minor: string | number;
            quantity: string | number;
            line_total_minor: string | number;
            current_product_name: string;
            current_unit_price_minor: string | number;
            product_is_visible: boolean;
            category_is_visible: boolean;
          };
          const unitPriceMinor = Number(row.unit_price_minor);
          const quantity = Number(row.quantity);
          const lineTotalMinor = Number(row.line_total_minor);
          if (
            row.product_is_visible !== true ||
            row.category_is_visible !== true ||
            row.product_name !== row.current_product_name ||
            unitPriceMinor !== Number(row.current_unit_price_minor) ||
            !Number.isSafeInteger(quantity) ||
            quantity < 1 ||
            !Number.isSafeInteger(lineTotalMinor) ||
            lineTotalMinor !== unitPriceMinor * quantity
          ) {
            throw new PaymentOrderStateChangedError();
          }
          lockedTotalMinor += lineTotalMinor;
        }
        if (
          !Number.isSafeInteger(lockedTotalMinor) ||
          lockedTotalMinor !== input.amountMinor
        ) {
          throw new PaymentOrderStateChangedError();
        }

        const providerPayment = await createProviderPayment();
        const [createdPayment] = await tx
          .insert(payments)
          .values({
            orderId: input.orderId,
            customerId: input.customerId,
            provider: input.provider,
            providerPaymentId: providerPayment.providerPaymentId,
            amountMinor: input.amountMinor,
            currency: input.currency,
            // A create response is never proof of payment. The webhook/API
            // confirmation path is the only code allowed to set succeeded.
            status: "pending",
            providerStatus: providerPayment.providerStatus,
            confirmationType: providerPayment.confirmationType,
            confirmationUrl: providerPayment.confirmationUrl,
            idempotencyKey: input.idempotencyKey,
            payloadFingerprint: input.payloadFingerprint,
            createdAt: input.createdAt,
            updatedAt: input.createdAt
          })
          .onConflictDoNothing()
          .returning();

        if (createdPayment !== undefined) return readPaymentAggregate(createdPayment);

        const [racedByKey] = await tx
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.customerId, input.customerId),
              eq(payments.idempotencyKey, input.idempotencyKey)
            )
          )
          .limit(1);
        if (racedByKey !== undefined) {
          checkFingerprint(racedByKey, input.payloadFingerprint);
          return readPaymentAggregate(racedByKey);
        }

        const [racedByOrder] = await tx
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.orderId, input.orderId),
              inArray(payments.status, ["pending", "succeeded"])
            )
          )
          .orderBy(asc(payments.id))
          .limit(1);
        if (racedByOrder !== undefined) return readPaymentAggregate(racedByOrder);

        throw new Error("Payment insert returned no row");
      });
    },

    async processProviderEvent(input) {
      return client.db.transaction(async (tx) => {
        const [event] = await tx
          .insert(paymentEvents)
          .values({
            provider: input.provider,
            providerPaymentId: input.providerPaymentId,
            eventType: input.eventType,
            eventFingerprint: input.eventFingerprint,
            providerStatus: input.providerStatus,
            receivedAt: input.receivedAt
          })
          .onConflictDoNothing({
            target: [paymentEvents.provider, paymentEvents.eventFingerprint]
          })
          .returning();

        const [sourcePayment] = await tx
          .select({ id: payments.id, orderId: payments.orderId })
          .from(payments)
          .where(eq(payments.providerPaymentId, input.providerPaymentId))
          .limit(1);
        if (sourcePayment === undefined) {
          return {
            duplicate: event === undefined,
            ignored: true,
            payment: null
          };
        }

        // Payment webhooks and cancellation both lock the order first, then
        // payment. This closes the race where a late success could enqueue a
        // canceled order for iiko.
        const [order] = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, sourcePayment.orderId))
          .limit(1)
          .for("update");
        const [payment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, sourcePayment.id))
          .limit(1)
          .for("update");

        if (event === undefined) {
          return {
            duplicate: true,
            ignored: payment === undefined,
            payment: payment ?? null
          };
        }

        if (payment === undefined) {
          return { duplicate: false, ignored: true, payment: null };
        }

        if (order === undefined) {
          return { duplicate: false, ignored: true, payment };
        }

        const now = input.receivedAt;
        const shouldSucceed = input.providerStatus === "succeeded";
        const shouldCancel = input.providerStatus === "canceled";
        const currentIsFinal =
          payment.status === "succeeded" || payment.status === "canceled";

        if (
          payment.amountMinor !== input.amountMinor ||
          payment.currency !== input.currency
        ) {
          return { duplicate: false, ignored: true, payment };
        }

        if (
          currentIsFinal &&
          ((payment.status === "succeeded" && !shouldSucceed) ||
            (payment.status === "canceled" && !shouldCancel))
        ) {
          return { duplicate: false, ignored: true, payment };
        }

        const nextStatus: PaymentStatusRecord = shouldSucceed
          ? "succeeded"
          : shouldCancel
            ? "canceled"
            : "pending";
        const [updatedPayment] = await tx
          .update(payments)
          .set({
            status: nextStatus,
            providerStatus: input.providerStatus,
            updatedAt: now
          })
          .where(eq(payments.id, payment.id))
          .returning();
        if (updatedPayment === undefined) {
          throw new Error("Payment event update returned no row");
        }

        if (shouldSucceed && order.status === "pending_payment") {
          const [updatedOrder] = await tx
            .update(orders)
            .set({ status: "payment_confirmed", updatedAt: now })
            .where(and(eq(orders.id, payment.orderId), eq(orders.status, "pending_payment")))
            .returning();
          if (updatedOrder !== undefined) {
            await tx.insert(orderStatusHistory).values({
              orderId: payment.orderId,
              status: "payment_confirmed",
              createdAt: now
            });
            await tx
              .insert(iikoOrderDispatches)
              .values({
                orderId: payment.orderId,
                correlationId: randomUUID(),
                status: "pending",
                attemptCount: 0,
                nextAttemptAt: now,
                createdAt: now,
                updatedAt: now
              })
              .onConflictDoNothing({ target: iikoOrderDispatches.orderId });
          }
        }

        return { duplicate: false, ignored: false, payment: updatedPayment };
      });
    }
  };
}
