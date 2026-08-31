import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View
} from "react-native";

import {
  createCatalogRequestController,
  type CatalogReadClient,
  type CatalogRequestController,
  type CatalogRequestState
} from "@vse-pro-zhar/api-client";
import type { CatalogProduct } from "@vse-pro-zhar/contracts";

import { createCatalogClient } from "../api/catalog-client";

export interface CatalogScreenProps {
  readonly client?: CatalogReadClient;
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

function ProductCard({ product }: { readonly product: CatalogProduct }): React.JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);
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
            accessibilityLabel="Добавление в корзину появится на следующем этапе"
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            disabled
            style={styles.disabledAddButton}
          >
            <Text style={styles.disabledAddButtonText}>＋</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function CatalogScreen({ client }: CatalogScreenProps): React.JSX.Element {
  const defaultClient = useMemo(() => createCatalogClient(), []);
  const catalogClient = client ?? defaultClient;
  const [state, setState] = useState<CatalogRequestState>({
    status: "loading"
  });
  const [activeCategory, setActiveCategory] = useState("all");
  const controllerRef = useRef<CatalogRequestController | null>(null);

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

  const categories = state.status === "success" ? state.catalog.categories : [];
  const products = useMemo(() => {
    if (state.status !== "success") {
      return [];
    }

    return state.catalog.categories.flatMap((category) =>
      activeCategory === "all" || category.id === Number(activeCategory)
        ? category.products
        : []
    );
  }, [activeCategory, state]);

  const retry = useCallback((): void => {
    controllerRef.current?.retry();
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.phoneShell}>
        <View style={styles.header}>
          <View style={styles.headerDecor} />
          <View style={styles.headerRow}>
            <Text style={styles.logo}>
              <Text style={styles.logoFlame}>🔥</Text> Все Про Жар
            </Text>
            <Text style={styles.headerLabel}>Меню</Text>
          </View>
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

          <View style={styles.promo}>
            <Text style={styles.promoBadge}>🔥</Text>
            <Text style={styles.promoTitle}>Сезон гриля открыт!</Text>
            <Text style={styles.promoDescription}>
              Выбирайте любимые блюда для самовывоза
            </Text>
          </View>

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
                    {activeCategory === "all"
                      ? "Каталог пока пуст"
                      : "В этой категории пока нет блюд"}
                  </Text>
                  <Text style={styles.stateText}>
                    Загляните позже — мы скоро добавим что-нибудь вкусное.
                  </Text>
                </View>
              ) : (
                <View style={styles.productGrid}>
                  {products.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </View>
              )}
            </>
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = {
  safeArea: {
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
    backgroundColor: "#24170f",
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
  logo: {
    color: "#ff5e3a",
    fontSize: 22,
    fontWeight: "900"
  },
  logoFlame: {
    color: "#ffffff"
  },
  headerLabel: {
    color: "#ffc83d",
    fontSize: 13,
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
  categoryChip: {
    backgroundColor: "#ffffff",
    borderColor: "#ece8e2",
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  categoryChipActive: {
    backgroundColor: "#ff5e3a",
    borderColor: "#ff5e3a",
    shadowColor: "#ff5e3a",
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
    minWidth: 140,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 12
  },
  productImage: {
    alignItems: "center",
    backgroundColor: "#ff9500",
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
  disabledAddButton: {
    alignItems: "center",
    backgroundColor: "#d8d3cd",
    borderRadius: 20,
    height: 36,
    justifyContent: "center",
    width: 36
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
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  retryText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700"
  }
} as const;
