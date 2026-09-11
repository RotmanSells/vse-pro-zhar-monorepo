import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type {
  AuthClient,
  CartQuoteClient,
  CartStorage,
  CatalogReadClient,
  CheckoutClient,
  OrderClient,
  PaymentClient
} from "@vse-pro-zhar/api-client";
import { CheckoutClientError } from "@vse-pro-zhar/api-client";
import type {
  CartQuoteResponse,
  CatalogResponse,
  CheckoutOptionsResponse,
  CheckoutQuoteResponse,
  OrderResponse,
  PaymentCreateResponse
} from "@vse-pro-zhar/contracts";

import { CatalogScreen } from "../src/components/catalog-screen";
import type { PaymentConfirmationNavigator } from "../src/payments/navigation";

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  AppState: {
    addEventListener: () => ({ remove: () => undefined })
  },
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
  priceMinor: 45_050,
  imageUrl: null,
  emoji: "🥩",
  tag: null,
  isVisible: true,
  sortOrder: 0
} as const;

const catalog: CatalogResponse = {
  categories: [
    {
      id: 1,
      slug: "shashlyk",
      name: "Шашлык",
      sortOrder: 1,
      isVisible: true,
      products: [product]
    }
  ]
};

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

const quote: CheckoutQuoteResponse = {
  customer: { phone: "+79991234567", name: "Анна", birthDate: null },
  items: [
    {
      productId: 1,
      productName: "Шашлык",
      quantity: 1,
      unitPriceMinor: 45_050,
      lineTotalMinor: 45_050
    }
  ],
  totalMinor: 45_050,
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

function storageWithCart(setItem: (key: string, value: string) => void = () => undefined): CartStorage {
  const value = JSON.stringify({ version: 1, items: [{ productId: 1, quantity: 1 }] });
  return {
    getItem: async () => value,
    setItem: async (key, nextValue) => setItem(key, nextValue)
  };
}

function text(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : text(child)))
    .join("");
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const found = renderer.root.findAll(
    (node) =>
      node.props["accessibilityRole"] === "button" &&
      (node.props["accessibilityLabel"] === label || text(node) === label)
  )[0];
  if (found === undefined) throw new Error(`Missing button ${label}`);
  return found;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function catalogClient(): CatalogReadClient {
  return { getCatalog: async () => catalog };
}

function quoteClient(): CartQuoteClient {
  const response: CartQuoteResponse = {
    items: [
      {
        productId: 1,
        quantity: 1,
        unitPriceMinor: product.priceMinor,
        lineTotalMinor: product.priceMinor
      }
    ],
    totalMinor: product.priceMinor
  };
  return { getCartQuote: async () => response };
}

function identifiedAuthClient(): AuthClient {
  return {
    identify: async () => ({
      customer: quote.customer,
      session: { token: null, expiresAt: "2026-09-01T10:00:00.000Z" }
    }),
    me: async () => ({ customer: quote.customer, session: { expiresAt: "2026-09-01T10:00:00.000Z" } }),
    logout: async () => ({ loggedOut: true })
  };
}

async function render(
  checkoutClient: CheckoutClient,
  orderClient: OrderClient = {
    createOrder: async () => orderResponse(),
    listOrders: async () => ({ orders: [] }),
    getOrder: async () => orderResponse()
  },
  storage: CartStorage = storageWithCart(),
  paymentClient?: PaymentClient,
  paymentNavigator?: PaymentConfirmationNavigator
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null;
  await act(async () => {
    renderer = create(
      <CatalogScreen
        authClient={identifiedAuthClient()}
        checkoutClient={checkoutClient}
        client={catalogClient()}
        orderClient={orderClient}
        paymentClient={paymentClient}
        paymentNavigator={paymentNavigator}
        quoteClient={quoteClient()}
        storage={storage}
      />
    );
    await flush();
  });
  if (renderer === null) throw new Error("Renderer was not created");
  return renderer;
}

function orderResponse(): OrderResponse {
  return {
    id: 7,
    status: "pending_payment",
    totalMinor: 45_050,
    currency: "RUB",
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
    createdAt: "2026-09-01T07:00:00.000Z",
    updatedAt: "2026-09-01T07:00:00.000Z",
    items: [
      {
        productId: 1,
        productName: "Шашлык",
        unitPriceMinor: 45_050,
        quantity: 1,
        lineTotalMinor: 45_050
      }
    ]
  };
}

