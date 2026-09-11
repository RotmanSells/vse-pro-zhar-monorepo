import {
  AdminPromoCreateRequestSchema,
  AdminPromoResponseSchema,
  AdminPromoRedemptionsQuerySchema,
  AdminPromoRedemptionsResponseSchema,
  AdminPromosQuerySchema,
  AdminPromosResponseSchema,
  AdminPromoUpdateRequestSchema
} from "@vse-pro-zhar/contracts";
import { AdminPromoCodeConflictError, type AdminPromoRepository } from "@vse-pro-zhar/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { assertSafeOrigin } from "../auth/route.js";
import type { StaffGuard } from "../auth/staff-route.js";
import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";
import {
  AdminPromoNotFoundError,
  AdminPromoValidationError,
  archiveAdminPromo,
  createAdminPromo,
  getAdminPromoRedemptions,
  getAdminPromos,
  setAdminPromoActive,
  updateAdminPromo
} from "./service.js";

const ParamsSchema = z.object({ id: z.coerce.number().int().positive() }).strict();

export interface AdminPromoRouteOptions {
  readonly repository?: AdminPromoRepository;
  readonly staffGuard: StaffGuard;
  readonly config: ApiConfig;
  readonly now?: () => Date;
}

function mapError(error: unknown): never {
  if (error instanceof AdminPromoValidationError || error instanceof AdminPromoCodeConflictError) throw new ApiRequestError("VALIDATION_ERROR", 400);
  if (error instanceof AdminPromoNotFoundError) throw new ApiRequestError("NOT_FOUND", 404);
  throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    mapError(error);
  }
}

export function registerAdminPromoRoutes(app: FastifyInstance, options: AdminPromoRouteOptions): void {
  const now = options.now ?? (() => new Date());
  const repository = (): AdminPromoRepository => {
    if (options.repository === undefined) throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    return options.repository;
  };

  app.get("/admin/promos", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    await options.staffGuard.require(request);
    const parsed = AdminPromosQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => getAdminPromos(repository(), parsed.data, now()));
    return reply.send(AdminPromosResponseSchema.parse(response));
  });

  app.post("/admin/promos", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    const staff = await options.staffGuard.require(request);
    const parsed = AdminPromoCreateRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => createAdminPromo(repository(), parsed.data, staff.user.id, now()));
    return reply.code(201).send(AdminPromoResponseSchema.parse(response));
  });

  app.get("/admin/promos/:id/redemptions", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    await options.staffGuard.require(request);
    const params = ParamsSchema.safeParse(request.params);
    const query = AdminPromoRedemptionsQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => getAdminPromoRedemptions(repository(), params.data.id, query.data));
    return reply.send(AdminPromoRedemptionsResponseSchema.parse(response));
  });

  app.patch("/admin/promos/:id", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    const staff = await options.staffGuard.require(request);
    const params = ParamsSchema.safeParse(request.params);
    const input = AdminPromoUpdateRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => updateAdminPromo(repository(), params.data.id, input.data, staff.user.id));
    return reply.send(AdminPromoResponseSchema.parse(response));
  });

  app.post("/admin/promos/:id/activate", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    const staff = await options.staffGuard.require(request);
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => setAdminPromoActive(repository(), params.data.id, true, staff.user.id));
    return reply.send(AdminPromoResponseSchema.parse(response));
  });

  app.post("/admin/promos/:id/deactivate", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    const staff = await options.staffGuard.require(request);
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => setAdminPromoActive(repository(), params.data.id, false, staff.user.id));
    return reply.send(AdminPromoResponseSchema.parse(response));
  });

  app.post("/admin/promos/:id/archive", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    const staff = await options.staffGuard.require(request);
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => archiveAdminPromo(repository(), params.data.id, staff.user.id));
    return reply.send(AdminPromoResponseSchema.parse(response));
  });
}
