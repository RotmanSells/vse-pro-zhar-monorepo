import {
  createHealthClient as createSharedHealthClient,
  type HealthClient as SharedHealthClient,
  type HealthClientOptions as SharedHealthClientOptions
} from "@vse-pro-zhar/api-client";

const DEFAULT_API_URL = "http://localhost:3000";

export type {
  FetchImplementation,
  HealthClientErrorKind,
  HealthRequestOptions
} from "@vse-pro-zhar/api-client";
export { HealthClientError } from "@vse-pro-zhar/api-client";
export type HealthClient = SharedHealthClient;

export interface HealthClientOptions
  extends Omit<SharedHealthClientOptions, "apiUrl"> {
  readonly apiUrl?: string;
}

function getConfiguredApiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;
}

export function createHealthClient(
  options: HealthClientOptions = {}
): HealthClient {
  const { apiUrl, ...clientOptions } = options;

  return createSharedHealthClient({
    ...clientOptions,
    apiUrl: apiUrl ?? getConfiguredApiUrl()
  });
}
