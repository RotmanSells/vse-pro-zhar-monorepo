import {
  createProfileClient as createSharedProfileClient,
  type ProfileClient,
  type ProfileClientOptions as SharedProfileClientOptions
} from "@vse-pro-zhar/api-client";

import { createPlatformAuthTransport } from "../auth/storage";
import { createTracedFetch } from "../debug/logger";

const DEFAULT_API_URL = "http://localhost:3000";

export type {
  ProfileClientErrorKind,
  ProfileRequestOptions
} from "@vse-pro-zhar/api-client";
export { ProfileClientError } from "@vse-pro-zhar/api-client";
export type { ProfileClient } from "@vse-pro-zhar/api-client";

export interface ProfileClientOptions extends Omit<SharedProfileClientOptions, "apiUrl" | "transport"> {
  readonly apiUrl?: string;
}

export function createProfileClient(options: ProfileClientOptions = {}): ProfileClient {
  return createSharedProfileClient({
    ...options,
    fetchImpl: createTracedFetch("profile", options.fetchImpl),
    apiUrl: options.apiUrl ?? (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL),
    transport: createPlatformAuthTransport()
  });
}
