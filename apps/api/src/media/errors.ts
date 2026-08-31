import { ApiRequestError } from "../http/errors.js";

export class MediaUnavailableError extends ApiRequestError {
  constructor() {
    super(
      "SERVICE_UNAVAILABLE",
      503,
      "Media storage is unavailable"
    );
    this.name = "MediaUnavailableError";
  }
}

export class MediaValidationError extends ApiRequestError {
  constructor() {
    super("VALIDATION_ERROR", 400, "Image upload is invalid");
    this.name = "MediaValidationError";
  }
}

export class MediaPayloadTooLargeError extends ApiRequestError {
  constructor() {
    super("PAYLOAD_TOO_LARGE", 413, "Image upload is too large");
    this.name = "MediaPayloadTooLargeError";
  }
}

export class MediaNotFoundError extends ApiRequestError {
  constructor() {
    super("NOT_FOUND", 404, "Media asset was not found");
    this.name = "MediaNotFoundError";
  }
}
