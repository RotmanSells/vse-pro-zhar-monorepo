import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  createCheckoutRequestController,
  createOrderRequestController,
  createPaymentRequestController,
  type CheckoutClient,
  type CheckoutOptionsRequestState,
  type CheckoutQuoteRequestState,
  type CheckoutRequestController,
  type OrderClient,
  type OrderCreateRequestState,
  type PaymentClient,
  type PaymentRequestState
} from "@vse-pro-zhar/api-client";
import type {
  CartItem,
  CheckoutPickupSelection,
  CustomerProfile,
  PickupLocation
} from "@vse-pro-zhar/contracts";
import type { PaymentConfirmationNavigator } from "../payments/navigation";

export interface CheckoutScreenProps {
  readonly items: readonly CartItem[];
  readonly customer: CustomerProfile;
  readonly checkoutClient: CheckoutClient;
  readonly orderClient: OrderClient;
  readonly paymentClient?: PaymentClient;
  readonly paymentNavigator?: PaymentConfirmationNavigator;
  readonly redemptionId?: number | null;
  readonly onBack: () => void;
  readonly onOrderCreated: () => void;
  readonly onViewOrders: () => void;
}

function createIdempotencyKey(): string {
  return `order-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function formatPriceMinor(priceMinor: number): string {
  const rubles = Math.floor(priceMinor / 100);
  const kopecks = priceMinor % 100;

  return kopecks === 0
    ? `${rubles.toLocaleString("ru-RU")}₽`
    : `${rubles.toLocaleString("ru-RU")},${String(kopecks).padStart(2, "0")}₽`;
}

function getFirstSelection(
  locations: readonly PickupLocation[]
): CheckoutPickupSelection | null {
  const location = locations[0];
  const slot = location?.slots[0];
  if (location === undefined || slot === undefined) return null;
  return { locationId: location.id, slotId: slot.id };
}

function hasSelection(
  locations: readonly PickupLocation[],
  selection: CheckoutPickupSelection
): boolean {
  const location = locations.find((candidate) => candidate.id === selection.locationId);
  return location?.slots.some((slot) => slot.id === selection.slotId) === true;
}

function getQuoteErrorTitle(state: Extract<CheckoutQuoteRequestState, { status: "error" }>): string {
  switch (state.code) {
    case "CART_ITEM_UNAVAILABLE":
      return "Корзина изменилась";
    case "PICKUP_OPTION_UNAVAILABLE":
      return "Время самовывоза больше недоступно";
    case "CHECKOUT_UNAVAILABLE":
      return "Самовывоз временно недоступен";
    case "CHECKOUT_STALE":
      return "Данные оформления устарели";
    case "AUTHENTICATION_ERROR":
      return "Сессия Customer истекла";
    default:
      return "Не удалось подготовить оформление";
  }
}

export function CheckoutScreen({
  items,
  customer,
  checkoutClient,
  orderClient,
  paymentClient,
  paymentNavigator,
  redemptionId = null,
  onBack,
  onOrderCreated,
  onViewOrders
}: CheckoutScreenProps): React.JSX.Element {
  const [optionsState, setOptionsState] = useState<CheckoutOptionsRequestState>({
    status: "idle"
  });
  const [quoteState, setQuoteState] = useState<CheckoutQuoteRequestState>({
    status: "idle"
  });
  const [selection, setSelection] = useState<CheckoutPickupSelection | null>(null);
  const [orderCreateState, setOrderCreateState] = useState<OrderCreateRequestState>({
    status: "idle"
  });
  const [paymentState, setPaymentState] = useState<PaymentRequestState>({
    status: "idle"
  });
  const controllerRef = useRef<CheckoutRequestController | null>(null);
  const orderControllerRef = useRef<ReturnType<typeof createOrderRequestController> | null>(null);
  const paymentControllerRef = useRef<ReturnType<typeof createPaymentRequestController> | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const paymentIdempotencyKeyRef = useRef<string | null>(null);
  const notifiedOrderIdRef = useRef<number | null>(null);
  const paymentOrderIdRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = createCheckoutRequestController(
      checkoutClient,
      setOptionsState,
      setQuoteState
    );
    const orderController = createOrderRequestController(
      orderClient,
      setOrderCreateState,
      () => undefined,
      () => undefined
    );
    const paymentController = createPaymentRequestController(
      paymentClient ?? {
        createPayment: async () => {
          throw new Error("Payment client is not configured");
        },
        getPayment: async () => {
          throw new Error("Payment client is not configured");
        }
      },
      setPaymentState,
      paymentNavigator
    );
    controllerRef.current = controller;
    orderControllerRef.current = orderController;
    paymentControllerRef.current = paymentController;
    controller.loadOptions();

    return () => {
      controller.dispose();
      orderController.dispose();
      paymentController.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
      if (orderControllerRef.current === orderController) orderControllerRef.current = null;
      if (paymentControllerRef.current === paymentController) paymentControllerRef.current = null;
    };
  }, [checkoutClient, orderClient, paymentClient, paymentNavigator]);

  useEffect(() => {
    if (optionsState.status !== "success") return;
    if (
      selection === null ||
      !hasSelection(optionsState.options.locations, selection)
    ) {
      setSelection(getFirstSelection(optionsState.options.locations));
    }
  }, [optionsState, selection]);

  const itemsKey = useMemo(
    () => items.map((item) => `${item.productId}:${item.quantity}`).join("|"),
    [items]
  );

  useEffect(() => {
    if (selection === null || items.length === 0) {
      return;
    }
    idempotencyKeyRef.current = null;
    notifiedOrderIdRef.current = null;
    setOrderCreateState({ status: "idle" });
    controllerRef.current?.quote(items, selection, redemptionId ?? undefined);
  }, [items, itemsKey, redemptionId, selection]);

  useEffect(() => {
    if (
      orderCreateState.status === "success" &&
      notifiedOrderIdRef.current !== orderCreateState.order.id
    ) {
      notifiedOrderIdRef.current = orderCreateState.order.id;
      onOrderCreated();
    }
  }, [onOrderCreated, orderCreateState]);

  useEffect(() => {
    if (orderCreateState.status !== "success") return;
    if (paymentOrderIdRef.current !== orderCreateState.order.id) {
      paymentOrderIdRef.current = orderCreateState.order.id;
      paymentIdempotencyKeyRef.current = null;
      setPaymentState({ status: "idle" });
    }
  }, [orderCreateState]);

  useEffect(() => {
    if (
      orderCreateState.status !== "success" ||
      paymentState.status !== "pending" ||
      AppState === undefined ||
      typeof AppState.addEventListener !== "function"
    ) {
      return;
    }
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        paymentControllerRef.current?.refresh(orderCreateState.order.id);
      }
    });
    return () => subscription.remove();
  }, [orderCreateState, paymentState.status]);

  const selectedLocation =
    optionsState.status === "success" && selection !== null
      ? optionsState.options.locations.find(
          (location) => location.id === selection.locationId
        )
      : undefined;
  const quote = quoteState.status === "success" ? quoteState.quote : null;
  const quoteLoading = quoteState.status === "loading";
  const createOrder = (): void => {
    if (quote === null || selection === null) return;
    const idempotencyKey = idempotencyKeyRef.current ?? createIdempotencyKey();
    idempotencyKeyRef.current = idempotencyKey;
    orderControllerRef.current?.create(
      { items, pickup: selection, ...(redemptionId === null ? {} : redemptionId === undefined ? {} : { redemptionId }) },
      idempotencyKey
    );
  };

  const requestPayment = (reuseCurrentAttempt: boolean): void => {
    if (orderCreateState.status !== "success") return;
    const idempotencyKey =
      (reuseCurrentAttempt ? paymentIdempotencyKeyRef.current : null) ??
      `payment-${orderCreateState.order.id}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    paymentIdempotencyKeyRef.current = idempotencyKey;
    paymentControllerRef.current?.create(orderCreateState.order.id, idempotencyKey);
  };
  const createPayment = (): void => requestPayment(true);
  const createNewPayment = (): void => requestPayment(false);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.phoneShell}>
        <View style={styles.header}>
          <View style={styles.headerDecor} />
          <View style={styles.headerRow}>
            <Pressable
              accessibilityLabel="Вернуться в корзину"
              accessibilityRole="button"
              onPress={onBack}
              style={styles.backButton}
            >
              <Text style={styles.backButtonText}>‹</Text>
            </Pressable>
            <Text style={styles.logo}>
              <Text style={styles.logoFlame}>🔥</Text> Самовывоз
            </Text>
            <View style={styles.headerSpacer} />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
          style={styles.content}
        >
          <View style={styles.intro}>
            <Text style={styles.pageTitle}>Проверка оформления</Text>
            <Text style={styles.pageDescription}>
              Подтвердите точку и время. На этом шаге заказ не создаётся и оплата не запускается.
            </Text>
          </View>

          {orderCreateState.status === "success" ? (
            <View style={styles.stateCard} testID="order-create-success">
              <Text style={styles.successIcon}>✅</Text>
              <Text style={styles.stateTitle}>Заказ создан</Text>
              <Text style={styles.orderNumber}>Заказ #{orderCreateState.order.id}</Text>
              <Text style={styles.stateText}>
                Итого: {formatPriceMinor(orderCreateState.order.totalMinor)}
              </Text>
              <Text style={styles.statusText}>Ожидает оплаты</Text>
              <Text style={styles.stateText}>
                Заказ сохранён в Backend. Оплата не выполнена, в iiko заказ не отправлен.
              </Text>
              {paymentState.status === "loading" ? (
                <View style={styles.paymentState} testID="payment-loading">
                  <ActivityIndicator color="#ff5e3a" size="small" />
                  <Text style={styles.stateText}>Создаём платёж через YooKassa…</Text>
                </View>
              ) : null}
              {paymentState.status === "pending" ? (
                <View style={styles.paymentNotice} testID="payment-pending">
                  <Text style={styles.paymentTitle}>Ожидаем подтверждение оплаты</Text>
                  <Text style={styles.stateText}>
                    Вернитесь из YooKassa и обновите статус. Redirect не считается оплатой.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => paymentControllerRef.current?.refresh(orderCreateState.order.id)}
                    style={styles.retryButton}
                  >
                    <Text style={styles.retryText}>Проверить статус оплаты</Text>
                  </Pressable>
                </View>
              ) : null}
              {paymentState.status === "success" ? (
                <View style={styles.paymentSuccess} testID="payment-success">
                  <Text style={styles.paymentTitle}>Оплата подтверждена Backend</Text>
                  <Text style={styles.stateText}>
                    Заказ сохранён и передаётся в iiko. Принятие кухней появится после подтверждения Backend.
                  </Text>
                </View>
              ) : null}
              {paymentState.status === "error" ? (
                <View style={styles.createError} testID="payment-error">
                  <Text style={styles.stateTitle}>Не удалось запустить оплату</Text>
                  <Text style={styles.stateText}>{paymentState.message}</Text>
                </View>
              ) : null}
              {paymentState.status !== "success" ? (
                <Pressable
                  accessibilityLabel="Оплатить картой"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: paymentState.status === "loading" }}
                  disabled={paymentState.status === "loading"}
                  onPress={
                    paymentState.status === "error"
                      ? paymentState.kind === "payment_invalid"
                        ? createNewPayment
                        : () => paymentControllerRef.current?.retryCreate()
                      : createPayment
                  }
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>
                    {paymentState.status === "loading"
                      ? "Готовим оплату…"
                      : paymentState.status === "error"
                        ? "Повторить оплату"
                        : "Оплатить картой"}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" onPress={onViewOrders} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Открыть мои заказы</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={onBack} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Вернуться в меню</Text>
              </Pressable>
            </View>
          ) : items.length === 0 ? (
            <View style={styles.stateCard} testID="checkout-empty">
              <Text style={styles.emptyIcon}>🛒</Text>
              <Text style={styles.stateTitle}>Корзина пуста</Text>
              <Text style={styles.stateText}>
                Вернитесь в меню и добавьте блюда перед оформлением.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={onBack}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Вернуться в корзину</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Customer</Text>
                <Text style={styles.profileName}>{customer.name}</Text>
                <Text style={styles.profilePhone}>{customer.phone}</Text>
              </View>

              <View style={styles.sectionCard} testID="checkout-pickup-options">
                <Text style={styles.sectionTitle}>Точка самовывоза</Text>
                {optionsState.status === "loading" ? (
                  <View style={styles.inlineState} testID="checkout-options-loading">
                    <ActivityIndicator color="#ff5e3a" size="small" />
                    <Text style={styles.stateText}>Загружаем доступные точки и слоты…</Text>
                  </View>
                ) : null}
                {optionsState.status === "error" ? (
                  <View style={styles.inlineState} testID="checkout-options-error">
                    <Text style={styles.stateTitle}>Параметры самовывоза недоступны</Text>
                    <Text style={styles.stateText}>{optionsState.message}</Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => controllerRef.current?.retryOptions()}
                      style={styles.retryButton}
                    >
                      <Text style={styles.retryText}>Повторить</Text>
                    </Pressable>
                  </View>
                ) : null}
                {optionsState.status === "success" ? (
                  <>
                    {optionsState.options.locations.map((location) => {
                      const locationSelected = selection?.locationId === location.id;
                      return (
                        <View key={location.id} style={styles.locationBlock}>
                          <Pressable
                            accessibilityLabel={`Выбрать точку ${location.name}`}
                            accessibilityRole="button"
                            accessibilityState={{ selected: locationSelected }}
                            onPress={() => {
                              const firstSlot = location.slots[0];
                              if (firstSlot !== undefined) {
                                setSelection({
                                  locationId: location.id,
                                  slotId: firstSlot.id
                                });
                              }
                            }}
                            style={[
                              styles.locationButton,
                              locationSelected ? styles.locationButtonSelected : null
                            ]}
                          >
                            <Text style={styles.locationName}>{location.name}</Text>
                            <Text style={styles.locationAddress}>{location.address}</Text>
                            <Text style={styles.locationTimezone}>{location.timezone}</Text>
                          </Pressable>
                          {locationSelected ? (
                            <View style={styles.slotGrid}>
                              {location.slots.map((slot) => {
                                const slotSelected = selection?.slotId === slot.id;
                                return (
                                  <Pressable
                                    accessibilityLabel={`Выбрать время ${slot.label}`}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: slotSelected }}
                                    key={slot.id}
                                    onPress={() =>
                                      setSelection({
                                        locationId: location.id,
                                        slotId: slot.id
                                      })
                                    }
                                    style={[
                                      styles.slotButton,
                                      slotSelected ? styles.slotButtonSelected : null
                                    ]}
                                  >
                                    <Text
                                      style={
                                        slotSelected
                                          ? styles.slotTextSelected
                                          : styles.slotText
                                      }
                                    >
                                      {slot.label}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </>
                ) : null}
              </View>

              {quoteLoading ? (
                <View style={styles.stateCard} testID="checkout-quote-loading">
                  <ActivityIndicator color="#ff5e3a" size="small" />
                  <Text style={styles.stateText}>Проверяем актуальные цены и наличие…</Text>
                </View>
              ) : null}

              {quoteState.status === "error" ? (
                <View style={styles.stateCard} testID="checkout-quote-error">
                  <Text style={styles.stateTitle}>{getQuoteErrorTitle(quoteState)}</Text>
                  <Text style={styles.stateText}>{quoteState.message}</Text>
                  <Text style={styles.stateText}>
                    Обновите проверку. Если блюдо или слот недоступны, Backend не разрешит продолжить.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      if (quoteState.code === "PICKUP_OPTION_UNAVAILABLE") {
                        controllerRef.current?.retryOptions();
                      } else {
                        controllerRef.current?.retryQuote();
                      }
                    }}
                    style={styles.retryButton}
                  >
                    <Text style={styles.retryText}>Повторить проверку</Text>
                  </Pressable>
                </View>
              ) : null}

              {quote !== null ? (
                <View style={styles.sectionCard} testID="checkout-quote-success">
                  <Text style={styles.sectionTitle}>Актуальный состав</Text>
                  {quote.items.map((item) => (
                    <View key={item.productId} style={styles.itemRow}>
                      <View style={styles.itemCopy}>
                        <Text style={styles.itemName}>{item.productName}</Text>
                        <Text style={styles.itemMeta}>
                          {item.quantity} × {formatPriceMinor(item.unitPriceMinor)}
                        </Text>
                      </View>
                      <Text style={styles.itemTotal}>{formatPriceMinor(item.lineTotalMinor)}</Text>
                    </View>
                  ))}
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Итого</Text>
                    <Text style={styles.totalValue}>{formatPriceMinor(quote.totalMinor)}</Text>
                  </View>
                  <View style={styles.confirmationNotice}>
                    <Text style={styles.confirmationText}>{quote.confirmationText}</Text>
                  </View>
                  {orderCreateState.status === "error" ? (
                    <View style={styles.createError} testID="order-create-error">
                      <Text style={styles.stateTitle}>Не удалось создать заказ</Text>
                      <Text style={styles.stateText}>{orderCreateState.message}</Text>
                      <Text style={styles.stateText}>
                        Повторите попытку: безопасный ключ запроса будет сохранён.
                      </Text>
                    </View>
                  ) : null}
                  <Pressable
                    accessibilityLabel="Создать внутренний заказ"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: orderCreateState.status === "loading" }}
                    disabled={orderCreateState.status === "loading"}
                    onPress={
                      orderCreateState.status === "error"
                        ? () => orderControllerRef.current?.retryCreate()
                        : createOrder
                    }
                    style={styles.primaryButton}
                  >
                    <Text style={styles.primaryButtonText}>
                      {orderCreateState.status === "loading"
                        ? "Создаём заказ…"
                        : orderCreateState.status === "error"
                          ? "Повторить создание заказа"
                          : "Создать внутренний заказ"}
                    </Text>
                  </Pressable>
                  <Text style={styles.pendingText}>Заказ ещё не создан</Text>
                </View>
              ) : null}

              {selectedLocation !== undefined && selection !== null ? (
                <Text style={styles.selectionHint} testID="checkout-selection-hint">
                  Выбрано: {selectedLocation.name}, слот подтверждается Backend.
                </Text>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = {
  safeArea: {
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    flex: 1
  },
  phoneShell: {
    backgroundColor: "#f9f7f4",
    flex: 1,
    maxWidth: 480,
    width: "100%"
  },
  header: {
    backgroundColor: "#1a1a1a",
    overflow: "hidden",
    borderBottomColor: "#3d1c08",
    borderBottomWidth: 1,
    paddingBottom: 14,
    paddingHorizontal: 18,
    paddingTop: 18,
    position: "relative"
  },
  headerDecor: {
    backgroundColor: "#3d1c08",
    borderRadius: 100,
    height: 160,
    opacity: 0.8,
    position: "absolute",
    right: -60,
    top: -70,
    width: 160
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    position: "relative"
  },
  backButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44
  },
  backButtonText: {
    color: "#ffffff",
    fontSize: 36,
    fontWeight: "300",
    lineHeight: 36
  },
  logo: {
    color: "#ff9500",
    fontSize: 21,
    fontWeight: "900"
  },
  logoFlame: {
    color: "#ffffff"
  },
  headerSpacer: {
    height: 44,
    width: 44
  },
  content: {
    flex: 1
  },
  contentContainer: {
    paddingBottom: 32,
    paddingHorizontal: 16,
    paddingTop: 18
  },
  intro: {
    marginBottom: 16
  },
  pageTitle: {
    color: "#1a1a1a",
    fontSize: 24,
    fontWeight: "900",
    marginBottom: 6
  },
  pageDescription: {
    color: "#6f6961",
    fontSize: 14,
    lineHeight: 20
  },
  sectionCard: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    marginBottom: 14,
    padding: 16,
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.06,
    shadowRadius: 10
  },
  sectionTitle: {
    color: "#1a1a1a",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 10
  },
  profileName: {
    color: "#24170f",
    fontSize: 16,
    fontWeight: "700"
  },
  profilePhone: {
    color: "#8a8580",
    fontSize: 14,
    marginTop: 3
  },
  inlineState: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 10
  },
  locationBlock: {
    marginBottom: 4
  },
  locationButton: {
    backgroundColor: "#fffaf2",
    borderColor: "#eadfd2",
    borderRadius: 14,
    borderWidth: 1,
    padding: 13
  },
  locationButtonSelected: {
    borderColor: "#ff5e3a",
    borderWidth: 2
  },
  locationName: {
    color: "#24170f",
    fontSize: 14,
    fontWeight: "800"
  },
  locationAddress: {
    color: "#6f6961",
    fontSize: 13,
    marginTop: 3
  },
  locationTimezone: {
    color: "#9a9289",
    fontSize: 12,
    marginTop: 5
  },
  slotGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 10
  },
  slotButton: {
    backgroundColor: "#ffffff",
    borderColor: "#eadfd2",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 11,
    minHeight: 44,
    paddingVertical: 9
  },
  slotButtonSelected: {
    backgroundColor: "#ff5e3a",
    borderColor: "#ff5e3a"
  },
  slotText: {
    color: "#5a544c",
    fontSize: 12,
    fontWeight: "700"
  },
  slotTextSelected: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800"
  },
  stateCard: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 18,
    marginBottom: 14,
    padding: 20,
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 10
  },
  emptyIcon: {
    fontSize: 44,
    marginBottom: 8
  },
  stateTitle: {
    color: "#24170f",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center"
  },
  stateText: {
    color: "#6f6961",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    textAlign: "center"
  },
  retryButton: {
    alignItems: "center",
    backgroundColor: "#fff0e8",
    borderRadius: 12,
    marginTop: 14,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  retryText: {
    color: "#d84428",
    fontSize: 13,
    fontWeight: "800"
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#ff5e3a",
    borderRadius: 13,
    minHeight: 48,
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 12
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800"
  },
  itemRow: {
    alignItems: "center",
    borderBottomColor: "#f0ebe5",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 11
  },
  itemCopy: {
    flex: 1,
    paddingRight: 12
  },
  itemName: {
    color: "#24170f",
    fontSize: 14,
    fontWeight: "700"
  },
  itemMeta: {
    color: "#8a8580",
    fontSize: 12,
    marginTop: 3
  },
  itemTotal: {
    color: "#24170f",
    fontSize: 14,
    fontWeight: "800"
  },
  totalRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 16
  },
  totalLabel: {
    color: "#24170f",
    fontSize: 18,
    fontWeight: "900"
  },
  totalValue: {
    color: "#ff5e3a",
    fontSize: 20,
    fontWeight: "900"
  },
  confirmationNotice: {
    backgroundColor: "#eef8ef",
    borderRadius: 12,
    marginTop: 16,
    padding: 12
  },
  confirmationText: {
    color: "#28633a",
    fontSize: 13,
    lineHeight: 18
  },
  createError: {
    backgroundColor: "#fff5e8",
    borderRadius: 12,
    marginTop: 14,
    padding: 12
  },
  pendingText: {
    color: "#8a8580",
    fontSize: 12,
    marginTop: 12,
    textAlign: "center"
  },
  paymentState: { alignItems: "center", marginTop: 14 },
  paymentNotice: { backgroundColor: "#fff8e8", borderRadius: 12, marginTop: 14, padding: 12 },
  paymentSuccess: { backgroundColor: "#eef8ef", borderRadius: 12, marginTop: 14, padding: 12 },
  paymentTitle: { color: "#28633a", fontSize: 14, fontWeight: "900" },
  successIcon: { fontSize: 46, marginBottom: 8 },
  orderNumber: { color: "#24170f", fontSize: 20, fontWeight: "900", marginTop: 10 },
  statusText: { color: "#d84428", fontSize: 15, fontWeight: "900", marginTop: 10 },
  secondaryButton: { alignItems: "center", borderColor: "#eadfd2", borderRadius: 13, borderWidth: 1, minHeight: 48, marginTop: 10, justifyContent: "center", paddingHorizontal: 18, paddingVertical: 12 },
  secondaryButtonText: { color: "#5a544c", fontSize: 14, fontWeight: "800" },
  selectionHint: {
    color: "#8a8580",
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 4,
    textAlign: "center"
  }
} as const;
