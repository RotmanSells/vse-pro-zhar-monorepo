import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoggedPressable as Pressable } from "../debug/pressable";
import { screenTrace } from "../debug/logger";

import {
  createProfileRequestController,
  type ProfileClient,
  type ProfileRequestController,
  type ProfileRequestState
} from "@vse-pro-zhar/api-client";
import type { NotificationsClient } from "../api/notifications-client";
import type {
  CustomerProfile,
  CustomerProfileRecentOrder,
  CustomerProfileSetting
} from "@vse-pro-zhar/contracts";

import { CustomerTabBar, type CustomerTab } from "./customer-tab-bar";

export interface ProfileScreenProps {
  readonly customer: CustomerProfile;
  readonly client: ProfileClient;
  readonly notificationsClient?: NotificationsClient;
  readonly onBack: () => void;
  readonly onRequireAuthentication?: () => void;
  readonly onOpenOrders: () => void;
  readonly onTabSelect: (tab: CustomerTab) => void;
  readonly cartItemCount: number;
}

function formatPriceMinor(priceMinor: number): string {
  const rubles = Math.floor(priceMinor / 100);
  const kopecks = priceMinor % 100;
  return kopecks === 0
    ? `${rubles.toLocaleString("ru-RU")}₽`
    : `${rubles.toLocaleString("ru-RU")},${String(kopecks).padStart(2, "0")}₽`;
}

