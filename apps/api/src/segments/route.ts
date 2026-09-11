import {
  AdminSegmentCodeSchema,
  AdminSegmentPreviewQuerySchema,
  AdminSegmentPreviewResponseSchema,
  AdminSegmentsResponseSchema
} from "@vse-pro-zhar/contracts";
import type { AdminSegmentRepository } from "@vse-pro-zhar/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { assertSafeOrigin } from "../auth/route.js";
import type { StaffGuard } from "../auth/staff-route.js";
import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";
import { getAdminSegmentPreview, getAdminSegments } from "./service.js";

const ParamsSchema = z.object({ code: AdminSegmentCodeSchema }).strict();

export interface AdminSegmentRouteOptions {
  readonly repository?: AdminSegmentRepository;
  readonly staffGuard: StaffGuard;
  readonly config: ApiConfig;
  readonly now?: () => Date;
}

function run<T>(operation: () => Promise<T>): Promise<T> {
  return operation().catch(() => {
    throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
  });
}

export function registerAdminSegmentRoutes(
  app: FastifyInstance,
  options: AdminSegmentRouteOptions
): void {
  const now = options.now ?? (() => new Date());
  const getRepository = (): AdminSegmentRepository => {
    if (options.repository === undefined) throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    return options.repository;
  };

  app.get("/admin/segments", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    await options.staffGuard.require(request);
    const response = await run(() => getAdminSegments(getRepository(), now()));
    return reply.send(AdminSegmentsResponseSchema.parse(response));
  });

  app.get("/admin/segments/:code", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    await options.staffGuard.require(request);
    const parsedParams = ParamsSchema.safeParse(request.params);
    const parsedQuery = AdminSegmentPreviewQuerySchema.safeParse(request.query);
    if (!parsedParams.success || !parsedQuery.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => getAdminSegmentPreview(getRepository(), parsedParams.data.code, parsedQuery.data, now()));
    return reply.send(AdminSegmentPreviewResponseSchema.parse(response));
  });
}
