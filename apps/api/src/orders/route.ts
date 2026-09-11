import {
  OrderCatalogChangedError,
  OrderIdempotencyConflictError,
  type CatalogRepository,
  type CustomerRepository,
  type IikoDispatchRepository,
  type OrderRepository,
  type PaymentRepository,
  type CancellationRefundRepository,
  type LoyaltyRepository
} from "@vse-pro-zhar/database";
import {
  CreatedOrderResponseSchema,
  IdempotencyKeySchema,
  OrderResponseSchema,
  OrdersListResponseSchema
} from "@vse-pro-zhar/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { assertSafeOrigin, readSession } from "../auth/route.js";
import { CustomerAuthService } from "../auth/service.js";
import type { ApiConfig } from "../config/env.js";
import { CheckoutService } from "../checkout/service.js";
import {
  CheckoutCartUnavailableError,
  CheckoutConfigurationError,
  CheckoutDependencyError,
  CheckoutOperationalUnavailableError,
  CheckoutPickupUnavailableError,
  CheckoutValidationError
} from "../checkout/errors.js";
import type { OperationalAvailabilityProvider } from "../checkout/availability.js";
import { createFailClosedAvailabilityProvider } from "../checkout/availability.js";
import { DEFAULT_PICKUP_CONFIGURATION, type PickupConfiguration } from "../checkout/pickup.js";
import { ApiRequestError } from "../http/errors.js";
import {
  OrderAuthenticationError,
  OrderDependencyError,
  OrderNotFoundError,
  OrderValidationError
} from "./errors.js";
import { OrderService } from "./service.js";

export interface OrderRouteOptions {
  readonly catalogRepository: CatalogRepository;
  readonly customerRepository?: CustomerRepository;
  readonly orderRepository?: OrderRepository;
  readonly paymentRepository?: PaymentRepository;
  readonly fulfillmentRepository?: IikoDispatchRepository;
  readonly cancellationRefundRepository?: CancellationRefundRepository;
  readonly availabilityProvider?: OperationalAvailabilityProvider;
  readonly pickupConfiguration?: PickupConfiguration;
  readonly now?: () => Date;
  readonly loyaltyRepository?: LoyaltyRepository;
}

function readIdempotencyKey(request: FastifyRequest): string {
  const raw = request.headers["idempotency-key"];
  const value = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
  const parsed = IdempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiRequestError("VALIDATION_ERROR", 400);
  }
  return parsed.data;
}

function mapOrderError(error: unknown): never {
  if (error instanceof OrderValidationError || error instanceof CheckoutValidationError) {
    throw new ApiRequestError("VALIDATION_ERROR", 400);
  }
  if (error instanceof OrderAuthenticationError) {
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
  if (error instanceof OrderIdempotencyConflictError) {
    throw new ApiRequestError("IDEMPOTENCY_CONFLICT", 409);
  }
  if (error instanceof OrderCatalogChangedError) {
    throw new ApiRequestError("CHECKOUT_STALE", 409);
  }
  if (error instanceof OrderNotFoundError) {
    throw new ApiRequestError("NOT_FOUND", 404);
  }
  if (error instanceof CheckoutConfigurationError || error instanceof CheckoutDependencyError) {
    throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
  }
  if (error instanceof OrderDependencyError) {
    throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
  }
  throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
}

async function runOrderOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    mapOrderError(error);
  }
}

const OrderParamsSchema = z.object({ id: z.coerce.number().int().positive() }).strict();

export function registerOrderRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  routeOptions: OrderRouteOptions
): OrderService | null {
  const now = routeOptions.now ?? (() => new Date());
  const authService =
    routeOptions.customerRepository === undefined
      ? null
      : new CustomerAuthService(routeOptions.customerRepository, config, now);
  const orderService =
    authService === null || routeOptions.orderRepository === undefined
      ? null
      : new OrderService({
          orderRepository: routeOptions.orderRepository,
          authService,
          checkoutService: new CheckoutService({
            catalogRepository: routeOptions.catalogRepository,
            authService,
            availabilityProvider:
              routeOptions.availabilityProvider ?? createFailClosedAvailabilityProvider(),
            pickupConfiguration:
              routeOptions.pickupConfiguration ?? DEFAULT_PICKUP_CONFIGURATION,
            ...(routeOptions.loyaltyRepository === undefined ? {} : { loyaltyRepository: routeOptions.loyaltyRepository }),
            now
          }),
          ...(routeOptions.paymentRepository === undefined
            ? {}
            : { paymentRepository: routeOptions.paymentRepository }),
          ...(routeOptions.fulfillmentRepository === undefined
            ? {}
            : { fulfillmentRepository: routeOptions.fulfillmentRepository }),
          ...(routeOptions.cancellationRefundRepository === undefined
            ? {}
            : { cancellationRefundRepository: routeOptions.cancellationRefundRepository }),
          now
        });

  const getService = (): OrderService => {
    if (orderService === null) {
      throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    }
    return orderService;
  };

  app.post("/orders", async (request, reply) => {
    assertSafeOrigin(request, config);
    const idempotencyKey = readIdempotencyKey(request);
    const { token } = readSession(request);
    const response = await runOrderOperation(() =>
      getService().create(token, request.body, idempotencyKey)
    );
    return reply.code(201).send(CreatedOrderResponseSchema.parse(response));
  });

  app.get("/orders", async (request, reply) => {
    const { token } = readSession(request);
    const response = await runOrderOperation(() => getService().list(token));
    return reply.send(OrdersListResponseSchema.parse(response));
  });

  app.get("/orders/:id", async (request, reply) => {
    const parsedParams = OrderParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      throw new ApiRequestError("NOT_FOUND", 404);
    }
    const { token } = readSession(request);
    const response = await runOrderOperation(() =>
      getService().get(token, parsedParams.data.id)
    );
    return reply.send(OrderResponseSchema.parse(response));
  });

  return orderService;
}
