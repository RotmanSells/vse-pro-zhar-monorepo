import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, SafeAreaView, ScrollView, Text, View, useWindowDimensions } from "react-native";

import {
  createLoyaltyGamificationController,
  type LoyaltyClient,
  type LoyaltyGamificationController,
  type WheelRequestState,
  type WheelSpinRequestState
} from "@vse-pro-zhar/api-client";
import type { CustomerTab } from "./customer-tab-bar";
import { CustomerTabBar } from "./customer-tab-bar";

export interface WheelScreenProps {
  readonly client: LoyaltyClient;
  readonly onBack: () => void;
  readonly onTabSelect?: (tab: CustomerTab) => void;
  readonly cartItemCount?: number;
  readonly coalBalance?: number;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function prizeIcon(type: string): string {
  if (type === "coal") return "🔥";
  if (type === "xp") return "⭐";
  return "🎲";
}

function wheelColor(index: number): string {
  return ["#ff5e3a", "#ff9500", "#ffc83d", "#ff3333", "#9a6330", "#5c5751"][index % 6] ?? "#ff5e3a";
}

function formatMinorUnits(value: number): string {
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: value % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(value / 100)} ₽`;
}

function formatDuration(seconds: number): string {
  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    const suffix = hours % 10 === 1 && hours % 100 !== 11 ? "час" : hours % 10 >= 2 && hours % 10 <= 4 && (hours % 100 < 10 || hours % 100 >= 20) ? "часа" : "часов";
    return `${hours} ${suffix}`;
  }
  if (seconds % 60 === 0) return `${seconds / 60} мин.`;
  return `${seconds} сек.`;
}

function eligibilityText(response: NonNullable<Extract<WheelRequestState, { status: "success" }> ["response"]> & { status: "confirmed" }): string {
  if (response.eligibility.canSpin) return `${response.settings.maxSpins} spin за rolling ${formatDuration(response.settings.limitPeriodSeconds)}. Условие: завершённый оплаченный заказ.`;
  if (response.eligibility.reason === "cooldown" && response.eligibility.cooldownUntil !== null) return `Следующее вращение будет доступно ${formatDate(response.eligibility.cooldownUntil)}.`;
  if (response.eligibility.reason === "limit_reached") return `Лимит ${response.settings.maxSpins} spin за rolling ${formatDuration(response.settings.limitPeriodSeconds)} исчерпан.`;
  if (response.eligibility.reason === "disabled") return "Колесо отключено в Admin.";
  if (response.eligibility.reason === "outside_active_period") return "Колесо сейчас вне активного периода.";
  if (response.eligibility.reason === "reconciliation_required") return "Колесо временно недоступно: Backend требует сверку настроек.";
  return `Сделайте заказ от ${formatMinorUnits(response.settings.minOrderAmountMinor)} — нужен завершённый оплаченный заказ.`;
}

function prizePosition(index: number, total: number, size: number): { readonly left: number; readonly top: number } {
  const angle = -Math.PI / 2 + ((index + 0.5) * (Math.PI * 2)) / total;
  const radius = size * 0.3;
  const slotSize = Math.max(24, Math.min(42, size * 0.14));
  return {
    left: size / 2 + Math.cos(angle) * radius - slotSize / 2,
    top: size / 2 + Math.sin(angle) * radius - slotSize / 2
  };
}

function wheelGradient(prizes: readonly { readonly type: string }[]): string {
  if (prizes.length === 0) return "#ff5e3a";
  const segmentCount = 6;
  const segmentAngle = 360 / segmentCount;
  const stops = Array.from({ length: segmentCount }, (_, index) => {
    const start = index * segmentAngle;
    const end = (index + 1) * segmentAngle;
    const separator = Math.min(end, start + 1.5);
    return `${wheelColor(index)} ${start}deg ${end - 1.5}deg, #1a1a1a ${end - 1.5}deg ${separator}deg`;
  });
  return `conic-gradient(from -90deg, ${stops.join(", ")})`;
}

