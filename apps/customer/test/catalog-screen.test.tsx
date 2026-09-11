import { StrictMode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer
} from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { CatalogResponse } from "@vse-pro-zhar/contracts";
import type { AuthClient } from "@vse-pro-zhar/api-client";

import type { CatalogReadClient } from "../src/api/catalog-client";
import { CatalogClientError } from "../src/api/catalog-client";
import { CatalogScreen } from "../src/components/catalog-screen";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Image: "Image",
  Modal: "Modal",
  Pressable: "Pressable",
  Platform: { OS: "web" },
  SafeAreaView: "SafeAreaView",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View"
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));

const firstCatalog: CatalogResponse = {
  categories: [
    {
      id: 1,
      slug: "shashlyk",
      name: "Шашлык",
      sortOrder: 10,
      isVisible: true,
      products: [
        {
          id: 1,
          categoryId: 1,
          name: "Шашлык из свинины",
          description: "Сочный шашлык на углях, 200г",
          priceMinor: 45_000,
          imageUrl: null,
          emoji: "🥩",
          tag: "hit",
          isVisible: true,
          sortOrder: 0
        }
      ]
    },
    {
      id: 2,
      slug: "krylya",
      name: "Крылья",
      sortOrder: 20,
      isVisible: true,
      products: [
        {
          id: 2,
          categoryId: 2,
          name: "Крылья BBQ",
          description: "Острые крылышки",
          priceMinor: 39_000,
          imageUrl: null,
          emoji: "🍗",
          tag: null,
          isVisible: true,
          sortOrder: 0
        }
      ]
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

function latestRequest(requests: readonly Deferred<CatalogResponse>[]): Deferred<CatalogResponse> {
  const request = requests[requests.length - 1];
  if (request === undefined) {
    throw new Error("Expected a catalog request");
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

function requireRenderer(renderer: ReactTestRenderer | null): ReactTestRenderer {
  if (renderer === null) {
    throw new Error("Expected the Customer renderer to be created");
  }

  return renderer;
}

describe("Customer catalog screen", () => {
  beforeAll(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  it("renders loading, error, retry and the visible catalog", async () => {
    const requests: Deferred<CatalogResponse>[] = [];
    const client: CatalogReadClient = {
      getCatalog: () => {
        const request = deferred<CatalogResponse>();
        requests.push(request);
        return request.promise;
      }
    };
    const authClient: AuthClient = {
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
    let createdRenderer: ReactTestRenderer | null = null;

    await act(async () => {
      createdRenderer = create(
        <StrictMode>
          <CatalogScreen authClient={authClient} client={client} />
        </StrictMode>
      );
      await flushPromises();
    });

    const renderer = requireRenderer(createdRenderer);
    expect(hasText(renderer, "Загружаем меню…")).toBe(true);

    latestRequest(requests).reject(
      new CatalogClientError("network", "Не удалось связаться с Backend API")
    );
    await act(flushPromises);
    expect(hasText(renderer, "Не удалось загрузить меню")).toBe(true);

    const retryButton = renderer.root.find(
      (node) =>
        node.props["accessibilityRole"] === "button" &&
        getNodeText(node).includes("Повторить")
    );
    await act(async () => {
      retryButton.props["onPress"]();
      await flushPromises();
    });

    latestRequest(requests).resolve(firstCatalog);
    await act(flushPromises);
    expect(hasText(renderer, "Шашлык из свинины")).toBe(true);
    expect(hasText(renderer, "450₽")).toBe(true);
    expect(hasText(renderer, "Крылья BBQ")).toBe(true);

    const wingsChip = renderer.root.find(
      (node) =>
        node.props["accessibilityRole"] === "button" &&
        getNodeText(node) === "🍗 Крылья"
    );
    await act(async () => {
      wingsChip.props["onPress"]();
      await flushPromises();
    });
    expect(hasText(renderer, "Крылья BBQ")).toBe(true);
    expect(hasText(renderer, "Шашлык из свинины")).toBe(false);

    await act(async () => {
      renderer.unmount();
      await flushPromises();
    });
  });

  it("filters visible dishes by name, description and category and can clear the query", async () => {
    const client: CatalogReadClient = { getCatalog: async () => firstCatalog };
    const authClient: AuthClient = {
      identify: async () => ({ customer: { phone: "+79991234567", name: "Анна", birthDate: null }, session: { token: null, expiresAt: "2026-09-01T10:00:00.000Z" } }),
      me: async () => ({ customer: { phone: "+79991234567", name: "Анна", birthDate: null }, session: { expiresAt: "2026-09-01T10:00:00.000Z" } }),
      logout: async () => ({ loggedOut: true })
    };
    let createdRenderer: ReactTestRenderer | null = null;
    await act(async () => {
      createdRenderer = create(<CatalogScreen authClient={authClient} client={client} />);
      await flushPromises();
    });
    const renderer = requireRenderer(createdRenderer);
    const search = renderer.root.find((node) => node.props["accessibilityLabel"] === "Поиск блюд");

    await act(async () => search.props["onChangeText"]("BBQ"));
    expect(hasText(renderer, "Крылья BBQ")).toBe(true);
    expect(hasText(renderer, "Шашлык из свинины")).toBe(false);

    await act(async () => search.props["onChangeText"]("шашлык"));
    expect(hasText(renderer, "Шашлык из свинины")).toBe(true);
    expect(hasText(renderer, "Крылья BBQ")).toBe(false);

    await act(async () => search.props["onChangeText"]("неизвестное блюдо"));
    expect(hasText(renderer, "ничего не найдено")).toBe(true);
    const clear = renderer.root.find((node) => node.props["accessibilityLabel"] === "Очистить поиск");
    await act(async () => clear.props["onPress"]());
    expect(hasText(renderer, "Шашлык из свинины")).toBe(true);
    expect(hasText(renderer, "Крылья BBQ")).toBe(true);
    await act(async () => renderer.unmount());
  });
});