function maskPhone(phone: string): string {
  if (phone.length < 7) return "••••";
  return `${phone.slice(0, 2)} ••• •••-${phone.slice(-4, -2)}-${phone.slice(-2)}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function orderItemsLabel(order: CustomerProfileRecentOrder): string {
  const label = order.items.map((item) => `${item.productName} ×${item.quantity}`).join(", ");
  return label.length > 52 ? `${label.slice(0, 52)}…` : label;
}

function settingLabel(setting: CustomerProfileSetting): string {
  if (setting.status === "unavailable") return "Недоступно";
  return setting.enabled ? "Включено" : "Отключено";
}

function StatCard({ label, value, fullWidth = false }: { readonly label: string; readonly value: string; readonly fullWidth?: boolean }): React.JSX.Element {
  return (
    <View style={[styles.statCard, fullWidth ? styles.statCardFull : null]}>
      <Text numberOfLines={2} style={[styles.statValue, fullWidth ? styles.statValueSmall : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function BonusInfoCard({ onOpenPassport }: { readonly onOpenPassport: () => void }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.bonusCard} testID="profile-bonus-card">
      <Pressable
        accessibilityLabel="Как работает бонусная система"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={styles.bonusHeader}
      >
        <Text style={styles.bonusHeaderText}>🔥 Как работает бонусная система</Text>
        <Text style={[styles.bonusChevron, expanded ? styles.bonusChevronExpanded : null]}>⌄</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.bonusBody} testID="profile-bonus-body">
          <BonusItem icon="🔥" title="Угольки" text="За каждые полные 100 ₽ завершённого заказа начисляется 1 уголёк. Угольки не сгорают и обмениваются на доступные награды." />
          <BonusItem icon="⭐" title="XP" text="За каждый полный рубль завершённого оплаченного заказа начисляется 1 XP. XP повышает ранг." />
          <BonusItem icon="🏕️" title="Ранги" text="Ранги считаются Backend из подтверждённого XP: Искра → Жар → Пламя → Вулкан." />
          <BonusItem icon="🎡" title="Рулетка" text="Рулетка проверяет eligibility только по правилам Backend. Возможные результаты — XP, угольки или без выигрыша." />
          <BonusItem icon="🎯" title="Квесты" text="Квесты и их прогресс появляются только из подтверждённых Backend definitions и событий." />
          <BonusItem icon="🎁" title="Что пока недоступно" text="Промокоды и физические подарки пока недоступны: для них ещё нет approved fulfillment contract." />
          <Pressable accessibilityLabel="Открыть мой Паспорт" accessibilityRole="button" onPress={onOpenPassport} style={styles.bonusCta}>
            <Text style={styles.bonusCtaText}>🏆 Открыть мой Паспорт</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function BonusItem({ icon, title, text }: { readonly icon: string; readonly title: string; readonly text: string }): React.JSX.Element {
  return (
    <View style={styles.bonusItem}>
      <View style={styles.bonusIcon}><Text style={styles.bonusIconText}>{icon}</Text></View>
      <Text style={styles.bonusItemText}><Text style={styles.bonusItemTitle}>{title}</Text> — {text}</Text>
    </View>
  );
}

function SettingsRow({ icon, label, setting, onToggle, busy }: { readonly icon: string; readonly label: string; readonly setting: CustomerProfileSetting; readonly onToggle?: () => void; readonly busy?: boolean }): React.JSX.Element {
  const interactive = setting.status === "confirmed" && onToggle !== undefined;
  return (
    <Pressable accessibilityRole={interactive ? "switch" : undefined} accessibilityState={interactive && setting.status === "confirmed" ? { checked: setting.enabled, disabled: busy } : { disabled: true }} disabled={!interactive || busy} onPress={onToggle} style={styles.settingRow} testID={`profile-setting-${label}`}>
      <Text style={styles.settingLabel}>{icon} {label}</Text>
      <View style={[styles.unavailablePill, setting.status === "confirmed" && setting.enabled ? styles.enabledPill : null]}><Text style={styles.unavailablePillText}>{busy ? "Сохраняем…" : settingLabel(setting)}</Text></View>
    </Pressable>
  );
}

function HistoryCard({ orders, onOpenOrders }: { readonly orders: readonly CustomerProfileRecentOrder[]; readonly onOpenOrders: () => void }): React.JSX.Element {
  return (
    <View style={styles.historyCard} testID="profile-history-card">
      <View style={styles.historyHeader}>
        <Text style={styles.cardTitle}>📜 История заказов</Text>
        <Pressable accessibilityLabel="Открыть все заказы" accessibilityRole="button" onPress={onOpenOrders} style={styles.allOrdersButton}>
          <Text style={styles.allOrdersText}>Все заказы</Text>
        </Pressable>
      </View>
      {orders.length === 0 ? (
        <View style={styles.historyEmpty} testID="profile-history-empty">
          <Text style={styles.historyEmptyText}>Пока нет заказов</Text>
          <Text style={styles.historyEmptyHint}>Создайте первый заказ в меню.</Text>
        </View>
      ) : orders.map((order) => (
        <Pressable
          accessibilityLabel={`Открыть заказ #${order.id}`}
          accessibilityRole="button"
          key={order.id}
          onPress={onOpenOrders}
          style={styles.historyItem}
        >
          <View style={styles.historyCopy}>
            <Text numberOfLines={1} style={styles.historyName}>{orderItemsLabel(order)}</Text>
            <Text numberOfLines={1} style={styles.historyMeta}>{formatDate(order.createdAt)} · 🚶 Самовывоз · {order.pickup.slot.label}</Text>
          </View>
          <Text style={styles.historySum}>{formatPriceMinor(order.totalMinor)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function LoadingState(): React.JSX.Element {
  return <View style={styles.stateCard} testID="profile-loading"><ActivityIndicator color="#ff5e3a" size="small" /><Text style={styles.stateText}>Загружаем профиль…</Text></View>;
}

export function ProfileScreen({ customer, client, notificationsClient, onBack, onOpenOrders, onRequireAuthentication, onTabSelect, cartItemCount }: ProfileScreenProps): React.JSX.Element {
  useEffect(() => screenTrace("profile"), []);
  const [state, setState] = useState<ProfileRequestState>({ status: "loading" });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const controllerRef = useRef<ProfileRequestController | null>(null);

  useEffect(() => {
    const controller = createProfileRequestController(client, setState);
    controllerRef.current = controller;
    controller.start();
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [client]);

  const response = state.status === "success" ? state.response : null;
  const pushSetting = response?.settings.pushNotifications;
  const loyalty = response?.loyalty;
  const coal = loyalty?.status === "confirmed" ? loyalty.summary.coalBalance.toLocaleString("ru-RU") : null;
  const nextMilestone = response?.stats.nextMilestone;
  const nextMilestoneValue = nextMilestone === null || nextMilestone === undefined
    ? "—"
    : `${nextMilestone.remaining.toLocaleString("ru-RU")} ${nextMilestone.unit === "xp" ? "XP" : "заказ."}`;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Вернуться в меню" accessibilityRole="button" onPress={onBack} style={styles.backButton}><Text style={styles.backText}>‹</Text></Pressable>
          <Text accessibilityRole="header" style={styles.headerTitle}>🔥 Профиль</Text>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {state.status === "loading" ? <LoadingState /> : null}
          {state.status === "error" ? (
            <View style={styles.stateCard} testID="profile-error">
              <Text style={styles.stateTitle}>{state.reason === "authentication" ? "Сессия профиля истекла" : "Не удалось загрузить профиль"}</Text>
              <Text style={styles.stateText}>{state.message}</Text>
              <Pressable accessibilityRole="button" onPress={() => {
                if (state.reason === "authentication") {
                  if (onRequireAuthentication !== undefined) onRequireAuthentication();
                  else controllerRef.current?.retry();
                  return;
                }
                controllerRef.current?.retry();
              }} style={styles.retryButton}><Text style={styles.retryText}>{state.reason === "authentication" ? "Войти снова" : "Повторить"}</Text></Pressable>
            </View>
          ) : null}
          {response !== null ? (
            <>
              <View style={styles.profileHead} testID="profile-head">
                <Text accessibilityLabel="Декоративный аватар" accessibilityRole="image" style={styles.avatar}>👨‍🍳</Text>
                <Text numberOfLines={2} style={styles.profileName}>{response.customer.name || customer.name}</Text>
                <Text style={styles.profilePhone}>{maskPhone(response.customer.phone)}</Text>
                <View style={[styles.profileCoal, coal === null ? styles.profileCoalUnavailable : null]}>
                  <Text style={styles.profileCoalText}>{coal === null ? "🔥 Угольки временно недоступны" : `🔥 ${coal} Угольков`}</Text>
                </View>
              </View>

              <View style={styles.statsGrid} testID="profile-stats">
                <StatCard label="Заказов сделано" value={response.stats.orderCount.toLocaleString("ru-RU")} />
                <StatCard label="До след. награды" value={nextMilestoneValue} />
                <StatCard fullWidth label="Любимое блюдо" value={response.stats.favoriteProduct ?? "—"} />
              </View>

              {loyalty?.status === "unavailable" ? (
                <View style={styles.unavailableNotice} testID="profile-loyalty-unavailable">
                  <Text style={styles.unavailableNoticeTitle}>Баланс лояльности временно недоступен</Text>
                  <Text style={styles.unavailableNoticeText}>Подтверждённые угольки и XP появятся после сверки Backend.</Text>
                </View>
              ) : null}

              <BonusInfoCard onOpenPassport={() => onTabSelect("passport")} />

              <View style={styles.settingsCard} testID="profile-settings">
                <Text style={styles.cardTitle}>⚙️ Настройки</Text>
                <SettingsRow busy={pushBusy} icon="🔔" label="Push-уведомления" onToggle={notificationsClient === undefined || pushSetting?.status !== "confirmed" ? undefined : () => {
                  setPushBusy(true);
                  setPushError(null);
                  void notificationsClient.updatePreferences({ pushEnabled: !pushSetting.enabled }).then(() => {
                    setState((current) => current.status === "success" ? { ...current, response: { ...current.response, settings: { ...current.response.settings, pushNotifications: { status: "confirmed", enabled: !pushSetting.enabled } } } } : current);
                  }).catch(() => setPushError("Не удалось сохранить настройку уведомлений. Повторите попытку.")).finally(() => setPushBusy(false));
                }} setting={response.settings.pushNotifications} />
                <SettingsRow icon="📧" label="Email-рассылка" setting={response.settings.emailSubscription} />
                <SettingsRow icon="🌙" label="Тёмная тема" setting={response.settings.darkTheme} />
                {pushError !== null ? <Text accessibilityRole="alert" style={styles.settingError}>{pushError}</Text> : null}
              </View>

              <HistoryCard onOpenOrders={onOpenOrders} orders={response.recentOrders} />

            </>
          ) : null}
        </ScrollView>
        <CustomerTabBar activeTab="profile" cartItemCount={cartItemCount} onSelect={onTabSelect} />
      </View>
    </SafeAreaView>
  );
}

const styles = {
  safeArea: { alignItems: "center", backgroundColor: "#1a1a1a", flex: 1 },
  shell: { backgroundColor: "#f9f7f4", flex: 1, maxWidth: 480, width: "100%" },
  header: { alignItems: "center", backgroundColor: "#1a1a1a", borderBottomColor: "#3d1c08", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 64, paddingHorizontal: 10 },
  backButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  backText: { color: "#ffffff", fontSize: 36, lineHeight: 36 },
  headerTitle: { color: "#ff9500", flex: 1, fontSize: 20, fontWeight: "900", marginLeft: 4, textAlign: "center", textShadowColor: "rgba(255,94,58,0.55)", textShadowOffset: { height: 0, width: 0 }, textShadowRadius: 8 },
  headerSpacer: { width: 44 },
  content: { padding: 16, paddingBottom: 36 },
  profileHead: { alignItems: "center", backgroundColor: "#2a1810", backgroundImage: "linear-gradient(135deg,#1a1a1a,#3d1c08)", borderRadius: 22, marginBottom: 18, overflow: "hidden", paddingHorizontal: 20, paddingVertical: 24, shadowColor: "#000000", shadowOffset: { height: 8, width: 0 }, shadowOpacity: 0.25, shadowRadius: 18 },
  avatar: { alignItems: "center", backgroundColor: "rgba(255,149,0,0.18)", borderColor: "rgba(255,149,0,0.4)", borderRadius: 42, borderWidth: 1, fontSize: 38, height: 82, lineHeight: 78, marginBottom: 10, overflow: "hidden", textAlign: "center", width: 82 },
  profileName: { color: "#ffffff", fontSize: 20, fontWeight: "900", textAlign: "center" },
  profilePhone: { color: "#d8c7bb", fontSize: 12, marginTop: 4 },
  profileCoal: { backgroundColor: "rgba(255,149,0,0.18)", borderColor: "rgba(255,149,0,0.4)", borderRadius: 30, borderWidth: 1, marginTop: 12, minHeight: 38, paddingHorizontal: 14, paddingVertical: 8 },
  profileCoalUnavailable: { backgroundColor: "rgba(138,133,128,0.18)", borderColor: "rgba(216,207,198,0.24)" },
  profileCoalText: { color: "#ffffff", fontSize: 14, fontWeight: "800" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 18 },
  statCard: { alignItems: "center", backgroundColor: "#ffffff", borderRadius: 16, flexBasis: "45%", flexGrow: 1, minHeight: 82, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 14, shadowColor: "#000000", shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.08, shadowRadius: 12 },
  statCardFull: { flexBasis: "100%" },
  statValue: { color: "#ff5e3a", fontSize: 22, fontWeight: "900", textAlign: "center" },
  statValueSmall: { fontSize: 15, lineHeight: 20 },
  statLabel: { color: "#8a8580", fontSize: 11, marginTop: 4, textAlign: "center" },
  bonusCard: { backgroundColor: "#ffffff", borderRadius: 16, marginBottom: 18, overflow: "hidden", shadowColor: "#000000", shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.08, shadowRadius: 12 },
  bonusHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 52, paddingHorizontal: 16 },
  bonusHeaderText: { color: "#24170f", flex: 1, fontSize: 15, fontWeight: "900" },
  bonusChevron: { color: "#8a8580", fontSize: 22, transform: [{ rotate: "0deg" }] },
  bonusChevronExpanded: { transform: [{ rotate: "180deg" }] },
  bonusBody: { paddingBottom: 16, paddingHorizontal: 16 },
  bonusItem: { alignItems: "flex-start", flexDirection: "row", gap: 11, paddingVertical: 10 },
  bonusIcon: { alignItems: "center", backgroundColor: "#fff3e6", borderRadius: 15, flexShrink: 0, height: 30, justifyContent: "center", width: 30 },
  bonusIconText: { fontSize: 16 },
  bonusItemText: { color: "#5f554d", flex: 1, fontSize: 12, lineHeight: 18 },
  bonusItemTitle: { color: "#24170f", fontWeight: "900" },
  bonusCta: { alignItems: "center", backgroundColor: "#fff1e9", borderRadius: 12, minHeight: 44, justifyContent: "center", marginTop: 8, paddingHorizontal: 12, paddingVertical: 10 },
  bonusCtaText: { color: "#d84428", fontSize: 13, fontWeight: "900" },
  settingsCard: { backgroundColor: "#ffffff", borderRadius: 16, marginBottom: 18, overflow: "hidden", shadowColor: "#000000", shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.08, shadowRadius: 12 },
  cardTitle: { color: "#24170f", fontSize: 15, fontWeight: "900", paddingHorizontal: 16, paddingTop: 15, paddingBottom: 9 },
  settingRow: { alignItems: "center", borderTopColor: "#ece8e2", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 58, paddingHorizontal: 16, paddingVertical: 8 },
  settingLabel: { color: "#4e4741", flex: 1, fontSize: 13, paddingRight: 10 },
  unavailablePill: { alignItems: "center", backgroundColor: "#f1eeea", borderRadius: 14, minHeight: 28, justifyContent: "center", paddingHorizontal: 10 },
  enabledPill: { backgroundColor: "#ffe7df" },
  unavailablePillText: { color: "#8a8580", fontSize: 10, fontWeight: "800" },
  settingError: { color: "#b42318", fontSize: 12, lineHeight: 17, paddingHorizontal: 16, paddingBottom: 12 },
  historyCard: { backgroundColor: "#ffffff", borderRadius: 16, marginBottom: 18, overflow: "hidden", shadowColor: "#000000", shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.08, shadowRadius: 12 },
  historyHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 55, paddingRight: 8 },
  allOrdersButton: { alignItems: "center", justifyContent: "center", minHeight: 44, paddingHorizontal: 8 },
  allOrdersText: { color: "#d84428", fontSize: 12, fontWeight: "800" },
  historyItem: { alignItems: "center", borderTopColor: "#ece8e2", borderTopWidth: 1, flexDirection: "row", minHeight: 66, paddingHorizontal: 16, paddingVertical: 11 },
  historyCopy: { flex: 1, minWidth: 0, paddingRight: 12 },
  historyName: { color: "#24170f", fontSize: 13, fontWeight: "700" },
  historyMeta: { color: "#8a8580", fontSize: 10, marginTop: 4 },
  historySum: { color: "#ff5e3a", fontSize: 14, fontWeight: "900" },
  historyEmpty: { borderTopColor: "#ece8e2", borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 16 },
  historyEmptyText: { color: "#4e4741", fontSize: 13, fontWeight: "700" },
  historyEmptyHint: { color: "#8a8580", fontSize: 11, marginTop: 4 },
  unavailableNotice: { backgroundColor: "#fff5e8", borderRadius: 14, marginBottom: 18, padding: 14 },
  unavailableNoticeTitle: { color: "#89531d", fontSize: 13, fontWeight: "900" },
  unavailableNoticeText: { color: "#8a6a4b", fontSize: 12, lineHeight: 18, marginTop: 4 },
  stateCard: { alignItems: "center", backgroundColor: "#ffffff", borderRadius: 16, gap: 8, padding: 26, shadowColor: "#000000", shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.06, shadowRadius: 10 },
  stateTitle: { color: "#24170f", fontSize: 16, fontWeight: "900", textAlign: "center" },
  stateText: { color: "#8a8580", fontSize: 13, lineHeight: 19, textAlign: "center" },
  retryButton: { alignItems: "center", backgroundColor: "#ff5e3a", borderRadius: 12, justifyContent: "center", marginTop: 6, minHeight: 44, paddingHorizontal: 16, paddingVertical: 10 },
  retryText: { color: "#ffffff", fontSize: 13, fontWeight: "900" }
} as const;
