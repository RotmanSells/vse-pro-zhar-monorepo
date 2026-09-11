import {
  createCatalogClient as createSharedCatalogClient,
  type CatalogClientOptions as SharedCatalogClientOptions,
  type CatalogReadClient
} from "@vse-pro-zhar/api-client";
import { createTracedFetch } from "../debug/logger";

const DEFAULT_API_URL = "http://localhost:3000";

export type {
  CatalogClientErrorKind,
  CatalogReadClient,
  CatalogRequestOptions
} from "@vse-pro-zhar/api-client";
export { CatalogClientError } from "@vse-pro-zhar/api-client";
export type CatalogClient = CatalogReadClient;

export interface CatalogClientOptions
  extends Omit<SharedCatalogClientOptions, "apiUrl"> {
  readonly apiUrl?: string;
}

function getConfiguredApiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;
}

export function createCatalogClient(
  options: CatalogClientOptions = {}
): CatalogReadClient {
  const { apiUrl, ...clientOptions } = options;

  return createSharedCatalogClient({
    ...clientOptions,
    fetchImpl: createTracedFetch("catalog", clientOptions.fetchImpl),
    apiUrl: apiUrl ?? getConfiguredApiUrl()
  });
}
