import { describe, expect, it } from "vitest";

import type { CartQuoteResponse } from "@vse-pro-zhar/contracts";

import {
  CartQuoteClientError,
  createCartQuoteRequestController,
  type CartQuoteClient,
  type CartQuoteRequestState
} from "../src/index.js";

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

const quoteForOne = (quantity: number, totalMinor: number): CartQuoteResponse => ({
  items: [
    {
      productId: 1,
      quantity,
      unitPriceMinor: 500,
      lineTotalMinor: totalMinor
    }
  ],
  totalMinor
});

describe("cart quote request controller", () => {
  it("publishes only the latest request result", async () => {
    const requests = [deferred<CartQuoteResponse>(), deferred<CartQuoteResponse>()];
    const states: CartQuoteRequestState[] = [];
    let requestIndex = 0;
    const client: CartQuoteClient = {
      getCartQuote: () => {
        const request = requests[requestIndex];
        requestIndex += 1;
        if (request === undefined) {
          return Promise.reject(new Error("unexpected request"));
        }
        return request.promise;
      }
    };
    const controller = createCartQuoteRequestController(client, (state) => {
      states.push(state);
    });

    controller.quote([{ productId: 1, quantity: 1 }]);
    controller.quote([{ productId: 1, quantity: 2 }]);
    requests[0]?.resolve(quoteForOne(1, 500));
    await flushPromises();
    requests[1]?.resolve(quoteForOne(2, 1_000));
    await flushPromises();

    expect(states).toEqual([
      { status: "loading", items: [{ productId: 1, quantity: 1 }] },
      { status: "loading", items: [{ productId: 1, quantity: 2 }] },
      { status: "success", quote: quoteForOne(2, 1_000) }
    ]);
    controller.dispose();
  });

  it("does not quote an empty cart and aborts the previous request", async () => {
    const request = deferred<CartQuoteResponse>();
    let callCount = 0;
    const states: string[] = [];
    const client: CartQuoteClient = {
      getCartQuote: () => {
        callCount += 1;
        return request.promise;
      }
    };
    const controller = createCartQuoteRequestController(client, (state) => {
      states.push(state.status);
    });

    controller.quote([{ productId: 1, quantity: 1 }]);
    controller.clear();
    request.resolve(quoteForOne(1, 500));
    await flushPromises();

    expect(callCount).toBe(1);
    expect(states).toEqual(["loading", "idle"]);
    controller.dispose();
  });

  it("supports retry and suppresses errors after dispose", async () => {
    const first = deferred<CartQuoteResponse>();
    const second = deferred<CartQuoteResponse>();
    let requestIndex = 0;
    const states: Array<{ status: string; message?: string }> = [];
    const client: CartQuoteClient = {
      getCartQuote: () => {
        requestIndex += 1;
        return requestIndex === 1 ? first.promise : second.promise;
      }
    };
    const controller = createCartQuoteRequestController(client, (state) => {
      states.push(
        state.status === "error"
          ? { status: state.status, message: state.message }
          : { status: state.status }
      );
    });

    controller.quote([{ productId: 1, quantity: 1 }]);
    first.reject(new CartQuoteClientError("network", "network failure"));
    await flushPromises();
    controller.retry();
    second.resolve(quoteForOne(1, 500));
    await flushPromises();

    expect(states).toEqual([
      { status: "loading" },
      { status: "error", message: "network failure" },
      { status: "loading" },
      { status: "success" }
    ]);

    const disposedRequest = deferred<CartQuoteResponse>();
    const disposedController = createCartQuoteRequestController(
      { getCartQuote: () => disposedRequest.promise },
      (state) => states.push({ status: state.status })
    );
    disposedController.quote([{ productId: 1, quantity: 1 }]);
    disposedController.dispose();
    disposedRequest.resolve(quoteForOne(1, 500));
    await flushPromises();
    expect(states.at(-1)?.status).toBe("loading");
  });
});
