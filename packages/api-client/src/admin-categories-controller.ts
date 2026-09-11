import type { CatalogAdminCategoriesResponse } from "@vse-pro-zhar/contracts";

import { CatalogClientError, type CatalogAdminClient, type CatalogRequestOptions } from "./catalog-client.js";

export type AdminCategoriesState =
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly response: CatalogAdminCategoriesResponse }
  | { readonly status: "error"; readonly message: string };

export interface AdminCategoriesRequestController {
  start(): void;
  retry(): void;
  dispose(): void;
}

function errorMessage(error: unknown): string {
  return error instanceof CatalogClientError
    ? error.message
    : "Не удалось загрузить категории";
}

export function createAdminCategoriesRequestController(
  client: Pick<CatalogAdminClient, "listCategories"> & {
    readonly listCategories: NonNullable<CatalogAdminClient["listCategories"]>;
  },
  onStateChange: (state: AdminCategoriesState) => void
): AdminCategoriesRequestController {
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
    const requestOptions: CatalogRequestOptions = { signal: controller.signal };
    void client.listCategories(requestOptions).then(
      (response) => {
        if (!disposed && currentSequence === sequence && !controller.signal.aborted) {
          onStateChange({ status: "success", response });
        }
      },
      (error: unknown) => {
        if (
          !disposed &&
          currentSequence === sequence &&
          !(error instanceof CatalogClientError && error.kind === "aborted")
        ) {
          onStateChange({ status: "error", message: errorMessage(error) });
        }
      }
    );
  };

  return {
    start: load,
    retry: load,
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      sequence += 1;
      activeController?.abort();
      activeController = null;
    }
  };
}
