import { describe, expect, it } from "vitest";

import type { AuthSessionTransport } from "../src/index.js";
import {
  OrderClientError,
  createOrderClient,
  type FetchImplementation
} from "../src/index.js";
import type { OrderResponse } from "@vse-pro-zhar/contracts";

const order: OrderResponse = {
  id: 11,
  status: "pending_payment",
  totalMinor: 45_050,
  currency: "RUB",
  pickup: {
    location: {
      id: "main-grill",
      name: "Основная точка",
      address: "Основная точка самовывоза",
      timezone: "Europe/Moscow"
    },
    slot: {
      id: "slot-1",
      label: "Сегодня, 18:00–18:30",
      startsAt: "2026-09-01T15:00:00.000Z",
      endsAt: "2026-09-01T15:30:00.000Z"
    }
  },
  createdAt: "2026-09-01T07:00:00.000Z",
  updatedAt: "2026-09-01T07:00:00.000Z",
  items: [
    {
      productId: 1,
      productName: "Шашлык",
      unitPriceMinor: 45_050,
      quantity: 1,
      lineTotalMinor: 45_050
    }
  ]
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

function transport(): AuthSessionTransport {
  return {
    mode: "cookie",
    getRequestHeaders: async () => ({}),
    storeSession: async () => undefined,
    clearSession: async () => undefined
  };
}

describe("shared order client", () => {
  it("sends only order references plus Idempotency-Key and reads own orders", async () => {
    const fetchImpl: FetchImplementation = async (url, init) => {
      if (url.endsWith("/orders") && init?.method === "POST") {
        expect(init.headers).toEqual({
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": "retry-key"
        });
        expect(init.body).toBe(JSON.stringify({
          items: [{ productId: 1, quantity: 1 }],
          pickup: { locationId: "main-grill", slotId: "slot-1" }
        }));
        return response(order, 201);
      }
      if (url.endsWith("/orders") && init?.method === "GET") {
        const summary = Object.fromEntries(
          Object.entries(order).filter(([key]) => key !== "items")
        );
        return response({ orders: [summary] });
      }
      return response(order);
    };
    const client = createOrderClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl,
      transport: transport()
    });

    await expect(client.createOrder(
      {
        items: [{ productId: 1, quantity: 1 }],
        pickup: { locationId: "main-grill", slotId: "slot-1" }
      },
      { idempotencyKey: "retry-key" }
    )).resolves.toEqual(order);
    await expect(client.listOrders()).resolves.toMatchObject({ orders: [{ id: 11 }] });
    await expect(client.getOrder(11)).resolves.toEqual(order);
  });

  it("maps idempotency conflict and rejects client money fields before fetch", async () => {
    let calls = 0;
    const client = createOrderClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl: async () => {
        calls += 1;
        return response({
          error: {
            code: "IDEMPOTENCY_CONFLICT",
            message: "Этот ключ уже использован для другого заказа",
            requestId: "request-1"
          }
        }, 409);
      },
      transport: transport()
    });
    await expect(client.createOrder(
      { items: [{ productId: 1, quantity: 1 }], pickup: { locationId: "main-grill", slotId: "slot-1" } },
      { idempotencyKey: "key" }
    )).rejects.toMatchObject({ kind: "idempotency_conflict", code: "IDEMPOTENCY_CONFLICT" });
    await expect(client.createOrder(
      { items: [{ productId: 1, quantity: 1 }], pickup: { locationId: "main-grill", slotId: "slot-1" }, totalMinor: 1 } as never,
      { idempotencyKey: "key" }
    )).rejects.toBeInstanceOf(OrderClientError);
    expect(calls).toBe(1);
  });
});
