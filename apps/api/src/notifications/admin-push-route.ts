import {
  AdminPushSendRequestSchema,
  AdminPushSendResponseSchema,
  IdempotencyKeySchema
} from "@vse-pro-zhar/contracts";
import type {
  CustomerPushRepository
} from "@vse-pro-zhar/database";
import { NotificationPushIdempotencyConflictError } from "@vse-pro-zhar/database";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { assertSafeOrigin } from "../auth/route.js";
import type { StaffGuard } from "../auth/staff-route.js";
import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";
import {
  PushCustomerNotFoundError,
  PushDeviceNotFoundError,
  PushDisabledError,
  sendAdminPush
} from "./push-service.js";
import {
  ExpoPushProviderError,
  type ExpoPushProvider
} from "./expo-provider.js";

export interface AdminPushRouteOptions {
  readonly config: ApiConfig;
  readonly staffGuard: StaffGuard;
  readonly repository?: CustomerPushRepository;
  readonly provider?: ExpoPushProvider;
  readonly now?: () => Date;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readIdempotencyKey(request: FastifyRequest): string {
  const parsed = IdempotencyKeySchema.safeParse(headerValue(request.headers["idempotency-key"]));
  if (!parsed.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
  return parsed.data;
}

function mapPushError(error: unknown): never {
  if (error instanceof PushCustomerNotFoundError) throw new ApiRequestError("NOT_FOUND", 404);
  if (error instanceof PushDisabledError) throw new ApiRequestError("NOTIFICATION_PUSH_DISABLED", 409);
  if (error instanceof PushDeviceNotFoundError) throw new ApiRequestError("NOTIFICATION_PUSH_NO_DEVICE", 409);
  if (error instanceof NotificationPushIdempotencyConflictError || (error instanceof Error && error.name === "NotificationPushIdempotencyConflictError")) {
    throw new ApiRequestError("NOTIFICATION_PUSH_CONFLICT", 409);
  }
  if (error instanceof ExpoPushProviderError) {
    throw new ApiRequestError("NOTIFICATION_UNAVAILABLE", 503);
  }
  throw new ApiRequestError("NOTIFICATION_UNAVAILABLE", 503);
}

export function registerAdminPushRoutes(app: FastifyInstance, options: AdminPushRouteOptions): void {
  app.post("/admin/notifications/push", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    const staff = await options.staffGuard.require(request);
    void staff;
    const input = AdminPushSendRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    if (options.repository === undefined || options.provider === undefined) {
      throw new ApiRequestError("NOTIFICATION_UNAVAILABLE", 503);
    }
    try {
      const response = await sendAdminPush(options.repository, options.provider, {
        ...input.data,
        requestKey: readIdempotencyKey(request),
        now: options.now?.() ?? new Date()
      });
      return reply.code(202).send(AdminPushSendResponseSchema.parse(response));
    } catch (error: unknown) {
      mapPushError(error);
    }
  });
}
