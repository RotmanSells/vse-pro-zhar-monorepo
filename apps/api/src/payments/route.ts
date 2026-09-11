import {
  PaymentIdempotencyConflictError,
  type CatalogRepository,
  type CustomerRepository,
  type OrderRepository,
  type PaymentRepository
} from "@vse-pro-zhar/database";
import type { CancellationRefundRepository } from "@vse-pro-zhar/database";
import {
  IdempotencyKeySchema,
  PaymentCreateResponseSchema,
  PaymentStateResponseSchema,
  PaymentWebhookResponseSchema,
  YooKassaWebhookPayloadSchema
} from "@vse-pro-zhar/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { assertSafeOrigin, readSession } from "../auth/route.js";
import { CustomerAuthService } from "../auth/service.js";
import {
  createFailClosedAvailabilityProvider,
  type OperationalAvailabilityProvider
} from "../checkout/availability.js";
import {
  DEFAULT_PICKUP_CONFIGURATION,
  type PickupConfiguration
} from "../checkout/pickup.js";
import { CheckoutService } from "../checkout/service.js";
import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";
import {
  PaymentAuthenticationError,
  PaymentInvalidError,
  PaymentNotAllowedError,
  PaymentNotFoundError,
  PaymentUnavailableError,
  PaymentValidationError
} from "./errors.js";
import { PaymentService } from "./service.js";
import { createUnavailablePaymentProvider, type PaymentProvider } from "./provider.js";

export interface PaymentRouteOptions {
  readonly catalogRepository?: CatalogRepository;
  readonly customerRepository?: CustomerRepository;
  readonly orderRepository?: OrderRepository;
  readonly paymentRepository?: PaymentRepository;
  readonly paymentProvider?: PaymentProvider;
  readonly availabilityProvider?: OperationalAvailabilityProvider;
  readonly pickupConfiguration?: PickupConfiguration;
  readonly now?: () => Date;
  readonly cancellationRefundRepository?: CancellationRefundRepository;
  readonly refundWebhookHandler?: (input: unknown) => Promise<"processed" | "duplicate" | "ignored">;
}

const PaymentParamsSchema = z.object({ id: z.coerce.number().int().positive() }).strict();

function readIdempotencyKey(request: FastifyRequest): string {
  const raw = request.headers["idempotency-key"];
  const value = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
  const parsed = IdempotencyKeySchema.safeParse(value);
  if (!parsed.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
  return parsed.data;
}

function mapPaymentError(error: unknown): never {
  if (error instanceof PaymentValidationError) {
    throw new ApiRequestError("VALIDATION_ERROR", 400);
  }
  if (error instanceof PaymentAuthenticationError) {
    throw new ApiRequestError("AUTHENTICATION_ERROR", 401);
  }
  if (error instanceof PaymentNotFoundError) {
    throw new ApiRequestError("NOT_FOUND", 404);
  }
  if (error instanceof PaymentNotAllowedError) {
    throw new ApiRequestError("PAYMENT_NOT_ALLOWED", 409);
  }
  if (error instanceof PaymentIdempotencyConflictError) {
    throw new ApiRequestError("IDEMPOTENCY_CONFLICT", 409);
  }
  if (error instanceof PaymentInvalidError) {
    throw new ApiRequestError("PAYMENT_INVALID", 409);
  }
  if (error instanceof PaymentUnavailableError) {
    throw new ApiRequestError(
      "PAYMENT_UNAVAILABLE",
      503,
      "PAYMENT_UNAVAILABLE",
      error.providerDetails === null ? null : { provider: error.providerDetails }
    );
  }
  throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
}

async function runPaymentOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    mapPaymentError(error);
  }
}

export function registerPaymentRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  routeOptions: PaymentRouteOptions
): void {
  const now = routeOptions.now ?? (() => new Date());
  const authService =
    routeOptions.customerRepository === undefined
      ? null
      : new CustomerAuthService(routeOptions.customerRepository, config, now);
  const service =
    authService === null ||
    routeOptions.catalogRepository === undefined ||
    routeOptions.orderRepository === undefined ||
    routeOptions.paymentRepository === undefined
      ? null
      : new PaymentService({
          authService,
          checkoutService: new CheckoutService({
            catalogRepository: routeOptions.catalogRepository,
            authService,
            availabilityProvider:
              routeOptions.availabilityProvider ?? createFailClosedAvailabilityProvider(),
            pickupConfiguration:
              routeOptions.pickupConfiguration ?? DEFAULT_PICKUP_CONFIGURATION,
            now
          }),
          orderRepository: routeOptions.orderRepository,
          paymentRepository: routeOptions.paymentRepository,
          ...(routeOptions.cancellationRefundRepository === undefined
            ? {}
            : { cancellationRefundRepository: routeOptions.cancellationRefundRepository }),
          provider: routeOptions.paymentProvider ?? createUnavailablePaymentProvider(),
          now
        });

  const getService = (): PaymentService => {
    if (service === null) throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    return service;
  };

  app.post("/orders/:id/payments", async (request, reply) => {
    assertSafeOrigin(request, config);
    const params = PaymentParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiRequestError("NOT_FOUND", 404);
    const idempotencyKey = readIdempotencyKey(request);
    const { token } = readSession(request);
    const response = await runPaymentOperation(() =>
      getService().create(token, params.data.id, request.body, idempotencyKey)
    );
    return reply.code(201).send(PaymentCreateResponseSchema.parse(response));
  });

  app.get("/orders/:id/payment", async (request, reply) => {
    const params = PaymentParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiRequestError("NOT_FOUND", 404);
    const { token } = readSession(request);
    const response = await runPaymentOperation(() =>
      getService().get(token, params.data.id)
    );
    return reply.send(PaymentStateResponseSchema.parse(response));
  });

  app.post("/webhooks/yookassa", async (request, reply) => {
    const webhook = YooKassaWebhookPayloadSchema.safeParse(request.body);
    const refundWebhookHandler = routeOptions.refundWebhookHandler;
    if (webhook.success && webhook.data.event === "refund.succeeded" && refundWebhookHandler !== undefined) {
      await runPaymentOperation(() => refundWebhookHandler(request.body));
      return reply.send(PaymentWebhookResponseSchema.parse({ received: true }));
    }
    const result = await runPaymentOperation(() => getService().handleWebhook(request.body));
    void result;
    return reply.send(PaymentWebhookResponseSchema.parse({ received: true }));
  });
}
