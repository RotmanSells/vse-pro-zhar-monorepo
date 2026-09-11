import {
  createCancellationClient as createSharedCancellationClient,
  type CancellationClient,
  type CancellationClientOptions as SharedOptions
} from "@vse-pro-zhar/api-client";

import { createPlatformAuthTransport } from "../auth/storage";

const DEFAULT_API_URL = "http://localhost:3000";

export type { CancellationClient } from "@vse-pro-zhar/api-client";
export { CancellationClientError } from "@vse-pro-zhar/api-client";

export interface CancellationClientOptions extends Omit<SharedOptions, "apiUrl" | "transport"> {
  readonly apiUrl?: string;
  readonly transport?: SharedOptions["transport"];
}

export function createCancellationClient(options: CancellationClientOptions = {}): CancellationClient {
  return createSharedCancellationClient({
    ...options,
    apiUrl: options.apiUrl ?? (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL),
    transport: options.transport ?? createPlatformAuthTransport()
  });
}
