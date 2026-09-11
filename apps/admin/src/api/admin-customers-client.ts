import {
  createAdminCustomersClient as createSharedAdminCustomersClient,
  type AdminCustomersClient,
  type AdminCustomersClientOptions as SharedOptions
} from "@vse-pro-zhar/api-client";

const DEFAULT_API_URL = "http://127.0.0.1:3000";

export type { AdminCustomersQueryInput } from "@vse-pro-zhar/contracts";
export type { AdminCustomersRequestOptions } from "@vse-pro-zhar/api-client";
export { AdminCustomersClientError } from "@vse-pro-zhar/api-client";

export interface AdminCustomersClientOptions extends Omit<SharedOptions, "apiUrl"> { readonly apiUrl?: string }

export function createAdminCustomersClient(options: AdminCustomersClientOptions = {}): AdminCustomersClient {
  return createSharedAdminCustomersClient({
    ...options,
    apiUrl: options.apiUrl ?? (import.meta.env.VITE_API_URL ?? DEFAULT_API_URL)
  });
}
