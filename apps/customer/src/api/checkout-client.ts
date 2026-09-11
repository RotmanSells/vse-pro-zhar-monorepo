import {
  createCheckoutClient as createSharedCheckoutClient,
  type AuthSessionTransport,
  type CheckoutClient as SharedCheckoutClient,
  type CheckoutClientOptions as SharedCheckoutClientOptions
} from "@vse-pro-zhar/api-client";

import { createPlatformAuthTransport } from "../auth/storage";

// Web checkout must share the API host with the auth cookie.
const DEFAULT_API_URL = "http://localhost:3000";

export type {
  CheckoutClientErrorKind,
  CheckoutRequestOptions
} from "@vse-pro-zhar/api-client";
export { CheckoutClientError } from "@vse-pro-zhar/api-client";
export type CheckoutClient = SharedCheckoutClient;

export interface CheckoutClientOptions
  extends Omit<SharedCheckoutClientOptions, "apiUrl" | "transport"> {
  readonly apiUrl?: string;
  readonly transport?: AuthSessionTransport;
}

function getConfiguredApiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;
}

export function createCheckoutClient(
  options: CheckoutClientOptions = {}
): SharedCheckoutClient {
  const { apiUrl, transport, ...clientOptions } = options;
  return createSharedCheckoutClient({
    ...clientOptions,
    apiUrl: apiUrl ?? getConfiguredApiUrl(),
    transport: transport ?? createPlatformAuthTransport()
  });
}
