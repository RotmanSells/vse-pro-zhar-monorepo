import {
  createAdminCommunicationsClient as createSharedAdminCommunicationsClient,
  type AdminCommunicationsClient,
  type AdminCommunicationsClientOptions as SharedOptions
} from "@vse-pro-zhar/api-client";

const DEFAULT_API_URL = "http://127.0.0.1:3000";

export type { AdminCommunicationPreviewRequest, AdminCommunicationChannel, AdminCommunicationTemplateCode } from "@vse-pro-zhar/contracts";
export type { AdminCommunicationsRequestOptions } from "@vse-pro-zhar/api-client";
export { AdminCommunicationsClientError } from "@vse-pro-zhar/api-client";

export interface AdminCommunicationsClientOptions extends Omit<SharedOptions, "apiUrl"> { readonly apiUrl?: string }

export function createAdminCommunicationsClient(options: AdminCommunicationsClientOptions = {}): AdminCommunicationsClient {
  return createSharedAdminCommunicationsClient({ ...options, apiUrl: options.apiUrl ?? (import.meta.env.VITE_API_URL ?? DEFAULT_API_URL) });
}
