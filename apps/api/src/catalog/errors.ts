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
