import {
  createAdminOrdersClient as createSharedAdminOrdersClient,
  type AdminOrdersClient,
  type AdminOrdersClientOptions as SharedOptions
} from "@vse-pro-zhar/api-client";

const DEFAULT_API_URL = "http://127.0.0.1:3000";

export type {
  AdminOrdersQuery,
  AdminOrdersRequestOptions
} from "@vse-pro-zhar/api-client";
export { AdminOrdersClientError } from "@vse-pro-zhar/api-client";
export type AdminClient = AdminOrdersClient;

export interface AdminOrdersClientOptions extends Omit<SharedOptions, "apiUrl"> {
  readonly apiUrl?: string;
}

export function createAdminOrdersClient(options: AdminOrdersClientOptions = {}): AdminOrdersClient {
  return createSharedAdminOrdersClient({
    ...options,
    apiUrl: options.apiUrl ?? (import.meta.env.VITE_API_URL ?? DEFAULT_API_URL)
  });
}
