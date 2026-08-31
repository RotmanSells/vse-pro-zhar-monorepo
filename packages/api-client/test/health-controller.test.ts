import { describe, expect, it } from "vitest";

import { HealthResponseSchema } from "@vse-pro-zhar/contracts";

import {
  createHealthRequestController,
  type HealthRequestState
} from "../src/health-controller.js";
import { HealthClientError, type HealthClient } from "../src/health-client.js";

const firstHealth = HealthResponseSchema.parse({
  service: "api",
  status: "ok",
  environment: "test",
  timestamp: "2026-08-31T10:00:00.000Z"
});
const secondHealth = {
  ...firstHealth,
  timestamp: "2026-08-31T10:01:00.000Z"
};

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

  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    queueMicrotask(resolve);
  });
}

describe("health request controller", () => {
  it("keeps the latest retry result and ignores a stale response", async () => {
    const requests = [deferred<typeof firstHealth>(), deferred<typeof secondHealth>()];
    const signals: AbortSignal[] = [];
    let requestIndex = 0;
    const states: HealthRequestState[] = [];
    const client: HealthClient = {
      getHealth: ({ signal } = {}) => {
        signals.push(signal ?? new AbortController().signal);
        const currentRequest = requests[requestIndex];
        requestIndex += 1;

        if (currentRequest === undefined) {
          return Promise.reject(new Error("unexpected request"));
        }

        return currentRequest.promise;
      }
    };
    const controller = createHealthRequestController(client, (state) => {
      states.push(state);
    });

    controller.start();
    controller.retry();
    requests[0]?.resolve(firstHealth);
    await flushPromises();

    expect(states).toEqual([{ status: "loading" }, { status: "loading" }]);
    expect(signals[0]?.aborted).toBe(true);

    requests[1]?.resolve(secondHealth);
    await flushPromises();

    expect(states).toEqual([
      { status: "loading" },
      { status: "loading" },
      { status: "success", health: secondHealth }
    ]);
  });

  it("supports retry after an error", async () => {
    const failed = deferred<typeof firstHealth>();
    const recovered = deferred<typeof secondHealth>();
    let requestIndex = 0;
    const states: HealthRequestState[] = [];
    const client: HealthClient = {
      getHealth: () => {
        requestIndex += 1;
        return requestIndex === 1 ? failed.promise : recovered.promise;
      }
    };
    const controller = createHealthRequestController(client, (state) => {
      states.push(state);
    });

    controller.start();
    failed.reject(new HealthClientError("network", "Не удалось связаться с Backend API"));
    await flushPromises();
    controller.retry();
    recovered.resolve(secondHealth);
    await flushPromises();

    expect(states).toEqual([
      { status: "loading" },
      {
        status: "error",
        message: "Не удалось связаться с Backend API"
      },
      { status: "loading" },
      { status: "success", health: secondHealth }
    ]);
  });

  it("does not publish a result after unmount/dispose", async () => {
    const request = deferred<typeof firstHealth>();
    let requestSignal: AbortSignal | undefined;
    const states: HealthRequestState[] = [];
    const client: HealthClient = {
      getHealth: ({ signal } = {}) => {
        requestSignal = signal;
        return request.promise;
      }
    };
    const controller = createHealthRequestController(client, (state) => {
      states.push(state);
    });

    controller.start();
    controller.dispose();
    request.resolve(firstHealth);
    await flushPromises();

    expect(requestSignal?.aborted).toBe(true);
    expect(states).toEqual([{ status: "loading" }]);
  });

  it("allows a fresh effect setup after StrictMode cleanup", async () => {
    const firstRequest = deferred<typeof firstHealth>();
    const secondRequest = deferred<typeof secondHealth>();
    let requestIndex = 0;
    const states: HealthRequestState[] = [];
    const client: HealthClient = {
      getHealth: () => {
        requestIndex += 1;
        return requestIndex === 1 ? firstRequest.promise : secondRequest.promise;
      }
    };

    const firstController = createHealthRequestController(client, (state) => {
      states.push(state);
    });
    firstController.start();
    firstController.dispose();

    const secondController = createHealthRequestController(client, (state) => {
      states.push(state);
    });
    secondController.start();
    secondRequest.resolve(secondHealth);
    await flushPromises();

    expect(states).toEqual([
      { status: "loading" },
      { status: "loading" },
      { status: "success", health: secondHealth }
    ]);
  });
});
