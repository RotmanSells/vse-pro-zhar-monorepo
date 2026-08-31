import type { HealthResponse } from "@vse-pro-zhar/contracts";

import {
  HealthClientError,
  type HealthClient
} from "./health-client.js";

export type HealthRequestState =
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly health: HealthResponse }
  | { readonly status: "error"; readonly message: string };

export interface HealthRequestController {
  start(): void;
  retry(): void;
  dispose(): void;
}

export function getHealthErrorMessage(error: unknown): string {
  if (error instanceof HealthClientError) {
    return error.message;
  }

  return "Не удалось получить состояние Backend API";
}

export function createHealthRequestController(
  client: HealthClient,
  onStateChange: (state: HealthRequestState) => void
): HealthRequestController {
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

    let request: Promise<HealthResponse>;

    try {
      request = client.getHealth({ signal: requestController.signal });
    } catch (error: unknown) {
      request = Promise.reject(error);
    }

    void request.then(
      (health) => {
        if (
          !disposed &&
          sequence === requestSequence &&
          requestController.signal.aborted === false
        ) {
          onStateChange({ status: "success", health });
        }
      },
      (error: unknown) => {
        if (
          disposed ||
          sequence !== requestSequence ||
          (requestController.signal.aborted &&
            error instanceof HealthClientError &&
            error.kind === "aborted")
        ) {
          return;
        }

        onStateChange({
          status: "error",
          message: getHealthErrorMessage(error)
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
