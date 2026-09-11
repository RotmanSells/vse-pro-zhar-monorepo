import { createHash } from "node:crypto";

import {
  IdempotencyKeySchema,
  OrderStatusSchema,
  PaymentCreateRequestSchema,
  PaymentStateResponseSchema,
  PaymentSummarySchema,
  YooKassaPaymentObjectSchema,
  YooKassaPaymentWebhookEventSchema,
  YooKassaWebhookPayloadSchema,
  type PaymentCreateResponse,
  type PaymentStateResponse,
  type PaymentSummary,
  type YooKassaPaymentWebhookEvent
} from "@vse-pro-zhar/contracts";
import type {
  CreatePaymentInput,
  OrderAggregate,
  OrderRepository,
  PaymentAggregate,
  PaymentProviderSnapshotInput,
  PaymentRepository
} from "@vse-pro-zhar/database";
import type { CancellationRefundRepository } from "@vse-pro-zhar/database";
import {
  PaymentIdempotencyConflictError,
  PaymentOrderStateChangedError
} from "@vse-pro-zhar/database";

import {
  CustomerAuthService,
  CustomerSessionError
} from "../auth/service.js";
import {
  CheckoutCartUnavailableError,
  CheckoutConfigurationError,
  CheckoutDependencyError,
  CheckoutOperationalUnavailableError,
  CheckoutPickupUnavailableError,
  CheckoutValidationError
} from "../checkout/errors.js";
import { CheckoutService } from "../checkout/service.js";
import {
  PaymentAuthenticationError,
  PaymentInvalidError,
  PaymentNotAllowedError,
  PaymentNotFoundError,
  PaymentUnavailableError,
  PaymentValidationError
} from "./errors.js";
import {
  YooKassaProviderError,
  type PaymentProvider
} from "./provider.js";

const PAYMENT_PROVIDER = "yookassa" as const;
const PAYMENT_REQUEST_FINGERPRINT = createHash("sha256")
  .update("{}", "utf8")
  .digest("hex");

export interface PaymentServiceOptions {
  readonly paymentRepository: PaymentRepository;
  readonly orderRepository: OrderRepository;
  readonly authService: CustomerAuthService;
  readonly checkoutService: CheckoutService;
  readonly provider: PaymentProvider;
  readonly cancellationRefundRepository?: CancellationRefundRepository;
  readonly now: () => Date;
}

export type PaymentWebhookResult = "processed" | "duplicate" | "ignored";

function providerStatusForEvent(
  event: YooKassaPaymentWebhookEvent
): "waiting_for_capture" | "succeeded" | "canceled" {
  switch (event) {
    case "payment.waiting_for_capture":
      return "waiting_for_capture";
    case "payment.succeeded":
      return "succeeded";
    case "payment.canceled":
      return "canceled";
  }
}

function providerKey(orderId: number, idempotencyKey: string): string {
  return createHash("sha256")
    .update(`yookassa:m8:order:${orderId}:request:${idempotencyKey}`, "utf8")
    .digest("hex");
}

function eventFingerprint(
  event: string,
  object: {
    readonly id: string;
    readonly status: string;
    readonly paid: boolean;
    readonly amount: { readonly value: string; readonly currency: string };
    readonly metadata: Readonly<Record<string, string>>;
  }
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        event,
        id: object.id,
        status: object.status,
        paid: object.paid,
        amount: object.amount,
        metadata: object.metadata ?? {}
      }),
      "utf8"
    )
    .digest("hex");
}

export function toPaymentSummary(aggregate: PaymentAggregate): PaymentSummary {
  const payment = aggregate.payment;
  const confirmation =
    payment.confirmationType === null && payment.confirmationUrl === null
      ? null
      : payment.confirmationType === "redirect" && payment.confirmationUrl !== null
        ? { type: "redirect" as const, url: payment.confirmationUrl }
        : null;
  const parsed = PaymentSummarySchema.safeParse({
    id: payment.id,
    orderId: payment.orderId,
    provider: payment.provider,
    status: payment.status,
    providerStatus: payment.providerStatus,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    confirmation,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString()
  });
  if (!parsed.success) throw new PaymentInvalidError();
  return parsed.data;
}

