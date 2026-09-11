import { describe, expect, it, vi } from "vitest";

import {
  type AuthSessionTransport,
  type CheckoutClient
} from "@vse-pro-zhar/api-client";
import {
  CheckoutOptionsResponseSchema,
  CheckoutQuoteResponseSchema
} from "@vse-pro-zhar/contracts";

import {
  CheckoutClientError,
  createCheckoutClient
} from "../src/checkout-client.js";
import type { FetchImplementation } from "../src/health-client.js";

const pickup = {
  locationId: "main-grill",
  slotId: "main-grill-2026-09-01-1800"
} as const;

const validOptions = CheckoutOptionsResponseSchema.parse({
  locations: [
    {
      id: "main-grill",
      name: "Основная точка",
      address: "Основная точка самовывоза",
      timezone: "Europe/Moscow",
      slots: [
        {
          id: pickup.slotId,
          label: "Сегодня, 18:00–18:30",
          startsAt: "2026-09-01T15:00:00.000Z",
          endsAt: "2026-09-01T15:30:00.000Z"
        }
      ]
    }
  ]
});

const validQuote = CheckoutQuoteResponseSchema.parse({
  customer: { phone: "+79991234567", name: "Анна", birthDate: null },
  items: [
    {
      productId: 1,
      productName: "Шашлык",
      quantity: 2,
      unitPriceMinor: 45_050,
      lineTotalMinor: 90_100
    }
  ],
  totalMinor: 90_100,
  pickup: {
    location: {
      id: "main-grill",
      name: "Основная точка",
      address: "Основная точка самовывоза",
      timezone: "Europe/Moscow"
    },
    slot: validOptions.locations[0]?.slots[0]
  },
  confirmationText: "Проверка завершена. Заказ ещё не создан."
});

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

function cookieTransport(): AuthSessionTransport {
  return {
    mode: "cookie",
    getRequestHeaders: async () => ({}),
    storeSession: async () => undefined,
    clearSession: async () => undefined
  };
}

describe("shared checkout client", () => {
  it("loads options and posts only cart references plus pickup selection", async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async (url, init) => {
      if (url.endsWith("/checkout/options")) {
        expect(init?.method).toBe("GET");
        expect(init?.credentials).toBe("include");
        return makeResponse(validOptions);
      }

      expect(url).toBe("http://127.0.0.1:3000/checkout/quote");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        Accept: "application/json",
        "Content-Type": "application/json"
      });
      expect(init?.body).toBe(
        JSON.stringify({
          items: [{ productId: 1, quantity: 2 }],
          pickup
        })
      );
      return makeResponse(validQuote);
    });
    const client = createCheckoutClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl,
      transport: cookieTransport()
    });

    await expect(client.getCheckoutOptions()).resolves.toEqual(validOptions);
    await expect(
      client.getCheckoutQuote({ items: [{ productId: 1, quantity: 2 }], pickup })
    ).resolves.toEqual(validQuote);
  });

  it("rejects client totals and validates response selection", async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async () => makeResponse(validQuote));
    const client = createCheckoutClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl,
      transport: cookieTransport()
    });

    await expect(
      client.getCheckoutQuote({
        items: [{ productId: 1, quantity: 1 }],
        pickup,
        totalMinor: 1
      } as never)
    ).rejects.toMatchObject({ kind: "validation" });
    expect(fetchImpl).not.toHaveBeenCalled();

    const mismatchClient = createCheckoutClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl: async () =>
        makeResponse({
          ...validQuote,
          pickup: { ...validQuote.pickup, slot: { ...validQuote.pickup.slot, id: "other-slot" } }
        }),
      transport: cookieTransport()
    });
    await expect(
      mismatchClient.getCheckoutQuote({ items: [{ productId: 1, quantity: 2 }], pickup })
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("maps safe backend errors and handles network, timeout and abort", async () => {
    const unavailableClient = createCheckoutClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl: async () =>
        makeResponse(
          {
            error: {
              code: "PICKUP_OPTION_UNAVAILABLE",
              message: "Выбранное время самовывоза больше недоступно",
              requestId: "request-1"
            }
          },
          409
        ),
      transport: cookieTransport()
    });
    await expect(unavailableClient.getCheckoutOptions()).rejects.toMatchObject({
      kind: "pickup_unavailable",
      code: "PICKUP_OPTION_UNAVAILABLE"
    });

    const networkClient = createCheckoutClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl: async () => {
        throw new Error("private network detail");
      },
      transport: cookieTransport()
    });
    await expect(networkClient.getCheckoutOptions()).rejects.toMatchObject({
      kind: "network",
      message: "Не удалось связаться с Backend API"
    });

    vi.useFakeTimers();
    try {
      const timeoutClient = createCheckoutClient({
        apiUrl: "http://127.0.0.1:3000",
        timeoutMs: 20,
        fetchImpl: async () => new Promise<Response>(() => undefined),
        transport: cookieTransport()
      });
      const timedOut = expect(timeoutClient.getCheckoutOptions()).rejects.toMatchObject({
        kind: "timeout"
      });
      await vi.advanceTimersByTimeAsync(20);
      await timedOut;

      const controller = new AbortController();
      const abortClient = createCheckoutClient({
        apiUrl: "http://127.0.0.1:3000",
        fetchImpl: async () => new Promise<Response>(() => undefined),
        transport: cookieTransport()
      });
      const aborted = expect(
        abortClient.getCheckoutOptions({ signal: controller.signal })
      ).rejects.toMatchObject({ kind: "aborted" });
      controller.abort();
      await aborted;
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes a typed error and preserves the public client shape", () => {
    const error = new CheckoutClientError("validation", "invalid");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBeNull();
    const client: CheckoutClient = createCheckoutClient({
      apiUrl: "http://127.0.0.1:3000",
      transport: cookieTransport(),
      fetchImpl: async () => makeResponse(validOptions)
    });
    expect(typeof client.getCheckoutOptions).toBe("function");
  });
});
