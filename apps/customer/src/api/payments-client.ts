import {
  createPaymentClient as createSharedPaymentClient,
  type PaymentClient as SharedPaymentClient,
  type PaymentClientOptions as SharedPaymentClientOptions
} from "@vse-pro-zhar/api-client";

import { createPlatformAuthTransport } from "../auth/storage";
import { createTracedFetch } from "../debug/logger";

const DEFAULT_API_URL = "http://localhost:3000";

export type {
  CreatePaymentRequestOptions,
  PaymentClientErrorKind,
  PaymentRequestOptions
} from "@vse-pro-zhar/api-client";
export {
  PaymentClientError
} from "@vse-pro-zhar/api-client";
export type PaymentClient = SharedPaymentClient;

export interface PaymentClientOptions
  extends Omit<SharedPaymentClientOptions, "apiUrl" | "transport"> {
  readonly apiUrl?: string;
  readonly transport?: SharedPaymentClientOptions["transport"];
}

function getConfiguredApiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;
}

export function createPaymentClient(
  options: PaymentClientOptions = {}
): SharedPaymentClient {
  const { apiUrl, transport, ...clientOptions } = options;
  return createSharedPaymentClient({
    ...clientOptions,
    fetchImpl: createTracedFetch("payments", clientOptions.fetchImpl),
    apiUrl: apiUrl ?? getConfiguredApiUrl(),
    transport: transport ?? createPlatformAuthTransport()
  });
}
