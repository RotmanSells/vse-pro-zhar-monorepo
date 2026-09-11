import {
  ApiErrorSchema,
  CatalogAdminCategoriesResponseSchema,
  CatalogAdminCategoryResponseSchema,
  CatalogCategoryIdempotencyKeySchema,
  CatalogCategoryInputSchema,
  CatalogCategoryUpdateSchema,
  CatalogProductInputSchema,
  CatalogProductSchema,
  CatalogProductUpdateSchema,
  CatalogResponseSchema,
  MediaUploadResponseSchema,
  type CatalogCategory,
  type CatalogAdminCategoriesResponse,
  type CatalogCategoryInput,
  type CatalogCategoryUpdate,
  type CatalogProduct,
  type CatalogProductInput,
  type CatalogProductUpdate,
  type CatalogResponse,
  type MediaUploadResponse
} from "@vse-pro-zhar/contracts";

import type { FetchImplementation } from "./health-client.js";

export const DEFAULT_CATALOG_TIMEOUT_MS = 10_000;

export type CatalogClientErrorKind =
  | "configuration"
  | "network"
  | "http"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "validation"
  | "authentication"
  | "forbidden"
  | "conflict";

export class CatalogClientError extends Error {
  readonly kind: CatalogClientErrorKind;
  readonly code: string | null;
  readonly status: number | null;

