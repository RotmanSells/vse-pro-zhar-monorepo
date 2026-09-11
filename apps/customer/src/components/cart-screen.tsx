import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  cartQuoteMatchesItems,
  createCartQuoteRequestController,
  decrementCartItem,
  getCartItemCount,
  incrementCartItem,
  removeCartItem,
  type CartQuoteClient,
  type CartQuoteRequestController,
  type CartQuoteRequestState
} from "@vse-pro-zhar/api-client";
import type {
  CartItem,
  CartQuoteItem,
  CatalogProduct
} from "@vse-pro-zhar/contracts";

import { CustomerTabBar, type CustomerTab } from "./customer-tab-bar";

export type CartChange = (
  updater: (items: readonly CartItem[]) => CartItem[]
) => void;

export interface CartScreenProps {
  readonly items: readonly CartItem[];
  readonly products: readonly CatalogProduct[];
  readonly quoteClient: CartQuoteClient;
  readonly onChange: CartChange;
  readonly onIncrease?: (productId: number) => void;
  readonly onCheckout?: () => void;
  readonly onClose: () => void;
  readonly onTabSelect?: (tab: CustomerTab) => void;
  readonly coalBalance?: number;
  readonly storageError: string | null;
}

function formatPriceMinor(priceMinor: number): string {
  const rubles = Math.floor(priceMinor / 100);
  const kopecks = priceMinor % 100;

  return kopecks === 0
    ? `${rubles.toLocaleString("ru-RU")}₽`
    : `${rubles.toLocaleString("ru-RU")},${String(kopecks).padStart(2, "0")}₽`;
}

function getCartItemsKey(
  items: readonly Pick<CartItem, "productId" | "quantity">[]
): string {
  return items.map((item) => `${item.productId}:${item.quantity}`).join("|");
}

export function ProductImage({ product }: { readonly product: CatalogProduct | undefined }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [product?.imageUrl]);
  const hasImage = product?.imageUrl !== null && product?.imageUrl !== undefined && !imageFailed;

  return (
    <View style={styles.itemThumb}>
      <Text style={styles.itemEmoji}>{product?.emoji ?? "⚠️"}</Text>
      {hasImage ? (
        <Image
          accessibilityLabel={product?.name ?? "Недоступное блюдо"}
          onError={() => setImageFailed(true)}
          resizeMode="cover"
          source={{ uri: product?.imageUrl as string }}
          style={styles.itemImage}
        />
      ) : null}
    </View>
  );
}

