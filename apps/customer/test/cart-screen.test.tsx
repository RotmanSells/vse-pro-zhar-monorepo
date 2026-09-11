import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type {
  CartQuoteResponse,
  CatalogResponse
} from "@vse-pro-zhar/contracts";
import type {
  AuthClient,
  CartQuoteClient,
  CartStorage,
  CatalogReadClient
} from "@vse-pro-zhar/api-client";
import { CartQuoteClientError } from "@vse-pro-zhar/api-client";

import { CatalogScreen } from "../src/components/catalog-screen";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Image: "Image",
  Modal: "Modal",
  Platform: { OS: "web" },
  Pressable: "Pressable",
  SafeAreaView: "SafeAreaView",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View"
}));

const product = {
  id: 1,
  categoryId: 1,
  name: "Шашлык из свинины",
  description: "Сочный шашлык на углях",
  priceMinor: 45_050,
  imageUrl: null,
  emoji: "🥩",
  tag: "hit" as const,
  isVisible: true,
  sortOrder: 0
};

const catalog: CatalogResponse = {
  categories: [
    {
      id: 1,
      slug: "shashlyk",
      name: "Шашлык",
      sortOrder: 10,
      isVisible: true,
      products: [product]
    }
  ]
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

  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function quoteFor(quantity: number): CartQuoteResponse {
  const lineTotalMinor = product.priceMinor * quantity;
  return {
    items: [
      {
        productId: product.id,
        quantity,
        unitPriceMinor: product.priceMinor,
        lineTotalMinor
      }
    ],
    totalMinor: lineTotalMinor
  };
}

function createStorage(initialValue: string | null = null): {
  readonly storage: CartStorage;
  readonly getValue: () => string | null;
  readonly writes: string[];
} {
  let value = initialValue;
  const writes: string[] = [];

  return {
    storage: {
      async getItem(): Promise<string | null> {
        return value;
      },
      async setItem(_key, nextValue): Promise<void> {
        value = nextValue;
        writes.push(nextValue);
      }
    },
    getValue: () => value,
    writes
  };
}

function getNodeText(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : getNodeText(child)))
    .join("");
}

function findButton(
  renderer: ReactTestRenderer,
  label: string
): ReactTestInstance {
  const buttons = renderer.root.findAll(
    (node) =>
      node.props["accessibilityRole"] === "button" &&
      node.props["accessibilityLabel"] === label
  );

  const button = buttons[0];
  if (button === undefined) {
    throw new Error(`Expected button: ${label}`);
  }

  return button;
}

