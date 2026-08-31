import {
  createCatalogClient as createSharedCatalogClient,
  type CatalogAdminClient,
  type CatalogClientOptions as SharedCatalogClientOptions
} from "@vse-pro-zhar/api-client";

const DEFAULT_API_URL = "http://127.0.0.1:3000";

export type {
  CatalogClientErrorKind,
  CatalogRequestOptions
} from "@vse-pro-zhar/api-client";
export { CatalogClientError } from "@vse-pro-zhar/api-client";
export type CatalogClient = CatalogAdminClient;

export interface CatalogClientOptions
  extends Omit<SharedCatalogClientOptions, "apiUrl"> {
  readonly apiUrl?: string;
}

function getConfiguredApiUrl(): string {
  return import.meta.env.VITE_API_URL ?? DEFAULT_API_URL;
}

export function createCatalogClient(
  options: CatalogClientOptions = {}
): CatalogAdminClient {
  const { apiUrl, ...clientOptions } = options;

  return createSharedCatalogClient({
    ...clientOptions,
    apiUrl: apiUrl ?? getConfiguredApiUrl()
  });
}
