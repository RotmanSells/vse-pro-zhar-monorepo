import {
  createAdminPushClient as createSharedAdminPushClient,
  type AdminPushClient,
  type AdminPushClientOptions as SharedOptions
} from "@vse-pro-zhar/api-client";

export type { AdminPushSendRequest, AdminPushSendResponse } from "@vse-pro-zhar/contracts";
export type { AdminPushRequestOptions } from "@vse-pro-zhar/api-client";
export { AdminPushClientError } from "@vse-pro-zhar/api-client";

export interface AdminPushClientOptions extends Omit<SharedOptions, "apiUrl"> {
  readonly apiUrl?: string;
}

const DEFAULT_API_URL = "http://127.0.0.1:3000";

export function createAdminPushClient(options: AdminPushClientOptions = {}): AdminPushClient {
  return createSharedAdminPushClient({
    ...options,
    apiUrl: options.apiUrl ?? (import.meta.env.VITE_API_URL ?? DEFAULT_API_URL)
  });
}
