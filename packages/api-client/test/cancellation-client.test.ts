import { describe, expect, it } from "vitest";

import {
  CancellationClientError,
  createCancellationClient,
  type AuthSessionTransport,
  type FetchImplementation
} from "../src/index.js";

const order = {
  id: 7,
  status: "canceled" as const,
  totalMinor: 45_050,
  currency: "RUB",
  pickup: {
    location: { id: "main-grill", name: "Основная точка", address: "ул. Жара, 1", timezone: "Europe/Moscow" },
    slot: { id: "slot-1", label: "Сегодня, 18:00–18:30", startsAt: "2026-09-01T15:00:00.000Z", endsAt: "2026-09-01T15:30:00.000Z" }
  },
  createdAt: "2026-09-01T07:00:00.000Z",
  updatedAt: "2026-09-01T07:01:00.000Z",
  items: [{ productId: 1, productName: "Шашлык", unitPriceMinor: 45_050, quantity: 1, lineTotalMinor: 45_050 }],
  cancellationRefund: {
    cancellation: { actorType: "customer" as const, reasonCode: "customer_requested" as const, createdAt: "2026-09-01T07:01:00.000Z", updatedAt: "2026-09-01T07:01:00.000Z" },
    refund: { status: "pending" as const, amountMinor: 45_050, currency: "RUB", attemptedAt: null, lastConfirmedAt: null, lastErrorCode: null },
    canCancel: false,
    canReconcile: false
  }
};

function transport(): AuthSessionTransport {
  return { mode: "cookie", getRequestHeaders: async () => ({}), storeSession: async () => undefined, clearSession: async () => undefined };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("shared cancellation client", () => {
  it("sends an empty body and only a stable idempotency key", async () => {
    const fetchImpl: FetchImplementation = async (url, init) => {
      expect(url).toBe("http://127.0.0.1:3000/orders/7/cancel");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe("{}");
      expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe("cancel-7");
      return response({ order, outcome: "refund_pending" });
    };
    const client = createCancellationClient({ apiUrl: "http://127.0.0.1:3000", transport: transport(), fetchImpl });
    await expect(client.cancelOrder(7, { idempotencyKey: "cancel-7" })).resolves.toMatchObject({ order: { status: "canceled" }, outcome: "refund_pending" });
  });

  it("maps server-side cancellation decisions without exposing client authority", async () => {
    const client = createCancellationClient({
      apiUrl: "http://127.0.0.1:3000",
      transport: transport(),
      fetchImpl: async () => response({ error: { code: "CANCELLATION_NOT_ALLOWED", message: "Отмена этого заказа сейчас недоступна", requestId: "request-1" } }, 409)
    });
    await expect(client.cancelOrder(7, { idempotencyKey: "cancel-7" })).rejects.toMatchObject({ kind: "not_allowed", code: "CANCELLATION_NOT_ALLOWED" });
    await expect(client.cancelOrder(7, { idempotencyKey: "" })).rejects.toBeInstanceOf(CancellationClientError);
  });
});
