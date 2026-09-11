import { describe, expect, it } from "vitest";

import type {
  IikoDispatchOrder,
  IikoDispatchRepository,
  IikoDispatchUpdate,
  IikoOrderDispatchRecord
} from "@vse-pro-zhar/database";

import {
  IikoDispatchProcessor,
  mapIikoOrderStatus
} from "../src/iiko/processor.js";
import {
  IikoFulfillmentProviderError,
  type IikoFulfillmentProvider
} from "../src/iiko/fulfillment.js";

const now = new Date("2026-09-01T10:00:00.000Z");
const correlationId = "90000000-0000-4000-8000-000000000099";

function dispatchRecord(status: IikoOrderDispatchRecord["status"] = "pending"): IikoOrderDispatchRecord {
  return {
    id: 1,
    orderId: 1,
    correlationId,
    providerOrderId: null,
    commandId: null,
    status,
    attemptCount: 0,
    nextAttemptAt: now,
    lastAttemptAt: null,
    lastErrorCode: null,
    createdAt: now,
    updatedAt: now
  };
}

function claimedOrder(dispatch: IikoOrderDispatchRecord): IikoDispatchOrder {
  return {
    dispatch,
    order: {
      id: 1,
      customerId: 1,
      pickupLocationId: "main-grill",
      pickupLocationName: "Основная точка",
      pickupLocationAddress: "Основная точка",
      pickupLocationTimezone: "Europe/Moscow",
      pickupSlotId: "slot-1",
      pickupSlotLabel: "Сегодня, 18:00–18:30",
      pickupSlotStartsAt: now,
      pickupSlotEndsAt: new Date(now.getTime() + 1_800_000),
      status: "payment_confirmed",
      totalMinor: 61_000,
      currency: "RUB",
      idempotencyKey: "order-1",
      payloadFingerprint: "a".repeat(64),
      createdAt: now,
      updatedAt: now
    },
    customer: { phone: "+79991234567", name: "Анна" },
    items: [
      {
        id: 1,
        orderId: 1,
        productId: 1,
        productName: "Шашлык",
        unitPriceMinor: 61_000,
        quantity: 1,
        lineTotalMinor: 61_000,
        iikoProductId: "10000000-0000-4000-8000-000000000001"
      }
    ]
  };
}

function fakeRepository(initial = dispatchRecord()): {
  readonly repository: IikoDispatchRepository;
  readonly dispatch: IikoOrderDispatchRecord;
  readonly order: IikoDispatchOrder["order"];
  readonly updates: IikoDispatchUpdate[];
  readonly failures: string[];
} {
  let dispatch = initial;
  let order = claimedOrder(dispatch).order;
  const updates: IikoDispatchUpdate[] = [];
  const failures: string[] = [];
  const repository: IikoDispatchRepository = {
    async claimNextDue(at, leaseMs) {
      if (dispatch.status === "failed" || dispatch.nextAttemptAt > at) return null;
      const claimed = { ...dispatch, status: dispatch.status === "pending" ? "creating" : dispatch.status, nextAttemptAt: new Date(at.getTime() + leaseMs), lastAttemptAt: at, updatedAt: at };
      dispatch = claimed;
      return claimedOrder(claimed);
    },
    async updateDispatch(id, update, at) {
      updates.push(update);
      dispatch = { ...dispatch, ...update, id, updatedAt: at };
    },
    async failDispatch(id, orderId, errorCode, at, attemptCount) {
      void id;
      void orderId;
      failures.push(errorCode);
      dispatch = { ...dispatch, status: "failed", lastErrorCode: errorCode, attemptCount: attemptCount ?? dispatch.attemptCount, updatedAt: at };
      order = { ...order, status: "fulfillment_problem", updatedAt: at };
    },
    async applyOrderStatus(orderId, status, at) {
      void orderId;
      order = { ...order, status, updatedAt: at };
      return true;
    },
    async findByOrderId() {
      return dispatch;
    }
  };
  return {
    repository,
    get dispatch() {
      return dispatch;
    },
    get order() {
      return order;
    },
    updates,
    failures
  };
}

describe("iiko fulfillment processor", () => {
  it("maps provider lifecycle and keeps one correlation ID across polling", async () => {
    expect(mapIikoOrderStatus("Unconfirmed")).toBeNull();
    expect(mapIikoOrderStatus("WaitCooking")).toBe("kitchen_accepted");
    expect(mapIikoOrderStatus("CookingStarted")).toBe("preparing");
    expect(mapIikoOrderStatus("CookingCompleted")).toBe("ready_for_pickup");
    expect(mapIikoOrderStatus("Closed")).toBe("completed");
    expect(mapIikoOrderStatus("Cancelled")).toBe("fulfillment_problem");

    const state = fakeRepository();
    const createCorrelationIds: string[] = [];
    const provider: IikoFulfillmentProvider = {
      async createOrder(input) {
        createCorrelationIds.push(input.correlationId);
        return { providerOrderId: input.correlationId, commandId: null, state: "submitted" };
      },
      async getCommandStatus() {
        return { state: "succeeded" };
      },
      async getOrder() {
        return { providerOrderId: correlationId, status: "Unconfirmed" };
      }
    };
    const processor = new IikoDispatchProcessor(state.repository, provider, {
      now: () => now,
      pollMs: 100,
      intervalMs: 100,
      retryDelaysMs: [1]
    });

    await expect(processor.runOnce()).resolves.toBe(2);
    expect(createCorrelationIds).toEqual([correlationId]);
    expect(state.updates.at(-1)).toMatchObject({
      status: "submitted",
      providerOrderId: correlationId
    });
    await processor.stop();
  });

  it("retries retryable faults and turns exhausted delivery into a controlled problem", async () => {
    const state = fakeRepository();
    const provider: IikoFulfillmentProvider = {
      async createOrder() {
        throw new IikoFulfillmentProviderError("retryable", "timeout");
      },
      async getCommandStatus() {
        throw new Error("not expected");
      },
      async getOrder() {
        throw new Error("not expected");
      }
    };
    let currentNow = now;
    const processor = new IikoDispatchProcessor(state.repository, provider, {
      now: () => currentNow,
      maxAttempts: 2,
      retryDelaysMs: [1],
      intervalMs: 100
    });

    await processor.runOnce();
    expect(state.failures).toEqual([]);
    currentNow = new Date(now.getTime() + 1);
    await processor.runOnce();
    expect(state.failures).toEqual(["retry_exhausted"]);
    expect(state.order.status).toBe("fulfillment_problem");
    await processor.stop();
  });

  it("does not let a second processor claim the same due dispatch", async () => {
    const state = fakeRepository();
    let createCalls = 0;
    const provider: IikoFulfillmentProvider = {
      async createOrder(input) {
        createCalls += 1;
        return { providerOrderId: input.correlationId, commandId: null, state: "submitted" };
      },
      async getCommandStatus() {
        return { state: "succeeded" };
      },
      async getOrder() {
        return { providerOrderId: correlationId, status: "Closed" };
      }
    };
    const first = new IikoDispatchProcessor(state.repository, provider, { now: () => now, intervalMs: 100 });
    const second = new IikoDispatchProcessor(state.repository, provider, { now: () => now, intervalMs: 100 });
    await Promise.all([first.runOnce(), second.runOnce()]);
    expect(createCalls).toBe(1);
    await first.stop();
    await second.stop();
  });
});
