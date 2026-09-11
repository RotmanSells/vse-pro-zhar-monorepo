import {
  createAdminAuthClient as createSharedAdminAuthClient,
  type AdminAuthClient,
  type AdminAuthClientOptions as SharedOptions
} from "@vse-pro-zhar/api-client";

const DEFAULT_API_URL = "http://127.0.0.1:3000";

export type { AdminAuthRequestOptions } from "@vse-pro-zhar/api-client";
export { AdminAuthClientError } from "@vse-pro-zhar/api-client";
export type AdminClient = AdminAuthClient;

export interface AdminAuthClientOptions extends Omit<SharedOptions, "apiUrl"> {
  readonly apiUrl?: string;
}

export function createAdminAuthClient(options: AdminAuthClientOptions = {}): AdminAuthClient {
  return createSharedAdminAuthClient({
    ...options,
    apiUrl: options.apiUrl ?? (import.meta.env.VITE_API_URL ?? DEFAULT_API_URL)
  });
}
