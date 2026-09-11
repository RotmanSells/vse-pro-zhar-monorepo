import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  Platform,
  View
} from "react-native";

import {
  addCartItem,
  createAddGateController,
  createAuthRequestController,
  createCatalogRequestController,
  createCartPersistence,
  getCartItemCount,
  loadCart,
  type CartQuoteClient,
  type CartStorage,
  type CatalogReadClient,
  type CatalogRequestController,
  type CatalogRequestState
} from "@vse-pro-zhar/api-client";
import type { AuthState, CartItem, CatalogProduct } from "@vse-pro-zhar/contracts";

import {
  AuthClientError,
  createAuthClient,
  type AuthClient
} from "../api/auth-client";
import { createCheckoutClient } from "../api/checkout-client";
import { createOrderClient } from "../api/orders-client";
import { createCancellationClient } from "../api/cancellation-client";
import { createPaymentClient, type PaymentClient } from "../api/payments-client";
import { createCartQuoteClient } from "../api/cart-quote-client";
import { createCatalogClient } from "../api/catalog-client";
import { createLoyaltyClient } from "../api/loyalty-client";
import { createProfileClient, type ProfileClient } from "../api/profile-client";
import { createNotificationsClient, type NotificationsClient } from "../api/notifications-client";
import { registerNativePushDevice } from "../notifications/native";
import { createPlatformCartStorage } from "../cart/storage";
import { CartScreen, type CartChange } from "./cart-screen";
import { CheckoutScreen } from "./checkout-screen";
import { CustomerIdentifyModal, type CustomerIdentifyValues } from "./customer-identify-modal";
import { OrdersScreen } from "./orders-screen";
import { LoyaltyScreen } from "./loyalty-screen";
import { WheelScreen } from "./wheel-screen";
import { ProfileScreen } from "./profile-screen";
import { CustomerTabBar, type CustomerTab } from "./customer-tab-bar";
import { createPlatformPaymentConfirmationNavigator } from "../payments/navigation";
import type { PaymentConfirmationNavigator } from "../payments/navigation";

export interface CatalogScreenProps {
  readonly client?: CatalogReadClient;
  readonly quoteClient?: CartQuoteClient;
  readonly checkoutClient?: ReturnType<typeof createCheckoutClient>;
  readonly orderClient?: ReturnType<typeof createOrderClient>;
  readonly cancellationClient?: ReturnType<typeof createCancellationClient>;
  readonly paymentClient?: PaymentClient;
  readonly paymentNavigator?: PaymentConfirmationNavigator;
  readonly storage?: CartStorage;
  readonly authClient?: AuthClient;
  readonly loyaltyClient?: import("@vse-pro-zhar/api-client").LoyaltyClient;
  readonly profileClient?: ProfileClient;
  readonly notificationsClient?: NotificationsClient;
}

const CATEGORY_EMOJIS: Readonly<Record<string, string>> = {
  shashlyk: "🥩",
  krylya: "🍗",
  kebab: "🌯",
  salaty: "🥗",
  garniry: "🍟",
  deserty: "🍰",
  napitki: "🍺"
};

function formatPriceMinor(priceMinor: number): string {
  const rubles = Math.floor(priceMinor / 100);
  const kopecks = priceMinor % 100;

  return kopecks === 0
    ? `${rubles.toLocaleString("ru-RU")}₽`
    : `${rubles.toLocaleString("ru-RU")},${String(kopecks).padStart(2, "0")}₽`;
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").trim();
}

