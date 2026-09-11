import {
  createAdminLoyaltyClient as createSharedAdminLoyaltyClient,
  type AdminLoyaltyClient,
  type AdminLoyaltyClientOptions as SharedOptions
} from "@vse-pro-zhar/api-client";

const DEFAULT_API_URL = "http://127.0.0.1:3000";

export type {
  AdminLoyaltyClientErrorKind,
  AdminLoyaltyRequestOptions
} from "@vse-pro-zhar/api-client";
export { AdminLoyaltyClientError } from "@vse-pro-zhar/api-client";
export type { AdminLoyaltyClient } from "@vse-pro-zhar/api-client";

export interface AdminLoyaltyClientOptions extends Omit<SharedOptions, "apiUrl"> {
  readonly apiUrl?: string;
}

export function createAdminLoyaltyClient(options: AdminLoyaltyClientOptions = {}): AdminLoyaltyClient {
  return createSharedAdminLoyaltyClient({
    ...options,
    apiUrl: options.apiUrl ?? (import.meta.env.VITE_API_URL ?? DEFAULT_API_URL)
  });
}
