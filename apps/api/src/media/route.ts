import type { FastifyInstance } from "fastify";
import { MediaUploadResponseSchema } from "@vse-pro-zhar/contracts";

import {
  MediaNotFoundError,
  MediaPayloadTooLargeError,
  MediaUnavailableError,
  MediaValidationError
} from "./errors.js";
import {
  MediaInputError,
  type MediaStorage,
  type StoredMediaAsset
} from "./storage.js";

const SUPPORTED_INPUT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);
const MULTIPART_LIMIT_ERROR_CODES = new Set([
  "FST_FIELDS_LIMIT",
  "FST_FILES_LIMIT",
  "FST_PARTS_LIMIT",
  "FST_REQ_FILE_TOO_LARGE"
]);

interface MediaParams {
  readonly filename: string;
}

function hasErrorCode(error: unknown, codes: ReadonlySet<string>): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    codes.has(error.code)
  );
}

async function saveMedia(
  storage: MediaStorage,
  input: { readonly buffer: Buffer; readonly mimeType: string }
): Promise<StoredMediaAsset> {
  try {
    return await storage.saveImage(input);
  } catch (error: unknown) {
    if (error instanceof MediaInputError) {
      throw new MediaValidationError();
    }

    throw new MediaUnavailableError();
  }
}

export function registerMediaRoutes(
  app: FastifyInstance,
  storage: MediaStorage
): void {
  app.post("/admin/media/images", async (request, reply) => {
    let file;

    try {
      file = await request.file();
    } catch (error: unknown) {
      if (hasErrorCode(error, MULTIPART_LIMIT_ERROR_CODES)) {
        throw new MediaPayloadTooLargeError();
      }

      throw new MediaValidationError();
    }

    if (file === undefined || !SUPPORTED_INPUT_MIME_TYPES.has(file.mimetype)) {
      throw new MediaValidationError();
    }

    let buffer: Buffer;

    try {
      buffer = await file.toBuffer();
    } catch (error: unknown) {
      if (hasErrorCode(error, MULTIPART_LIMIT_ERROR_CODES)) {
        throw new MediaPayloadTooLargeError();
      }

      throw new MediaValidationError();
    }

    const asset = await saveMedia(storage, { buffer, mimeType: file.mimetype });
    const response = {
      format: asset.format,
      height: asset.height,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      url: asset.url,
      width: asset.width
    };

    return reply
      .code(201)
      .send(MediaUploadResponseSchema.parse(response));
  });

  app.get<{ Params: MediaParams }>("/media/:filename", async (request, reply) => {
    let buffer: Buffer | null;

    try {
      buffer = await storage.readImage(request.params.filename);
    } catch {
      throw new MediaUnavailableError();
    }

    if (buffer === null) {
      throw new MediaNotFoundError();
    }

    return reply
      .type("image/webp")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(buffer);
  });
}
