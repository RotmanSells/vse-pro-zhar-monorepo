import type {
  CatalogRepository,
  CustomerRepository,
  LoyaltyRepository
} from "@vse-pro-zhar/database";
import {
  CheckoutOptionsResponseSchema,
  CheckoutQuoteRequestSchema,
  CheckoutQuoteResponseSchema
} from "@vse-pro-zhar/contracts";
import type { FastifyInstance } from "fastify";

import {
  assertSafeOrigin,
  readSession
} from "../auth/route.js";
import { CustomerAuthService } from "../auth/service.js";
import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";
import {
  createFailClosedAvailabilityProvider,
  type OperationalAvailabilityProvider
} from "./availability.js";
import {
  CheckoutAuthenticationError,
  CheckoutCartUnavailableError,
  CheckoutConfigurationError,
  CheckoutDependencyError,
  CheckoutOperationalUnavailableError,
  CheckoutPickupUnavailableError,
  CheckoutRewardUnavailableError,
  CheckoutValidationError
} from "./errors.js";
import {
  DEFAULT_PICKUP_CONFIGURATION,
  type PickupConfiguration
} from "./pickup.js";
import { CheckoutService } from "./service.js";

export interface CheckoutRouteOptions {
  readonly catalogRepository: CatalogRepository;
  readonly customerRepository?: CustomerRepository;
  readonly availabilityProvider?: OperationalAvailabilityProvider;
  readonly pickupConfiguration?: PickupConfiguration;
  readonly now?: () => Date;
  readonly loyaltyRepository?: LoyaltyRepository;
}

function mapCheckoutError(error: unknown): never {
  if (error instanceof CheckoutValidationError) {
    throw new ApiRequestError("VALIDATION_ERROR", 400);
  }
  if (error instanceof CheckoutAuthenticationError) {
    throw new ApiRequestError("AUTHENTICATION_ERROR", 401);
  }
  if (error instanceof CheckoutCartUnavailableError) {
    throw new ApiRequestError("CART_ITEM_UNAVAILABLE", 409);
  }
  if (error instanceof CheckoutPickupUnavailableError) {
    throw new ApiRequestError("PICKUP_OPTION_UNAVAILABLE", 409);
  }
  if (error instanceof CheckoutOperationalUnavailableError) {
    throw new ApiRequestError("CHECKOUT_UNAVAILABLE", 409);
  }
  if (error instanceof CheckoutRewardUnavailableError) {
    throw new ApiRequestError("LOYALTY_INVALID_TRANSITION", 409);
  }
  if (error instanceof CheckoutConfigurationError || error instanceof CheckoutDependencyError) {
    throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
  }
  throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
}

async function runCheckoutOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    mapCheckoutError(error);
  }
}

export function registerCheckoutRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  routeOptions: CheckoutRouteOptions
): void {
  const now = routeOptions.now ?? (() => new Date());
  const authService =
    routeOptions.customerRepository === undefined
      ? null
      : new CustomerAuthService(routeOptions.customerRepository, config, now);
  const service =
    authService === null
      ? null
      : new CheckoutService({
          catalogRepository: routeOptions.catalogRepository,
          authService,
          availabilityProvider:
            routeOptions.availabilityProvider ?? createFailClosedAvailabilityProvider(),
          pickupConfiguration:
            routeOptions.pickupConfiguration ?? DEFAULT_PICKUP_CONFIGURATION,
          now,
          ...(routeOptions.loyaltyRepository === undefined ? {} : { loyaltyRepository: routeOptions.loyaltyRepository })
        });

  const getService = (): CheckoutService => {
    if (service === null) {
      throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    }
    return service;
  };

  app.get("/checkout/options", async (request, reply) => {
    const { token } = readSession(request);
    const response = await runCheckoutOperation(() => getService().getOptions(token));
    return reply.send(CheckoutOptionsResponseSchema.parse(response));
  });

  app.post("/checkout/quote", async (request, reply) => {
    assertSafeOrigin(request, config);
    const parsed = CheckoutQuoteRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiRequestError("VALIDATION_ERROR", 400);
    }

    const { token } = readSession(request);
    const response = await runCheckoutOperation(() =>
      getService().quote(token, parsed.data)
    );
    return reply.send(CheckoutQuoteResponseSchema.parse(response));
  });
}