export function WheelScreen({ client, onTabSelect, cartItemCount = 0, coalBalance = 0 }: WheelScreenProps): React.JSX.Element {
  const [wheelState, setWheelState] = useState<WheelRequestState>({ status: "loading" });
  const [spinState, setSpinState] = useState<WheelSpinRequestState>({ status: "idle" });
  const controllerRef = useRef<LoyaltyGamificationController | null>(null);
  const rotation = useRef(new Animated.Value(0)).current;
  const spinCount = useRef(0);
  const { width: viewportWidth } = useWindowDimensions();

  useEffect(() => {
    const controller = createLoyaltyGamificationController(client, setWheelState, () => undefined, setSpinState);
    controllerRef.current = controller;
    controller.loadWheel();
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [client]);

  const spin = (): void => {
    if (wheelState.status !== "success" || wheelState.response.status !== "confirmed" || !wheelState.response.eligibility.canSpin || wheelState.response.eligibility.eligibleOrderId === null || spinState.status === "loading") return;
    controllerRef.current?.spin({ orderId: wheelState.response.eligibility.eligibleOrderId }, `wheel-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  };

  useEffect(() => {
    if (spinState.status !== "success") return;
    spinCount.current += 1;
    Animated.timing(rotation, { toValue: spinCount.current, duration: 1_200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [rotation, spinState]);

  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "720deg"] });
  const confirmed = wheelState.status === "success" && wheelState.response.status === "confirmed" ? wheelState.response : null;
  const spinning = spinState.status === "loading";
  const spinResult = spinState.status === "success" ? spinState.response.spin : null;
  const wheelSize = viewportWidth <= 340 ? 200 : viewportWidth <= 400 ? 240 : 300;
  const hubSize = viewportWidth <= 340 ? 40 : viewportWidth <= 400 ? 48 : 60;
  const wheelBorderWidth = viewportWidth <= 340 ? 6 : 8;
  const innerWheelSize = wheelSize - 8;
  const wheelBackground = wheelGradient(confirmed?.prizes ?? []);
  const visualPrizes = confirmed === null || confirmed.prizes.length === 0
    ? []
    : Array.from({ length: 6 }, (_, index) => confirmed.prizes[index % confirmed.prizes.length]!);
  const progressPercent = confirmed?.eligibility.canSpin === true ? 100 : 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <View style={styles.headerDecor} />
          <View style={styles.headerRow}>
            <Text style={styles.logo}><Text style={styles.logoFlame}>🔥</Text> Все Про Жар</Text>
            <View style={styles.coalBalance}>
              <Text style={styles.coalIcon}>🔥</Text>
              <Text style={styles.coalValue}>{formatMinorUnits(coalBalance).replace(" ₽", "")}</Text>
            </View>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text accessibilityRole="header" style={styles.title}>🎡 Поймай искру</Text>
          <Text style={styles.subtitle}>Крути колесо и забирай призы!</Text>
          {wheelState.status === "loading" ? <View style={styles.stateCard} testID="wheel-loading"><ActivityIndicator color="#ff5e3a" /><Text style={styles.stateText}>Загружаем колесо…</Text></View> : null}
          {wheelState.status === "error" ? <View accessibilityRole="alert" style={styles.stateCard}><Text style={styles.stateTitle}>Рулетка недоступна</Text><Text style={styles.stateText}>{wheelState.message}</Text><Pressable accessibilityRole="button" onPress={() => controllerRef.current?.loadWheel()} style={styles.retryButton}><Text style={styles.retryText}>Повторить</Text></Pressable></View> : null}
          {wheelState.status === "success" && wheelState.response.status === "unavailable" ? <View accessibilityRole="alert" style={styles.stateCard}><Text style={styles.stateTitle}>Рулетка временно недоступна</Text><Text style={styles.stateText}>Backend не подтвердил настройки рулетки. Попробуйте позже.</Text><Pressable accessibilityRole="button" onPress={() => controllerRef.current?.loadWheel()} style={styles.retryButton}><Text style={styles.retryText}>Повторить</Text></Pressable></View> : null}
          {confirmed !== null ? (
            <>
              <View style={[styles.wheelWrap, { height: wheelSize, width: wheelSize }]}>
                <View style={styles.pointer} />
                <Animated.View accessibilityLabel="Колесо фортуны" style={[styles.wheelOuter, { height: wheelSize, width: wheelSize, transform: [{ rotate }] }]}>
                  <View style={[styles.wheel, { backgroundImage: wheelBackground, borderWidth: wheelBorderWidth, height: innerWheelSize, width: innerWheelSize }]}>
                    {visualPrizes.map((prize, index) => {
                      const position = prizePosition(index, visualPrizes.length, innerWheelSize);
                      return <Text key={`${prize.id}-${index}`} style={[styles.prizeIcon, { left: position.left, top: position.top }]}>{prizeIcon(prize.type)}</Text>;
                    })}
                  </View>
                </Animated.View>
                <View style={[styles.hub, { borderRadius: hubSize / 2, height: hubSize, width: hubSize }]}><Text style={[styles.hubText, { fontSize: hubSize * 0.43 }]}>🔥</Text></View>
              </View>
              <View style={styles.infoCard}>
                {spinResult !== null ? <><Text style={styles.infoTitle}>Результат подтверждён</Text><Text style={styles.infoText}>{prizeIcon(spinResult.prize.type)} {spinResult.prize.name}</Text><Text style={styles.infoMuted}>Заказ #{spinResult.sourceOrderId} · {formatDate(spinResult.createdAt)}</Text></> : <><Text style={styles.infoTitle}>{confirmed.eligibility.canSpin ? "✅ Заказ подходит — можно крутить" : "🔒 Рулетка пока закрыта"}</Text><Text style={styles.infoText}>{eligibilityText(confirmed)}</Text></>}
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progressPercent}%` }]} /></View>
              </View>
              {spinState.status === "error" ? <View accessibilityRole="alert" style={styles.errorCard}><Text style={styles.errorText}>{spinState.message}</Text><Pressable accessibilityRole="button" onPress={spin} style={styles.retryButton}><Text style={styles.retryText}>Повторить</Text></Pressable></View> : null}
              <Pressable accessibilityLabel="Крутить колесо" accessibilityRole="button" accessibilityState={{ disabled: !confirmed.eligibility.canSpin || spinning }} disabled={!confirmed.eligibility.canSpin || spinning} onPress={spin} style={[styles.spinButton, !confirmed.eligibility.canSpin || spinning ? styles.spinButtonDisabled : null]}>
                {spinning ? <ActivityIndicator color="#7a746c" /> : <Text style={!confirmed.eligibility.canSpin || spinning ? styles.spinButtonTextDisabled : styles.spinButtonText}>{spinResult !== null ? "✅ SPIN ЗАВЕРШЁН" : "🔥 КРУТИТЬ"}</Text>}
              </Pressable>
              <View style={styles.prizesCard}><Text style={styles.prizesTitle}>🎁 Возможные призы</Text>{confirmed.prizes.map((prize) => <View key={prize.id} style={styles.prizeRow}><Text style={styles.prizeName}>{prizeIcon(prize.type)} {prize.name}</Text><Text style={styles.prizeDescription}>{prize.description}</Text></View>)}</View>
              {confirmed.spins.length > 0 ? <View style={styles.historyCard}><Text style={styles.prizesTitle}>История spin</Text>{confirmed.spins.slice(0, 5).map((item) => <Text key={item.id} style={styles.historyText}>#{item.id} · {item.prize.name} · {formatDate(item.createdAt)}</Text>)}</View> : null}
            </>
          ) : null}
        </ScrollView>
        <CustomerTabBar activeTab="roulette" cartItemCount={cartItemCount} onSelect={(tab) => onTabSelect?.(tab)} />
      </View>
    </SafeAreaView>
  );
}

