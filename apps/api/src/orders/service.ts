import { createHash } from "node:crypto";

import {
  IdempotencyKeySchema,
  OrderCreateRequestSchema,
  OrderResponseSchema,
  OrdersListResponseSchema,
  type OrderCreateRequest,
  type OrderResponse,
  type OrdersListResponse
} from "@vse-pro-zhar/contracts";
import type {
  CreateOrderInput,
  IikoDispatchRepository,
  OrderAggregate,
  OrderRepository,
  PaymentRepository,
  CancellationRefundRepository
} from "@vse-pro-zhar/database";
import { OrderIdempotencyConflictError } from "@vse-pro-zhar/database";

import {
  CustomerAuthService,
  CustomerSessionError
} from "../auth/service.js";
import { CheckoutService } from "../checkout/service.js";
import {
  OrderAuthenticationError,
  OrderDependencyError,
  OrderNotFoundError,
  OrderValidationError
} from "./errors.js";
import { toPaymentSummary } from "../payments/service.js";
import { toCancellationSummary, toRefundSummary } from "../cancellation-refund/view.js";

const ORDER_CURRENCY = "RUB";

export interface OrderServiceOptions {
  readonly orderRepository: OrderRepository;
  readonly authService: CustomerAuthService;
  readonly checkoutService: CheckoutService;
  readonly paymentRepository?: PaymentRepository;
  readonly fulfillmentRepository?: IikoDispatchRepository;
  readonly cancellationRefundRepository?: CancellationRefundRepository;
  readonly now: () => Date;
}

function fingerprint(input: OrderCreateRequest): string {
  return createHash("sha256")
    .update(JSON.stringify(input), "utf8")
    .digest("hex");
}

async function toOrderResponse(
  aggregate: OrderAggregate,
  paymentRepository?: PaymentRepository,
  fulfillmentRepository?: IikoDispatchRepository,
  cancellationRefundRepository?: CancellationRefundRepository
): Promise<OrderResponse> {
  const order = aggregate.order;
  const payment =
    paymentRepository === undefined
      ? undefined
      : await paymentRepository.findByCustomerAndOrder(order.customerId, order.id);
  const dispatch =
    fulfillmentRepository === undefined
      ? undefined
      : await fulfillmentRepository.findByOrderId(order.id);
  const cancellationRefund =
    cancellationRefundRepository === undefined
      ? undefined
      : await cancellationRefundRepository.findByCustomerAndOrder(order.customerId, order.id);
  const response = {
    id: order.id,
    status: order.status,
    totalMinor: order.totalMinor,
    currency: order.currency,
    pickup: {
      location: {
        id: order.pickupLocationId,
        name: order.pickupLocationName,
        address: order.pickupLocationAddress,
        timezone: order.pickupLocationTimezone
      },
      slot: {
        id: order.pickupSlotId,
        label: order.pickupSlotLabel,
        startsAt: order.pickupSlotStartsAt.toISOString(),
        endsAt: order.pickupSlotEndsAt.toISOString()
      }
    },
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    subtotalMinor: aggregate.items.reduce((sum, item) => sum + item.lineTotalMinor, 0),
    discountMinor: aggregate.loyaltyRedemption?.discountMinor ?? 0,
    ...(aggregate.loyaltyRedemption === undefined ? {} : { loyaltyRedemption: aggregate.loyaltyRedemption }),
    ...(paymentRepository === undefined
      ? {}
      : {
          payment:
            payment === null || payment === undefined ? null : toPaymentSummary(payment)
        }),
    ...(fulfillmentRepository === undefined
      ? {}
      : {
          fulfillment:
            dispatch == null
              ? null
              : { status: dispatch.status, updatedAt: dispatch.updatedAt.toISOString() }
        }),
    ...(cancellationRefundRepository === undefined
      ? {}
      : {
          cancellationRefund: {
            cancellation: toCancellationSummary(cancellationRefund?.cancellation),
            refund: toRefundSummary(cancellationRefund?.refund),
            canCancel:
              cancellationRefund?.cancellation === null &&
              (order.status === "pending_payment" || order.status === "payment_confirmed") &&
              (cancellationRefund.dispatch === null ||
                (cancellationRefund.dispatch.status === "pending" &&
                  cancellationRefund.dispatch.providerOrderId === null)),
            canReconcile: cancellationRefund?.refund?.status === "reconciliation_required"
          }
        }),
    items: aggregate.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      lineTotalMinor: item.lineTotalMinor
    }))
  };

  const parsed = OrderResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new OrderDependencyError();
  }
  return parsed.data;
}