function hasText(renderer: ReactTestRenderer, text: string): boolean {
  return renderer.root.findAll((node) => getNodeText(node).includes(text)).length > 0;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createCatalogClient(): CatalogReadClient {
  return { getCatalog: async () => catalog };
}

function createIdentifiedAuthClient(): AuthClient {
  return {
    identify: async () => ({
      customer: { phone: "+79991234567", name: "Анна", birthDate: null },
      session: { token: null, expiresAt: "2026-09-01T10:00:00.000Z" }
    }),
    me: async () => ({
      customer: { phone: "+79991234567", name: "Анна", birthDate: null },
      session: { expiresAt: "2026-09-01T10:00:00.000Z" }
    }),
    logout: async () => ({ loggedOut: true })
  };
}

async function renderCatalog(
  quoteClient: CartQuoteClient,
  storage: CartStorage
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null;

  await act(async () => {
    renderer = create(
      <CatalogScreen
        authClient={createIdentifiedAuthClient()}
        client={createCatalogClient()}
        quoteClient={quoteClient}
        storage={storage}
      />
    );
    await flushPromises();
  });

  if (renderer === null) {
    throw new Error("Expected the Customer renderer to be created");
  }

  return renderer;
}

describe("Customer cart", () => {
  beforeAll(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  it("adds, persists, quotes, changes quantity and clears the cart", async () => {
    const storageState = createStorage();
    const getCartQuote = vi.fn<CartQuoteClient["getCartQuote"]>(async (input) =>
      quoteFor(input.items[0]?.quantity ?? 1)
    );
    const quoteClient: CartQuoteClient = { getCartQuote };
    const renderer = await renderCatalog(quoteClient, storageState.storage);

    const addButton = findButton(renderer, `Добавить в корзину ${product.name}`);
    await act(async () => {
      addButton.props["onPress"]();
      addButton.props["onPress"]();
      await flushPromises();
    });

    expect(JSON.parse(storageState.getValue() ?? "{}") as unknown).toEqual({
      version: 1,
      items: [{ productId: 1, quantity: 2 }]
    });
    expect(getCartQuote).not.toHaveBeenCalled();

    await act(async () => {
      findButton(renderer, "Открыть корзину").props["onPress"]();
      await flushPromises();
    });
    expect(getCartQuote).toHaveBeenCalledTimes(1);
    expect(getCartQuote.mock.calls[0]?.[0]).toEqual({
      items: [{ productId: 1, quantity: 2 }]
    });
    expect(hasText(renderer, "Моя корзина")).toBe(true);
    expect(hasText(renderer, "901₽")).toBe(true);

    await act(async () => {
      findButton(renderer, `Увеличить количество ${product.name}`).props["onPress"]();
      await flushPromises();
    });
    expect(getCartQuote.mock.calls[1]?.[0]).toEqual({
      items: [{ productId: 1, quantity: 3 }]
    });
    expect(hasText(renderer, "1 351,50₽")).toBe(true);
    expect(hasText(renderer, "Шашлык из свинины")).toBe(true);

    await act(async () => {
      findButton(renderer, "Очистить корзину").props["onPress"]();
      await flushPromises();
    });
    expect(hasText(renderer, "Корзина пуста")).toBe(true);
    expect(getCartQuote).toHaveBeenCalledTimes(2);

    await act(async () => {
      renderer.unmount();
      await flushPromises();
    });
  });

  it("restores persisted references after remount without persisting product data", async () => {
    const storageState = createStorage(
      JSON.stringify({ version: 1, items: [{ productId: 1, quantity: 2 }] })
    );
    const getCartQuote = vi.fn<CartQuoteClient["getCartQuote"]>(async (input) =>
      quoteFor(input.items[0]?.quantity ?? 1)
    );
    const quoteClient: CartQuoteClient = { getCartQuote };
    const renderer = await renderCatalog(quoteClient, storageState.storage);

    expect(hasText(renderer, "2")).toBe(true);
    await act(async () => {
      findButton(renderer, "Открыть корзину").props["onPress"]();
      await flushPromises();
    });
    expect(getCartQuote).toHaveBeenCalledTimes(1);
    expect(getCartQuote.mock.calls[0]?.[0]).toEqual({
      items: [{ productId: 1, quantity: 2 }]
    });
    expect(storageState.getValue()).not.toContain("Шашлык");
    expect(storageState.getValue()).not.toContain("priceMinor");

    await act(async () => {
      renderer.unmount();
      await flushPromises();
    });
  });

  it("does not let a stale quote replace the latest quantity", async () => {
    const storageState = createStorage();
    const requests: Array<Deferred<CartQuoteResponse>> = [];
    const getCartQuote = vi.fn<CartQuoteClient["getCartQuote"]>(
      async () => {
        const request = deferred<CartQuoteResponse>();
        requests.push(request);
        return request.promise;
      }
    );
    const renderer = await renderCatalog(
      { getCartQuote },
      storageState.storage
    );

    await act(async () => {
      findButton(renderer, `Добавить в корзину ${product.name}`).props["onPress"]();
      await flushPromises();
      findButton(renderer, "Открыть корзину").props["onPress"]();
      await flushPromises();
    });
    expect(requests).toHaveLength(1);

    await act(async () => {
      findButton(renderer, `Увеличить количество ${product.name}`).props["onPress"]();
      await flushPromises();
    });
    expect(requests).toHaveLength(2);

    requests[0]?.resolve(quoteFor(1));
    await act(flushPromises);
    expect(hasText(renderer, "Пересчитываем корзину…")).toBe(true);

    requests[1]?.resolve(quoteFor(2));
    await act(flushPromises);
    expect(hasText(renderer, "Пересчитываем корзину…")).toBe(false);
    expect(hasText(renderer, "Корзина пуста")).toBe(false);

    await act(async () => {
      findButton(renderer, `Удалить ${product.name} из корзины`).props["onPress"]();
      await flushPromises();
      renderer.unmount();
    });
  });

  it("shows controlled unavailable state and allows removing the item", async () => {
    const storageState = createStorage(
      JSON.stringify({ version: 1, items: [{ productId: 1, quantity: 1 }] })
    );
    const quoteClient: CartQuoteClient = {
      getCartQuote: async () => {
        throw new CartQuoteClientError(
          "http",
          "Некоторые блюда больше недоступны",
          "CART_ITEM_UNAVAILABLE"
        );
      }
    };
    const renderer = await renderCatalog(quoteClient, storageState.storage);

    await act(async () => {
      findButton(renderer, "Открыть корзину").props["onPress"]();
      await flushPromises();
    });
    expect(hasText(renderer, "Блюдо больше недоступно")).toBe(true);
    expect(hasText(renderer, "Цена уточняется")).toBe(true);

    await act(async () => {
      findButton(renderer, `Удалить ${product.name} из корзины`).props["onPress"]();
      await flushPromises();
    });
    expect(hasText(renderer, "Корзина пуста")).toBe(true);

    await act(async () => {
      renderer.unmount();
      await flushPromises();
    });
  });
});
