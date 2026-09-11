import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  createOrderRequestController,
  createCancellationRequestController,
  type CancellationClient,
  type CancellationRequestState,
  type OrderClient,
  type OrderDetailRequestState,
  type OrdersListRequestState
} from "@vse-pro-zhar/api-client";
import type { CustomerProfile, OrderResponse, OrderSummary } from "@vse-pro-zhar/contracts";


export interface OrdersScreenProps {
  readonly customer: CustomerProfile;
  readonly orderClient: OrderClient;
  readonly cancellationClient?: CancellationClient;
  readonly onBack: () => void;
}

function formatPriceMinor(priceMinor: number): string {
  const rubles = Math.floor(priceMinor / 100);
  const kopecks = priceMinor % 100;
  return kopecks === 0
    ? `${rubles.toLocaleString("ru-RU")}₽`
    : `${rubles.toLocaleString("ru-RU")},${String(kopecks).padStart(2, "0")}₽`;
}

function statusLabel(order: Pick<OrderSummary, "status"> & { readonly fulfillment?: OrderResponse["fulfillment"] }): string {
  switch (order.status) {
    case "pending_payment":
      return "Ожидает оплаты";
    case "payment_confirmed":
      return order.fulfillment?.status === "submitted"
        ? "Ожидаем кухню"
        : "Передаём заказ";
    case "kitchen_accepted":
      return "Принят кухней";
    case "preparing":
      return "Готовится";
    case "ready_for_pickup":
      return "Готов к выдаче";
    case "completed":
      return "Завершён";
    case "canceled":
      return "Отменён";
    case "fulfillment_problem":
      return "Проблема исполнения";
  }
}

function statusNotice(order: OrderResponse): string {
  if (order.cancellationRefund?.refund?.status === "pending") {
    return "Отмена принята. Возврат обрабатывается; деньги будут возвращены после подтверждения платёжного провайдера.";
  }
  if (order.cancellationRefund?.refund?.status === "succeeded") return "Деньги возвращены платёжным провайдером.";
  if (order.cancellationRefund?.refund?.status === "canceled") return "Возврат не выполнен. Обратитесь в поддержку.";
  if (order.cancellationRefund?.refund?.status === "reconciliation_required") return "Статус возврата нужно проверить. Обратитесь в поддержку.";
  if (order.status === "canceled") return "Заказ отменён. Оплата не была передана в iiko.";
  switch (order.status) {
    case "pending_payment":
      return "Оплата ещё не выполнена. Заказ не отправлен в iiko и не принят кухней.";
    case "payment_confirmed":
      return order.fulfillment?.status === "submitted"
        ? "Оплата подтверждена Backend. Заказ передан в iiko, ждём подтверждение кухни."
        : "Оплата подтверждена Backend. Передаём заказ в iiko; принятие кухней ещё не подтверждено.";
    case "kitchen_accepted":
      return "Кухня подтвердила заказ. Скоро начнётся приготовление.";
    case "preparing":
      return "Заказ готовится на кухне.";
    case "ready_for_pickup":
      return "Заказ готов. Можно забрать его в выбранной точке.";
    case "completed":
      return "Заказ завершён.";
    case "fulfillment_problem":
      return "Оплата подтверждена, но исполнение заказа не удалось завершить. Обратитесь в поддержку.";
  }
}

