import {
  AdminSegmentPreviewResponseSchema,
  AdminSegmentsResponseSchema,
  type AdminSegmentCode,
  type AdminSegmentPreviewQueryInput,
  type AdminSegmentPreviewResponse,
  type AdminSegmentsResponse
} from "@vse-pro-zhar/contracts";

import { AdminSegmentsClientError, type AdminSegmentsClient } from "./admin-segments-client.js";

export type AdminSegmentsListState =
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly response: AdminSegmentsResponse }
  | { readonly status: "error"; readonly message: string };

export type AdminSegmentPreviewState =
  | { readonly status: "idle" | "loading"; readonly code: AdminSegmentCode | null; readonly query: AdminSegmentPreviewQueryInput }
  | { readonly status: "success"; readonly code: AdminSegmentCode; readonly query: AdminSegmentPreviewQueryInput; readonly response: AdminSegmentPreviewResponse }
  | { readonly status: "error"; readonly code: AdminSegmentCode; readonly query: AdminSegmentPreviewQueryInput; readonly message: string };

export interface AdminSegmentsListRequestController {
  load(): void;
  retry(): void;
  dispose(): void;
}

export interface AdminSegmentPreviewRequestController {
  load(code: AdminSegmentCode, query?: AdminSegmentPreviewQueryInput): void;
  retry(): void;
  dispose(): void;
}

export function getAdminSegmentsErrorMessage(error: unknown): string {
  return error instanceof AdminSegmentsClientError ? error.message : "Не удалось загрузить сегменты";
}

export function createAdminSegmentsListRequestController(
  client: AdminSegmentsClient,
  onStateChange: (state: AdminSegmentsListState) => void
): AdminSegmentsListRequestController {
  let disposed = false;
  let sequence = 0;
  let activeController: AbortController | null = null;
  const load = (): void => {
    if (disposed) return;
    const currentSequence = ++sequence;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    onStateChange({ status: "loading" });
    void client.list({ signal: controller.signal }).then(
      (response) => {
        if (!disposed && currentSequence === sequence && !controller.signal.aborted) {
          const parsed = AdminSegmentsResponseSchema.safeParse(response);
          onStateChange(parsed.success ? { status: "success", response: parsed.data } : { status: "error", message: "Backend API вернул некорректные сегменты" });
        }
      },
      (error: unknown) => {
        if (!disposed && currentSequence === sequence && !(error instanceof AdminSegmentsClientError && error.kind === "aborted")) onStateChange({ status: "error", message: getAdminSegmentsErrorMessage(error) });
      }
    );
  };
  return {
    load,
    retry: load,
    dispose: (): void => { if (disposed) return; disposed = true; sequence += 1; activeController?.abort(); activeController = null; }
  };
}

export function createAdminSegmentPreviewRequestController(
  client: AdminSegmentsClient,
  onStateChange: (state: AdminSegmentPreviewState) => void
): AdminSegmentPreviewRequestController {
  let disposed = false;
  let sequence = 0;
  let lastCode: AdminSegmentCode | null = null;
  let lastQuery: AdminSegmentPreviewQueryInput = { limit: 25, offset: 0 };
  let activeController: AbortController | null = null;
  const load = (code: AdminSegmentCode, query: AdminSegmentPreviewQueryInput = { limit: 25, offset: 0 }): void => {
    if (disposed) return;
    lastCode = code;
    lastQuery = query;
    const currentSequence = ++sequence;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    onStateChange({ status: "loading", code, query });
    void client.preview(code, query, { signal: controller.signal }).then(
      (response) => {
        if (!disposed && currentSequence === sequence && !controller.signal.aborted) {
          const parsed = AdminSegmentPreviewResponseSchema.safeParse(response);
          onStateChange(parsed.success ? { status: "success", code, query, response: parsed.data } : { status: "error", code, query, message: "Backend API вернул некорректный preview сегмента" });
        }
      },
      (error: unknown) => {
        if (!disposed && currentSequence === sequence && !(error instanceof AdminSegmentsClientError && error.kind === "aborted") && lastCode !== null) onStateChange({ status: "error", code: lastCode, query: lastQuery, message: getAdminSegmentsErrorMessage(error) });
      }
    );
  };
  return {
    load,
    retry: (): void => { if (lastCode !== null) load(lastCode, lastQuery); },
    dispose: (): void => { if (disposed) return; disposed = true; sequence += 1; activeController?.abort(); activeController = null; }
  };
}
