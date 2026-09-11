import {
  createLoyaltyClient as createSharedLoyaltyClient,
  type LoyaltyClient,
  type LoyaltyClientOptions as SharedOptions
} from "@vse-pro-zhar/api-client";

import { createPlatformAuthTransport } from "../auth/storage";
import { createTracedFetch } from "../debug/logger";

const DEFAULT_API_URL = "http://localhost:3000";

export type {
  LoyaltyClientErrorKind,
  LoyaltyRequestOptions
} from "@vse-pro-zhar/api-client";
export { LoyaltyClientError } from "@vse-pro-zhar/api-client";
export type { LoyaltyClient } from "@vse-pro-zhar/api-client";

export interface LoyaltyClientOptions extends Omit<SharedOptions, "apiUrl" | "transport"> {
  readonly apiUrl?: string;
}

export function createLoyaltyClient(options: LoyaltyClientOptions = {}): LoyaltyClient {
  return createSharedLoyaltyClient({
    ...options,
    fetchImpl: createTracedFetch("loyalty", options.fetchImpl),
    apiUrl: options.apiUrl ?? (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL),
    transport: createPlatformAuthTransport()
  });
}
