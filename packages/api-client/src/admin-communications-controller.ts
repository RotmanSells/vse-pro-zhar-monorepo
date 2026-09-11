import {
  AdminCommunicationPreviewResponseSchema,
  AdminCommunicationsResponseSchema,
  type AdminCommunicationPreviewRequest,
  type AdminCommunicationPreviewResponse,
  type AdminCommunicationsResponse,
  type AdminCommunicationDraftCreateRequest,
  type AdminCommunicationDraftResponse,
  type AdminCommunicationDraftUpdateRequest,
  type AdminCommunicationDraftVersionRequest
} from "@vse-pro-zhar/contracts";

import { AdminCommunicationsClientError, type AdminCommunicationsClient } from "./admin-communications-client.js";

export type AdminCommunicationsListState =
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly response: AdminCommunicationsResponse }
  | { readonly status: "error"; readonly message: string };

export type AdminCommunicationPreviewState =
  | { readonly status: "idle" | "loading"; readonly request: AdminCommunicationPreviewRequest | null }
  | { readonly status: "success"; readonly request: AdminCommunicationPreviewRequest; readonly response: AdminCommunicationPreviewResponse }
  | { readonly status: "error"; readonly request: AdminCommunicationPreviewRequest; readonly message: string };

export interface AdminCommunicationsListRequestController { load(): void; retry(): void; dispose(): void }
export interface AdminCommunicationPreviewRequestController { load(request: AdminCommunicationPreviewRequest): void; retry(): void; dispose(): void }

export type AdminCommunicationDraftMutationState =
  | { readonly status: "idle" | "loading"; readonly operation: "create" | "update" | "archive" | "restore" | null }
  | { readonly status: "success"; readonly operation: "create" | "update" | "archive" | "restore"; readonly response: AdminCommunicationDraftResponse }
  | { readonly status: "conflict"; readonly operation: "create" | "update" | "archive" | "restore"; readonly message: string }
  | { readonly status: "error"; readonly operation: "create" | "update" | "archive" | "restore"; readonly message: string };

export interface AdminCommunicationDraftMutationController {
  create(input: AdminCommunicationDraftCreateRequest): void;
  update(id: number, input: AdminCommunicationDraftUpdateRequest): void;
  archive(id: number, input: AdminCommunicationDraftVersionRequest): void;
  restore(id: number, input: AdminCommunicationDraftVersionRequest): void;
  retry(): void;
  dispose(): void;
}

export function getAdminCommunicationsErrorMessage(error: unknown): string {
  return error instanceof AdminCommunicationsClientError ? error.message : "Не удалось загрузить коммуникации";
}

export function createAdminCommunicationsListRequestController(client: AdminCommunicationsClient, onStateChange: (state: AdminCommunicationsListState) => void): AdminCommunicationsListRequestController {
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
    void client.get({ signal: controller.signal }).then(
      (response) => { if (!disposed && currentSequence === sequence && !controller.signal.aborted) { const parsed = AdminCommunicationsResponseSchema.safeParse(response); onStateChange(parsed.success ? { status: "success", response: parsed.data } : { status: "error", message: "Backend API вернул некорректные коммуникации" }); } },
      (error: unknown) => { if (!disposed && currentSequence === sequence && !(error instanceof AdminCommunicationsClientError && error.kind === "aborted")) onStateChange({ status: "error", message: getAdminCommunicationsErrorMessage(error) }); }
    );
  };
  return { load, retry: load, dispose: (): void => { if (disposed) return; disposed = true; sequence += 1; activeController?.abort(); activeController = null; } };
}

export function createAdminCommunicationPreviewRequestController(client: AdminCommunicationsClient, onStateChange: (state: AdminCommunicationPreviewState) => void): AdminCommunicationPreviewRequestController {
  let disposed = false;
  let sequence = 0;
  let lastRequest: AdminCommunicationPreviewRequest | null = null;
  let activeController: AbortController | null = null;
  const load = (request: AdminCommunicationPreviewRequest): void => {
    if (disposed) return;
    lastRequest = request;
    const currentSequence = ++sequence;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    onStateChange({ status: "loading", request });
    void client.preview(request, { signal: controller.signal }).then(
      (response) => { if (!disposed && currentSequence === sequence && !controller.signal.aborted) { const parsed = AdminCommunicationPreviewResponseSchema.safeParse(response); onStateChange(parsed.success ? { status: "success", request, response: parsed.data } : { status: "error", request, message: "Backend API вернул некорректный preview сообщения" }); } },
      (error: unknown) => { if (!disposed && currentSequence === sequence && !(error instanceof AdminCommunicationsClientError && error.kind === "aborted") && lastRequest !== null) onStateChange({ status: "error", request: lastRequest, message: getAdminCommunicationsErrorMessage(error) }); }
    );
  };
  return { load, retry: (): void => { if (lastRequest !== null) load(lastRequest); }, dispose: (): void => { if (disposed) return; disposed = true; sequence += 1; activeController?.abort(); activeController = null; } };
}

export function createAdminCommunicationDraftMutationController(client: AdminCommunicationsClient, onStateChange: (state: AdminCommunicationDraftMutationState) => void): AdminCommunicationDraftMutationController {
  let disposed = false;
  let sequence = 0;
  let activeController: AbortController | null = null;
  let lastOperation: ((signal: AbortSignal) => Promise<AdminCommunicationDraftResponse>) | null = null;
  let lastKind: "create" | "update" | "archive" | "restore" | null = null;

  const run = (operation: "create" | "update" | "archive" | "restore", action: (signal: AbortSignal) => Promise<AdminCommunicationDraftResponse>): void => {
    if (disposed) return;
    const currentSequence = ++sequence;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    lastKind = operation;
    lastOperation = action;
    onStateChange({ status: "loading", operation });
    void action(controller.signal).then(
      (response) => { if (!disposed && currentSequence === sequence && !controller.signal.aborted) onStateChange({ status: "success", operation, response }); },
      (error: unknown) => {
        if (disposed || currentSequence !== sequence || controller.signal.aborted) return;
        const message = getAdminCommunicationsErrorMessage(error);
        onStateChange({ status: error instanceof AdminCommunicationsClientError && error.kind === "conflict" ? "conflict" : "error", operation, message });
      }
    );
  };
  const create = (input: AdminCommunicationDraftCreateRequest): void => run("create", (signal) => client.createDraft(input, { signal }));
  const update = (id: number, input: AdminCommunicationDraftUpdateRequest): void => run("update", (signal) => client.updateDraft(id, input, { signal }));
  const archive = (id: number, input: AdminCommunicationDraftVersionRequest): void => run("archive", (signal) => client.archiveDraft(id, input, { signal }));
  const restore = (id: number, input: AdminCommunicationDraftVersionRequest): void => run("restore", (signal) => client.restoreDraft(id, input, { signal }));
  const retry = (): void => { if (lastOperation !== null && lastKind !== null) run(lastKind, lastOperation); };
  const dispose = (): void => { if (disposed) return; disposed = true; sequence += 1; activeController?.abort(); activeController = null; };
  return { create, update, archive, restore, retry, dispose };
}
