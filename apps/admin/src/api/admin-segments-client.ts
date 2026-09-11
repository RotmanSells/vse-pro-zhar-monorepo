import {
  createAdminSegmentsClient as createSharedAdminSegmentsClient,
  type AdminSegmentsClient,
  type AdminSegmentsClientOptions as SharedOptions
} from "@vse-pro-zhar/api-client";

const DEFAULT_API_URL = "http://127.0.0.1:3000";

export type { AdminSegmentCode, AdminSegmentPreviewQueryInput } from "@vse-pro-zhar/contracts";
export type { AdminSegmentsRequestOptions } from "@vse-pro-zhar/api-client";
export { AdminSegmentsClientError } from "@vse-pro-zhar/api-client";

export interface AdminSegmentsClientOptions extends Omit<SharedOptions, "apiUrl"> {
  readonly apiUrl?: string;
}

export function createAdminSegmentsClient(options: AdminSegmentsClientOptions = {}): AdminSegmentsClient {
  return createSharedAdminSegmentsClient({
    ...options,
    apiUrl: options.apiUrl ?? (import.meta.env.VITE_API_URL ?? DEFAULT_API_URL)
  });
}
