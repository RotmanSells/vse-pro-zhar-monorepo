import { StrictMode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer
} from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { HealthResponse } from "@vse-pro-zhar/contracts";

import { App } from "../src/app";
import type { HealthClient } from "../src/api/health-client";
import { HealthClientError } from "../src/api/health-client";

const validHealthResponse: HealthResponse = {
  service: "api",
  status: "ok",
  environment: "test",
  timestamp: "2026-08-31T10:00:00.000Z"
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (reason: unknown) => void;
  readonly resolve: (value: T) => void;
}

interface PendingRequest {
  readonly deferred: Deferred<HealthResponse>;
  readonly signal: AbortSignal | undefined;
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

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function latestRequest(requests: readonly PendingRequest[]): PendingRequest {
  const request = requests[requests.length - 1];

  if (request === undefined) {
    throw new Error("Expected a health request");
  }

  return request;
}

function getNodeText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : getNodeText(child)))
    .join("");
}

function hasText(renderer: ReactTestRenderer, text: string): boolean {
  return renderer.root.findAll((node) => getNodeText(node).includes(text)).length > 0;
}

describe("Admin health screen lifecycle", () => {
  beforeAll(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  it("passes loading → error → retry → success under StrictMode", async () => {
    const requests: PendingRequest[] = [];
    const client: HealthClient = {
      getHealth: ({ signal } = {}) => {
        const current = { deferred: deferred<HealthResponse>(), signal };
        requests.push(current);
        return current.deferred.promise;
      }
    };
    let createdRenderer: ReactTestRenderer | null = null;

    await act(async () => {
      createdRenderer = create(
        <StrictMode>
          <App client={client} />
        </StrictMode>
      );
      await flushPromises();
    });

    if (createdRenderer === null) {
      throw new Error("Expected the Admin renderer to be created");
    }

    const renderer = createdRenderer;
    expect(hasText(renderer, "Проверяем соединение…")).toBe(true);

    const firstActiveRequest = latestRequest(requests);
    firstActiveRequest.deferred.reject(
      new HealthClientError("network", "Не удалось связаться с Backend API")
    );
    await act(flushPromises);

    expect(hasText(renderer, "○ Disconnected")).toBe(true);
    expect(hasText(renderer, "Не удалось связаться с Backend API")).toBe(true);

    const retryButton = renderer.root.find((node) => node.props.type === "button");
    await act(async () => {
      retryButton.props.onClick();
      await flushPromises();
    });

    const retryRequest = latestRequest(requests);
    expect(hasText(renderer, "Проверяем соединение…")).toBe(true);
    retryRequest.deferred.resolve(validHealthResponse);
    await act(flushPromises);

    expect(hasText(renderer, "● Connected")).toBe(true);
    expect(hasText(renderer, "api · test")).toBe(true);
    expect(firstActiveRequest.signal?.aborted).toBe(true);

    await act(async () => {
      renderer.unmount();
      await flushPromises();
    });
  });
});