function toOrderSummary(aggregate: OrderAggregate["order"]): OrdersListResponse["orders"][number] {
  const response = {
    id: aggregate.id,
    status: aggregate.status,
    totalMinor: aggregate.totalMinor,
    currency: aggregate.currency,
    pickup: {
      location: {
        id: aggregate.pickupLocationId,
        name: aggregate.pickupLocationName,
        address: aggregate.pickupLocationAddress,
        timezone: aggregate.pickupLocationTimezone
      },
      slot: {
        id: aggregate.pickupSlotId,
        label: aggregate.pickupSlotLabel,
        startsAt: aggregate.pickupSlotStartsAt.toISOString(),
        endsAt: aggregate.pickupSlotEndsAt.toISOString()
      }
    },
    createdAt: aggregate.createdAt.toISOString(),
    updatedAt: aggregate.updatedAt.toISOString()
  };

  const parsed = OrdersListResponseSchema.shape.orders.element.safeParse(response);
  if (!parsed.success) {
    throw new OrderDependencyError();
  }
  return parsed.data;
}

export class OrderService {
  constructor(private readonly options: OrderServiceOptions) {}

  private async requireSession(token: string | null) {
    try {
      return await this.options.authService.getActiveSession(token);
    } catch (error: unknown) {
      if (error instanceof CustomerSessionError) {
        throw new OrderAuthenticationError();
      }
      throw error;
    }
  }

  async create(
    token: string | null,
    input: unknown,
    rawIdempotencyKey: string
  ): Promise<OrderResponse> {
    const parsedInput = OrderCreateRequestSchema.safeParse(input);
    const idempotencyKey = IdempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!parsedInput.success || !idempotencyKey.success) {
      throw new OrderValidationError();
    }

    const session = await this.requireSession(token);
    const payloadFingerprint = fingerprint(parsedInput.data);
    const existing = await this.options.orderRepository.findByIdempotencyKey(
      session.customer.id,
      idempotencyKey.data
    );
    if (existing !== null) {
      if (existing.order.payloadFingerprint !== payloadFingerprint) {
        throw new OrderIdempotencyConflictError();
      }
      return toOrderResponse(
        existing,
        this.options.paymentRepository,
        this.options.fulfillmentRepository,
        this.options.cancellationRefundRepository
      );
    }

    // CheckoutService repeats all critical checks immediately before the write:
    // current public catalog, prices, operational availability and pickup slot.
    const quoteWithAvailability =
      await this.options.checkoutService.quoteWithAvailability(token, parsedInput.data);
    const quote = quoteWithAvailability.quote;
    const orderInput: CreateOrderInput = {
      customerId: session.customer.id,
      idempotencyKey: idempotencyKey.data,
      payloadFingerprint,
      pickup: {
        locationId: quote.pickup.location.id,
        locationName: quote.pickup.location.name,
        locationAddress: quote.pickup.location.address,
        locationTimezone: quote.pickup.location.timezone,
        slotId: quote.pickup.slot.id,
        slotLabel: quote.pickup.slot.label,
        slotStartsAt: new Date(quote.pickup.slot.startsAt),
        slotEndsAt: new Date(quote.pickup.slot.endsAt)
      },
      items: quote.items,
      iikoItems: quote.items.map((item) => ({
        productId: item.productId,
        iikoProductId: quoteWithAvailability.iikoProductIds.get(item.productId) ?? null
      })),
      totalMinor: quote.totalMinor,
      ...(quote.subtotalMinor === undefined ? {} : { subtotalMinor: quote.subtotalMinor }),
      ...(quote.discountMinor === undefined ? {} : { discountMinor: quote.discountMinor }),
      ...(quote.loyaltyRedemption === undefined ? {} : { loyaltyRedemption: quote.loyaltyRedemption }),
      currency: ORDER_CURRENCY,
      status: "pending_payment",
      createdAt: this.options.now()
    };

    return toOrderResponse(
      await this.options.orderRepository.createOrder(orderInput),
      this.options.paymentRepository,
      this.options.fulfillmentRepository,
      this.options.cancellationRefundRepository
    );
  }

  async list(token: string | null): Promise<OrdersListResponse> {
    const session = await this.requireSession(token);
    const orders = await this.options.orderRepository.listByCustomer(session.customer.id);
    const response = { orders: orders.slice(0, 100).map(toOrderSummary) };
    const parsed = OrdersListResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new OrderDependencyError();
    }
    return parsed.data;
  }

  async get(token: string | null, orderId: number): Promise<OrderResponse> {
    if (!Number.isSafeInteger(orderId) || orderId < 1) {
      throw new OrderValidationError();
    }
    const session = await this.requireSession(token);
    const order = await this.options.orderRepository.findByCustomerAndId(
      session.customer.id,
      orderId
    );
    if (order === null) {
      throw new OrderNotFoundError();
    }
    return toOrderResponse(
      order,
      this.options.paymentRepository,
      this.options.fulfillmentRepository,
      this.options.cancellationRefundRepository
    );
  }
}
