import {
  CancellationRequestSchema,
  CancellationResponseSchema,
  AdminReconciliationResponseSchema,
  IdempotencyKeySchema
} from "@vse-pro-zhar/contracts";
import type {
  CancellationRefundRepository,
  CustomerRepository,
  StaffRepository
} from "@vse-pro-zhar/database";
import {
  CancellationNotAllowedError,
  OrderAlreadyCanceledError
} from "@vse-pro-zhar/database";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { assertSafeOrigin, readSession } from "../auth/route.js";
import { CustomerAuthService } from "../auth/service.js";
import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";
import type { RefundProvider } from "../payments/provider.js";
import type { OrderService } from "../orders/service.js";
import type { AdminOrderService } from "../orders/admin-service.js";
import type { StaffGuard } from "../auth/staff-route.js";
import {
  CancellationAuthenticationError,
  CancellationNotFoundError,
  CancellationUnavailableError,
  CancellationValidationError,
  RefundPendingError,
  RefundReconciliationRequiredError
} from "./errors.js";
import { CancellationRefundService } from "./service.js";

const ParamsSchema = z.object({ id: z.coerce.number().int().positive() }).strict();

export interface CancellationRefundRouteOptions {
  readonly repository?: CancellationRefundRepository;
  readonly customerRepository?: CustomerRepository;
  readonly staffRepository?: StaffRepository;
  readonly staffGuard: StaffGuard;
  readonly refundProvider?: RefundProvider;
  readonly orderService?: OrderService | null;
  readonly adminOrderService?: AdminOrderService | null;
  readonly now?: () => Date;
}

function readIdempotencyKey(request: FastifyRequest): string {
  const raw = request.headers["idempotency-key"];
  const value = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
  const parsed = IdempotencyKeySchema.safeParse(value);
  if (!parsed.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
  return parsed.data;
}

function mapError(error: unknown): never {
  if (error instanceof CancellationValidationError) throw new ApiRequestError("VALIDATION_ERROR", 400);
  if (error instanceof CancellationAuthenticationError) throw new ApiRequestError("AUTHENTICATION_ERROR", 401);
  if (error instanceof CancellationNotFoundError) throw new ApiRequestError("NOT_FOUND", 404);
  if (error instanceof OrderAlreadyCanceledError) throw new ApiRequestError("ORDER_ALREADY_CANCELED", 409);
  if (error instanceof CancellationNotAllowedError) throw new ApiRequestError("CANCELLATION_NOT_ALLOWED", 409);
  if (error instanceof RefundPendingError) throw new ApiRequestError("REFUND_PENDING", 409);
  if (error instanceof RefundReconciliationRequiredError) throw new ApiRequestError("REFUND_RECONCILIATION_REQUIRED", 409);
  if (error instanceof CancellationUnavailableError) throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
  throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    mapError(error);
  }
}

export function registerCancellationRefundRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  options: CancellationRefundRouteOptions
): CancellationRefundService | null {
  const now = options.now ?? (() => new Date());
  const authService =
    options.customerRepository === undefined
      ? undefined
      : new CustomerAuthService(options.customerRepository, config, now);
  const service =
    options.repository === undefined
      ? null
      : new CancellationRefundService({
          repository: options.repository,
          ...(authService === undefined ? {} : { authService }),
          ...(options.refundProvider === undefined ? {} : { refundProvider: options.refundProvider }),
          ...(options.staffRepository === undefined ? {} : { staffRepository: options.staffRepository }),
          now
        });
  const getService = (): CancellationRefundService => {
    if (service === null) throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    return service;
  };

  app.post<{ Params: { id: string } }>("/orders/:id/cancel", async (request, reply) => {
    assertSafeOrigin(request, config);
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiRequestError("NOT_FOUND", 404);
    const input = CancellationRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const idempotencyKey = readIdempotencyKey(request);
    const { token } = readSession(request);
    const result = await run(() => getService().cancelCustomer(token, params.data.id, input.data, idempotencyKey));
    if (options.orderService === undefined || options.orderService === null) {
      throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    }
    const order = await run(() => options.orderService!.get(token, params.data.id));
    return reply.code(200).send(CancellationResponseSchema.parse({ order, outcome: result.outcome }));
  });

  app.post<{ Params: { id: string } }>("/admin/orders/:id/cancel", async (request, reply) => {
    assertSafeOrigin(request, config);
    const staff = await options.staffGuard.require(request);
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiRequestError("NOT_FOUND", 404);
    const input = CancellationRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const idempotencyKey = readIdempotencyKey(request);
    const result = await run(() => getService().cancelAdmin(params.data.id, staff.user.id, request.id, idempotencyKey));
    if (options.adminOrderService === undefined || options.adminOrderService === null) {
      throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    }
    const order = await run(() => options.adminOrderService!.get(params.data.id));
    return reply.code(200).send(CancellationResponseSchema.parse({ order, outcome: result.outcome }));
  });

  app.post<{ Params: { id: string } }>("/admin/orders/:id/refund/reconcile", async (request, reply) => {
    assertSafeOrigin(request, config);
    const staff = await options.staffGuard.require(request);
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiRequestError("NOT_FOUND", 404);
    readIdempotencyKey(request);
    const result = await run(() => getService().reconcileAdmin(params.data.id, staff.user.id, request.id));
    if (options.adminOrderService === undefined || options.adminOrderService === null) {
      throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    }
    const order = await run(() => options.adminOrderService!.get(params.data.id));
    return reply.code(200).send(AdminReconciliationResponseSchema.parse({ order, outcome: result.outcome }));
  });

  return service;
}