function OrderDetail({
  order,
  onBack,
  onRefresh,
  cancellationState,
  onCancel
}: {
  readonly order: OrderResponse;
  readonly onBack: () => void;
  readonly onRefresh: () => void;
  readonly cancellationState: CancellationRequestState;
  readonly onCancel?: () => void;
}): React.JSX.Element {
  return (
    <View testID="orders-detail">
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.backLink}>
        <Text style={styles.backLinkText}>‹ Все заказы</Text>
      </Pressable>
      <View style={styles.card}>
        <Text style={styles.orderTitle}>Заказ #{order.id}</Text>
        <Text style={styles.status}>{statusLabel(order)}</Text>
        <Text style={styles.muted}>Создан {new Date(order.createdAt).toLocaleString("ru-RU")}</Text>
        {order.items.map((item) => (
          <View key={item.productId} style={styles.itemRow}>
            <View style={styles.itemCopy}>
              <Text style={styles.itemName}>{item.productName}</Text>
              <Text style={styles.muted}>{item.quantity} × {formatPriceMinor(item.unitPriceMinor)}</Text>
            </View>
            <Text style={styles.itemPrice}>{formatPriceMinor(item.lineTotalMinor)}</Text>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Итого</Text>
          <Text style={styles.totalValue}>{formatPriceMinor(order.totalMinor)}</Text>
        </View>
        <Text style={styles.pickupText}>
          {order.pickup.location.name}, {order.pickup.slot.label}
        </Text>
        <Text style={styles.notice}>{statusNotice(order)}</Text>
        {order.cancellationRefund?.canCancel === true && onCancel !== undefined ? <Pressable accessibilityRole="button" disabled={cancellationState.status === "loading"} onPress={onCancel} style={styles.cancelButton}><Text style={styles.cancelButtonText}>{cancellationState.status === "loading" ? "Отменяем…" : "Отменить заказ"}</Text></Pressable> : null}
        {cancellationState.status === "error" ? <Text style={styles.errorText}>{cancellationState.message}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Обновить статус заказа"
          onPress={onRefresh}
          style={styles.refreshButton}
        >
          <Text style={styles.refreshText}>Обновить статус</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function OrdersScreen({ customer, orderClient, cancellationClient, onBack }: OrdersScreenProps): React.JSX.Element {
  const [listState, setListState] = useState<OrdersListRequestState>({ status: "idle" });
  const [detailState, setDetailState] = useState<OrderDetailRequestState>({ status: "idle" });
  const [cancellationState, setCancellationState] = useState<CancellationRequestState>({ status: "idle" });
  const controllerRef = useRef<ReturnType<typeof createOrderRequestController> | null>(null);
  const cancellationControllerRef = useRef<ReturnType<typeof createCancellationRequestController> | null>(null);
  const detailOrderId = detailState.status === "success" ? detailState.order.id : null;

  useEffect(() => {
    const controller = createOrderRequestController(
      orderClient,
      () => undefined,
      setListState,
      setDetailState
    );
    controllerRef.current = controller;
    controller.loadOrders();
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [orderClient]);

  useEffect(() => {
    if (cancellationClient === undefined) return;
    const controller = createCancellationRequestController(cancellationClient, (state) => {
      setCancellationState(state);
      if (state.status === "success") setDetailState({ status: "success", order: state.order });
    });
    cancellationControllerRef.current = controller;
    return () => {
      controller.dispose();
      if (cancellationControllerRef.current === controller) cancellationControllerRef.current = null;
    };
  }, [cancellationClient]);

  useEffect(() => {
    if (AppState === undefined || typeof AppState.addEventListener !== "function") {
      return;
    }
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      if (detailState.status === "success") {
        controllerRef.current?.refreshOrder(detailState.order.id);
      } else {
        controllerRef.current?.refreshOrders();
      }
    });
    return () => subscription.remove();
  }, [detailOrderId]);

  const openDetail = (orderId: number): void => {
    setCancellationState({ status: "idle" });
    controllerRef.current?.loadOrder(orderId);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.phoneShell}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Вернуться в меню" accessibilityRole="button" onPress={onBack} style={styles.headerBackButton}>
            <Text style={styles.headerBack}>‹</Text>
          </Pressable>
          <Text style={styles.logo}>🔥 Мои заказы</Text>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.contentContainer}>
          <Text style={styles.pageTitle}>История заказов</Text>
          <Text style={styles.pageDescription}>{customer.name}, здесь только ваши внутренние заказы.</Text>

          {detailState.status === "success" ? (
    <OrderDetail
              order={detailState.order}
              onBack={() => setDetailState({ status: "idle" })}
              onRefresh={() => controllerRef.current?.refreshOrder(detailState.order.id)}
              cancellationState={cancellationState}
              onCancel={cancellationClient === undefined ? undefined : () => {
                Alert.alert("Отменить заказ?", "Если оплата уже подтверждена, будет запущен полный возврат сохранённой суммы.", [{ text: "Оставить" }, { text: "Отменить", style: "destructive", onPress: () => cancellationControllerRef.current?.cancel(detailState.order.id, `customer-cancel-${detailState.order.id}`) }]);
              }}
            />
          ) : (
            <>
              {detailState.status === "loading" ? (
                <View style={styles.stateCard} testID="orders-detail-loading">
                  <ActivityIndicator color="#ff5e3a" size="small" />
                  <Text style={styles.muted}>Загружаем заказ…</Text>
                </View>
              ) : null}
              {detailState.status === "error" ? (
                <View style={styles.stateCard} testID="orders-detail-error">
                  <Text style={styles.stateTitle}>Не удалось открыть заказ</Text>
                  <Text style={styles.muted}>{detailState.message}</Text>
                </View>
              ) : null}
              {listState.status === "loading" ? (
                <View style={styles.stateCard} testID="orders-loading">
                  <ActivityIndicator color="#ff5e3a" size="small" />
                  <Text style={styles.muted}>Загружаем заказы…</Text>
                </View>
              ) : null}
              {listState.status === "error" ? (
                <View style={styles.stateCard} testID="orders-error">
                  <Text style={styles.stateTitle}>Не удалось загрузить заказы</Text>
                  <Text style={styles.muted}>{listState.message}</Text>
                  <Pressable accessibilityRole="button" onPress={() => controllerRef.current?.retryOrders()} style={styles.retryButton}>
                    <Text style={styles.retryText}>Повторить</Text>
                  </Pressable>
                </View>
              ) : null}
              {listState.status === "success" && listState.response.orders.length === 0 ? (
                <View style={styles.stateCard} testID="orders-empty">
                  <Text style={styles.stateTitle}>Заказов пока нет</Text>
                  <Text style={styles.muted}>Создайте заказ после проверки корзины.</Text>
                </View>
              ) : null}
              {listState.status === "success" ? listState.response.orders.map((order) => (
                <Pressable
                  accessibilityLabel={`Открыть заказ #${order.id}`}
                  accessibilityRole="button"
                  key={order.id}
                  onPress={() => openDetail(order.id)}
                  style={styles.card}
                >
                  <View style={styles.orderRow}>
                    <View>
                      <Text style={styles.orderTitle}>Заказ #{order.id}</Text>
                      <Text style={styles.muted}>{new Date(order.createdAt).toLocaleDateString("ru-RU")}</Text>
                    </View>
                    <Text style={styles.totalValue}>{formatPriceMinor(order.totalMinor)}</Text>
                  </View>
                  <Text style={styles.status}>{statusLabel(order)}</Text>
                </Pressable>
              )) : null}
            </>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = {
  safeArea: { alignItems: "center", backgroundColor: "#1a1a1a", flex: 1 },
  phoneShell: { backgroundColor: "#f9f7f4", flex: 1, maxWidth: 480, width: "100%" },
  header: { alignItems: "center", backgroundColor: "#1a1a1a", borderBottomColor: "#3d1c08", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14 },
  headerBackButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  headerBack: { color: "#ffffff", fontSize: 36, lineHeight: 36 },
  headerSpacer: { width: 32 },
  logo: { color: "#ff9500", flex: 1, fontSize: 21, fontWeight: "900", marginLeft: 8 },
  contentContainer: { padding: 16, paddingBottom: 32 },
  pageTitle: { color: "#1a1a1a", fontSize: 24, fontWeight: "900", marginBottom: 6 },
  pageDescription: { color: "#6f6961", fontSize: 14, lineHeight: 20, marginBottom: 16 },
  card: { backgroundColor: "#ffffff", borderRadius: 18, marginBottom: 12, padding: 16, shadowColor: "#000000", shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.06, shadowRadius: 10 },
  orderRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  orderTitle: { color: "#24170f", fontSize: 17, fontWeight: "800" },
  status: { color: "#d84428", fontSize: 13, fontWeight: "800", marginTop: 8 },
  muted: { color: "#6f6961", fontSize: 13, lineHeight: 19, marginTop: 4 },
  itemRow: { alignItems: "center", borderBottomColor: "#f0ebe5", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  itemCopy: { flex: 1, paddingRight: 12 },
  itemName: { color: "#24170f", fontSize: 14, fontWeight: "700" },
  itemPrice: { color: "#24170f", fontSize: 14, fontWeight: "800" },
  totalRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingTop: 14 },
  totalLabel: { color: "#24170f", fontSize: 18, fontWeight: "900" },
  totalValue: { color: "#ff5e3a", fontSize: 18, fontWeight: "900" },
  pickupText: { color: "#5a544c", fontSize: 13, lineHeight: 19, marginTop: 14 },
  notice: { backgroundColor: "#fff5e8", borderRadius: 12, color: "#89531d", fontSize: 13, lineHeight: 18, marginTop: 14, padding: 12 },
  cancelButton: { alignItems: "center", backgroundColor: "#fff0e8", borderRadius: 12, marginTop: 12, minHeight: 44, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 11 },
  cancelButtonText: { color: "#d84428", fontSize: 13, fontWeight: "800", textAlign: "center" },
  errorText: { color: "#b3261e", fontSize: 13, lineHeight: 19, marginTop: 10 },
  stateCard: { alignItems: "center", backgroundColor: "#ffffff", borderRadius: 18, marginBottom: 12, padding: 20 },
  stateTitle: { color: "#24170f", fontSize: 16, fontWeight: "800", textAlign: "center" },
  retryButton: { alignItems: "center", backgroundColor: "#fff0e8", borderRadius: 12, marginTop: 14, minHeight: 44, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 10 },
  retryText: { color: "#d84428", fontSize: 13, fontWeight: "800" },
  refreshButton: { alignSelf: "flex-start", backgroundColor: "#fff0e8", borderRadius: 12, marginTop: 14, minHeight: 44, paddingHorizontal: 14, paddingVertical: 10 },
  refreshText: { color: "#d84428", fontSize: 13, fontWeight: "800" },
  backLink: { marginBottom: 12, minHeight: 44, justifyContent: "center" },
  backLinkText: { color: "#d84428", fontSize: 14, fontWeight: "800" }
} as const;
