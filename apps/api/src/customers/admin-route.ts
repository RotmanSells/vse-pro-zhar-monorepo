import { AdminCustomersQuerySchema, AdminCustomersResponseSchema } from "@vse-pro-zhar/contracts";
import type { AdminCustomerRepository } from "@vse-pro-zhar/database";
import type { FastifyInstance } from "fastify";

import { assertSafeOrigin } from "../auth/route.js";
import type { StaffGuard } from "../auth/staff-route.js";
import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";
import { getAdminCustomers } from "./admin-service.js";

export interface AdminCustomerRouteOptions {
  readonly repository?: AdminCustomerRepository;
  readonly staffGuard: StaffGuard;
  readonly config: ApiConfig;
}

export function registerAdminCustomerRoutes(
  app: FastifyInstance,
  options: AdminCustomerRouteOptions
): void {
  app.get("/admin/customers", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    await options.staffGuard.require(request);
    const parsed = AdminCustomersQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    if (options.repository === undefined) throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    try {
      const response = await getAdminCustomers(options.repository, parsed.data);
      return reply.send(AdminCustomersResponseSchema.parse(response));
    } catch {
      throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    }
  });
}
