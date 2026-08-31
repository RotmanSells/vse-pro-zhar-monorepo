import { describe, expect, it } from "vitest";

import type { CatalogResponse } from "@vse-pro-zhar/contracts";

import {
  createCatalogRequestController,
  type CatalogRequestState
} from "../src/catalog-controller.js";
import { CatalogClientError, type CatalogReadClient } from "../src/catalog-client.js";

const firstCatalog = { categories: [] } satisfies CatalogResponse;
const secondCatalog = {
  categories: [
    {
      id: 1,
      slug: "shashlyk",
      name: "Шашлык",
      sortOrder: 10,
      isVisible: true,
      products: []
    }
  ]
} satisfies CatalogResponse;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("catalog request controller", () => {
  it("publishes only the latest retry and suppresses stale results", async () => {
    const requests = [deferred<CatalogResponse>(), deferred<CatalogResponse>()];
    let requestIndex = 0;
    const states: CatalogRequestState[] = [];
    const client: CatalogReadClient = {
      getCatalog: () => {
        const request = requests[requestIndex];
        requestIndex += 1;
        if (request === undefined) {
          return Promise.reject(new Error("unexpected request"));
        }
        return request.promise;
      }
    };
    const controller = createCatalogRequestController(client, (state) => {
      states.push(state);
    });

    controller.start();
    controller.retry();
    requests[0]?.resolve(firstCatalog);
    await flushPromises();
    requests[1]?.resolve(secondCatalog);
    await flushPromises();

    expect(states).toEqual([
      { status: "loading" },
      { status: "loading" },
      { status: "success", catalog: secondCatalog }
    ]);
  });

  it("shows a controlled error and does not publish after dispose", async () => {
    const request = deferred<CatalogResponse>();
    const states: CatalogRequestState[] = [];
    const client: CatalogReadClient = {
      getCatalog: () => request.promise
    };
    const controller = createCatalogRequestController(client, (state) => {
      states.push(state);
    });

    controller.start();
    request.resolve(firstCatalog);
    await flushPromises();
    expect(states).toEqual([
      { status: "loading" },
      { status: "success", catalog: firstCatalog }
    ]);

    const failingStates: CatalogRequestState[] = [];
    const failingController = createCatalogRequestController(
      {
        getCatalog: () =>
          Promise.reject(
            new CatalogClientError("network", "Не удалось связаться с Backend API")
          )
      },
      (state) => failingStates.push(state)
    );
    failingController.start();
    await flushPromises();
    expect(failingStates).toEqual([
      { status: "loading" },
      { status: "error", message: "Не удалось связаться с Backend API" }
    ]);
    failingController.dispose();
  });
});
