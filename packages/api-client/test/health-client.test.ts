import { describe, expect, it, vi } from "vitest";

import { HealthResponseSchema } from "@vse-pro-zhar/contracts";

import {
  createHealthClient,
  HealthClientError,
  type FetchImplementation
} from "../src/health-client.js";

const validHealthResponse = HealthResponseSchema.parse({
  service: "api",
  status: "ok",
  environment: "test",
  timestamp: "2026-08-31T10:00:00.000Z"
});

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

function createClient(
  fetchImpl: FetchImplementation,
  options: { readonly apiUrl?: string; readonly timeoutMs?: number } = {}
) {
  const clientOptions = {
    apiUrl: options.apiUrl ?? "http://127.0.0.1:3000",
    fetchImpl
  };

  return options.timeoutMs === undefined
    ? createHealthClient(clientOptions)
    : createHealthClient({ ...clientOptions, timeoutMs: options.timeoutMs });
}

describe("shared health client", () => {
  it("accepts and validates a valid shared-contract response", async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async (url, init) => {
      expect(url).toBe("http://127.0.0.1:3000/health");
      expect(init?.headers).toEqual({ Accept: "application/json" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return makeResponse(validHealthResponse);
    });

    await expect(createClient(fetchImpl).getHealth()).resolves.toEqual(
      validHealthResponse
    );
  });

  it("rejects an invalid response without exposing parser details", async () => {
    const client = createClient(async () =>
      makeResponse({ service: "api", status: "broken" })
    );

    await expect(client.getHealth()).rejects.toMatchObject({
      kind: "invalid_response",
      message: "Backend API вернул некорректный ответ"
    });
  });

  it("rejects malformed JSON as an invalid response", async () => {
    const client = createClient(async () =>
      new Response("not-json", {
        headers: { "content-type": "application/json" },
        status: 200
      })
    );

    await expect(client.getHealth()).rejects.toMatchObject({
      kind: "invalid_response",
      message: "Backend API вернул некорректный ответ"
    });
  });

  it("turns an HTTP failure into a controlled error", async () => {
    const client = createClient(async () => makeResponse({}, 503));

    await expect(client.getHealth()).rejects.toMatchObject({
      kind: "http",
      message: "Backend API временно недоступен"
    });
  });

  it("turns a network failure, including a synchronous fetch throw, into a controlled error", async () => {
    const client = createClient(() => {
      throw new Error("network-only-detail");
    });

    const error = await client.getHealth().catch((value: unknown) => value);

    expect(error).toBeInstanceOf(HealthClientError);
    expect(error).toMatchObject({
      kind: "network",
      message: "Не удалось связаться с Backend API"
    });
    expect(JSON.stringify(error)).not.toContain("network-only-detail");
  });

  it("rejects malformed API URLs before making a request", async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async () =>
      makeResponse(validHealthResponse)
    );
    const client = createClient(fetchImpl, {
      apiUrl: "postgresql://user:password@example.test/app"
    });

    await expect(client.getHealth()).rejects.toMatchObject({
      kind: "configuration",
      message: "Адрес Backend API настроен некорректно"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aborts a request when the timeout expires", async () => {
    vi.useFakeTimers();

    try {
      let requestSignal: AbortSignal | undefined;
      const fetchImpl: FetchImplementation = async (_url, init) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      };
      const request = createClient(fetchImpl, { timeoutMs: 25 }).getHealth();
      const assertion = expect(request).rejects.toMatchObject({
        kind: "timeout",
        message: "Backend API не ответил вовремя"
      });

      await vi.advanceTimersByTimeAsync(25);

      await assertion;
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("distinguishes an external abort from a timeout", async () => {
    const requestController = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl: FetchImplementation = async (_url, init) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    };

    const request = createClient(fetchImpl, { timeoutMs: 1_000 }).getHealth({
      signal: requestController.signal
    });
    const assertion = expect(request).rejects.toMatchObject({
      kind: "aborted",
      message: "Запрос к Backend API отменён"
    });
    requestController.abort();

    await assertion;
    expect(requestSignal?.aborted).toBe(true);
  });
});
