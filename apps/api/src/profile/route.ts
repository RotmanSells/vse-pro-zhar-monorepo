import type { CustomerNotificationRepository, CustomerProfileRepository, CustomerRepository } from "@vse-pro-zhar/database";
import { CustomerProfileResponseSchema } from "@vse-pro-zhar/contracts";
import type { FastifyInstance } from "fastify";

import { readSession } from "../auth/route.js";
import { CustomerAuthService } from "../auth/service.js";
import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";
import type { LoyaltyService } from "../loyalty/service.js";
import {
  ProfileAuthenticationError,
  ProfileDependencyError,
  ProfileService
} from "./service.js";

export interface ProfileRouteOptions {
  readonly repository?: CustomerProfileRepository;
  readonly customerRepository?: CustomerRepository;
  readonly loyaltyService?: LoyaltyService | null;
  readonly now?: () => Date;
  readonly notificationRepository?: CustomerNotificationRepository;
}

function mapProfileError(error: unknown): never {
  if (error instanceof ProfileAuthenticationError) {
    throw new ApiRequestError("AUTHENTICATION_ERROR", 401);
  }
  if (error instanceof ProfileDependencyError) {
    throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
  }
  throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
}

async function runProfileOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    mapProfileError(error);
  }
}

export function registerProfileRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  options: ProfileRouteOptions
): ProfileService | null {
  const service = options.repository === undefined || options.customerRepository === undefined
    ? null
    : new ProfileService({
        repository: options.repository,
        authService: new CustomerAuthService(options.customerRepository, config, options.now),
        ...(options.loyaltyService == null ? {} : { loyaltyService: options.loyaltyService }),
        ...(options.notificationRepository === undefined ? {} : { notificationRepository: options.notificationRepository }),
        ...(options.now === undefined ? {} : { now: options.now })
      });

  app.get("/profile", async (request, reply) => {
    const { token } = readSession(request);
    if (service === null) throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    const response = await runProfileOperation(() => service.get(token));
    return reply.send(CustomerProfileResponseSchema.parse(response));
  });

  return service;
}