describe("Customer checkout screen", () => {
  beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

  it("opens only after an identified session check and renders an authoritative quote", async () => {
    const getCheckoutOptions = vi.fn(async () => options);
    const getCheckoutQuote = vi.fn(async () => quote);
    const renderer = await render({ getCheckoutOptions, getCheckoutQuote });

    await act(async () => {
      button(renderer, "Открыть корзину").props["onPress"]();
      await flush();
    });
    await act(async () => {
      button(renderer, "Оформить самовывоз").props["onPress"]();
      await flush();
    });

    expect(getCheckoutOptions).toHaveBeenCalledTimes(1);
    expect(getCheckoutQuote).toHaveBeenCalledWith(
      {
        items: [{ productId: 1, quantity: 1 }],
        pickup: { locationId: "main-grill", slotId: "slot-1" }
      },
      expect.objectContaining({ signal: expect.anything() })
    );
    expect(text(renderer.root)).toContain("Актуальный состав");
    expect(text(renderer.root)).toContain("450,50₽");
    expect(text(renderer.root)).toContain("Заказ ещё не создан");

    await act(async () => {
      button(renderer, "Вернуться в корзину").props["onPress"]();
      await flush();
      renderer.unmount();
    });
  });

  it("keeps checkout fail-closed and exposes retry without order side effects", async () => {
    let attempts = 0;
    const checkoutClient: CheckoutClient = {
      getCheckoutOptions: async () => options,
      getCheckoutQuote: async () => {
        attempts += 1;
        throw new CheckoutClientError(
          "checkout_unavailable",
          "Самовывоз временно недоступен",
          "CHECKOUT_UNAVAILABLE",
          409
        );
      }
    };
    const renderer = await render(checkoutClient);

    await act(async () => {
      button(renderer, "Открыть корзину").props["onPress"]();
      await flush();
    });
    await act(async () => {
      button(renderer, "Оформить самовывоз").props["onPress"]();
      await flush();
    });
    expect(text(renderer.root)).toContain("Самовывоз временно недоступен");
    expect(text(renderer.root)).not.toContain("Оплата запущена");
    expect(text(renderer.root)).not.toContain("Заказ принят кухней");

    await act(async () => {
      button(renderer, "Повторить проверку").props["onPress"]();
      await flush();
    });
    expect(attempts).toBe(2);

    await act(async () => {
      renderer.unmount();
      await flush();
    });
  });

  it("creates an internal order and clears cart only after confirmed backend success", async () => {
    const setItem = vi.fn<(key: string, value: string) => void>();
    const createOrder = vi.fn(async () => orderResponse());
    const renderer = await render(
      { getCheckoutOptions: async () => options, getCheckoutQuote: async () => quote },
      {
        createOrder,
        listOrders: async () => ({ orders: [] }),
        getOrder: async () => orderResponse()
      },
      storageWithCart(setItem)
    );

    await act(async () => {
      button(renderer, "Открыть корзину").props["onPress"]();
      await flush();
    });
    await act(async () => {
      button(renderer, "Оформить самовывоз").props["onPress"]();
      await flush();
    });
    await act(async () => {
      button(renderer, "Создать внутренний заказ").props["onPress"]();
      await flush();
    });

    expect(createOrder).toHaveBeenCalledWith(
      {
        items: [{ productId: 1, quantity: 1 }],
        pickup: { locationId: "main-grill", slotId: "slot-1" }
      },
      expect.objectContaining({ idempotencyKey: expect.any(String), signal: expect.anything() })
    );
    expect(text(renderer.root)).toContain("Заказ создан");
    expect(text(renderer.root)).toContain("Ожидает оплаты");
    expect(setItem).toHaveBeenLastCalledWith(
      "vse-pro-zhar:guest-cart",
      JSON.stringify({ version: 1, items: [] })
    );
    expect(text(renderer.root)).not.toContain("Заказ принят кухней");
    expect(text(renderer.root)).not.toContain("Заказ отправлен в iiko");
    renderer.unmount();
  });

  it("starts card payment only after the order exists and keeps the result pending until backend confirmation", async () => {
    const createPayment = vi.fn(async (): Promise<PaymentCreateResponse> => ({
      order: { id: 7, status: "pending_payment" },
      payment: {
        id: 1,
        orderId: 7,
        provider: "yookassa",
        status: "pending",
        providerStatus: "pending",
        amountMinor: 45_050,
        currency: "RUB",
        confirmation: { type: "redirect", url: "https://yoomoney.ru/checkout/example" },
        createdAt: "2026-09-01T07:00:00.000Z",
        updatedAt: "2026-09-01T07:00:00.000Z"
      }
    }));
    const open = vi.fn();
    const renderer = await render(
      { getCheckoutOptions: async () => options, getCheckoutQuote: async () => quote },
      undefined,
      storageWithCart(),
      { createPayment, getPayment: async () => { throw new Error("not called"); } },
      { open }
    );

    await act(async () => {
      button(renderer, "Открыть корзину").props["onPress"]();
      await flush();
    });
    await act(async () => {
      button(renderer, "Оформить самовывоз").props["onPress"]();
      await flush();
    });
    await act(async () => {
      button(renderer, "Создать внутренний заказ").props["onPress"]();
      await flush();
    });
    await act(async () => {
      button(renderer, "Оплатить картой").props["onPress"]();
      await flush();
    });

    expect(createPayment).toHaveBeenCalledWith(7, expect.objectContaining({
      idempotencyKey: expect.any(String),
      signal: expect.anything()
    }));
    expect(open).toHaveBeenCalledWith("https://yoomoney.ru/checkout/example");
    expect(text(renderer.root)).toContain("Ожидаем подтверждение оплаты");
    expect(text(renderer.root)).not.toContain("Оплата подтверждена Backend");
    renderer.unmount();
  });

  it("uses a new idempotency key after a canceled payment", async () => {
    let attempt = 0;
    const createPayment = vi.fn<PaymentClient["createPayment"]>(async (): Promise<PaymentCreateResponse> => {
      attempt += 1;
      const canceled = attempt === 1;
      return {
        order: { id: 7, status: "pending_payment" },
        payment: {
          id: attempt,
          orderId: 7,
          provider: "yookassa",
          status: canceled ? "canceled" : "pending",
          providerStatus: canceled ? "canceled" : "pending",
          amountMinor: 45_050,
          currency: "RUB",
          confirmation: canceled
            ? null
            : { type: "redirect", url: "https://yoomoney.ru/checkout/retry" },
          createdAt: "2026-09-01T07:00:00.000Z",
          updatedAt: "2026-09-01T07:00:00.000Z"
        }
      };
    });
    const open = vi.fn();
    const renderer = await render(
      { getCheckoutOptions: async () => options, getCheckoutQuote: async () => quote },
      undefined,
      storageWithCart(),
      { createPayment, getPayment: async () => { throw new Error("not called"); } },
      { open }
    );

    await act(async () => {
      button(renderer, "Открыть корзину").props["onPress"]();
      await flush();
    });
    await act(async () => {
      button(renderer, "Оформить самовывоз").props["onPress"]();
      await flush();
    });
    await act(async () => {
      button(renderer, "Создать внутренний заказ").props["onPress"]();
      await flush();
    });
    await act(async () => {
      button(renderer, "Оплатить картой").props["onPress"]();
      await flush();
    });
    expect(text(renderer.root)).toContain("Платёж отменён или истёк");

    await act(async () => {
      button(renderer, "Оплатить картой").props["onPress"]();
      await flush();
    });

    const firstKey = createPayment.mock.calls[0]?.[1].idempotencyKey;
    const secondKey = createPayment.mock.calls[1]?.[1].idempotencyKey;
    expect(firstKey).toEqual(expect.any(String));
    expect(secondKey).toEqual(expect.any(String));
    expect(secondKey).not.toBe(firstKey);
    expect(open).toHaveBeenCalledWith("https://yoomoney.ru/checkout/retry");
    expect(text(renderer.root)).toContain("Ожидаем подтверждение оплаты");
    renderer.unmount();
  });
});