  constructor(
    kind: CatalogClientErrorKind,
    message: string,
    code: string | null = null,
    status: number | null = null
  ) {
    super(message);
    this.name = "CatalogClientError";
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export interface CatalogClientOptions {
  readonly apiUrl: string;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}

export interface CatalogRequestOptions {
  readonly signal?: AbortSignal;
  readonly idempotencyKey?: string;
}

export interface CatalogReadClient {
  getCatalog(options?: CatalogRequestOptions): Promise<CatalogResponse>;
}

export interface CatalogAdminClient {
  getAdminCatalog(options?: CatalogRequestOptions): Promise<CatalogResponse>;
  listCategories?(options?: CatalogRequestOptions): Promise<CatalogAdminCategoriesResponse>;
  createCategory(input: CatalogCategoryInput, options?: CatalogRequestOptions): Promise<CatalogCategory>;
  updateCategory(
    id: number,
    input: CatalogCategoryUpdate,
    options?: CatalogRequestOptions
  ): Promise<CatalogCategory>;
  uploadImage(file: Blob): Promise<MediaUploadResponse>;
  createProduct(input: CatalogProductInput): Promise<CatalogProduct>;
  updateProduct(id: number, input: CatalogProductUpdate): Promise<CatalogProduct>;
}

export interface CatalogClient extends CatalogReadClient, CatalogAdminClient {}

function invalidApiUrl(): CatalogClientError {
  return new CatalogClientError(
    "configuration",
    "Адрес Backend API настроен некорректно"
  );
}

function resolveApiUrl(value: string): string {
  if (value.trim() === "") {
    throw invalidApiUrl();
  }

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw invalidApiUrl();
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw invalidApiUrl();
  }

  return url.origin;
}

function resolveTimeout(timeoutMs: number | undefined): number {
  const resolvedTimeout = timeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS;

  if (!Number.isFinite(resolvedTimeout) || resolvedTimeout <= 0) {
    throw new CatalogClientError(
      "configuration",
      "Timeout Backend API настроен некорректно"
    );
  }

  return resolvedTimeout;
}

function createTimeoutError(): CatalogClientError {
  return new CatalogClientError("timeout", "Backend API не ответил вовремя");
}

function createAbortError(): CatalogClientError {
  return new CatalogClientError("aborted", "Запрос к Backend API отменён");
}

function throwIfAborted(
  timedOut: boolean,
  signal: AbortSignal | undefined
): void {
  if (timedOut) {
    throw createTimeoutError();
  }

  if (signal?.aborted === true) {
    throw createAbortError();
  }
}

function createInvalidResponseError(): CatalogClientError {
  return new CatalogClientError(
    "invalid_response",
    "Backend API вернул некорректный ответ"
  );
}

function createValidationError(): CatalogClientError {
  return new CatalogClientError("validation", "Проверьте данные каталога");
}

function createIdempotencyKey(): string {
  const cryptoObject = globalThis.crypto;
  return typeof cryptoObject?.randomUUID === "function"
    ? cryptoObject.randomUUID()
    : `catalog-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mutationRequestOptions(options: CatalogRequestOptions): CatalogRequestOptions {
  const key = options.idempotencyKey ?? createIdempotencyKey();
  const parsed = CatalogCategoryIdempotencyKeySchema.safeParse(key);
  if (!parsed.success) throw createValidationError();
  return { ...options, idempotencyKey: parsed.data };
}

function getHttpError(body: unknown, status: number): CatalogClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error.code : null;
  const message = parsed.success
    ? parsed.data.error.message
    : "Каталог временно недоступен";
  if (status === 401) return new CatalogClientError("authentication", message, code, status);
  if (status === 403) return new CatalogClientError("forbidden", message, code, status);
  if (status === 400) return new CatalogClientError("validation", message, code, status);
  if (status === 409) return new CatalogClientError("conflict", message, code, status);
  return new CatalogClientError("http", message, code, status);
}

function parseInput<T>(schema: { safeParse: (value: unknown) => unknown }, value: unknown): T {
  const parsed = schema.safeParse(value) as
    | { readonly success: true; readonly data: T }
    | { readonly success: false };

  if (!parsed.success) {
    throw createValidationError();
  }

  return parsed.data;
}

function isFormDataBody(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

async function requestJson<T>(
  apiUrl: string,
  fetchImpl: FetchImplementation,
  timeoutMs: number,
  path: string,
  method: "GET" | "POST" | "PATCH",
  responseSchema: { safeParse: (value: unknown) => unknown },
  body: unknown,
  requestOptions: CatalogRequestOptions
): Promise<T> {
  const externalSignal = requestOptions.signal;

  if (externalSignal?.aborted === true) {
    throw createAbortError();
  }

  const requestController = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      requestController.abort();
      reject(createTimeoutError());
    }, timeoutMs);
  });

  const abort =
    externalSignal === undefined
      ? undefined
      : new Promise<never>((_, reject) => {
          const handleAbort = (): void => {
            requestController.abort();
            reject(createAbortError());
          };

          if (externalSignal.aborted) {
            handleAbort();
            return;
          }

          externalSignal.addEventListener("abort", handleAbort, { once: true });
          removeAbortListener = () => {
            externalSignal.removeEventListener("abort", handleAbort);
          };
        });

  const headers: HeadersInit = { Accept: "application/json" };
  if (requestOptions.idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = requestOptions.idempotencyKey;
  }
  if (body !== undefined && !isFormDataBody(body)) {
    headers["Content-Type"] = "application/json";
  }

  const init: RequestInit = {
    credentials: "include",
    method,
    headers,
    signal: requestController.signal
  };
  if (body !== undefined) {
    init.body = isFormDataBody(body) ? body : JSON.stringify(body);
  }

  const request = Promise.resolve()
    .then(() => fetchImpl(`${apiUrl}${path}`, init))
    .then(async (response): Promise<T> => {
      throwIfAborted(timedOut, externalSignal);

      let responseBody: unknown;

      try {
        responseBody = await response.json();
      } catch {
        throwIfAborted(timedOut, externalSignal);
        throw createInvalidResponseError();
      }

      throwIfAborted(timedOut, externalSignal);

      if (!response.ok) {
        throw getHttpError(responseBody, response.status);
      }

      const parsed = responseSchema.safeParse(responseBody) as
        | { readonly success: true; readonly data: T }
        | { readonly success: false };

      if (!parsed.success) {
        throw createInvalidResponseError();
      }

      return parsed.data;
    });

  try {
    const races: Array<Promise<T>> = [request, timeout];

    if (abort !== undefined) {
      races.push(abort);
    }

    return await Promise.race(races);
  } catch (error: unknown) {
    if (error instanceof CatalogClientError) {
      throw error;
    }

    if (timedOut) {
      throw createTimeoutError();
    }

    if (externalSignal?.aborted) {
      throw createAbortError();
    }

    throw new CatalogClientError(
      "network",
      "Не удалось связаться с Backend API"
    );
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    removeAbortListener?.();
  }
}

const CatalogProductMutationResponseSchema = {
  safeParse(value: unknown): unknown {
    return zProductMutationResponse.safeParse(value);
  }
};

const zProductMutationResponse = {
  safeParse(value: unknown): unknown {
    if (typeof value !== "object" || value === null || !("product" in value)) {
      return { success: false };
    }

    const product = CatalogProductSchema.safeParse(value.product);
    return product.success
      ? { success: true, data: { product: product.data } }
      : { success: false };
  }
};

const CatalogCategoryMutationResponseSchema = {
  safeParse(value: unknown): unknown {
    return CatalogAdminCategoryResponseSchema.safeParse(value);
  }
};

function unwrapProduct(value: { readonly product: CatalogProduct }): CatalogProduct {
  return value.product;
}

function unwrapCategory(
  value: { readonly category: CatalogCategory }
): CatalogCategory {
  return value.category;
}

export function createCatalogClient(options: CatalogClientOptions): CatalogClient {
  const apiUrl = resolveApiUrl(options.apiUrl);
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const fetchImpl =
    options.fetchImpl ??
    ((input: string, init?: RequestInit) => fetch(input, init));

  return {
    async getCatalog(requestOptions = {}): Promise<CatalogResponse> {
      return requestJson(
        apiUrl,
        fetchImpl,
        timeoutMs,
        "/catalog",
        "GET",
        CatalogResponseSchema,
        undefined,
        requestOptions
      );
    },

    async getAdminCatalog(requestOptions = {}): Promise<CatalogResponse> {
      return requestJson(
        apiUrl,
        fetchImpl,
        timeoutMs,
        "/admin/catalog",
        "GET",
        CatalogResponseSchema,
        undefined,
        requestOptions
      );
    },

    async listCategories(requestOptions = {}): Promise<CatalogAdminCategoriesResponse> {
      return requestJson(
        apiUrl,
        fetchImpl,
        timeoutMs,
        "/admin/categories",
        "GET",
        CatalogAdminCategoriesResponseSchema,
        undefined,
        requestOptions
      );
    },

    async createCategory(input, requestOptions = {}): Promise<CatalogCategory> {
      const validInput = parseInput<CatalogCategoryInput>(
        CatalogCategoryInputSchema,
        input
      );
      const response = await requestJson<{
        readonly category: CatalogCategory;
      }>(
        apiUrl,
        fetchImpl,
        timeoutMs,
        "/admin/categories",
        "POST",
        CatalogCategoryMutationResponseSchema,
        validInput,
        mutationRequestOptions(requestOptions)
      );

      return unwrapCategory(response);
    },

    async updateCategory(id, input, requestOptions = {}): Promise<CatalogCategory> {
      if (!Number.isSafeInteger(id) || id < 1) {
        throw createValidationError();
      }
      const validInput = parseInput<CatalogCategoryUpdate>(
        CatalogCategoryUpdateSchema,
        input
      );
      const response = await requestJson<{
        readonly category: CatalogCategory;
      }>(
        apiUrl,
        fetchImpl,
        timeoutMs,
        `/admin/categories/${encodeURIComponent(String(id))}`,
        "PATCH",
        CatalogCategoryMutationResponseSchema,
        validInput,
        mutationRequestOptions(requestOptions)
      );

      return unwrapCategory(response);
    },

    async uploadImage(file): Promise<MediaUploadResponse> {
      const formData = new FormData();
      formData.append("file", file, "upload");

      return requestJson(
        apiUrl,
        fetchImpl,
        timeoutMs,
        "/admin/media/images",
        "POST",
        MediaUploadResponseSchema,
        formData,
        {}
      );
    },

    async createProduct(input): Promise<CatalogProduct> {
      const validInput = parseInput<CatalogProductInput>(
        CatalogProductInputSchema,
        input
      );
      const response = await requestJson<{
        readonly product: CatalogProduct;
      }>(
        apiUrl,
        fetchImpl,
        timeoutMs,
        "/admin/products",
        "POST",
        CatalogProductMutationResponseSchema,
        validInput,
        {}
      );

      return unwrapProduct(response);
    },

    async updateProduct(id, input): Promise<CatalogProduct> {
      const validInput = parseInput<CatalogProductUpdate>(
        CatalogProductUpdateSchema,
        input
      );
      const response = await requestJson<{
        readonly product: CatalogProduct;
      }>(
        apiUrl,
        fetchImpl,
        timeoutMs,
        `/admin/products/${encodeURIComponent(String(id))}`,
        "PATCH",
        CatalogProductMutationResponseSchema,
        validInput,
        {}
      );

      return unwrapProduct(response);
    }
  };
}
