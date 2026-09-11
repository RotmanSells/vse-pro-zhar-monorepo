import { StrictMode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer
} from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { HealthResponse } from "@vse-pro-zhar/contracts";
import type { CatalogAdminClient } from "@vse-pro-zhar/api-client";

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

  it("lets keyboard and pointer users close the mobile navigation backdrop", async () => {
    const catalogClient: CatalogAdminClient = {
      getAdminCatalog: async () => ({ categories: [] }),
      createCategory: async () => { throw new Error("not used"); },
      updateCategory: async () => { throw new Error("not used"); },
      createProduct: async () => { throw new Error("not used"); },
      updateProduct: async () => { throw new Error("not used"); },
      uploadImage: async () => { throw new Error("not used"); }
    };
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<App client={catalogClient} />);
      await flushPromises();
    });
    const menuButton = renderer?.root.find(
      (node) => node.props["aria-label"] === "Открыть меню"
    );
    const backdrop = renderer?.root.find(
      (node) => node.props["aria-label"] === "Закрыть меню"
    );

    expect(menuButton?.props["aria-expanded"]).toBe(false);
    expect(backdrop?.props["disabled"]).toBe(true);
    await act(async () => menuButton?.props["onClick"]());
    expect(menuButton?.props["aria-expanded"]).toBe(true);
    expect(backdrop?.props["disabled"]).toBe(false);
    await act(async () => backdrop?.props["onClick"]());
    expect(menuButton?.props["aria-expanded"]).toBe(false);
    expect(backdrop?.props["disabled"]).toBe(true);
    await act(async () => renderer?.unmount());
  });

  it("keeps every navigation item accessible when the tablet sidebar is collapsed", async () => {
    const catalogClient: CatalogAdminClient = {
      getAdminCatalog: async () => ({ categories: [] }),
      createCategory: async () => { throw new Error("not used"); },
      updateCategory: async () => { throw new Error("not used"); },
      createProduct: async () => { throw new Error("not used"); },
      updateProduct: async () => { throw new Error("not used"); },
      uploadImage: async () => { throw new Error("not used"); }
    };
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<App client={catalogClient} />);
      await flushPromises();
    });

    const navItems = renderer?.root.findAll((node) => node.props.className?.includes("nav-item")) ?? [];
    expect(navItems).toHaveLength(11);
    expect(navItems.map((node) => node.props["aria-label"])).toEqual([
      "Дашборд",
      "Заказы",
      "Меню",
      "Лояльность",
      "Награды",
      "Промокоды",
      "Квесты",
      "Колесо фортуны",
      "Клиенты",
      "Сегменты",
      "Рассылки"
    ]);
    await act(async () => renderer?.unmount());
  });
});
