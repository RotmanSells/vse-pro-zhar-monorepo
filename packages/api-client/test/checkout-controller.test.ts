import { describe, expect, it } from "vitest";

import {
  createCheckoutRequestController,
  CheckoutClientError,
  type CheckoutClient,
  type CheckoutOptionsRequestState,
  type CheckoutQuoteRequestState
} from "../src/index.js";
import type {
  CheckoutOptionsResponse,
  CheckoutQuoteResponse
} from "@vse-pro-zhar/contracts";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (reason: unknown) => void;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const options: CheckoutOptionsResponse = {
  locations: [
    {
      id: "main-grill",
      name: "Основная точка",
      address: "Основная точка самовывоза",
      timezone: "Europe/Moscow",
      slots: [
        {
          id: "slot-1",
          label: "Сегодня, 18:00–18:30",
          startsAt: "2026-09-01T15:00:00.000Z",
          endsAt: "2026-09-01T15:30:00.000Z"
        }
      ]
    }
  ]
};

function quote(quantity: number): CheckoutQuoteResponse {
  const lineTotalMinor = quantity * 500;
  return {
    customer: { phone: "+79991234567", name: "Анна", birthDate: null },
    items: [
      {
        productId: 1,
        productName: "Шашлык",
        quantity,
        unitPriceMinor: 500,
        lineTotalMinor
      }
    ],
    totalMinor: lineTotalMinor,
    pickup: {
      location: {
        id: "main-grill",
        name: "Основная точка",
        address: "Основная точка самовывоза",
        timezone: "Europe/Moscow"
      },
      slot: options.locations[0]?.slots[0] as NonNullable<
        (typeof options.locations)[number]["slots"]
      >[number]
    },
    confirmationText: "Проверка завершена. Заказ ещё не создан."
  };
}

describe("checkout request controller", () => {
  it("suppresses stale options and quote responses", async () => {
    const optionRequests = [deferred<CheckoutOptionsResponse>(), deferred<CheckoutOptionsResponse>()];
    const quoteRequests = [deferred<CheckoutQuoteResponse>(), deferred<CheckoutQuoteResponse>()];
    let optionIndex = 0;
    let quoteIndex = 0;
    const client: CheckoutClient = {
      getCheckoutOptions: () => optionRequests[optionIndex++]?.promise ?? Promise.reject(new Error("unexpected options")),
      getCheckoutQuote: () => quoteRequests[quoteIndex++]?.promise ?? Promise.reject(new Error("unexpected quote"))
    };
    const optionsStates: CheckoutOptionsRequestState[] = [];
    const quoteStates: CheckoutQuoteRequestState[] = [];
    const controller = createCheckoutRequestController(
      client,
      (state) => optionsStates.push(state),
      (state) => quoteStates.push(state)
    );

    controller.loadOptions();
    controller.loadOptions();
    optionRequests[0]?.resolve(options);
    await flushPromises();
    optionRequests[1]?.resolve(options);
    await flushPromises();

    const pickup = { locationId: "main-grill", slotId: "slot-1" };
    controller.quote([{ productId: 1, quantity: 1 }], pickup);
    controller.quote([{ productId: 1, quantity: 2 }], pickup);
    quoteRequests[0]?.resolve(quote(1));
    await flushPromises();
    quoteRequests[1]?.resolve(quote(2));
    await flushPromises();

    expect(optionsStates.map((state) => state.status)).toEqual([
      "loading",
      "loading",
      "success"
    ]);
    expect(quoteStates.map((state) => state.status)).toEqual([
      "loading",
      "loading",
      "success"
    ]);
    expect(quoteStates.at(-1)).toMatchObject({ status: "success", quote: quote(2) });
    controller.dispose();
  });

  it("does not call the client for empty or malformed selection and handles retry", async () => {
    let calls = 0;
    const states: CheckoutQuoteRequestState[] = [];
    const controller = createCheckoutRequestController(
      {
        getCheckoutOptions: async () => options,
        getCheckoutQuote: async () => {
          calls += 1;
          throw new CheckoutClientError("network", "network failure");
        }
      },
      () => undefined,
      (state) => states.push(state)
    );

    controller.quote([], { locationId: "main-grill", slotId: "slot-1" });
    controller.quote([{ productId: 1, quantity: 1 }], { locationId: "bad id!", slotId: "slot-1" });
    expect(calls).toBe(0);
    expect(states.at(-1)).toMatchObject({ status: "error", kind: "validation" });

    controller.quote([{ productId: 1, quantity: 1 }], { locationId: "main-grill", slotId: "slot-1" });
    await flushPromises();
    expect(calls).toBe(1);
    expect(states.at(-1)).toMatchObject({ status: "error", message: "network failure" });
    controller.retryQuote();
    await flushPromises();
    expect(calls).toBe(2);
    controller.dispose();
  });
});