export function ProductCard({
  product,
  onAdd,
  disabled
}: {
  readonly product: CatalogProduct;
  readonly onAdd: () => void;
  readonly disabled: boolean;
}): React.JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [product.imageUrl]);
  const hasImage = product.imageUrl !== null && !imageFailed;

  return (
    <View style={styles.productCard}>
      <View style={styles.productImage}>
        <Text style={styles.productEmoji}>{product.emoji}</Text>
        {hasImage ? (
          <Image
            accessibilityLabel={product.name}
            onError={() => setImageFailed(true)}
            resizeMode="cover"
            source={{ uri: product.imageUrl as string }}
            style={styles.productImageAsset}
          />
        ) : null}
        {product.tag !== null ? (
          <View
            style={[
              styles.productTag,
              product.tag === "new" ? styles.productTagNew : styles.productTagHit
            ]}
          >
            <Text style={styles.productTagText}>
              {product.tag === "hit" ? "🔥 Хит" : "🆕 Новинка"}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.productBody}>
        <Text numberOfLines={2} style={styles.productName}>
          {product.name}
        </Text>
        <Text numberOfLines={3} style={styles.productDescription}>
          {product.description}
        </Text>
        <View style={styles.productBottom}>
          <Text style={styles.productPrice}>{formatPriceMinor(product.priceMinor)}</Text>
          <Pressable
            accessibilityLabel={`Добавить в корзину ${product.name}`}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onAdd}
            style={[styles.addButton, disabled ? styles.disabledAddButton : null]}
          >
            <Text style={disabled ? styles.disabledAddButtonText : styles.addButtonText}>＋</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function CatalogScreen({
  client,
  quoteClient,
  checkoutClient,
  orderClient,
  cancellationClient,
  paymentClient,
  paymentNavigator: configuredPaymentNavigator,
  storage,
  authClient,
  loyaltyClient,
  profileClient,
  notificationsClient
}: CatalogScreenProps): React.JSX.Element {
  const defaultClient = useMemo(() => createCatalogClient(), []);
  const catalogClient = client ?? defaultClient;
  const defaultQuoteClient = useMemo(() => createCartQuoteClient(), []);
  const cartQuoteClient = quoteClient ?? defaultQuoteClient;
  const defaultCheckoutClient = useMemo(() => createCheckoutClient(), []);
  const customerCheckoutClient = checkoutClient ?? defaultCheckoutClient;
  const defaultOrderClient = useMemo(() => createOrderClient(), []);
  const customerOrderClient = orderClient ?? defaultOrderClient;
  const defaultCancellationClient = useMemo(() => createCancellationClient(), []);
  const customerCancellationClient = cancellationClient ?? defaultCancellationClient;
  const defaultPaymentClient = useMemo(() => createPaymentClient(), []);
  const customerPaymentClient = paymentClient ?? defaultPaymentClient;
  const defaultPaymentNavigator = useMemo(
    () => createPlatformPaymentConfirmationNavigator(),
    []
  );
  const paymentNavigator = configuredPaymentNavigator ?? defaultPaymentNavigator;
  const defaultStorage = useMemo(() => createPlatformCartStorage(), []);
  const cartStorage = storage ?? defaultStorage;
  const defaultAuthClient = useMemo(() => createAuthClient(), []);
  const customerAuthClient = authClient ?? defaultAuthClient;
  const defaultLoyaltyClient = useMemo(() => createLoyaltyClient(), []);
  const customerLoyaltyClient = loyaltyClient ?? defaultLoyaltyClient;
  const defaultProfileClient = useMemo(() => createProfileClient(), []);
  const customerProfileClient = profileClient ?? defaultProfileClient;
  const defaultNotificationsClient = useMemo(() => createNotificationsClient(), []);
  const customerNotificationsClient = notificationsClient ?? defaultNotificationsClient;
  const [state, setState] = useState<CatalogRequestState>({
    status: "loading"
  });
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [loyaltyOpen, setLoyaltyOpen] = useState(false);
  const [rouletteOpen, setRouletteOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [redemptionIdToUse, setRedemptionIdToUse] = useState<number | null>(null);
  const [coalBalance, setCoalBalance] = useState(0);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState>({ status: "unknown" });
  const [identifyModalOpen, setIdentifyModalOpen] = useState(false);
  const [identifyMode, setIdentifyMode] = useState<"add" | "checkout" | "loyalty" | "wheel" | "profile">("add");
  const [identifySuccess, setIdentifySuccess] = useState(false);
  const authControllerRef = useRef<ReturnType<typeof createAuthRequestController> | null>(null);
  const addGateRef = useRef(createAddGateController());
  const checkoutIntentRef = useRef(false);
  const ordersIntentRef = useRef(false);
  const loyaltyIntentRef = useRef(false);
  const rouletteIntentRef = useRef(false);
  const profileIntentRef = useRef(false);
  const controllerRef = useRef<CatalogRequestController | null>(null);
  const cartItemsRef = useRef<CartItem[]>([]);

  useEffect(() => {
    const controller = createCatalogRequestController(catalogClient, setState);
    controllerRef.current = controller;
    controller.start();

    return () => {
      controller.dispose();

      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [catalogClient]);

  useEffect(() => {
    const controller = createAuthRequestController(customerAuthClient, setAuthState);
    authControllerRef.current = controller;
    controller.hydrate();
    return () => {
      controller.dispose();
      addGateRef.current.cancel();
      if (authControllerRef.current === controller) authControllerRef.current = null;
    };
  }, [customerAuthClient]);

  useEffect(() => {
    let mounted = true;
    if (authState.status !== "identified") {
      setCoalBalance(0);
      return () => {
        mounted = false;
      };
    }

    void customerLoyaltyClient.getSummary().then((response) => {
      if (!mounted) return;
      setCoalBalance(response.status === "confirmed" ? response.summary.coalBalance : 0);
    }).catch(() => {
      if (mounted) setCoalBalance(0);
    });

    return () => {
      mounted = false;
    };
  }, [authState.status, customerLoyaltyClient]);

  useEffect(() => {
    if (authState.status !== "identified" || (Platform.OS !== "ios" && Platform.OS !== "android")) return undefined;
    void registerNativePushDevice(customerNotificationsClient);
    return undefined;
  }, [authState.status, authState.status === "identified" ? authState.customer.phone : null, customerNotificationsClient]);

  useEffect(() => () => addGateRef.current.dispose(), []);

  const persistence = useMemo(
    () =>
      createCartPersistence(cartStorage, (message) => {
        setStorageError(message);
      }),
    [cartStorage]
  );

  useEffect(() => {
    let mounted = true;

    void loadCart(cartStorage).then((result) => {
      if (!mounted) {
        return;
      }

      cartItemsRef.current = result.items;
      setCartItems(result.items);
      setStorageError(result.error);
      setCartReady(true);
    });

    return () => {
      mounted = false;
    };
  }, [cartStorage]);

  useEffect(() => () => persistence.dispose(), [persistence]);

  const categories = state.status === "success" ? state.catalog.categories : [];
  const normalizedSearchQuery = normalizeSearchText(searchQuery);
  const products = useMemo(() => {
    if (state.status !== "success") {
      return [];
    }

    return state.catalog.categories.flatMap((category) => {
      if (activeCategory !== "all" && category.id !== Number(activeCategory)) {
        return [];
      }
      return category.products.filter((product) => {
        if (normalizedSearchQuery === "") return true;
        const searchableText = normalizeSearchText(
          `${product.name} ${product.description} ${category.name}`
        );
        return searchableText.includes(normalizedSearchQuery);
      });
    });
  }, [activeCategory, normalizedSearchQuery, state]);

  const retry = useCallback((): void => {
    controllerRef.current?.retry();
  }, []);

  const changeCart = useCallback<CartChange>(
    (updater) => {
      if (!cartReady) {
        return;
      }

      const nextItems = updater(cartItemsRef.current);
      cartItemsRef.current = nextItems;
      setCartItems(nextItems);
      setStorageError(null);
      void persistence.save(nextItems);
    },
    [cartReady, persistence]
  );

  const openCart = useCallback((): void => {
    if (cartReady) {
      setCartOpen(true);
    }
  }, [cartReady]);

  const handleAdd = useCallback(
    async (productId: number, quantity = 1): Promise<void> => {
      if (!cartReady || authState.status === "loading") return;
      setIdentifySuccess(false);
      if (authState.status === "identified") {
        try {
          await customerAuthClient.me();
        } catch (error: unknown) {
          if (error instanceof AuthClientError && error.kind === "authentication") {
            setAuthState({ status: "anonymous" });
          } else {
            setAuthState({
              status: "error",
              message: error instanceof AuthClientError
                ? error.message
                : "Не удалось проверить сессию"
            });
          }
          addGateRef.current.request({ productId, quantity }, { status: "anonymous" });
          setIdentifyMode("add");
          setIdentifyModalOpen(true);
          return;
        }
      }
      const directAction = addGateRef.current.request(
        { productId, quantity },
        authState
      );
      if (directAction !== null) {
        changeCart((current) => addCartItem(current, directAction.productId, directAction.quantity));
        return;
      }
      setIdentifyMode("add");
      authControllerRef.current?.clearError();
      setIdentifyModalOpen(true);
    },
    [authState, cartReady, changeCart, customerAuthClient]
  );

  const openCheckout = useCallback(async (): Promise<void> => {
    if (!cartReady || cartItemsRef.current.length === 0) return;

    checkoutIntentRef.current = true;
    setIdentifyMode("checkout");

    if (authState.status !== "identified") {
      authControllerRef.current?.clearError();
      setIdentifyModalOpen(true);
      return;
    }

    try {
      const response = await customerAuthClient.me();
      setAuthState({ status: "identified", customer: response.customer });
      checkoutIntentRef.current = false;
      setCheckoutOpen(true);
    } catch (error: unknown) {
      if (error instanceof AuthClientError && error.kind === "authentication") {
        setAuthState({ status: "anonymous" });
      } else {
        setAuthState({
          status: "error",
          message:
            error instanceof AuthClientError
              ? error.message
              : "Не удалось проверить сессию"
        });
      }
      setIdentifyModalOpen(true);
    }
  }, [authState, cartReady, customerAuthClient]);

  const openOrders = useCallback(async (): Promise<void> => {
    ordersIntentRef.current = true;
    if (authState.status !== "identified") {
      setIdentifyMode("checkout");
      setIdentifyModalOpen(true);
      return;
    }

    try {
      const response = await customerAuthClient.me();
      setAuthState({ status: "identified", customer: response.customer });
      ordersIntentRef.current = false;
      setOrdersOpen(true);
    } catch (error: unknown) {
      if (error instanceof AuthClientError && error.kind === "authentication") {
        setAuthState({ status: "anonymous" });
      } else {
        setAuthState({
          status: "error",
          message:
            error instanceof AuthClientError
              ? error.message
              : "Не удалось проверить сессию"
        });
      }
      setIdentifyModalOpen(true);
    }
  }, [authState, customerAuthClient]);

  const openLoyalty = useCallback(async (): Promise<void> => {
    loyaltyIntentRef.current = true;
    if (authState.status !== "identified") {
      setIdentifyMode("loyalty");
      setIdentifyModalOpen(true);
      return;
    }
    try {
      const response = await customerAuthClient.me();
      setAuthState({ status: "identified", customer: response.customer });
      loyaltyIntentRef.current = false;
      setLoyaltyOpen(true);
    } catch (error: unknown) {
      if (error instanceof AuthClientError && error.kind === "authentication") setAuthState({ status: "anonymous" });
      else setAuthState({ status: "error", message: error instanceof AuthClientError ? error.message : "Не удалось проверить сессию" });
      setIdentifyMode("loyalty");
      setIdentifyModalOpen(true);
    }
  }, [authState, customerAuthClient]);

  const openRoulette = useCallback(async (): Promise<void> => {
    rouletteIntentRef.current = true;
    if (authState.status !== "identified") {
      setIdentifyMode("wheel");
      setIdentifyModalOpen(true);
      return;
    }
    try {
      const response = await customerAuthClient.me();
      setAuthState({ status: "identified", customer: response.customer });
      rouletteIntentRef.current = false;
      setRouletteOpen(true);
    } catch (error: unknown) {
      if (error instanceof AuthClientError && error.kind === "authentication") setAuthState({ status: "anonymous" });
      else setAuthState({ status: "error", message: error instanceof AuthClientError ? error.message : "Не удалось проверить сессию" });
      setIdentifyMode("wheel");
      setIdentifyModalOpen(true);
    }
  }, [authState, customerAuthClient]);

  const openProfile = useCallback(async (): Promise<void> => {
    profileIntentRef.current = true;
    if (authState.status !== "identified") {
      setIdentifyMode("profile");
      authControllerRef.current?.clearError();
      setIdentifyModalOpen(true);
      return;
    }
    try {
      const response = await customerAuthClient.me();
      setAuthState({ status: "identified", customer: response.customer });
      profileIntentRef.current = false;
      setProfileOpen(true);
    } catch (error: unknown) {
      if (error instanceof AuthClientError && error.kind === "authentication") setAuthState({ status: "anonymous" });
      else setAuthState({ status: "error", message: error instanceof AuthClientError ? error.message : "Не удалось проверить сессию" });
      setIdentifyMode("profile");
      setIdentifyModalOpen(true);
    }
  }, [authState, customerAuthClient]);

  const completeAuthentication = useCallback(async (): Promise<boolean> => {
    const pending = addGateRef.current.consume();
    if (pending !== null) {
      changeCart((current) => addCartItem(current, pending.productId, pending.quantity));
    }
    const shouldOpenCheckout = checkoutIntentRef.current;
    const shouldOpenOrders = ordersIntentRef.current;
    const shouldOpenLoyalty = loyaltyIntentRef.current;
    const shouldOpenRoulette = rouletteIntentRef.current;
    const shouldOpenProfile = profileIntentRef.current;
    checkoutIntentRef.current = false;
    ordersIntentRef.current = false;
    loyaltyIntentRef.current = false;
    rouletteIntentRef.current = false;
    profileIntentRef.current = false;
    setIdentifyModalOpen(false);
    setIdentifySuccess(true);
    if (shouldOpenCheckout && cartItemsRef.current.length > 0) setCheckoutOpen(true);
    if (shouldOpenOrders) setOrdersOpen(true);
    if (shouldOpenLoyalty) setLoyaltyOpen(true);
    if (shouldOpenRoulette) setRouletteOpen(true);
    if (shouldOpenProfile) setProfileOpen(true);
    return true;
  }, [changeCart]);

  const submitIdentification = useCallback(
    async (values: CustomerIdentifyValues): Promise<boolean> => {
      if (authControllerRef.current === null) return false;
      try {
        await authControllerRef.current.identify(values);
        return completeAuthentication();
      } catch {
        return false;
      }
    },
    [completeAuthentication]
  );

  const authErrorMessage = authState.status === "error" ? authState.message : null;

  const cancelIdentification = useCallback((): void => {
    addGateRef.current.cancel();
    checkoutIntentRef.current = false;
    ordersIntentRef.current = false;
    loyaltyIntentRef.current = false;
    rouletteIntentRef.current = false;
    profileIntentRef.current = false;
    setIdentifyModalOpen(false);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    if (authControllerRef.current === null) return;
    await authControllerRef.current.logout();
    setProfileOpen(false);
  }, []);

  const requireProfileAuthentication = useCallback((): void => {
    setProfileOpen(false);
    setAuthState({ status: "anonymous" });
    setIdentifyMode("profile");
    authControllerRef.current?.clearError();
    setIdentifyModalOpen(true);
  }, []);

  const catalogProducts = useMemo(
    () =>
      state.status === "success"
        ? state.catalog.categories.flatMap((category) => category.products)
        : [],
    [state]
  );
  const cartItemCount = getCartItemCount(cartItems);

  const handleTabSelect = useCallback(
    (tab: CustomerTab): void => {
      if (tab === "menu") {
        setCartOpen(false);
        setOrdersOpen(false);
        setLoyaltyOpen(false);
        setRouletteOpen(false);
        setProfileOpen(false);
        return;
      }
      if (tab === "cart") {
        setOrdersOpen(false);
        setLoyaltyOpen(false);
        setRouletteOpen(false);
        setProfileOpen(false);
        openCart();
        return;
      }
      if (tab === "passport") {
        setCartOpen(false);
        setOrdersOpen(false);
        setRouletteOpen(false);
        setProfileOpen(false);
        void openLoyalty();
      }
      if (tab === "roulette") {
        setCartOpen(false);
        setOrdersOpen(false);
        setLoyaltyOpen(false);
        setProfileOpen(false);
        void openRoulette();
      }
      if (tab === "profile") {
        setCartOpen(false);
        setOrdersOpen(false);
        setLoyaltyOpen(false);
        setRouletteOpen(false);
        void openProfile();
      }
    },
    [openCart, openLoyalty, openProfile, openRoulette]
  );

  if (checkoutOpen && authState.status === "identified") {
    return (
      <CheckoutScreen
        checkoutClient={customerCheckoutClient}
        customer={authState.customer}
        items={cartItems}
        onOrderCreated={() => { changeCart(() => []); setRedemptionIdToUse(null); }}
        onBack={() => setCheckoutOpen(false)}
        onViewOrders={() => {
          setCheckoutOpen(false);
          setOrdersOpen(true);
        }}
        orderClient={customerOrderClient}
        paymentClient={customerPaymentClient}
        paymentNavigator={paymentNavigator}
        redemptionId={redemptionIdToUse}
      />
    );
  }

  if (ordersOpen && authState.status === "identified") {
    return (
      <OrdersScreen
        customer={authState.customer}
        onBack={() => setOrdersOpen(false)}
        orderClient={customerOrderClient}
        cancellationClient={customerCancellationClient}
      />
    );
  }

  if (loyaltyOpen && authState.status === "identified") {
    return <LoyaltyScreen client={customerLoyaltyClient} customer={authState.customer} onBack={() => setLoyaltyOpen(false)} onRedemptionSelected={setRedemptionIdToUse} onTabSelect={handleTabSelect} cartItemCount={cartItemCount} />;
  }

  if (rouletteOpen && authState.status === "identified") {
    return <WheelScreen client={customerLoyaltyClient} coalBalance={coalBalance} onBack={() => setRouletteOpen(false)} onTabSelect={handleTabSelect} cartItemCount={cartItemCount} />;
  }

  if (profileOpen && authState.status === "identified") {
    return (
      <ProfileScreen
        cartItemCount={cartItemCount}
        client={customerProfileClient}
        customer={authState.customer}
        notificationsClient={customerNotificationsClient}
        onBack={() => setProfileOpen(false)}
        onLogout={logout}
        onRequireAuthentication={requireProfileAuthentication}
        onOpenOrders={() => {
          setProfileOpen(false);
          void openOrders();
        }}
        onTabSelect={handleTabSelect}
      />
    );
  }

  if (cartOpen) {
    return (
      <>
        <CartScreen
          items={cartItems}
          onChange={changeCart}
          onIncrease={(productId) => void handleAdd(productId)}
          onClose={() => setCartOpen(false)}
          onTabSelect={handleTabSelect}
          coalBalance={coalBalance}
          products={catalogProducts}
          quoteClient={cartQuoteClient}
          onCheckout={() => void openCheckout()}
          storageError={storageError}
        />
        <CustomerIdentifyModal
          busy={authState.status === "loading"}
          errorMessage={authErrorMessage}
          mode={identifyMode}
          onCancel={cancelIdentification}
          onSubmit={submitIdentification}
          visible={identifyModalOpen}
        />
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.phoneShell}>
        <View style={styles.header}>
          <View style={styles.headerDecor} />
          <View style={styles.headerRow}>
            <Text style={styles.logo}>
              <Text style={styles.logoFlame}>🔥</Text> Все Про Жар
            </Text>
            <Pressable
              accessibilityLabel="Открыть баланс угольков"
              accessibilityRole="button"
              onPress={() => void openLoyalty()}
              style={styles.coalBalance}
              >
                <Text style={styles.coalIcon}>🔥</Text>
                <Text style={styles.coalValue}>{coalBalance.toLocaleString("ru-RU")}</Text>
              </Pressable>
          </View>
          {authState.status === "identified" ? (
            <View style={styles.headerNav}>
              <Pressable accessibilityLabel="Открыть мои заказы" accessibilityRole="button" onPress={() => void openOrders()} style={styles.headerNavButton}>
                <Text style={styles.headerNavText}>Заказы</Text>
              </Pressable>
              <Pressable accessibilityLabel="Открыть мою лояльность" accessibilityRole="button" onPress={() => void openLoyalty()} style={styles.headerNavButton}>
                <Text style={styles.headerNavText}>Угольки</Text>
              </Pressable>
              <Pressable accessibilityLabel="Выйти из профиля" accessibilityRole="button" onPress={logout} style={styles.headerNavButton}>
                <Text numberOfLines={1} style={styles.headerNavText}>{authState.customer.name}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <ScrollView
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
          style={styles.content}
        >
          <ScrollView
            contentContainerStyle={styles.categories}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: activeCategory === "all" }}
              onPress={() => setActiveCategory("all")}
              style={[
                styles.categoryChip,
                activeCategory === "all" ? styles.categoryChipActive : null
              ]}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  activeCategory === "all" ? styles.categoryChipTextActive : null
                ]}
              >
                🍴 Всё
              </Text>
            </Pressable>
            {categories.map((category) => {
              const isActive = activeCategory === String(category.id);

              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  key={category.id}
                  onPress={() => setActiveCategory(String(category.id))}
                  style={[styles.categoryChip, isActive ? styles.categoryChipActive : null]}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      isActive ? styles.categoryChipTextActive : null
                    ]}
                  >
                    {CATEGORY_EMOJIS[category.slug] ?? "🍽️"} {category.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.searchBar}>
            <TextInput
              accessibilityLabel="Поиск блюд"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setSearchQuery}
              placeholder="Найти блюдо или ингредиент"
              placeholderTextColor="#9a938b"
              returnKeyType="search"
              style={styles.searchInput}
              value={searchQuery}
            />
            {searchQuery !== "" ? (
              <Pressable
                accessibilityLabel="Очистить поиск"
                accessibilityRole="button"
                onPress={() => setSearchQuery("")}
                style={styles.clearSearchButton}
              >
                <Text style={styles.clearSearchText}>Очистить</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.promo}>
            <Text style={styles.promoBadge}>🔥</Text>
            <Text style={styles.promoTitle}>Сезон гриля открыт!</Text>
            <Text style={styles.promoDescription}>
              Выбирайте любимые блюда для самовывоза
            </Text>
          </View>

          {storageError !== null ? (
            <View style={styles.storageNotice} testID="catalog-storage-error">
              <Text style={styles.storageNoticeText}>{storageError}</Text>
            </View>
          ) : null}

          {identifySuccess ? (
            <View style={styles.successNotice} testID="customer-identify-success">
              <Text style={styles.successNoticeText}>Данные сохранены, блюдо добавлено в корзину.</Text>
            </View>
          ) : null}

          {state.status === "loading" ? (
            <View style={styles.stateCard} testID="catalog-loading">
              <ActivityIndicator color="#ff5e3a" size="small" />
              <Text style={styles.stateText}>Загружаем меню…</Text>
            </View>
          ) : null}

          {state.status === "error" ? (
            <View style={styles.stateCard} testID="catalog-error">
              <Text style={styles.stateTitle}>Не удалось загрузить меню</Text>
              <Text style={styles.stateText}>{state.message}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={retry}
                style={styles.retryButton}
              >
                <Text style={styles.retryText}>Повторить</Text>
              </Pressable>
            </View>
          ) : null}

          {state.status === "success" ? (
            <>
              <View style={styles.sectionHeading}>
                <Text style={styles.sectionTitle}>Меню</Text>
                <Text style={styles.sectionCount}>{products.length} блюд</Text>
              </View>
              {products.length === 0 ? (
                <View style={styles.stateCard}>
                  <Text style={styles.emptyIcon}>🍽️</Text>
                  <Text style={styles.stateTitle}>
                    {normalizedSearchQuery !== ""
                      ? `По запросу «${searchQuery.trim().slice(0, 60)}» ничего не найдено`
                      : activeCategory === "all"
                      ? "Каталог пока пуст"
                      : "В этой категории пока нет блюд"}
                  </Text>
                  <Text style={styles.stateText}>
                    {normalizedSearchQuery !== ""
                      ? "Попробуйте изменить запрос или очистить поиск."
                      : "Загляните позже — мы скоро добавим что-нибудь вкусное."}
                  </Text>
                </View>
              ) : (
                <View style={styles.productGrid}>
                  {products.map((product) => (
                    <ProductCard
                      disabled={!cartReady || authState.status === "loading"}
                      key={product.id}
                      onAdd={() => handleAdd(product.id)}
                      product={product}
                    />
                  ))}
                </View>
              )}
            </>
          ) : null}
        </ScrollView>
        {cartItemCount > 0 ? (
          <Pressable
            accessibilityLabel="Открыть корзину"
            accessibilityRole="button"
            disabled={!cartReady}
            onPress={openCart}
            style={styles.floatingCart}
          >
            <Text style={styles.floatingCartText}>🛒 Корзина</Text>
            <Text style={styles.floatingCartBadge}>{cartItemCount}</Text>
          </Pressable>
        ) : null}
        <CustomerTabBar activeTab="menu" cartItemCount={cartItemCount} onSelect={handleTabSelect} />
      </View>
      <CustomerIdentifyModal
        busy={authState.status === "loading"}
        errorMessage={authErrorMessage}
        mode={identifyMode}
        onCancel={cancelIdentification}
        onSubmit={submitIdentification}
        visible={identifyModalOpen}
      />
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
    paddingBottom: 16,
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
  headerNav: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 8
  },
  headerNavButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,149,0,0.12)",
    borderColor: "rgba(255,149,0,0.32)",
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 8
  },
  headerNavText: {
    color: "#ffc83d",
    fontSize: 12,
    fontWeight: "700"
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
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 13,
    shadowColor: "#ff5e3a",
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12
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
    paddingBottom: 24
  },
  categories: {
    gap: 10,
    paddingBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 16
  },
  searchBar: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#ece8e2",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: 16,
    marginHorizontal: 16,
    minHeight: 48,
    paddingLeft: 14,
    paddingRight: 8,
    shadowColor: "#000000",
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.05,
    shadowRadius: 8
  },
  searchInput: {
    color: "#1a1a1a",
    flex: 1,
    fontSize: 14,
    minHeight: 46,
    paddingHorizontal: 0,
    paddingVertical: 10
  },
  clearSearchButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 8
  },
  clearSearchText: {
    color: "#d94b2d",
    fontSize: 12,
    fontWeight: "800"
  },
  categoryChip: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#ece8e2",
    borderRadius: 14,
    borderWidth: 1.5,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  categoryChipActive: {
    backgroundColor: "#ff5e3a",
    backgroundImage: "linear-gradient(135deg,#ff5e3a,#ff3333)",
    borderColor: "#ff5e3a",
    shadowColor: "#ff5e3a",
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 10
  },
  categoryChipText: {
    color: "#5a544c",
    fontSize: 14,
    fontWeight: "600"
  },
  categoryChipTextActive: {
    color: "#ffffff"
  },
  promo: {
    backgroundColor: "#ff5e3a",
    backgroundImage: "linear-gradient(120deg,#ff5e3a,#ff9500,#ff3333)",
    borderRadius: 20,
    marginBottom: 16,
    marginHorizontal: 16,
    overflow: "hidden",
    paddingHorizontal: 20,
    paddingVertical: 18,
    position: "relative"
  },
  promoBadge: {
    color: "#ffffff",
    fontSize: 60,
    opacity: 0.24,
    position: "absolute",
    right: -10,
    top: -10,
    transform: [{ rotate: "15deg" }]
  },
  promoTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 4
  },
  promoDescription: {
    color: "#ffffff",
    fontSize: 13,
    opacity: 0.95
  },
  sectionHeading: {
    alignItems: "baseline",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    marginHorizontal: 16
  },
  sectionTitle: {
    color: "#1a1a1a",
    fontSize: 20,
    fontWeight: "800"
  },
  sectionCount: {
    color: "#8a8580",
    fontSize: 12
  },
  productGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    paddingHorizontal: 16
  },
  productCard: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    flexBasis: "47%",
    flexGrow: 1,
    maxWidth: "48%",
    minWidth: 0,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 12
  },
  productImage: {
    alignItems: "center",
    backgroundColor: "#dddddd",
    height: 120,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative"
  },
  productImageAsset: {
    height: "100%",
    position: "absolute",
    width: "100%"
  },
  productEmoji: {
    fontSize: 50,
    zIndex: 0
  },
  productTag: {
    borderRadius: 20,
    left: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
    position: "absolute",
    top: 8,
    zIndex: 2
  },
  productTagHit: {
    backgroundColor: "#ff3333"
  },
  productTagNew: {
    backgroundColor: "#ff9500"
  },
  productTagText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700"
  },
  productBody: {
    flex: 1,
    paddingBottom: 12,
    paddingHorizontal: 12,
    paddingTop: 11
  },
  productName: {
    color: "#1a1a1a",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
    marginBottom: 4
  },
  productDescription: {
    color: "#8a8580",
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 10
  },
  productBottom: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  productPrice: {
    color: "#1a1a1a",
    fontSize: 16,
    fontWeight: "800"
  },
  addButton: {
    alignItems: "center",
    backgroundColor: "#ff5e3a",
    backgroundImage: "linear-gradient(135deg,#ff5e3a,#ff3333)",
    borderRadius: 20,
    height: 44,
    justifyContent: "center",
    shadowColor: "#ff5e3a",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    width: 44
  },
  addButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700"
  },
  disabledAddButton: {
    alignItems: "center",
    backgroundColor: "#d8d3cd",
    borderRadius: 20,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  disabledAddButtonText: {
    color: "#8a8580",
    fontSize: 18,
    fontWeight: "700"
  },
  stateCard: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 28,
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 12
  },
  stateTitle: {
    color: "#1a1a1a",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center"
  },
  stateText: {
    color: "#8a8580",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center"
  },
  emptyIcon: {
    fontSize: 34,
    marginBottom: 2
  },
  retryButton: {
    backgroundColor: "#ff5e3a",
    borderRadius: 10,
    minHeight: 44,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  retryText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700"
  },
  storageNotice: {
    backgroundColor: "#fff7ed",
    borderColor: "#fed7aa",
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
    marginHorizontal: 16,
    padding: 12
  },
  storageNoticeText: {
    color: "#9a3412",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center"
  },
  successNotice: {
    backgroundColor: "#ecfdf3",
    borderColor: "#a6f4c5",
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
    marginHorizontal: 16,
    padding: 12
  },
  successNoticeText: {
    color: "#067647",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center"
  },
  floatingCart: {
    alignItems: "center",
    backgroundColor: "#ff5e3a",
    borderRadius: 28,
    bottom: 80,
    elevation: 5,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 18,
    minHeight: 48,
    paddingVertical: 12,
    position: "absolute",
    right: 16,
    shadowColor: "#ff5e3a",
    shadowOpacity: 0.35,
    shadowRadius: 12
  },
  floatingCartText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800"
  },
  floatingCartBadge: {
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: 12,
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    textAlign: "center"
  }
} as const;
