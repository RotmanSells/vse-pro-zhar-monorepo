import type {
  ApiErrorCode,
  CartItem,
  CartQuoteResponse
} from "@vse-pro-zhar/contracts";

import { cartQuoteMatchesItems, normalizeCartItems } from "./cart.js";
import {
  CartQuoteClientError,
  type CartQuoteClient
} from "./cart-quote-client.js";

export type CartQuoteRequestState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly items: readonly CartItem[] }
  | { readonly status: "success"; readonly quote: CartQuoteResponse }
  | {
      readonly status: "error";
      readonly message: string;
      readonly code: ApiErrorCode | null;
    };

export interface CartQuoteRequestController {
  quote(items: readonly unknown[]): void;
  retry(): void;
  clear(): void;
  dispose(): void;
}

export function getCartQuoteErrorMessage(error: unknown): string {
  if (error instanceof CartQuoteClientError) {
    return error.message;
  }

  return "Не удалось рассчитать корзину";
}

export function createCartQuoteRequestController(
  client: CartQuoteClient,
  onStateChange: (state: CartQuoteRequestState) => void
): CartQuoteRequestController {
  let disposed = false;
  let requestSequence = 0;
  let activeRequestController: AbortController | null = null;
  let lastItems: CartItem[] = [];

  const load = (items?: readonly unknown[]): void => {
    if (disposed) {
      return;
    }

    if (items !== undefined) {
      lastItems = normalizeCartItems(items);
    }

    const sequence = requestSequence + 1;
    requestSequence = sequence;
    activeRequestController?.abort();

    if (lastItems.length === 0) {
      activeRequestController = null;
      onStateChange({ status: "idle" });
      return;
    }

    const requestController = new AbortController();
    activeRequestController = requestController;
    const requestedItems = lastItems.map((item) => ({ ...item }));
    onStateChange({ status: "loading", items: requestedItems });

    const handleError = (error: unknown): void => {
      if (
        disposed ||
        sequence !== requestSequence ||
        (requestController.signal.aborted &&
          error instanceof CartQuoteClientError &&
          error.kind === "aborted")
      ) {
        return;
      }

      const state: CartQuoteRequestState = {
        status: "error",
        message: getCartQuoteErrorMessage(error),
        code: error instanceof CartQuoteClientError ? error.code : null
      };
      onStateChange(state);
    };

    let request: Promise<CartQuoteResponse>;
    try {
      request = client.getCartQuote(
        { items: requestedItems },
        { signal: requestController.signal }
      );
    } catch (error: unknown) {
      request = Promise.reject(error);
    }

    void request.then(
      (quote) => {
        if (
          !disposed &&
          sequence === requestSequence &&
          requestController.signal.aborted === false
        ) {
          if (!cartQuoteMatchesItems(requestedItems, quote.items)) {
            handleError(
              new CartQuoteClientError(
                "invalid_response",
                "Backend API вернул некорректный ответ"
              )
            );
            return;
          }

          onStateChange({ status: "success", quote });
        }
      },
      handleError
    );
  };

  return {
    quote: load,
    retry: () => load(),
    clear: () => load([]),
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
