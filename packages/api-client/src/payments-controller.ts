import {
  IdempotencyKeySchema,
  PaymentCreateResponseSchema,
  PaymentStateResponseSchema,
  type ApiErrorCode,
  type PaymentSummary
} from "@vse-pro-zhar/contracts";

import {
  PaymentClientError,
  type PaymentClient,
  type PaymentClientErrorKind
} from "./payments-client.js";

export type PaymentRequestState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "pending"; readonly payment: PaymentSummary }
  | { readonly status: "success"; readonly payment: PaymentSummary }
  | {
      readonly status: "error";
      readonly message: string;
      readonly code: ApiErrorCode | null;
      readonly kind: PaymentClientErrorKind | "unknown";
    };

export interface PaymentConfirmationOpener {
  open(url: string): Promise<void> | void;
}

export interface PaymentRequestController {
  create(orderId: number, idempotencyKey: string): void;
  retryCreate(): void;
  refresh(orderId: number): void;
  dispose(): void;
}

export function getPaymentErrorMessage(error: unknown): string {
  return error instanceof PaymentClientError
    ? error.message
    : "Не удалось выполнить операцию оплаты";
}

function errorState(error: unknown) {
  return {
    message: getPaymentErrorMessage(error),
    code: error instanceof PaymentClientError ? error.code : null,
    kind: error instanceof PaymentClientError ? error.kind : ("unknown" as const)
  };
}

function canceledPaymentError(): PaymentClientError {
  return new PaymentClientError(
    "payment_invalid",
    "Платёж отменён или истёк. Запустите оплату заново.",
    "PAYMENT_INVALID",
    409
  );
}

export function createPaymentRequestController(
  client: PaymentClient,
  onStateChange: (state: PaymentRequestState) => void,
  opener?: PaymentConfirmationOpener
): PaymentRequestController {
  let disposed = false;
  let sequence = 0;
  let controller: AbortController | null = null;
  let lastCreate: { orderId: number; idempotencyKey: string } | null = null;

  const applyResponse = (response: unknown, responseSequence: number): void => {
    const checked = PaymentCreateResponseSchema.safeParse(response);
    if (!checked.success || checked.data.payment === null) {
      onStateChange({
        status: "error",
        ...errorState(new PaymentClientError("invalid_response", "Backend API вернул некорректный платёж"))
      });
      return;
    }
    const payment = checked.data.payment;
    if (payment.status === "succeeded") {
      onStateChange({ status: "success", payment });
      return;
    }
    if (payment.status === "canceled") {
      onStateChange({ status: "error", ...errorState(canceledPaymentError()) });
      return;
    }
    onStateChange({ status: "pending", payment });
    if (payment.confirmation?.url !== undefined && opener !== undefined) {
      void Promise.resolve(opener.open(payment.confirmation.url)).catch(() => {
        if (disposed || responseSequence !== sequence) return;
        onStateChange({
          status: "error",
          ...errorState(
            new PaymentClientError(
              "network",
              "Не удалось открыть форму оплаты. Попробуйте ещё раз."
            )
          )
        });
      });
    }
  };

  const create = (orderId: number, idempotencyKey: string): void => {
    if (disposed) return;
    if (
      !Number.isSafeInteger(orderId) ||
      orderId < 1 ||
      !IdempotencyKeySchema.safeParse(idempotencyKey).success
    ) {
      onStateChange({
        status: "error",
        ...errorState(new PaymentClientError("validation", "Не удалось подготовить оплату"))
      });
      return;
    }
    lastCreate = { orderId, idempotencyKey };
    const currentSequence = ++sequence;
    controller?.abort();
    const currentController = new AbortController();
    controller = currentController;
    onStateChange({ status: "loading" });
    void client
      .createPayment(orderId, { idempotencyKey, signal: currentController.signal })
      .then((response) => {
        if (disposed || currentSequence !== sequence || currentController.signal.aborted) return;
        applyResponse(response, currentSequence);
      })
      .catch((error: unknown) => {
        if (disposed || currentSequence !== sequence) return;
        if (
          currentController.signal.aborted &&
          error instanceof PaymentClientError &&
          error.kind === "aborted"
        ) {
          return;
        }
        onStateChange({ status: "error", ...errorState(error) });
      });
  };

  const refresh = (orderId: number): void => {
    if (disposed || !Number.isSafeInteger(orderId) || orderId < 1) return;
    const currentSequence = ++sequence;
    controller?.abort();
    const currentController = new AbortController();
    controller = currentController;
    onStateChange({ status: "loading" });
    void client
      .getPayment(orderId, { signal: currentController.signal })
      .then((response) => {
        if (disposed || currentSequence !== sequence || currentController.signal.aborted) return;
        const checked = PaymentStateResponseSchema.safeParse(response);
        if (!checked.success || checked.data.payment === null) {
          onStateChange({
            status: "error",
            ...errorState(new PaymentClientError("invalid_response", "Backend API вернул некорректный статус оплаты"))
          });
          return;
        }
        if (checked.data.payment.status === "canceled") {
          onStateChange({ status: "error", ...errorState(canceledPaymentError()) });
          return;
        }
        onStateChange(
          checked.data.payment.status === "succeeded"
            ? { status: "success", payment: checked.data.payment }
            : { status: "pending", payment: checked.data.payment }
        );
      })
      .catch((error: unknown) => {
        if (disposed || currentSequence !== sequence) return;
        if (
          currentController.signal.aborted &&
          error instanceof PaymentClientError &&
          error.kind === "aborted"
        ) {
          return;
        }
        onStateChange({ status: "error", ...errorState(error) });
      });
  };

  return {
    create,
    retryCreate: () => {
      if (lastCreate !== null) create(lastCreate.orderId, lastCreate.idempotencyKey);
    },
    refresh,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      sequence += 1;
      controller?.abort();
    }
  };
}
