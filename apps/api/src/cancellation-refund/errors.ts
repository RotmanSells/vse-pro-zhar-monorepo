export class CancellationAuthenticationError extends Error {
  constructor() {
    super("Customer authentication is required");
    this.name = "CancellationAuthenticationError";
  }
}

export class CancellationValidationError extends Error {
  constructor() {
    super("Cancellation request is invalid");
    this.name = "CancellationValidationError";
  }
}

export class CancellationNotFoundError extends Error {
  constructor() {
    super("Order was not found");
    this.name = "CancellationNotFoundError";
  }
}

export class CancellationUnavailableError extends Error {
  constructor() {
    super("Cancellation service is unavailable");
    this.name = "CancellationUnavailableError";
  }
}

export class RefundPendingError extends Error {
  constructor() {
    super("Refund is still pending");
    this.name = "RefundPendingError";
  }
}

export class RefundReconciliationRequiredError extends Error {
  constructor() {
    super("Refund reconciliation is required");
    this.name = "RefundReconciliationRequiredError";
  }
}
