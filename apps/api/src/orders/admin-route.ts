import {
  AdminFulfillmentRecoveryResponseSchema,
  AdminOrdersListResponseSchema,
  AdminOrderStatusSchema,
  AdminPaymentFilterSchema,
  AdminFulfillmentStatusSchema
} from "@vse-pro-zhar/contracts";
import type { AdminOrderRepository } from "@vse-pro-zhar/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { assertSafeOrigin } from "../auth/route.js";
import type { StaffGuard } from "../auth/staff-route.js";
import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";
import {
  AdminOrderDependencyError,
  AdminOrderNotFoundError,
  AdminOrderService
} from "./admin-service.js";
import { AdminRecoveryNotAllowedError } from "@vse-pro-zhar/database";

const QuerySchema = z
  .object({
    status: AdminOrderStatusSchema.optional(),
    fulfillmentStatus: AdminFulfillmentStatusSchema.optional(),
    paymentStatus: AdminPaymentFilterSchema.optional(),
    from: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
    to: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
    search: z.string().trim().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(100_000).default(0)
  })
  .strict();
const ParamsSchema = z.object({ id: z.coerce.number().int().positive() }).strict();

function queryDate(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (value === undefined) return undefined;
  return new Date(value.length === 10 ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : value);
}

export interface AdminOrderRouteOptions {
  readonly orderRepository?: AdminOrderRepository;
  readonly staffGuard: StaffGuard;
  readonly now?: () => Date;
}

function mapError(error: unknown): never {
  if (error instanceof AdminOrderNotFoundError) throw new ApiRequestError("NOT_FOUND", 404);
  if (error instanceof AdminRecoveryNotAllowedError) {
    if (error.reason === "order_not_found") throw new ApiRequestError("NOT_FOUND", 404);
    throw new ApiRequestError("FULFILLMENT_RECOVERY_NOT_ALLOWED", 409);
  }
  if (error instanceof AdminOrderDependencyError) throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
  throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    mapError(error);
  }
}

export function registerAdminOrderRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  options: AdminOrderRouteOptions
): AdminOrderService | null {
  const now = options.now ?? (() => new Date());
  const service = options.orderRepository === undefined
    ? null
    : new AdminOrderService(options.orderRepository);
  const getService = (): AdminOrderService => {
    if (service === null) throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    return service;
  };

  app.get("/admin/orders", async (request, reply) => {
    await options.staffGuard.require(request);
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const from = queryDate(parsed.data.from, false);
    const to = queryDate(parsed.data.to, true);
    if (from !== undefined && to !== undefined && from > to) {
      throw new ApiRequestError("VALIDATION_ERROR", 400);
    }
    const response = await run(() => getService().list({
      ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
      ...(parsed.data.fulfillmentStatus === undefined ? {} : { fulfillmentStatus: parsed.data.fulfillmentStatus }),
      ...(parsed.data.paymentStatus === undefined ? {} : { paymentStatus: parsed.data.paymentStatus }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      ...(parsed.data.search === undefined || parsed.data.search === "" ? {} : { search: parsed.data.search }),
      limit: parsed.data.limit,
      offset: parsed.data.offset
    }));
    return reply.send(AdminOrdersListResponseSchema.parse(response));
  });

  app.get<{ Params: { id: string } }>("/admin/orders/:id", async (request, reply) => {
    await options.staffGuard.require(request);
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiRequestError("NOT_FOUND", 404);
    const response = await run(() => getService().get(params.data.id));
    return reply.send(response);
  });

  app.post<{ Params: { id: string } }>("/admin/orders/:id/fulfillment/retry", async (request, reply) => {
    assertSafeOrigin(request, config);
    const staff = await options.staffGuard.require(request);
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiRequestError("NOT_FOUND", 404);
    const response = await run(() =>
      getService().retry(params.data.id, staff.user.id, request.id, now())
    );
    return reply.send(AdminFulfillmentRecoveryResponseSchema.parse(response));
  });

  return service;
}
