export class CheckoutValidationError extends Error {
  constructor() {
    super("Checkout input is invalid");
    this.name = "CheckoutValidationError";
  }
}

export class CheckoutAuthenticationError extends Error {
  constructor() {
    super("Customer session is invalid");
    this.name = "CheckoutAuthenticationError";
  }
}

export class CheckoutCartUnavailableError extends Error {
  constructor() {
    super("One or more cart items are no longer available");
    this.name = "CheckoutCartUnavailableError";
  }
}

export class CheckoutPickupUnavailableError extends Error {
  constructor() {
    super("The selected pickup option is no longer available");
    this.name = "CheckoutPickupUnavailableError";
  }
}

export class CheckoutOperationalUnavailableError extends Error {
  constructor() {
    super("Operational availability is not confirmed");
    this.name = "CheckoutOperationalUnavailableError";
  }
}

export class CheckoutRewardUnavailableError extends Error {
  constructor() {
    super("The selected loyalty reward is unavailable");
    this.name = "CheckoutRewardUnavailableError";
  }
}

export class CheckoutDependencyError extends Error {
  constructor() {
    super("Checkout dependency is unavailable");
    this.name = "CheckoutDependencyError";
  }
}

export class CheckoutConfigurationError extends Error {
  constructor() {
    super("Pickup configuration is invalid");
    this.name = "CheckoutConfigurationError";
  }
}
