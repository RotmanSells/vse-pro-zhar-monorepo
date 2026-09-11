import {
  createAdminAnalyticsClient as createSharedAdminAnalyticsClient,
  type AdminAnalyticsClient,
  type AdminAnalyticsClientOptions as SharedOptions
} from "@vse-pro-zhar/api-client";

const DEFAULT_API_URL = "http://127.0.0.1:3000";

export type { AdminAnalyticsRequestOptions, AdminAnalyticsQuery } from "@vse-pro-zhar/api-client";
export { AdminAnalyticsClientError } from "@vse-pro-zhar/api-client";

export interface AdminAnalyticsClientOptions extends Omit<SharedOptions, "apiUrl"> {
  readonly apiUrl?: string;
}

export function createAdminAnalyticsClient(options: AdminAnalyticsClientOptions = {}): AdminAnalyticsClient {
  return createSharedAdminAnalyticsClient({
    ...options,
    apiUrl: options.apiUrl ?? (import.meta.env.VITE_API_URL ?? DEFAULT_API_URL)
  });
}
