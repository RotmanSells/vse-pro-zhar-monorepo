import {
  AdminAnalyticsExportResponseSchema,
  AdminAnalyticsPeriodSchema,
  AdminAnalyticsResponseSchema
} from "@vse-pro-zhar/contracts";
import type { AdminAnalyticsRepository } from "@vse-pro-zhar/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { assertSafeOrigin } from "../auth/route.js";
import type { StaffGuard } from "../auth/staff-route.js";
import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";
import { buildAdminAnalyticsExport, getAdminAnalytics } from "./service.js";

const QuerySchema = z
  .object({ days: z.coerce.number().int().pipe(AdminAnalyticsPeriodSchema).default(30) })
  .strict();

export interface AdminAnalyticsRouteOptions {
  readonly analyticsRepository?: AdminAnalyticsRepository;
  readonly staffGuard: StaffGuard;
  readonly now?: () => Date;
}

function run<T>(operation: () => Promise<T>): Promise<T> {
  return operation().catch(() => {
    throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
  });
}

export function registerAdminAnalyticsRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  options: AdminAnalyticsRouteOptions
): void {
  const now = options.now ?? (() => new Date());
  const getRepository = (): AdminAnalyticsRepository => {
    if (options.analyticsRepository === undefined) throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    return options.analyticsRepository;
  };

  app.get("/admin/analytics", async (request, reply) => {
    assertSafeOrigin(request, config);
    await options.staffGuard.require(request);
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => getAdminAnalytics(getRepository(), parsed.data.days, now()));
    return reply.send(AdminAnalyticsResponseSchema.parse(response));
  });

  app.get("/admin/analytics/export", async (request, reply) => {
    assertSafeOrigin(request, config);
    await options.staffGuard.require(request);
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => getAdminAnalytics(getRepository(), parsed.data.days, now()));
    const exportResponse = buildAdminAnalyticsExport(response);
    const validated = AdminAnalyticsExportResponseSchema.parse(exportResponse);
    return reply.send(validated);
  });
}
