import {
  createOrderClient as createSharedOrderClient,
  type AuthSessionTransport,
  type OrderClient as SharedOrderClient,
  type OrderClientOptions as SharedOrderClientOptions
} from "@vse-pro-zhar/api-client";

import { createPlatformAuthTransport } from "../auth/storage";
import { createTracedFetch } from "../debug/logger";

const DEFAULT_API_URL = "http://localhost:3000";

export type {
  CreateOrderRequestOptions,
  OrderClientErrorKind,
  OrderRequestOptions
} from "@vse-pro-zhar/api-client";
export { OrderClientError } from "@vse-pro-zhar/api-client";
export type { OrderClient } from "@vse-pro-zhar/api-client";

export interface OrderClientOptions
  extends Omit<SharedOrderClientOptions, "apiUrl" | "transport"> {
  readonly apiUrl?: string;
  readonly transport?: AuthSessionTransport;
}

function getConfiguredApiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;
}

export function createOrderClient(
  options: OrderClientOptions = {}
): SharedOrderClient {
  const { apiUrl, transport, ...clientOptions } = options;
  return createSharedOrderClient({
    ...clientOptions,
    fetchImpl: createTracedFetch("orders", clientOptions.fetchImpl),
    apiUrl: apiUrl ?? getConfiguredApiUrl(),
    transport: transport ?? createPlatformAuthTransport()
  });
}
