import { ApiRequestError } from "../http/errors.js";

export class CatalogUnavailableError extends ApiRequestError {
  constructor() {
    super(
      "SERVICE_UNAVAILABLE",
      503,
      "Catalog PostgreSQL storage is unavailable"
    );
    this.name = "CatalogUnavailableError";
  }
}

export class CatalogValidationError extends ApiRequestError {
  constructor() {
    super("VALIDATION_ERROR", 400, "Catalog request is invalid");
    this.name = "CatalogValidationError";
  }
}

export class CatalogNotFoundError extends ApiRequestError {
  constructor() {
    super("NOT_FOUND", 404, "Catalog resource was not found");
    this.name = "CatalogNotFoundError";
  }
}

export class CartItemUnavailableError extends ApiRequestError {
  constructor() {
    super(
      "CART_ITEM_UNAVAILABLE",
      409,
      "One or more cart items are no longer available"
    );
    this.name = "CartItemUnavailableError";
  }
}
