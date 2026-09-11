export class OrderValidationError extends Error {
  constructor() {
    super("Order input is invalid");
    this.name = "OrderValidationError";
  }
}

export class OrderAuthenticationError extends Error {
  constructor() {
    super("Customer session is invalid");
    this.name = "OrderAuthenticationError";
  }
}

export class OrderNotFoundError extends Error {
  constructor() {
    super("Order was not found");
    this.name = "OrderNotFoundError";
  }
}

export class OrderDependencyError extends Error {
  constructor() {
    super("Order dependency is unavailable");
    this.name = "OrderDependencyError";
  }
}
