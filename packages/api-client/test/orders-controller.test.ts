import { describe, expect, it } from "vitest";

import {
  OrderClientError,
  createOrderRequestController,
  type OrderClient,
  type OrderCreateRequestState
} from "../src/index.js";
import type { OrderResponse } from "@vse-pro-zhar/contracts";

const order: OrderResponse = {
  id: 1,
  status: "pending_payment",
  totalMinor: 500,
  currency: "RUB",
  pickup: {
    location: { id: "main-grill", name: "Точка", address: "Адрес", timezone: "Europe/Moscow" },
    slot: { id: "slot-1", label: "Сегодня, 18:00–18:30", startsAt: "2026-09-01T15:00:00.000Z", endsAt: "2026-09-01T15:30:00.000Z" }
  },
  createdAt: "2026-09-01T07:00:00.000Z",
  updatedAt: "2026-09-01T07:00:00.000Z",
  items: [{ productId: 1, productName: "Блюдо", unitPriceMinor: 500, quantity: 1, lineTotalMinor: 500 }]
};

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("order request controller", () => {
  it("retries with the same idempotency key after a network error", async () => {
    let calls = 0;
    const keys: string[] = [];
    const states: OrderCreateRequestState[] = [];
    const client: OrderClient = {
      createOrder: async (_input, options) => {
        calls += 1;
        keys.push(options.idempotencyKey);
        if (calls === 1) throw new OrderClientError("network", "network");
        return order;
      },
      listOrders: async () => ({ orders: [] }),
      getOrder: async () => order
    };
    const controller = createOrderRequestController(
      client,
      (state) => states.push(state),
      () => undefined,
      () => undefined
    );
    const input = {
      items: [{ productId: 1, quantity: 1 }],
      pickup: { locationId: "main-grill", slotId: "slot-1" }
    };
    controller.create(input, "stable-key");
    await flush();
    expect(states.at(-1)).toMatchObject({ status: "error" });
    controller.retryCreate();
    await flush();
    expect(states.at(-1)).toMatchObject({ status: "success", order });
    expect(keys).toEqual(["stable-key", "stable-key"]);
    controller.dispose();
  });
});
