import type { CatalogResponse } from "@vse-pro-zhar/contracts";

import {
  CatalogClientError,
  type CatalogReadClient
} from "./catalog-client.js";

export type CatalogRequestState =
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly catalog: CatalogResponse }
  | { readonly status: "error"; readonly message: string };

export interface CatalogRequestController {
  start(): void;
  retry(): void;
  dispose(): void;
}

export function getCatalogErrorMessage(error: unknown): string {
  if (error instanceof CatalogClientError) {
    return error.message;
  }

  return "Не удалось получить каталог";
}

export function createCatalogRequestController(
  client: CatalogReadClient,
  onStateChange: (state: CatalogRequestState) => void
): CatalogRequestController {
  let disposed = false;
  let requestSequence = 0;
  let activeRequestController: AbortController | null = null;

  const load = (): void => {
    if (disposed) {
      return;
    }

    const sequence = requestSequence + 1;
    requestSequence = sequence;
    activeRequestController?.abort();

    const requestController = new AbortController();
    activeRequestController = requestController;
    onStateChange({ status: "loading" });

    let request: Promise<CatalogResponse>;

    try {
      request = client.getCatalog({ signal: requestController.signal });
    } catch (error: unknown) {
      request = Promise.reject(error);
    }

    void request.then(
      (catalog) => {
        if (
          !disposed &&
          sequence === requestSequence &&
          requestController.signal.aborted === false
        ) {
          onStateChange({ status: "success", catalog });
        }
      },
      (error: unknown) => {
        if (
          disposed ||
          sequence !== requestSequence ||
          (requestController.signal.aborted &&
            error instanceof CatalogClientError &&
            error.kind === "aborted")
        ) {
          return;
        }

        onStateChange({
          status: "error",
          message: getCatalogErrorMessage(error)
        });
      }
    );
  };

  return {
    start: load,
    retry: load,
    dispose: (): void => {
      if (disposed) {
        return;
      }

      disposed = true;
      requestSequence += 1;
      activeRequestController?.abort();
      activeRequestController = null;
    }
  };
}
