import {
  createAdminPromosClient as createSharedAdminPromosClient,
  type AdminPromosClient,
  type AdminPromosClientOptions as SharedOptions
} from "@vse-pro-zhar/api-client";

const DEFAULT_API_URL = "http://127.0.0.1:3000";

export type { AdminPromoCreateRequest, AdminPromoUpdateRequest, AdminPromoRedemptionsQueryInput, AdminPromosQueryInput } from "@vse-pro-zhar/contracts";
export type { AdminPromosRequestOptions } from "@vse-pro-zhar/api-client";
export { AdminPromosClientError } from "@vse-pro-zhar/api-client";

export interface AdminPromosClientOptions extends Omit<SharedOptions, "apiUrl"> { readonly apiUrl?: string }

export function createAdminPromosClient(options: AdminPromosClientOptions = {}): AdminPromosClient {
  return createSharedAdminPromosClient({
    ...options,
    apiUrl: options.apiUrl ?? (import.meta.env.VITE_API_URL ?? DEFAULT_API_URL)
  });
}
