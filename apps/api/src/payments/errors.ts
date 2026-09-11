import type { YooKassaProviderErrorDetails } from "./provider.js";

export class PaymentAuthenticationError extends Error {
  constructor() {
    super("Customer session is invalid");
    this.name = "PaymentAuthenticationError";
  }
}

export class PaymentValidationError extends Error {
  constructor() {
    super("Payment input is invalid");
    this.name = "PaymentValidationError";
  }
}

export class PaymentNotFoundError extends Error {
  constructor() {
    super("Payment order was not found");
    this.name = "PaymentNotFoundError";
  }
}

export class PaymentNotAllowedError extends Error {
  constructor() {
    super("Payment is not allowed for this order");
    this.name = "PaymentNotAllowedError";
  }
}

export class PaymentUnavailableError extends Error {
  readonly providerDetails: YooKassaProviderErrorDetails | null;

  constructor(providerDetails: YooKassaProviderErrorDetails | null = null) {
    super("Payment provider is unavailable");
    this.name = "PaymentUnavailableError";
    this.providerDetails = providerDetails;
  }
}

export class PaymentInvalidError extends Error {
  constructor() {
    super("Payment provider response is invalid");
    this.name = "PaymentInvalidError";
  }
}
