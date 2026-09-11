import {
  createAuthClient as createSharedAuthClient,
  type AuthClient as SharedAuthClient,
  type AuthClientOptions as SharedAuthClientOptions,
  type AuthSessionTransport
} from "@vse-pro-zhar/api-client";

import { createPlatformAuthTransport } from "../auth/storage";
import { createTracedFetch } from "../debug/logger";

// Web auth cookies must use the same host as the Customer Web origin family.
const DEFAULT_API_URL = "http://localhost:3000";

export type {
  AuthClientErrorKind,
  AuthRequestOptions,
  AuthSessionTransport
} from "@vse-pro-zhar/api-client";
export { AuthClientError } from "@vse-pro-zhar/api-client";

export type AuthClient = SharedAuthClient;

export interface AuthClientOptions
  extends Omit<SharedAuthClientOptions, "apiUrl" | "transport"> {
  readonly apiUrl?: string;
  readonly transport?: AuthSessionTransport;
}

function getConfiguredApiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;
}

export function createAuthClient(options: AuthClientOptions = {}): SharedAuthClient {
  const { apiUrl, transport, ...clientOptions } = options;
  return createSharedAuthClient({
    ...clientOptions,
    fetchImpl: createTracedFetch("auth", clientOptions.fetchImpl),
    apiUrl: apiUrl ?? getConfiguredApiUrl(),
    transport: transport ?? createPlatformAuthTransport()
  });
}