function toPaymentState(
  order: OrderAggregate["order"],
  payment: PaymentAggregate | null
): PaymentStateResponse {
  const parsed = PaymentStateResponseSchema.safeParse({
    order: { id: order.id, status: order.status },
    payment: payment === null ? null : toPaymentSummary(payment)
  });
  if (!parsed.success) throw new PaymentInvalidError();
  return parsed.data;
}

function mapProviderError(error: unknown): never {
  if (error instanceof PaymentUnavailableError) throw error;
  if (error instanceof YooKassaProviderError) {
    throw error.kind === "invalid_response"
      ? new PaymentInvalidError()
      : new PaymentUnavailableError(error.details);
  }
  throw error;
}

export class PaymentService {
  constructor(private readonly options: PaymentServiceOptions) {}

  private async requireSession(token: string | null) {
    try {
      return await this.options.authService.getActiveSession(token);
    } catch (error: unknown) {
      if (error instanceof CustomerSessionError) {
        throw new PaymentAuthenticationError();
      }
      throw error;
    }
  }

  private async readOwnedOrder(customerId: number, orderId: number): Promise<OrderAggregate> {
    const order = await this.options.orderRepository.findByCustomerAndId(customerId, orderId);
    if (order === null) throw new PaymentNotFoundError();
    if (!OrderStatusSchema.safeParse(order.order.status).success) {
      throw new PaymentInvalidError();
    }
    return order;
  }

  private async readState(customerId: number, orderId: number): Promise<PaymentStateResponse> {
    const order = await this.readOwnedOrder(customerId, orderId);
    const payment = await this.options.paymentRepository.findByCustomerAndOrder(
      customerId,
      orderId
    );
    return toPaymentState(order.order, payment);
  }

  private validateProviderPayment(
    payment: Awaited<ReturnType<PaymentProvider["createPayment"]>>,
    order: OrderAggregate["order"]
  ): PaymentProviderSnapshotInput {
    if (
      payment.test !== true ||
      payment.providerPaymentId.trim() === "" ||
      payment.amountMinor !== order.totalMinor ||
      payment.currency !== order.currency ||
      payment.metadata["order_id"] !== String(order.id)
    ) {
      throw new PaymentInvalidError();
    }
    if (
      payment.confirmationType !== null &&
      (payment.confirmationType !== "redirect" || payment.confirmationUrl === null)
    ) {
      throw new PaymentInvalidError();
    }
    if (
      (payment.providerStatus === "pending" ||
        payment.providerStatus === "waiting_for_capture") &&
      payment.confirmationUrl === null
    ) {
      throw new PaymentInvalidError();
    }
    return {
      providerPaymentId: payment.providerPaymentId,
      providerStatus: payment.providerStatus,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      confirmationType: payment.confirmationType,
      confirmationUrl: payment.confirmationUrl
    };
  }

