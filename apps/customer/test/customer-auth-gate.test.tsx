import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AuthClient, CartStorage, CatalogReadClient } from "@vse-pro-zhar/api-client";
import { AuthClientError } from "@vse-pro-zhar/api-client";
import type { CatalogResponse } from "@vse-pro-zhar/contracts";

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

const product = {
  id: 1,
  categoryId: 1,
  name: "Шашлык",
  description: "На углях",
  priceMinor: 45000,
  imageUrl: null,
  emoji: "🥩",
  tag: null,
  isVisible: true,
  sortOrder: 0
} as const;

const catalog: CatalogResponse = {
  categories: [{ id: 1, slug: "shashlyk", name: "Шашлык", sortOrder: 1, isVisible: true, products: [product] }]
};

function storageState(): CartStorage & { readonly value: () => string | null } {
  let value: string | null = null;
  return {
    value: () => value,
    getItem: async () => value,
    setItem: async (_key, nextValue) => {
      value = nextValue;
    }
  };
}

function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const found = renderer.root.findAll(
    (node) => node.props["accessibilityRole"] === "button" && (node.props["accessibilityLabel"] === label || text(node) === label)
  )[0];
  if (found === undefined) throw new Error(`Missing button ${label}`);
  return found;
}

describe("Customer identification add gate", () => {
  beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

  it("does not mutate the guest cart before identify and continues exactly once after success", async () => {
    const storage = storageState();
    const identify = vi.fn(async () => ({
      customer: { phone: "+79991234567", name: "Анна", birthDate: "1990-01-02" },
      session: { token: null, expiresAt: "2026-09-01T10:00:00.000Z" }
    }));
    const authClient: AuthClient = {
      identify,
      me: async () => {
        throw new AuthClientError("authentication", "Сессия недействительна", "AUTHENTICATION_ERROR", 401);
      },
      logout: async () => ({ loggedOut: true })
    };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(
        <CatalogScreen
          authClient={authClient}
          client={{ getCatalog: async () => catalog } satisfies CatalogReadClient}
          storage={storage}
        />
      );
      await flush();
    });
    if (renderer === null) throw new Error("Renderer was not created");
    const mountedRenderer = renderer as ReactTestRenderer;

    await act(async () => {
      button(mountedRenderer, `Добавить в корзину ${product.name}`).props["onPress"]();
      await flush();
    });
    expect(storage.value()).toBeNull();
    const modal = mountedRenderer.root.find((node: ReactTestInstance) => String(node.type) === "Modal");
    expect(modal.props["visible"]).toBe(true);

    const phoneInput = mountedRenderer.root.find((node: ReactTestInstance) => node.props["accessibilityLabel"] === "Номер телефона");
    await act(async () => {
      phoneInput.props["onChangeText"]("8 (999) 123-45-67");
      await flush();
    });
    expect(phoneInput.props["value"]).toBe("+7 (999) 123-45-67");
    await act(async () => {
      button(mountedRenderer, "Сохранить и добавить").props["onPress"]();
      await flush();
    });

    expect(identify).toHaveBeenCalledTimes(1);
    expect(identify).toHaveBeenCalledWith({
      phone: "+7 (999) 123-45-67"
    }, expect.objectContaining({ signal: expect.anything() }));
    expect(JSON.parse(storage.value() ?? "{}") as unknown).toEqual({
      version: 1,
      items: [{ productId: 1, quantity: 1 }]
    });
  });
});
