import {
  HealthResponseSchema,
  type HealthResponse
} from "@vse-pro-zhar/contracts";

const DEFAULT_API_URL = "http://127.0.0.1:3000";

export type HealthClientErrorKind =
  | "configuration"
  | "network"
  | "http"
  | "invalid_response";

export class HealthClientError extends Error {
  readonly kind: HealthClientErrorKind;

  constructor(
    kind: HealthClientErrorKind,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "HealthClientError";
    this.kind = kind;
  }
}

export interface HealthClientOptions {
  readonly apiUrl?: string;
  readonly fetchImpl?: FetchImplementation;
}

export type FetchImplementation = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export interface HealthClient {
  getHealth(): Promise<HealthResponse>;
}

function resolveApiUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch (error: unknown) {
    throw new HealthClientError(
      "configuration",
      "Адрес Backend API настроен некорректно",
      { cause: error }
    );
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new HealthClientError(
      "configuration",
      "Адрес Backend API настроен некорректно"
    );
  }

  return url.origin;
}

function getConfiguredApiUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;
}

export function createHealthClient(
  options: HealthClientOptions = {}
): HealthClient {
  const fetchImpl =
    options.fetchImpl ??
    ((input: string, init?: RequestInit) => fetch(input, init));
  const configuredApiUrl = options.apiUrl ?? getConfiguredApiUrl();

  return {
    async getHealth(): Promise<HealthResponse> {
      const apiUrl = resolveApiUrl(configuredApiUrl);
      let response: Response;

      try {
        response = await fetchImpl(`${apiUrl}/health`, {
          headers: { Accept: "application/json" }
        });
      } catch (error: unknown) {
        throw new HealthClientError(
          "network",
          "Не удалось связаться с Backend API",
          { cause: error }
        );
      }

      if (!response.ok) {
        throw new HealthClientError(
          "http",
          "Backend API временно недоступен"
        );
      }

      let body: unknown;

      try {
        body = await response.json();
      } catch (error: unknown) {
        throw new HealthClientError(
          "invalid_response",
          "Backend API вернул некорректный ответ",
          { cause: error }
        );
      }

      const parsed = HealthResponseSchema.safeParse(body);

      if (!parsed.success) {
        throw new HealthClientError(
          "invalid_response",
          "Backend API вернул некорректный ответ",
          { cause: parsed.error }
        );
      }

      return parsed.data;
    }
  };
}
