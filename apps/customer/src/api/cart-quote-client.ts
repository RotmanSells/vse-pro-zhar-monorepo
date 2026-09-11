import {
  createCartQuoteClient as createSharedCartQuoteClient,
  type CartQuoteClient,
  type CartQuoteClientOptions as SharedCartQuoteClientOptions
} from "@vse-pro-zhar/api-client";

const DEFAULT_API_URL = "http://localhost:3000";

export type {
  CartQuoteClientErrorKind,
  CartQuoteRequestOptions
} from "@vse-pro-zhar/api-client";
export { CartQuoteClientError } from "@vse-pro-zhar/api-client";
export type { CartQuoteClient };

export interface CartQuoteClientOptions
  extends Omit<SharedCartQuoteClientOptions, "apiUrl"> {
  readonly apiUrl?: string;
}

function getConfiguredApiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;
}

export function createCartQuoteClient(
  options: CartQuoteClientOptions = {}
): CartQuoteClient {
  const { apiUrl, ...clientOptions } = options;

  return createSharedCartQuoteClient({
    ...clientOptions,
    apiUrl: apiUrl ?? getConfiguredApiUrl()
  });
}
