import {
  AdminOrderDetailSchema,
  AdminOrderListItemSchema,
  AdminOrdersListResponseSchema,
  AdminFulfillmentRecoveryResponseSchema,
  type AdminOrderDetail,
  type AdminOrdersListResponse,
  type AdminFulfillmentRecoveryResponse
} from "@vse-pro-zhar/contracts";
import type { AdminOrderRepository, AdminOrderResult, AdminRecoveryResult } from "@vse-pro-zhar/database";
import { toAdminRefundSummary, toCancellationSummary } from "../cancellation-refund/view.js";

export class AdminOrderNotFoundError extends Error {
  constructor() {
    super("Admin order was not found");
    this.name = "AdminOrderNotFoundError";
  }
}

export class AdminOrderDependencyError extends Error {
  constructor() {
    super("Admin order dependency is unavailable");
    this.name = "AdminOrderDependencyError";
  }
}

function maskPhone(phone: string): string {
  const normalized = phone.trim();
  if (normalized.length <= 4) return "••••";
  return `•••• ${normalized.slice(-4)}`;
}

function safeErrorCode(code: string | null): string | null {
  return code !== null && /^[A-Za-z0-9_.-]{1,80}$/u.test(code) ? code : null;
}

function mapDetail(result: AdminOrderResult): AdminOrderDetail {
  const response = {
    id: result.order.id,
    status: result.order.status,
    totalMinor: result.order.totalMinor,
    currency: result.order.currency,
    customer: {
      id: result.customer.id,
      name: result.customer.name,
      phone: result.customer.phone
    },
    pickup: {
      locationId: result.order.pickupLocationId,
      locationName: result.order.pickupLocationName,
      address: result.order.pickupLocationAddress,
      timezone: result.order.pickupLocationTimezone,
      slotId: result.order.pickupSlotId,
      slotLabel: result.order.pickupSlotLabel,
      startsAt: result.order.pickupSlotStartsAt.toISOString(),
      endsAt: result.order.pickupSlotEndsAt.toISOString()
    },
    items: result.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      lineTotalMinor: item.lineTotalMinor
    })),
    payment:
      result.payment === null
        ? null
        : {
            id: result.payment.id,
            provider: result.payment.provider,
            status: result.payment.status,
            providerStatus: result.payment.providerStatus,
            amountMinor: result.payment.amountMinor,
            currency: result.payment.currency,
            createdAt: result.payment.createdAt.toISOString(),
            updatedAt: result.payment.updatedAt.toISOString()
          },
    fulfillment:
      result.dispatch === null
        ? null
        : {
            status: result.dispatch.status,
            errorCode: safeErrorCode(result.dispatch.lastErrorCode),
            attemptCount: result.dispatch.attemptCount,
            nextAttemptAt: result.dispatch.nextAttemptAt.toISOString(),
            lastAttemptAt: result.dispatch.lastAttemptAt?.toISOString() ?? null,
            updatedAt: result.dispatch.updatedAt.toISOString(),
            correlationId: result.dispatch.correlationId,
            providerOrderId: result.dispatch.providerOrderId,
            commandId: result.dispatch.commandId
          },
    history: result.history.map((entry) => ({
      status: entry.status,
      createdAt: entry.createdAt.toISOString()
    })),
    ...(result.cancellation === undefined
      ? {}
      : { cancellation: toCancellationSummary(result.cancellation) }),
    ...(result.refund === undefined ? {} : { refund: toAdminRefundSummary(result.refund) })
    ,
    ...(result.refundEvents === undefined
      ? {}
      : {
          refundEvents: result.refundEvents.map((event) => ({
            eventType: event.eventType,
            providerStatus: event.providerStatus,
            receivedAt: event.receivedAt.toISOString()
          }))
        })
  };
  const parsed = AdminOrderDetailSchema.safeParse(response);
  if (!parsed.success) throw new AdminOrderDependencyError();
  return parsed.data;
}

function mapListItem(result: AdminOrderResult) {
  const parsed = AdminOrderListItemSchema.safeParse({
    id: result.order.id,
    status: result.order.status,
    totalMinor: result.order.totalMinor,
    currency: result.order.currency,
    customer: { name: result.customer.name, phoneMasked: maskPhone(result.customer.phone) },
    paymentStatus: result.payment?.status ?? null,
    fulfillmentStatus: result.dispatch?.status ?? null,
    fulfillmentErrorCode: safeErrorCode(result.dispatch?.lastErrorCode ?? null),
    pickup: {
      locationName: result.order.pickupLocationName,
      slotLabel: result.order.pickupSlotLabel
    },
    createdAt: result.order.createdAt.toISOString(),
    updatedAt: result.order.updatedAt.toISOString()
  });
  if (!parsed.success) throw new AdminOrderDependencyError();
  return parsed.data;
}

export class AdminOrderService {
  constructor(private readonly repository: AdminOrderRepository) {}

  async list(filters: Parameters<AdminOrderRepository["list"]>[0]): Promise<AdminOrdersListResponse> {
    const result = await this.repository.list(filters);
    const response = {
      orders: result.orders.map(mapListItem),
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        total: result.total,
        hasNext: filters.offset + result.orders.length < result.total
      }
    };
    const parsed = AdminOrdersListResponseSchema.safeParse(response);
    if (!parsed.success) throw new AdminOrderDependencyError();
    return parsed.data;
  }

  async get(orderId: number): Promise<AdminOrderDetail> {
    const result = await this.repository.findById(orderId);
    if (result === null) throw new AdminOrderNotFoundError();
    return mapDetail(result);
  }

  async retry(
    orderId: number,
    staffUserId: number,
    requestId: string,
    now: Date
  ): Promise<AdminFulfillmentRecoveryResponse> {
    const result: AdminRecoveryResult = await this.repository.retryFulfillment({
      orderId,
      staffUserId,
      requestId,
      now
    });
    const response = { order: mapDetail(result.order), recovery: { mode: result.mode } };
    const parsed = AdminFulfillmentRecoveryResponseSchema.safeParse(response);
    if (!parsed.success) throw new AdminOrderDependencyError();
    return parsed.data;
  }
}