const styles = {
  safeArea: { alignItems: "center", backgroundColor: "#1a1a1a", flex: 1 },
  shell: { backgroundColor: "#f9f7f4", flex: 1, maxWidth: 480, width: "100%" },
  header: { backgroundColor: "#2a1810", backgroundImage: "linear-gradient(135deg,#1a1a1a 0%,#2a1810 60%,#3d1c08 100%)", overflow: "hidden", paddingBottom: 16, paddingHorizontal: 18, paddingTop: 18, position: "relative" },
  headerDecor: { backgroundColor: "#3d1c08", borderRadius: 120, height: 190, opacity: 0.18, position: "absolute", right: -80, top: -100, width: 190 },
  headerRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", position: "relative" },
  logo: { color: "#ff9500", flex: 1, fontSize: 22, fontWeight: "900", letterSpacing: -0.5, textShadowColor: "rgba(255,94,58,0.55)", textShadowOffset: { height: 0, width: 0 }, textShadowRadius: 8 },
  logoFlame: { color: "#ff5e3a", textShadowColor: "rgba(255,94,58,0.75)", textShadowOffset: { height: 0, width: 0 }, textShadowRadius: 9 },
  coalBalance: { alignItems: "center", backgroundColor: "rgba(255,94,58,0.22)", backgroundImage: "linear-gradient(135deg,rgba(255,149,0,0.2),rgba(255,51,51,0.2))", borderColor: "rgba(255,149,0,0.4)", borderRadius: 30, borderWidth: 1, flexDirection: "row", gap: 6, minHeight: 44, paddingHorizontal: 13 },
  coalIcon: { fontSize: 16, textShadowColor: "rgba(255,94,58,0.75)", textShadowOffset: { height: 0, width: 0 }, textShadowRadius: 7 },
  coalValue: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  content: { gap: 14, padding: 18, paddingBottom: 28 },
  title: { color: "#1a1a1a", fontSize: 24, fontWeight: "900", textAlign: "center" },
  subtitle: { color: "#8a8580", fontSize: 14, marginBottom: 8, textAlign: "center" },
  wheelWrap: { alignItems: "center", alignSelf: "center", justifyContent: "center", marginBottom: 26, position: "relative" },
  pointer: { borderLeftColor: "transparent", borderLeftWidth: 14, borderRightColor: "transparent", borderRightWidth: 14, borderTopColor: "#ff3333", borderTopWidth: 24, filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.3))", position: "absolute", top: -6, zIndex: 5 },
  wheelOuter: { alignItems: "center", borderColor: "#ffc83d", borderRadius: 160, borderWidth: 4, justifyContent: "center", shadowColor: "rgba(0,0,0,0.4)", shadowOffset: { height: 12, width: 0 }, shadowOpacity: 1, shadowRadius: 24 },
  wheel: { backgroundColor: "#ff5e3a", borderColor: "#2a1810", borderRadius: 160, justifyContent: "center", overflow: "hidden", position: "relative" },
  prizeIcon: { color: "#ffffff", fontSize: 30, position: "absolute", textAlign: "center", width: 42 },
  hub: { alignItems: "center", backgroundColor: "#1a1a1a", borderColor: "#ffc83d", borderWidth: 3, justifyContent: "center", position: "absolute", shadowColor: "#000000", shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.5, shadowRadius: 12 },
  hubText: { lineHeight: 32 },
  infoCard: { backgroundColor: "#ffffff", borderRadius: 16, marginBottom: 20, padding: 14, shadowColor: "#000000", shadowOffset: { height: 4, width: 0 }, shadowOpacity: 0.08, shadowRadius: 12 },
  infoTitle: { color: "#1a1a1a", fontSize: 14, fontWeight: "800" },
  infoText: { color: "#5f5952", fontSize: 14, lineHeight: 20, marginTop: 5 },
  infoMuted: { color: "#9a938b", fontSize: 11, marginTop: 5 },
  progressTrack: { backgroundColor: "#eee4d8", borderRadius: 10, height: 10, marginTop: 10, overflow: "hidden" },
  progressFill: { backgroundColor: "#ff5e3a", borderRadius: 10, height: "100%" },
  spinButton: { alignItems: "center", backgroundColor: "#ff5e3a", backgroundImage: "linear-gradient(135deg,#ff9500,#ff5e3a,#ff3333)", borderRadius: 18, justifyContent: "center", minHeight: 58, padding: 18, shadowColor: "#ff5e3a", shadowOffset: { height: 8, width: 0 }, shadowOpacity: 0.5, shadowRadius: 24 },
  spinButtonDisabled: { backgroundColor: "#c9c2b9", backgroundImage: "linear-gradient(135deg,#c9c2b9,#c9c2b9)", shadowOpacity: 0 },
  spinButtonText: { color: "#ffffff", fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  spinButtonTextDisabled: { color: "#7a746c", fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  prizesCard: { backgroundColor: "#ffffff", borderRadius: 16, marginTop: 4, padding: 16, shadowColor: "#000000", shadowOffset: { height: 3, width: 0 }, shadowOpacity: 0.06, shadowRadius: 10 },
  prizesTitle: { color: "#1a1a1a", fontSize: 14, fontWeight: "900", marginBottom: 10 },
  prizeRow: { borderBottomColor: "#ece8e2", borderBottomWidth: 1, paddingVertical: 8 },
  prizeName: { color: "#1a1a1a", fontSize: 13, fontWeight: "800" },
  prizeDescription: { color: "#8a8580", fontSize: 11, marginTop: 3 },
  historyCard: { backgroundColor: "#fff1e9", borderColor: "#ffd8c7", borderRadius: 16, borderWidth: 1, padding: 16 },
  historyText: { color: "#6e4d40", fontSize: 12, paddingVertical: 4 },
  stateCard: { alignItems: "center", backgroundColor: "#ffffff", borderRadius: 16, gap: 8, padding: 26, shadowColor: "#000000", shadowOffset: { height: 3, width: 0 }, shadowOpacity: 0.06, shadowRadius: 10 },
  stateTitle: { color: "#1a1a1a", fontSize: 16, fontWeight: "800", textAlign: "center" },
  stateText: { color: "#8a8580", fontSize: 13, lineHeight: 19, textAlign: "center" },
  errorCard: { alignItems: "center", backgroundColor: "#fff5f3", borderRadius: 12, gap: 8, padding: 12 },
  errorText: { color: "#8f2f24", fontSize: 13, textAlign: "center" },
  retryButton: { alignItems: "center", backgroundColor: "#ff5e3a", borderRadius: 10, minHeight: 44, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 10 },
  retryText: { color: "#ffffff", fontSize: 13, fontWeight: "800" }
} as const;
