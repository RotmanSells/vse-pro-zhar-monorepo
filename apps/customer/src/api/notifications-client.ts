import {
  createNotificationsClient as createSharedNotificationsClient,
  type NotificationsClient,
  type NotificationsClientOptions as SharedNotificationsClientOptions
} from "@vse-pro-zhar/api-client";

import { createPlatformAuthTransport } from "../auth/storage";
import { createTracedFetch } from "../debug/logger";

const DEFAULT_API_URL = "http://localhost:3000";

export type { NotificationsClient } from "@vse-pro-zhar/api-client";
export { NotificationsClientError } from "@vse-pro-zhar/api-client";

export interface NotificationsClientOptions extends Omit<SharedNotificationsClientOptions, "apiUrl" | "transport"> {
  readonly apiUrl?: string;
}

export function createNotificationsClient(options: NotificationsClientOptions = {}): NotificationsClient {
  return createSharedNotificationsClient({
    ...options,
    fetchImpl: createTracedFetch("notifications", options.fetchImpl),
    apiUrl: options.apiUrl ?? (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL),
    transport: createPlatformAuthTransport()
  });
}
