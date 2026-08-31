import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import sharp, { type Metadata, type OutputInfo } from "sharp";

export const MAX_MEDIA_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_MEDIA_DIMENSION = 1_600;
export const MEDIA_WEBP_QUALITY = 82;

const MAX_INPUT_PIXELS = 40_000_000;
const SUPPORTED_INPUT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);
const SUPPORTED_INPUT_FORMATS = new Set(["jpeg", "png", "webp"]);
const MEDIA_FILENAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/u;

export interface StoredMediaAsset {
  readonly filename: string;
  readonly url: string;
  readonly format: "webp";
  readonly mimeType: "image/webp";
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
}

export interface MediaStorage {
  saveImage(input: {
    readonly buffer: Buffer;
    readonly mimeType: string;
  }): Promise<StoredMediaAsset>;
  readImage(filename: string): Promise<Buffer | null>;
}

export interface MediaStorageOptions {
  readonly directory: string;
  readonly publicUrl: string;
}

export class MediaInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaInputError";
  }
}

export class MediaStorageError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "MediaStorageError";
  }
}

interface EncodedImage {
  readonly buffer: Buffer;
  readonly format: "webp";
  readonly mimeType: "image/webp";
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function normalizePublicUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch (error: unknown) {
    throw new MediaStorageError("Media public URL is invalid", { cause: error });
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new MediaStorageError("Media public URL is invalid");
  }

  return url.origin;
}

function normalizeDirectory(value: string): string {
  const normalized = value.trim();

  if (normalized === "") {
    throw new MediaStorageError("Media directory is invalid");
  }

  return isAbsolute(normalized) ? normalized : resolve(process.cwd(), normalized);
}

function createMediaUrl(publicUrl: string, filename: string): string {
  return new URL(`/media/${encodeURIComponent(filename)}`, `${publicUrl}/`).toString();
}

async function encodeImage(input: {
  readonly buffer: Buffer;
  readonly mimeType: string;
}): Promise<EncodedImage> {
  if (input.buffer.length === 0) {
    throw new MediaInputError("Image upload is empty");
  }

  if (input.buffer.length > MAX_MEDIA_UPLOAD_BYTES) {
    throw new MediaInputError("Image upload is too large");
  }

  if (!SUPPORTED_INPUT_MIME_TYPES.has(input.mimeType.toLowerCase())) {
    throw new MediaInputError("Image type is not supported");
  }

  let metadata: Metadata;

  try {
    metadata = await sharp(input.buffer, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS
    }).metadata();
  } catch {
    throw new MediaInputError("Image file is invalid");
  }

  if (
    metadata.format === undefined ||
    !SUPPORTED_INPUT_FORMATS.has(metadata.format) ||
    metadata.width === undefined ||
    metadata.height === undefined
  ) {
    throw new MediaInputError("Image file is invalid");
  }

  let encoded: { data: Buffer; info: OutputInfo };

  try {
    encoded = await sharp(input.buffer, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS
    })
      .rotate()
      .resize({
        fit: "inside",
        height: MAX_MEDIA_DIMENSION,
        width: MAX_MEDIA_DIMENSION,
        withoutEnlargement: true
      })
      .webp({ effort: 4, quality: MEDIA_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new MediaInputError("Image file could not be converted");
  }

  if (
    encoded.info.format !== "webp" ||
    encoded.info.width === undefined ||
    encoded.info.height === undefined ||
    encoded.info.size <= 0
  ) {
    throw new MediaInputError("Image conversion returned an invalid result");
  }

  return {
    buffer: encoded.data,
    format: "webp",
    height: encoded.info.height,
    mimeType: "image/webp",
    sizeBytes: encoded.info.size,
    width: encoded.info.width
  };
}

export function createMediaStorage(options: MediaStorageOptions): MediaStorage {
  const directory = normalizeDirectory(options.directory);
  const publicUrl = normalizePublicUrl(options.publicUrl);

  return {
    async saveImage(input): Promise<StoredMediaAsset> {
      const encoded = await encodeImage(input);
      const filename = `${randomUUID()}.webp`;
      const path = join(directory, filename);

      try {
        await mkdir(directory, { recursive: true });
        await writeFile(path, encoded.buffer, { flag: "wx" });
      } catch (error: unknown) {
        throw new MediaStorageError("Media file could not be saved", { cause: error });
      }

      return {
        format: encoded.format,
        height: encoded.height,
        filename,
        mimeType: encoded.mimeType,
        sizeBytes: encoded.sizeBytes,
        url: createMediaUrl(publicUrl, filename),
        width: encoded.width
      };
    },

    async readImage(filename): Promise<Buffer | null> {
      if (!MEDIA_FILENAME_PATTERN.test(filename)) {
        return null;
      }

      try {
        return await readFile(join(directory, filename));
      } catch (error: unknown) {
        if (isNodeError(error) && error.code === "ENOENT") {
          return null;
        }

        throw new MediaStorageError("Media file could not be read", { cause: error });
      }
    }
  };
}
