import {
  NotificationDeviceIdempotencyConflictError,
  notificationPayloadFingerprint,
  type CustomerNotificationRepository,
  type CustomerRepository
} from "@vse-pro-zhar/database";
import {
  CustomerNotificationDeviceListResponseSchema,
  CustomerNotificationDeviceRegisterRequestSchema,
  CustomerNotificationDeviceResponseSchema,
  CustomerNotificationDeviceRevokeResponseSchema,
  CustomerNotificationPreferencesResponseSchema,
  CustomerNotificationPreferencesUpdateRequestSchema
} from "@vse-pro-zhar/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { assertSafeOrigin, readSession } from "../auth/route.js";
import { CustomerAuthService, CustomerSessionError } from "../auth/service.js";
import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";

const DeviceParamsSchema = z.object({ id: z.coerce.number().int().positive() }).strict();

export interface NotificationRouteOptions {
  readonly config: ApiConfig;
  readonly customerRepository?: CustomerRepository;
  readonly repository?: CustomerNotificationRepository;
  readonly now?: () => Date;
}

function requireRepository(options: NotificationRouteOptions): CustomerNotificationRepository {
  if (options.repository === undefined) throw new ApiRequestError("NOTIFICATION_UNAVAILABLE", 503);
  return options.repository;
}

async function requireCustomer(options: NotificationRouteOptions, request: FastifyRequest) {
  if (options.customerRepository === undefined) throw new ApiRequestError("NOTIFICATION_UNAVAILABLE", 503);
  const { token } = readSession(request);
  try {
    return await new CustomerAuthService(options.customerRepository, options.config, options.now).getActiveSession(token);
  } catch (error: unknown) {
    if (error instanceof CustomerSessionError) throw new ApiRequestError("AUTHENTICATION_ERROR", 401);
    throw new ApiRequestError("NOTIFICATION_UNAVAILABLE", 503);
  }
}

export function registerNotificationRoutes(app: FastifyInstance, options: NotificationRouteOptions): void {
  const now = options.now ?? (() => new Date());

  app.post("/notifications/devices", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    const customer = await requireCustomer(options, request);
    const input = CustomerNotificationDeviceRegisterRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    try {
      const result = await requireRepository(options).registerDevice({
        customerId: customer.customer.id,
        ...input.data,
        payloadFingerprint: notificationPayloadFingerprint(input.data),
        now: now()
      });
      return reply.code(result.created ? 201 : 200).send(CustomerNotificationDeviceResponseSchema.parse({
        status: "confirmed",
        device: {
          id: result.device.id,
          provider: result.device.provider,
          platform: result.device.platform,
          token: result.device.token,
          enabled: result.device.enabled,
          lastSeenAt: result.device.lastSeenAt.toISOString()
        }
      }));
    } catch (error: unknown) {
      if (error instanceof NotificationDeviceIdempotencyConflictError) {
        throw new ApiRequestError("NOTIFICATION_DEVICE_CONFLICT", 409);
      }
      throw new ApiRequestError("NOTIFICATION_UNAVAILABLE", 503);
    }
  });

  app.get("/notifications/devices", async (request, reply) => {
    const customer = await requireCustomer(options, request);
    const devices = await requireRepository(options).listDevices(customer.customer.id);
    return reply.send(CustomerNotificationDeviceListResponseSchema.parse({
      status: "confirmed",
      devices: devices.map((device) => ({ id: device.id, provider: device.provider, platform: device.platform, token: device.token, enabled: device.enabled, lastSeenAt: device.lastSeenAt.toISOString() }))
    }));
  });

  app.delete("/notifications/devices/:id", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    const customer = await requireCustomer(options, request);
    const params = DeviceParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const revoked = await requireRepository(options).revokeDevice(customer.customer.id, params.data.id, now());
    return reply.send(CustomerNotificationDeviceRevokeResponseSchema.parse({ status: "confirmed", revoked }));
  });

  app.get("/notifications/preferences", async (request, reply) => {
    const customer = await requireCustomer(options, request);
    const preferences = await requireRepository(options).getPreferences(customer.customer.id, now());
    return reply.send(CustomerNotificationPreferencesResponseSchema.parse({ status: "confirmed", preferences: { pushEnabled: preferences.pushEnabled, smsEnabled: preferences.smsEnabled, updatedAt: preferences.updatedAt.toISOString() } }));
  });

  app.patch("/notifications/preferences", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    const customer = await requireCustomer(options, request);
    const input = CustomerNotificationPreferencesUpdateRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const update = { customerId: customer.customer.id, now: now(), ...(input.data.pushEnabled === undefined ? {} : { pushEnabled: input.data.pushEnabled }), ...(input.data.smsEnabled === undefined ? {} : { smsEnabled: input.data.smsEnabled }) };
    const preferences = await requireRepository(options).updatePreferences(update);
    return reply.send(CustomerNotificationPreferencesResponseSchema.parse({ status: "confirmed", preferences: { pushEnabled: preferences.pushEnabled, smsEnabled: preferences.smsEnabled, updatedAt: preferences.updatedAt.toISOString() } }));
  });
}