  private async assertOrderStillPayable(
    token: string | null,
    order: OrderAggregate
  ): Promise<void> {
    let quote: Awaited<ReturnType<CheckoutService["quote"]>>;
    try {
      quote = await this.options.checkoutService.quote(token, {
        items: order.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity
        })),
        pickup: {
          locationId: order.order.pickupLocationId,
          slotId: order.order.pickupSlotId
        }
      });
    } catch (error: unknown) {
      if (
        error instanceof CheckoutCartUnavailableError ||
        error instanceof CheckoutOperationalUnavailableError ||
        error instanceof CheckoutPickupUnavailableError ||
        error instanceof CheckoutValidationError
      ) {
        throw new PaymentNotAllowedError();
      }
      if (
        error instanceof CheckoutConfigurationError ||
        error instanceof CheckoutDependencyError
      ) {
        throw new PaymentUnavailableError();
      }
      throw error;
    }

    const expectedTotalMinor = quote.totalMinor - (order.loyaltyRedemption?.discountMinor ?? 0);
    if (
      !Number.isSafeInteger(expectedTotalMinor) ||
      expectedTotalMinor < 0 ||
      expectedTotalMinor !== order.order.totalMinor ||
      quote.items.length !== order.items.length ||
      quote.items.some((item, index) => {
        const snapshot = order.items[index];
        return (
          snapshot === undefined ||
          item.productId !== snapshot.productId ||
          item.productName !== snapshot.productName ||
          item.quantity !== snapshot.quantity ||
          item.unitPriceMinor !== snapshot.unitPriceMinor ||
          item.lineTotalMinor !== snapshot.lineTotalMinor
        );
      })
    ) {
      throw new PaymentNotAllowedError();
    }
  }

  async create(
    token: string | null,
    orderId: number,
    input: unknown,
    rawIdempotencyKey: string
  ): Promise<PaymentCreateResponse> {
    if (!Number.isSafeInteger(orderId) || orderId < 1) {
      throw new PaymentValidationError();
    }
    const parsedInput = PaymentCreateRequestSchema.safeParse(input);
    const idempotencyKey = IdempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!parsedInput.success || !idempotencyKey.success) {
      throw new PaymentValidationError();
    }

    const session = await this.requireSession(token);
    const order = await this.readOwnedOrder(session.customer.id, orderId);
    const existingByKey = await this.options.paymentRepository.findByCustomerAndIdempotencyKey(
      session.customer.id,
      idempotencyKey.data
    );
    if (existingByKey !== null) {
      if (existingByKey.payment.orderId !== orderId) {
        throw new PaymentIdempotencyConflictError();
      }
      return this.readState(session.customer.id, orderId);
    }

    const existingForOrder = await this.options.paymentRepository.findByCustomerAndOrder(
      session.customer.id,
      orderId
    );
    if (
      existingForOrder !== null &&
      (existingForOrder.payment.status === "pending" ||
        existingForOrder.payment.status === "succeeded")
    ) {
      return this.readState(session.customer.id, orderId);
    }

    if (order.order.status !== "pending_payment") {
      throw new PaymentNotAllowedError();
    }
    if (
      !Number.isSafeInteger(order.order.totalMinor) ||
      order.order.totalMinor < 0 ||
      order.order.currency !== "RUB"
    ) {
      throw new PaymentInvalidError();
    }

    // A persisted order is an immutable historical snapshot, not permission to
    // charge stale catalog/iiko data. Existing active payments are returned
    // above, but a new provider payment always gets a fresh server-side quote.
    await this.assertOrderStillPayable(token, order);

    const providerIdempotencyKey = providerKey(orderId, idempotencyKey.data);
    const paymentInput: CreatePaymentInput = {
      customerId: session.customer.id,
      orderId,
      provider: PAYMENT_PROVIDER,
      idempotencyKey: idempotencyKey.data,
      payloadFingerprint: PAYMENT_REQUEST_FINGERPRINT,
      amountMinor: order.order.totalMinor,
      currency: order.order.currency,
      createdAt: this.options.now()
    };

    try {
      await this.options.paymentRepository.createPayment(paymentInput, async () => {
        const providerPayment = await this.options.provider.createPayment({
          orderId,
          amountMinor: order.order.totalMinor,
          currency: order.order.currency,
          idempotencyKey: providerIdempotencyKey
        });
        return this.validateProviderPayment(providerPayment, order.order);
      });
    } catch (error: unknown) {
      if (error instanceof PaymentIdempotencyConflictError) throw error;
      if (error instanceof PaymentOrderStateChangedError) {
        throw new PaymentNotAllowedError();
      }
      mapProviderError(error);
    }

    return this.readState(session.customer.id, orderId);
  }

  async get(token: string | null, orderId: number): Promise<PaymentStateResponse> {
    if (!Number.isSafeInteger(orderId) || orderId < 1) {
      throw new PaymentValidationError();
    }
    const session = await this.requireSession(token);
    return this.readState(session.customer.id, orderId);
  }

  async handleWebhook(input: unknown): Promise<PaymentWebhookResult> {
    const envelope = YooKassaWebhookPayloadSchema.safeParse(input);
    if (!envelope.success) throw new PaymentValidationError();

    const event = YooKassaPaymentWebhookEventSchema.safeParse(envelope.data.event);
    if (!event.success) return "ignored";

    const object = YooKassaPaymentObjectSchema.safeParse(envelope.data.object);
    if (!object.success || object.data.test !== true) {
      throw new PaymentInvalidError();
    }
    const expectedProviderStatus = providerStatusForEvent(event.data);
    if (
      object.data.status !== expectedProviderStatus ||
      (expectedProviderStatus === "succeeded" && object.data.paid !== true)
    ) {
      throw new PaymentInvalidError();
    }

    const payment = await this.options.paymentRepository.findByProviderPaymentId(
      object.data.id
    );
    const fingerprint = eventFingerprint(event.data, {
      id: object.data.id,
      status: object.data.status,
      paid: object.data.paid,
      amount: object.data.amount,
      metadata: object.data.metadata ?? {}
    });

    if (payment === null) {
      // YooKassa can notify us before the create-payment transaction commits.
      // Do not persist/deduplicate the event yet: a retry must still be able to
      // confirm the payment after its local row becomes visible.
      throw new PaymentUnavailableError();
    }

    const webhookAmountMinor = this.providerAmountToMinor(object.data.amount.value);
    if (
      webhookAmountMinor !== payment.payment.amountMinor ||
      object.data.amount.currency !== payment.payment.currency ||
      (object.data.metadata?.["order_id"] !== undefined &&
        object.data.metadata["order_id"] !== String(payment.payment.orderId))
    ) {
      throw new PaymentInvalidError();
    }

    let currentPayment: Awaited<ReturnType<PaymentProvider["getPayment"]>>;
    try {
      currentPayment = await this.options.provider.getPayment(object.data.id);
    } catch (error: unknown) {
      mapProviderError(error);
    }
    if (
      currentPayment.providerPaymentId !== object.data.id ||
      currentPayment.test !== true ||
      currentPayment.amountMinor !== payment.payment.amountMinor ||
      currentPayment.currency !== payment.payment.currency ||
      currentPayment.metadata["order_id"] !== String(payment.payment.orderId) ||
      currentPayment.providerStatus !== expectedProviderStatus ||
      (currentPayment.providerStatus === "succeeded" && currentPayment.paid !== true)
    ) {
      throw new PaymentInvalidError();
    }

    const result = await this.options.paymentRepository.processProviderEvent({
      provider: PAYMENT_PROVIDER,
      providerPaymentId: object.data.id,
      eventType: event.data,
      eventFingerprint: fingerprint,
      providerStatus: currentPayment.providerStatus,
      amountMinor: currentPayment.amountMinor,
      currency: currentPayment.currency,
      receivedAt: this.options.now()
    });
    if (
      result.payment?.status === "succeeded" &&
      this.options.cancellationRefundRepository !== undefined
    ) {
      await this.options.cancellationRefundRepository.ensureRefundForSucceededPayment(
        result.payment.id,
        this.options.now()
      );
    }
    if (result.duplicate) return "duplicate";
    return result.ignored ? "ignored" : "processed";
  }

  private providerAmountToMinor(value: string): number {
    const [rublesText, kopecksText] = value.split(".");
    if (rublesText === undefined || kopecksText === undefined) {
      throw new PaymentInvalidError();
    }
    try {
      const minor = BigInt(rublesText) * 100n + BigInt(kopecksText);
      if (minor < 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new PaymentInvalidError();
      }
      return Number(minor);
    } catch (error: unknown) {
      if (error instanceof PaymentInvalidError) throw error;
      throw new PaymentInvalidError();
    }
  }
}
