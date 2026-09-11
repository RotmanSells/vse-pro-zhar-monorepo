import { describe, expect, it, vi } from "vitest";

import { CartQuoteResponseSchema } from "@vse-pro-zhar/contracts";

import {
  CartQuoteClientError,
  createCartQuoteClient
} from "../src/cart-quote-client.js";
import type { FetchImplementation } from "../src/health-client.js";

const validQuote = CartQuoteResponseSchema.parse({
  items: [
    {
      productId: 1,
      quantity: 2,
      unitPriceMinor: 45_050,
      lineTotalMinor: 90_100
    }
  ],
  totalMinor: 90_100
});

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

describe("shared cart quote client", () => {
  it("posts only validated cart references and validates the quote", async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async (url, init) => {
      expect(url).toBe("http://127.0.0.1:3000/cart/quote");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        Accept: "application/json",
        "Content-Type": "application/json"
      });
      expect(init?.body).toBe(
        JSON.stringify({ items: [{ productId: 1, quantity: 2 }] })
      );
      return makeResponse(validQuote);
    });
    const client = createCartQuoteClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl
    });

    await expect(
      client.getCartQuote({ items: [{ productId: 1, quantity: 2 }] })
    ).resolves.toEqual(validQuote);
  });

  it("rejects malformed client input before network access", async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async () => makeResponse(validQuote));
    const client = createCartQuoteClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl
    });

    await expect(
      client.getCartQuote({
        items: [{ productId: 1, quantity: 1.5 }]
      })
    ).rejects.toMatchObject({
      kind: "validation",
      message: "Проверьте данные корзины"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a mathematically valid quote for different cart items", async () => {
    const client = createCartQuoteClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl: async () =>
        makeResponse({
          items: [
            {
              productId: 1,
              quantity: 3,
              unitPriceMinor: 500,
              lineTotalMinor: 1_500
            }
          ],
          totalMinor: 1_500
        })
    });

    await expect(
      client.getCartQuote({ items: [{ productId: 1, quantity: 2 }] })
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("keeps the safe unavailable error code from Backend", async () => {
    const client = createCartQuoteClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl: async () =>
        makeResponse(
          {
            error: {
              code: "CART_ITEM_UNAVAILABLE",
              message: "Некоторые блюда больше недоступны",
              requestId: "request-1"
            }
          },
          409
        )
    });

    await expect(
      client.getCartQuote({ items: [{ productId: 1, quantity: 1 }] })
    ).rejects.toMatchObject({
      kind: "http",
      code: "CART_ITEM_UNAVAILABLE",
      message: "Некоторые блюда больше недоступны"
    });
  });

  it("handles network and invalid response failures", async () => {
    const networkClient = createCartQuoteClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl: async () => {
        throw new Error("transport detail");
      }
    });
    await expect(
      networkClient.getCartQuote({ items: [{ productId: 1, quantity: 1 }] })
    ).rejects.toMatchObject({
      kind: "network",
      message: "Не удалось связаться с Backend API"
    });

    const invalidResponseClient = createCartQuoteClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl: async () => makeResponse({ items: [], totalMinor: 0 })
    });
    await expect(
      invalidResponseClient.getCartQuote({ items: [{ productId: 1, quantity: 1 }] })
    ).rejects.toMatchObject({
      kind: "invalid_response",
      message: "Backend API вернул некорректный ответ"
    });
  });

  it("handles timeout and external abort", async () => {
    vi.useFakeTimers();
    try {
      const timeoutClient = createCartQuoteClient({
        apiUrl: "http://127.0.0.1:3000",
        timeoutMs: 20,
        fetchImpl: async () => new Promise<Response>(() => undefined)
      });
      const timeoutRequest = expect(
        timeoutClient.getCartQuote({
          items: [{ productId: 1, quantity: 1 }]
        })
      ).rejects.toMatchObject({ kind: "timeout" });
      await vi.advanceTimersByTimeAsync(20);
      await timeoutRequest;

      const abortController = new AbortController();
      const abortClient = createCartQuoteClient({
        apiUrl: "http://127.0.0.1:3000",
        fetchImpl: async () => new Promise<Response>(() => undefined)
      });
      const abortRequest = expect(
        abortClient.getCartQuote(
          { items: [{ productId: 1, quantity: 1 }] },
          { signal: abortController.signal }
        )
      ).rejects.toMatchObject({ kind: "aborted" });
      abortController.abort();
      await abortRequest;
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes typed client errors", () => {
    const error = new CartQuoteClientError("validation", "invalid");
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe("validation");
    expect(error.code).toBeNull();
  });
});
