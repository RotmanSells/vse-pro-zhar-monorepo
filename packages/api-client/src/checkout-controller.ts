import {
  CheckoutOptionsResponseSchema,
  CheckoutPickupSelectionSchema,
  CheckoutQuoteResponseSchema,
  type ApiErrorCode,
  type CartItem,
  type CheckoutOptionsResponse,
  type CheckoutPickupSelection,
  type CheckoutQuoteResponse
} from "@vse-pro-zhar/contracts";

import { normalizeCartItems } from "./cart.js";
import {
  CheckoutClientError,
  type CheckoutClient,
  type CheckoutClientErrorKind
} from "./checkout-client.js";

export type CheckoutOptionsRequestState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly options: CheckoutOptionsResponse }
  | {
      readonly status: "error";
      readonly message: string;
      readonly code: ApiErrorCode | null;
      readonly kind: CheckoutClientErrorKind | "unknown";
    };

export type CheckoutQuoteRequestState =
  | { readonly status: "idle" }
  | {
      readonly status: "loading";
      readonly items: readonly CartItem[];
      readonly pickup: CheckoutPickupSelection;
    }
  | { readonly status: "success"; readonly quote: CheckoutQuoteResponse }
  | {
      readonly status: "error";
      readonly message: string;
      readonly code: ApiErrorCode | null;
      readonly kind: CheckoutClientErrorKind | "unknown";
    };

export interface CheckoutRequestController {
  loadOptions(): void;
  retryOptions(): void;
  quote(items: readonly unknown[], pickup: unknown, redemptionId?: number): void;
  retryQuote(): void;
  clearQuote(): void;
  dispose(): void;
}

export function getCheckoutErrorMessage(error: unknown): string {
  if (error instanceof CheckoutClientError) return error.message;
  return "Не удалось подготовить оформление самовывоза";
}

function errorState(error: unknown): {
  readonly message: string;
  readonly code: ApiErrorCode | null;
  readonly kind: CheckoutClientErrorKind | "unknown";
} {
  return {
    message: getCheckoutErrorMessage(error),
    code: error instanceof CheckoutClientError ? error.code : null,
    kind: error instanceof CheckoutClientError ? error.kind : "unknown"
  };
}

export function createCheckoutRequestController(
  client: CheckoutClient,
  onOptionsStateChange: (state: CheckoutOptionsRequestState) => void,
  onQuoteStateChange: (state: CheckoutQuoteRequestState) => void
): CheckoutRequestController {
  let disposed = false;
  let optionsSequence = 0;
  let quoteSequence = 0;
  let optionsController: AbortController | null = null;
  let quoteController: AbortController | null = null;
  let lastItems: CartItem[] = [];
  let lastPickup: CheckoutPickupSelection | null = null;
  let lastRedemptionId: number | undefined;

  const loadOptions = (): void => {
    if (disposed) return;
    const sequence = optionsSequence + 1;
    optionsSequence = sequence;
    optionsController?.abort();
    const controller = new AbortController();
    optionsController = controller;
    onOptionsStateChange({ status: "loading" });

    let request: Promise<CheckoutOptionsResponse>;
    try {
      request = client.getCheckoutOptions({ signal: controller.signal });
    } catch (error: unknown) {
      request = Promise.reject(error);
    }

    void request.then(
      (options) => {
        if (
          !disposed &&
          sequence === optionsSequence &&
          !controller.signal.aborted
        ) {
          const parsed = CheckoutOptionsResponseSchema.safeParse(options);
          if (!parsed.success) {
            onOptionsStateChange({
              status: "error",
              ...errorState(
                new CheckoutClientError(
                  "invalid_response",
                  "Backend API вернул некорректный ответ"
                )
              )
            });
            return;
          }
          onOptionsStateChange({ status: "success", options: parsed.data });
        }
      },
      (error: unknown) => {
        if (
          disposed ||
          sequence !== optionsSequence ||
          (controller.signal.aborted &&
            error instanceof CheckoutClientError &&
            error.kind === "aborted")
        ) {
          return;
        }
        onOptionsStateChange({ status: "error", ...errorState(error) });
      }
    );
  };

  const loadQuote = (): void => {
    if (disposed || lastPickup === null) return;
    const sequence = quoteSequence + 1;
    quoteSequence = sequence;
    quoteController?.abort();
    const controller = new AbortController();
    quoteController = controller;
    const requestedItems = lastItems.map((item) => ({ ...item }));
    const requestedPickup = { ...lastPickup };
    if (requestedItems.length === 0) {
      onQuoteStateChange({
        status: "error",
        message: "Корзина пуста",
        code: null,
        kind: "validation"
      });
      return;
    }
    onQuoteStateChange({
      status: "loading",
      items: requestedItems,
      pickup: requestedPickup
    });

    let request: Promise<CheckoutQuoteResponse>;
    try {
      request = client.getCheckoutQuote(
        { items: requestedItems, pickup: requestedPickup, ...(lastRedemptionId === undefined ? {} : { redemptionId: lastRedemptionId }) },
        { signal: controller.signal }
      );
    } catch (error: unknown) {
      request = Promise.reject(error);
    }

    void request.then(
      (quote) => {
        if (
          !disposed &&
          sequence === quoteSequence &&
          !controller.signal.aborted
        ) {
          const parsed = CheckoutQuoteResponseSchema.safeParse(quote);
          if (!parsed.success) {
            onQuoteStateChange({
              status: "error",
              ...errorState(
                new CheckoutClientError(
                  "invalid_response",
                  "Backend API вернул некорректный ответ"
                )
              )
            });
            return;
          }
          onQuoteStateChange({ status: "success", quote: parsed.data });
        }
      },
      (error: unknown) => {
        if (
          disposed ||
          sequence !== quoteSequence ||
          (controller.signal.aborted &&
            error instanceof CheckoutClientError &&
            error.kind === "aborted")
        ) {
          return;
        }
        onQuoteStateChange({ status: "error", ...errorState(error) });
      }
    );
  };

  return {
    loadOptions,
    retryOptions: loadOptions,
    quote: (items, pickup, redemptionId): void => {
      if (disposed) return;
      const normalizedItems = normalizeCartItems(items);
      const parsedPickup = CheckoutPickupSelectionSchema.safeParse(pickup);
      lastItems = normalizedItems;
      lastPickup = parsedPickup.success ? parsedPickup.data : null;
      lastRedemptionId = redemptionId;
      if (!parsedPickup.success) {
        quoteSequence += 1;
        quoteController?.abort();
        onQuoteStateChange({
          status: "error",
          ...errorState(
            new CheckoutClientError("validation", "Выберите точку и время самовывоза")
          )
        });
        return;
      }
      if (normalizedItems.length === 0) {
        quoteSequence += 1;
        quoteController?.abort();
        onQuoteStateChange({
          status: "error",
          message: "Корзина пуста",
          code: null,
          kind: "validation"
        });
        return;
      }
      loadQuote();
    },
    retryQuote: loadQuote,
    clearQuote: (): void => {
      if (disposed) return;
      quoteSequence += 1;
      quoteController?.abort();
      quoteController = null;
      lastItems = [];
      lastPickup = null;
      lastRedemptionId = undefined;
      onQuoteStateChange({ status: "idle" });
    },
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      optionsSequence += 1;
      quoteSequence += 1;
      optionsController?.abort();
      quoteController?.abort();
      optionsController = null;
      quoteController = null;
    }
  };
}