function CartItemRow({
  item,
  product,
  quoteItem,
  quoteConfirmed,
  onChange,
  onIncrease
}: {
  readonly item: CartItem;
  readonly product: CatalogProduct | undefined;
  readonly quoteItem: CartQuoteItem | undefined;
  readonly quoteConfirmed: boolean;
  readonly onChange: CartChange;
  readonly onIncrease?: (productId: number) => void;
}): React.JSX.Element {
  const name = product?.name ?? `Блюдо #${item.productId}`;
  const linePrice = quoteConfirmed && quoteItem !== undefined
    ? formatPriceMinor(quoteItem.unitPriceMinor)
    : "Цена уточняется";
  const lineTotal = quoteConfirmed && quoteItem !== undefined
    ? formatPriceMinor(quoteItem.lineTotalMinor)
    : "—";

  return (
    <View style={styles.cartItem} testID={`cart-item-${item.productId}`}>
      <ProductImage product={product} />
      <View style={styles.itemInfo}>
        <Text numberOfLines={2} style={styles.itemName}>
          {name}
        </Text>
        <Text style={styles.itemPrice}>{linePrice} / шт</Text>
        <View style={styles.quantityControls}>
          <Pressable
            accessibilityLabel={`Уменьшить количество ${name}`}
            accessibilityRole="button"
            onPress={() => onChange((current) => decrementCartItem(current, item.productId))}
            style={styles.quantityButton}
          >
            <Text style={styles.quantityButtonText}>−</Text>
          </Pressable>
          <Text accessibilityLabel={`Количество ${name}: ${item.quantity}`} style={styles.quantityValue}>
            {item.quantity}
          </Text>
          <Pressable
            accessibilityLabel={`Увеличить количество ${name}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: item.quantity >= 99 }}
            disabled={item.quantity >= 99}
            onPress={() =>
              onIncrease === undefined
                ? onChange((current) => incrementCartItem(current, item.productId))
                : onIncrease(item.productId)
            }
            style={[
              styles.quantityButton,
              item.quantity >= 99 ? styles.quantityButtonDisabled : null
            ]}
          >
            <Text style={styles.quantityButtonText}>+</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.itemActions}>
        <Text style={styles.itemTotal}>{lineTotal}</Text>
        <Pressable
          accessibilityLabel={`Удалить ${name} из корзины`}
          accessibilityRole="button"
          onPress={() => onChange((current) => removeCartItem(current, item.productId))}
          style={styles.removeButton}
        >
          <Text style={styles.removeButtonText}>🗑️</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function CartScreen({
  items,
  products,
  quoteClient,
  onChange,
  onIncrease,
  onCheckout,
  onClose,
  onTabSelect,
  coalBalance = 0,
  storageError
}: CartScreenProps): React.JSX.Element {
  const [quoteState, setQuoteState] = useState<CartQuoteRequestState>({
    status: "idle"
  });
  const controllerRef = useRef<CartQuoteRequestController | null>(null);
  const requestedItemsKeyRef = useRef<string | null>(null);
  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products]
  );

  useEffect(() => {
    const controller = createCartQuoteRequestController(quoteClient, (state) => {
      if (state.status === "loading") {
        requestedItemsKeyRef.current = getCartItemsKey(state.items);
      } else if (state.status === "idle") {
        requestedItemsKeyRef.current = null;
      }

      setQuoteState(state);
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [quoteClient]);

  useEffect(() => {
    controllerRef.current?.quote(items);
  }, [items]);

  const retryQuote = useCallback((): void => {
    controllerRef.current?.retry();
  }, []);

  const quote = quoteState.status === "success" ? quoteState.quote : null;
  const quoteItemById = useMemo(
    () => new Map((quote?.items ?? []).map((item) => [item.productId, item])),
    [quote]
  );
  const itemCount = getCartItemCount(items);
  const currentItemsKey = getCartItemsKey(items);
  const quoteConfirmed =
    quoteState.status === "success" &&
    cartQuoteMatchesItems(items, quoteState.quote.items);
  const currentQuoteError =
    quoteState.status === "error" &&
    requestedItemsKeyRef.current === currentItemsKey;
  const quoteLoading = items.length > 0 && !quoteConfirmed && !currentQuoteError;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.phoneShell}>
        <View style={styles.header}>
          <View style={styles.headerDecor} />
          <View style={styles.headerRow}>
            <Text style={styles.logo}>
              <Text style={styles.logoFlame}>🔥</Text> Все Про Жар
            </Text>
            <View style={styles.coalBalance}>
              <Text style={styles.coalIcon}>🔥</Text>
              <Text style={styles.coalValue}>{coalBalance.toLocaleString("ru-RU")}</Text>
            </View>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
          style={styles.content}
        >
          {storageError !== null ? (
            <View style={styles.storageNotice} testID="cart-storage-error">
              <Text style={styles.storageNoticeText}>{storageError}</Text>
            </View>
          ) : null}

          <View style={styles.cartHeading}>
            <Text style={styles.sectionTitle}>🛒 Моя корзина</Text>
            {items.length > 0 ? (
              <Pressable
                accessibilityLabel="Очистить корзину"
                accessibilityRole="button"
                accessibilityState={{ disabled: items.length === 0 }}
                disabled={items.length === 0}
                onPress={() => onChange(() => [])}
                style={styles.clearButton}
              >
                <Text style={styles.clearButtonText}>Очистить</Text>
              </Pressable>
            ) : null}
          </View>

          {items.length === 0 ? (
            <View style={styles.emptyCart} testID="cart-empty">
              <Text style={styles.emptyIcon}>🛒</Text>
              <Text style={styles.stateTitle}>Корзина пуста</Text>
              <Text style={styles.emptyCartText}>
                {"Добавьте блюда из меню,\nчтобы оформить заказ!"}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>🔥 Перейти в меню</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.cartList}>
                {items.map((item) => (
                  <CartItemRow
                    item={item}
                    key={item.productId}
                    onChange={onChange}
                    onIncrease={onIncrease}
                    product={productById.get(item.productId)}
                    quoteConfirmed={quoteConfirmed}
                    quoteItem={quoteItemById.get(item.productId)}
                  />
                ))}
              </View>

              {quoteLoading ? (
                <View style={styles.stateCard} testID="cart-quote-loading">
                  <ActivityIndicator color="#ff5e3a" size="small" />
                  <Text style={styles.stateText}>Пересчитываем корзину…</Text>
                </View>
              ) : null}

              {currentQuoteError && quoteState.status === "error" ? (
                <View style={styles.stateCard} testID="cart-quote-error">
                  <Text style={styles.stateTitle}>
                    {quoteState.code === "CART_ITEM_UNAVAILABLE"
                      ? "Блюдо больше недоступно"
                      : "Не удалось рассчитать корзину"}
                  </Text>
                  <Text style={styles.stateText}>{quoteState.message}</Text>
                  <Text style={styles.stateText}>
                    Удалите недоступную позицию или повторите попытку.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={retryQuote}
                    style={styles.retryButton}
                  >
                    <Text style={styles.retryText}>Повторить расчёт</Text>
                  </Pressable>
                </View>
              ) : null}

              {quoteConfirmed && quoteState.status === "success" ? (
                <View testID="cart-quote-success">
                  <View style={styles.cartSummary}>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Товары</Text>
                      <Text style={styles.summaryValue}>{formatPriceMinor(quoteState.quote.totalMinor)}</Text>
                    </View>
                    <View style={styles.summaryTotalRow}>
                      <Text style={styles.summaryTotalLabel}>Итого</Text>
                      <Text style={styles.summaryTotalValue}>{formatPriceMinor(quoteState.quote.totalMinor)}</Text>
                    </View>
                  </View>
                  <Pressable
                    accessibilityLabel="Повторить расчёт"
                    accessibilityRole="button"
                    onPress={retryQuote}
                    style={styles.recalculateButton}
                  >
                    <Text style={styles.recalculateText}>Обновить расчёт</Text>
                  </Pressable>
                </View>
              ) : null}

              <Pressable
                accessibilityLabel="Оформить самовывоз"
                accessibilityRole="button"
                accessibilityState={{ disabled: !quoteConfirmed || onCheckout === undefined }}
                disabled={!quoteConfirmed || onCheckout === undefined}
                onPress={onCheckout}
                style={[
                  styles.checkoutButton,
                  !quoteConfirmed || onCheckout === undefined
                    ? styles.disabledCheckoutButton
                    : null
                ]}
              >
                <Text
                  style={
                    !quoteConfirmed || onCheckout === undefined
                      ? styles.disabledCheckoutText
                      : styles.checkoutButtonText
                  }
                >
                  {quoteConfirmed ? "Оформить самовывоз" : "Оформление пока недоступно"}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
        <CustomerTabBar
          activeTab="cart"
          cartItemCount={itemCount}
          onSelect={(tab) => onTabSelect?.(tab)}
        />
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
    backgroundColor: "#2a1810",
    backgroundImage: "linear-gradient(135deg,#1a1a1a 0%,#2a1810 60%,#3d1c08 100%)",
    overflow: "hidden",
    paddingBottom: 14,
    paddingHorizontal: 18,
    paddingTop: 18,
    position: "relative"
  },
  headerDecor: {
    backgroundColor: "#3d1c08",
    borderRadius: 100,
    height: 160,
    opacity: 0,
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
  logo: {
    color: "#ff9500",
    flex: 1,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
    textShadowColor: "rgba(255,94,58,0.55)",
    textShadowOffset: { height: 0, width: 0 },
    textShadowRadius: 8
  },
  logoFlame: {
    color: "#ff5e3a",
    textShadowColor: "rgba(255,94,58,0.75)",
    textShadowOffset: { height: 0, width: 0 },
    textShadowRadius: 9
  },
  coalBalance: {
    alignItems: "center",
    backgroundColor: "rgba(255,94,58,0.22)",
    backgroundImage: "linear-gradient(135deg,rgba(255,149,0,0.2),rgba(255,51,51,0.2))",
    borderColor: "rgba(255,149,0,0.4)",
    borderRadius: 30,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 13
  },
  coalIcon: {
    fontSize: 16,
    textShadowColor: "rgba(255,94,58,0.75)",
    textShadowOffset: { height: 0, width: 0 },
    textShadowRadius: 7
  },
  coalValue: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700"
  },
  content: {
    flex: 1
  },
  contentContainer: {
    paddingBottom: 28,
    paddingHorizontal: 16,
    paddingTop: 18
  },
  storageNotice: {
    backgroundColor: "#fff7ed",
    borderColor: "#fed7aa",
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
    padding: 12
  },
  storageNoticeText: {
    color: "#9a3412",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center"
  },
  emptyCart: {
    alignItems: "center",
    backgroundColor: "transparent",
    marginTop: 0,
    paddingHorizontal: 24,
    paddingVertical: 60
  },
  emptyIcon: {
    fontSize: 62,
    marginBottom: 14,
    opacity: 0.55
  },
  emptyCartText: {
    color: "#8a8580",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center"
  },
  stateCard: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    gap: 8,
    marginTop: 14,
    padding: 22,
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 12
  },
  stateTitle: {
    color: "#1a1a1a",
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center"
  },
  stateText: {
    color: "#8a8580",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center"
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#ff5e3a",
    backgroundImage: "linear-gradient(135deg,#ff5e3a,#ff3333)",
    borderRadius: 18,
    minHeight: 48,
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 18,
    shadowColor: "#ff5e3a",
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    width: "100%"
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0.5
  },
  cartHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18
  },
  sectionTitle: {
    color: "#1a1a1a",
    fontSize: 24,
    fontWeight: "800"
  },
  clearButton: {
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  clearButtonText: {
    color: "#ff5e3a",
    fontSize: 13,
    fontWeight: "700"
  },
  cartList: {
    gap: 12
  },
  cartItem: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    flexDirection: "row",
    gap: 10,
    padding: 11,
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.07,
    shadowRadius: 10
  },
  itemThumb: {
    alignItems: "center",
    backgroundColor: "#ff9500",
    borderRadius: 12,
    height: 60,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    width: 60
  },
  itemEmoji: {
    fontSize: 28
  },
  itemImage: {
    height: "100%",
    position: "absolute",
    width: "100%"
  },
  itemInfo: {
    flex: 1,
    minWidth: 0
  },
  itemName: {
    color: "#1a1a1a",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18
  },
  itemPrice: {
    color: "#8a8580",
    fontSize: 11,
    marginTop: 2
  },
  quantityControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 7
  },
  quantityButton: {
    alignItems: "center",
    borderColor: "#ece8e2",
    borderRadius: 8,
    borderWidth: 1.5,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  quantityButtonDisabled: {
    opacity: 0.45
  },
  quantityButtonText: {
    color: "#ff5e3a",
    fontSize: 16,
    fontWeight: "800"
  },
  quantityValue: {
    color: "#1a1a1a",
    fontSize: 14,
    fontWeight: "800",
    minWidth: 18,
    textAlign: "center"
  },
  itemActions: {
    alignItems: "flex-end",
    alignSelf: "stretch",
    justifyContent: "space-between"
  },
  itemTotal: {
    color: "#1a1a1a",
    fontSize: 13,
    fontWeight: "800"
  },
  removeButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44
  },
  removeButtonText: {
    color: "#8a8580",
    fontSize: 17
  },
  retryButton: {
    backgroundColor: "#ff5e3a",
    borderRadius: 10,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  retryText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700"
  },
  cartSummary: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    marginTop: 14,
    padding: 16,
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.07,
    shadowRadius: 10
  },
  summaryRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 10
  },
  summaryLabel: {
    color: "#8a8580",
    fontSize: 13
  },
  summaryValue: {
    color: "#5a544c",
    fontSize: 14,
    fontWeight: "700"
  },
  summaryTotalRow: {
    alignItems: "center",
    borderTopColor: "#ece8e2",
    borderTopStyle: "dashed",
    borderTopWidth: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 12
  },
  summaryTotalLabel: {
    color: "#1a1a1a",
    fontSize: 18,
    fontWeight: "800"
  },
  summaryTotalValue: {
    color: "#ff5e3a",
    fontSize: 20,
    fontWeight: "900"
  },
  recalculateButton: {
    alignItems: "center",
    borderColor: "#ff5e3a",
    borderRadius: 12,
    borderWidth: 1.5,
    marginTop: 10,
    paddingVertical: 10
  },
  recalculateText: {
    color: "#ff5e3a",
    fontSize: 13,
    fontWeight: "800"
  },
  checkoutButton: {
    alignItems: "center",
    backgroundColor: "#ff5e3a",
    backgroundImage: "linear-gradient(135deg,#ff5e3a,#ff3333)",
    borderRadius: 18,
    marginTop: 14,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 15,
    shadowColor: "#ff5e3a",
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 16
  },
  checkoutButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800"
  },
  disabledCheckoutButton: {
    alignItems: "center",
    backgroundColor: "#d8d3cd",
    borderRadius: 15,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 15
  },
  disabledCheckoutText: {
    color: "#8a8580",
    fontSize: 14,
    fontWeight: "800"
  }
} as const;
