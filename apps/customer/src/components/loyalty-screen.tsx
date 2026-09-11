import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoggedPressable as Pressable } from "../debug/pressable";
import { screenTrace } from "../debug/logger";

import {
  createLoyaltyRequestController,
  createLoyaltyGamificationController,
  LoyaltyClientError,
  type LoyaltyClient,
  type LoyaltyLedgerRequestState,
  type LoyaltyRequestController,
  type LoyaltySummaryRequestState
  ,type QuestRequestState
} from "@vse-pro-zhar/api-client";
import type {
  CustomerProfile,
  LoyaltyRedemptionsResponse,
  LoyaltyRewardsResponse,
  LoyaltyRankCode,
  LoyaltySummary
} from "@vse-pro-zhar/contracts";

import { CustomerTabBar, type CustomerTab } from "./customer-tab-bar";


export interface LoyaltyScreenProps {
  readonly customer: CustomerProfile;
  readonly client: LoyaltyClient;
  readonly onBack: () => void;
  readonly onRedemptionSelected?: (redemptionId: number) => void;
  readonly onTabSelect?: (tab: CustomerTab) => void;
  readonly cartItemCount?: number;
}

function formatUnits(value: number): string {
  return value.toLocaleString("ru-RU");
}

function formatQuestProgress(progress: number, goal: number, unit: string): string {
  if (unit === "minor_units") return `${formatUnits(Math.floor(progress / 100))} ₽ / ${formatUnits(Math.floor(goal / 100))} ₽`;
  return `${formatUnits(progress)} / ${formatUnits(goal)} заказ${goal === 1 ? "" : "а"}`;
}

function ledgerSourceLabel(sourceType: string): string {
  if (sourceType === "completed_order") return "Завершённый заказ";
  if (sourceType === "redemption") return "Обмен награды";
  if (sourceType === "wheel_spin") return "Награда рулетки";
  if (sourceType === "quest_reward") return "Награда за квест";
  return "Корректировка";
}

function ledgerDelta(value: number, suffix: string): string {
  return `${value > 0 ? "+" : ""}${formatUnits(value)} ${suffix}`;
}

function createRedemptionIdempotencyKey(rewardId: number): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return `redemption-${rewardId}-${globalThis.crypto.randomUUID()}`;
  return `redemption-${rewardId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const rankMarkStyles: Readonly<Record<LoyaltyRankCode, { readonly backgroundColor: string }>> = {
  spark: { backgroundColor: "#ffc83d" },
  heat: { backgroundColor: "#ff8b3d" },
  flame: { backgroundColor: "#ff5e3a" },
  volcano: { backgroundColor: "#d94431" }
};

function RankMark({ code }: { readonly code: LoyaltyRankCode }): React.JSX.Element {
  return (
    <View
      accessibilityLabel={`Значок ранга ${code}`}
      accessibilityRole="image"
      style={[styles.rankMark, rankMarkStyles[code]]}
      testID="passport-rank-icon"
    >
      <View style={styles.rankMarkCore} />
      <View style={styles.rankMarkDot} />
    </View>
  );
}

function PassportCard({ summary }: { readonly summary: LoyaltySummary }): React.JSX.Element {
  const nextThreshold = summary.nextRank?.thresholdXp ?? summary.xp;
  return (
    <View style={styles.passportCard} testID="passport-rank-card">
      <View style={styles.rankRow}>
        <RankMark code={summary.rank.code} />
        <View style={styles.rankCopy}>
          <Text style={styles.rankName}>{summary.rank.name}</Text>
          <Text style={styles.rankXp}>{formatUnits(summary.xp)} / {formatUnits(nextThreshold)} XP</Text>
        </View>
      </View>
      <View
        accessibilityLabel="Прогресс ранга"
        accessibilityRole="progressbar"
        accessibilityValue={{ max: 100, min: 0, now: summary.progressPercent }}
        style={styles.progressTrack}
        testID="loyalty-progress"
      >
        <View style={[styles.progressFill, { width: `${summary.progressPercent}%` }]} />
      </View>
      {summary.isMaxRank ? (
        <Text style={styles.progressText}>Максимальный ранг достигнут</Text>
      ) : summary.nextRank !== null ? (
        <Text style={styles.progressText}>До ранга «{summary.nextRank.name}» осталось {formatUnits(summary.xpToNextRank)} XP</Text>
      ) : null}
      <Text accessibilityRole="image" style={styles.passportFire}>🔥</Text>
    </View>
  );
}

function LoadingCard({ children }: { readonly children: string }): React.JSX.Element {
  return <View style={styles.stateCard}><ActivityIndicator color="#ff5e3a" size="small" /><Text style={styles.stateText}>{children}</Text></View>;
}

export function LoyaltyScreen({ client, onTabSelect, onRedemptionSelected, cartItemCount = 0 }: LoyaltyScreenProps): React.JSX.Element {
  useEffect(() => screenTrace("loyalty"), []);
  const [summaryState, setSummaryState] = useState<LoyaltySummaryRequestState>({ status: "loading" });
  const [ledgerState, setLedgerState] = useState<LoyaltyLedgerRequestState>({ status: "loading" });
  const [questState, setQuestState] = useState<QuestRequestState>({ status: "loading" });
  const [rewardsState, setRewardsState] = useState<{ readonly status: "loading" | "success" | "error"; readonly response?: LoyaltyRewardsResponse; readonly message?: string }>({ status: "loading" });
  const [redemptionsState, setRedemptionsState] = useState<{ readonly status: "loading" | "success" | "error"; readonly response?: LoyaltyRedemptionsResponse; readonly message?: string }>({ status: "loading" });
  const [confirmingRewardId, setConfirmingRewardId] = useState<number | null>(null);
  const [redeemingRewardId, setRedeemingRewardId] = useState<number | null>(null);
  const [redemptionError, setRedemptionError] = useState<string | null>(null);
  const [failedRedemptionRewardId, setFailedRedemptionRewardId] = useState<number | null>(null);
  const redemptionKeysRef = useRef<Map<number, string>>(new Map());
  const controllerRef = useRef<LoyaltyRequestController | null>(null);
  const gamificationControllerRef = useRef<ReturnType<typeof createLoyaltyGamificationController> | null>(null);

  useEffect(() => {
    const controller = createLoyaltyRequestController(client, setSummaryState, setLedgerState);
    controllerRef.current = controller;
    controller.start({ limit: 50, offset: 0 });
    const gamificationController = createLoyaltyGamificationController(client, () => undefined, setQuestState, () => undefined);
    gamificationControllerRef.current = gamificationController;
    gamificationController.loadQuests();
    if (client.getRewards === undefined) setRewardsState({ status: "success", response: { status: "confirmed", rewards: [] } });
    else void client.getRewards().then((response) => setRewardsState({ status: "success", response })).catch((error: unknown) => setRewardsState({ status: "error", message: error instanceof LoyaltyClientError ? error.message : "Награды временно недоступны" }));
    if (client.getRedemptions === undefined) setRedemptionsState({ status: "success", response: { status: "confirmed", redemptions: [], pagination: { limit: 50, offset: 0, total: 0, hasNext: false } } });
    else void client.getRedemptions({ limit: 50, offset: 0 }).then((response) => setRedemptionsState({ status: "success", response })).catch((error: unknown) => setRedemptionsState({ status: "error", message: error instanceof LoyaltyClientError ? error.message : "История обменов временно недоступна" }));
    return () => {
      controller.dispose();
      gamificationController.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
      if (gamificationControllerRef.current === gamificationController) gamificationControllerRef.current = null;
    };
  }, [client]);

  const retry = (): void => controllerRef.current?.retry();
  const summaryUnavailable = summaryState.status === "success" && summaryState.response.status === "unavailable";
  const confirmedSummary = summaryState.status === "success" && summaryState.response.status === "confirmed" ? summaryState.response.summary : null;
  const confirmRedeem = (rewardId: number): void => {
    if (client.redeem === undefined) return;
    const idempotencyKey = redemptionKeysRef.current.get(rewardId) ?? createRedemptionIdempotencyKey(rewardId);
    redemptionKeysRef.current.set(rewardId, idempotencyKey);
    setRedeemingRewardId(rewardId);
    setConfirmingRewardId(null);
    setRedemptionError(null);
    setFailedRedemptionRewardId(null);
    void client.redeem(rewardId, idempotencyKey).then((response) => {
      redemptionKeysRef.current.delete(rewardId);
      setRedeemingRewardId(null);
      if (response.status === "confirmed") onRedemptionSelected?.(response.redemption.id);
      if (client.getRedemptions !== undefined) void client.getRedemptions({ limit: 50, offset: 0 }).then((response) => setRedemptionsState({ status: "success", response }));
      if (client.getSummary !== undefined) void client.getSummary().then((response) => setSummaryState({ status: "success", response }));
    }).catch((error: unknown) => {
      setRedeemingRewardId(null);
      setConfirmingRewardId(rewardId);
      setFailedRedemptionRewardId(rewardId);
      setRedemptionError(error instanceof LoyaltyClientError ? error.message : "Не удалось подтвердить списание. Повторите с тем же ключом операции.");
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <View style={styles.headerDecor} />
          <View style={styles.headerRow}>
            <Text style={styles.logo}><Text style={styles.logoFlame}>🔥</Text> Все Про Жар</Text>
            <View style={styles.coalBalance}>
              <Text style={styles.coalIcon}>🔥</Text>
              <Text style={styles.coalValue}>{summaryState.status === "success" && summaryState.response.status === "confirmed" ? formatUnits(summaryState.response.summary.coalBalance) : "0"}</Text>
            </View>
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {summaryState.status === "loading" ? <LoadingCard>Загружаем баланс…</LoadingCard> : null}
          {summaryState.status === "error" ? <View style={styles.stateCard}><Text style={styles.stateTitle}>Не удалось загрузить баланс</Text><Text style={styles.stateText}>{summaryState.message}</Text><Pressable onPress={retry} style={styles.retryButton}><Text style={styles.retryText}>Повторить</Text></Pressable></View> : null}
          {summaryUnavailable ? <View style={styles.stateCard}><Text style={styles.stateTitle}>Баланс временно недоступен</Text><Text style={styles.stateText}>Мы проверяем историю операций. Подтверждённые данные появятся после сверки.</Text><Pressable onPress={retry} style={styles.retryButton}><Text style={styles.retryText}>Повторить</Text></Pressable></View> : null}
          {summaryState.status === "success" ? (
            <>
            {summaryState.response.status === "confirmed" ? <PassportCard summary={summaryState.response.summary} /> : null}
            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>📒 История операций</Text><Text style={styles.sectionHint}>Только подтверждённые данные</Text></View>
            {ledgerState.status === "loading" ? <LoadingCard>Загружаем историю операций…</LoadingCard> : null}
            {ledgerState.status === "error" ? <View style={styles.stateCard}><Text style={styles.stateTitle}>История операций временно недоступна</Text><Text style={styles.stateText}>{ledgerState.message}</Text><Pressable onPress={retry} style={styles.retryButton}><Text style={styles.retryText}>Повторить</Text></Pressable></View> : null}
            {ledgerState.status === "success" && ledgerState.response.status === "confirmed" && ledgerState.response.entries.length === 0 ? <View style={styles.stateCard}><Text style={styles.stateText}>Операций пока нет.</Text></View> : null}
            {ledgerState.status === "success" && ledgerState.response.status === "confirmed" && ledgerState.response.entries.length > 0 ? <View style={styles.ledgerCard}>{ledgerState.response.entries.map((entry) => <View key={entry.id} style={styles.entry}><View style={styles.entryMain}><Text style={styles.entryTitle}>{ledgerSourceLabel(entry.sourceType)}</Text><Text style={styles.entryReason}>{entry.reason}</Text><Text style={styles.entryDate}>{new Date(entry.createdAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" })}</Text></View><View style={styles.entryValues}>{entry.xpDelta !== 0 ? <Text style={styles.entryValue}>{ledgerDelta(entry.xpDelta, "XP")}</Text> : null}{entry.coalDelta !== 0 ? <Text style={styles.entryValue}>{ledgerDelta(entry.coalDelta, "🔥")}</Text> : null}</View></View>)}</View> : null}
            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>🎁 Награды</Text><Text style={styles.sectionHint}>Списание угольков</Text></View>
            {redemptionError !== null ? <View accessibilityRole="alert" style={styles.stateCard} testID="redemption-error"><Text style={styles.stateTitle}>Списание требует проверки</Text><Text style={styles.stateText}>{redemptionError}</Text>{failedRedemptionRewardId !== null ? <Pressable accessibilityRole="button" onPress={() => confirmRedeem(failedRedemptionRewardId)} style={styles.retryButton}><Text style={styles.retryText}>Повторить списание</Text></Pressable> : null}</View> : null}
            {rewardsState.status === "loading" ? <LoadingCard>Загружаем награды…</LoadingCard> : null}
            {rewardsState.status === "error" ? <View style={styles.stateCard}><Text style={styles.stateTitle}>Награды временно недоступны</Text><Text style={styles.stateText}>{rewardsState.message}</Text></View> : null}
            {rewardsState.status === "success" && rewardsState.response?.status === "confirmed" ? <View style={styles.rewardGrid}>{rewardsState.response.rewards.length === 0 ? <View style={styles.stateCard}><Text style={styles.emptyIcon}>🎁</Text><Text style={styles.stateTitle}>Доступных наград пока нет</Text><Text style={styles.stateText}>Награды появятся после настройки Backend.</Text></View> : rewardsState.response.rewards.map((reward) => { const balance = confirmedSummary?.coalBalance ?? 0; const canRedeem = confirmedSummary !== null && reward.isVisible && !reward.isArchived && balance >= reward.costCoal && client.redeem !== undefined; const confirming = confirmingRewardId === reward.id; return <View key={reward.id} style={styles.rewardCard}><Text style={styles.rewardTitle}>{reward.name}</Text><Text style={styles.rewardDescription}>{reward.description || "Скидка на следующий pickup-заказ"}</Text><Text style={styles.rewardCost}>🔥 {formatUnits(reward.costCoal)} угольков · скидка {formatUnits(reward.fulfillmentTarget.discountMinor / 100)} ₽</Text>{confirming ? <View style={styles.rewardConfirm}><Text style={styles.rewardConfirmText}>Списать угольки и создать claim?</Text><View style={styles.rewardConfirmActions}><Pressable accessibilityRole="button" disabled={redeemingRewardId !== null} onPress={() => confirmRedeem(reward.id)} style={styles.rewardPrimaryButton}><Text style={styles.retryText}>{redeemingRewardId === reward.id ? "Списываем…" : "Подтвердить"}</Text></Pressable><Pressable accessibilityRole="button" disabled={redeemingRewardId !== null} onPress={() => setConfirmingRewardId(null)} style={styles.rewardSecondaryButton}><Text style={styles.rewardSecondaryText}>Отмена</Text></Pressable></View></View> : <Pressable accessibilityRole="button" accessibilityLabel={`Обменять угольки на ${reward.name}`} disabled={!canRedeem || redeemingRewardId !== null} onPress={() => setConfirmingRewardId(reward.id)} style={[styles.rewardPrimaryButton, !canRedeem ? styles.rewardDisabledButton : null]}><Text style={styles.retryText}>{confirmedSummary === null ? "Баланс недоступен" : balance < reward.costCoal ? "Недостаточно угольков" : "Обменять угольки"}</Text></Pressable>}</View>; })}</View> : null}
            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>🧾 История обменов</Text><Text style={styles.sectionHint}>Статус Backend</Text></View>
            {redemptionsState.status === "loading" ? <LoadingCard>Загружаем историю обменов…</LoadingCard> : null}
            {redemptionsState.status === "error" ? <View style={styles.stateCard}><Text style={styles.stateTitle}>История обменов временно недоступна</Text><Text style={styles.stateText}>{redemptionsState.message}</Text></View> : null}
            {redemptionsState.status === "success" && redemptionsState.response?.status === "confirmed" && redemptionsState.response.redemptions.length === 0 ? <View style={styles.stateCard}><Text style={styles.stateText}>Подтверждённых обменов пока нет.</Text></View> : null}
            {redemptionsState.status === "success" && redemptionsState.response?.status === "confirmed" && redemptionsState.response.redemptions.length > 0 ? <View style={styles.redemptionCard}>{redemptionsState.response.redemptions.map((redemption) => <View key={redemption.id} style={styles.redemptionRow}><View style={styles.rewardCopy}><Text style={styles.rewardTitle}>{redemption.rewardName}</Text><Text style={styles.rewardDescription}>Списано: {formatUnits(redemption.costCoal)} угольков · {redemption.status === "pending" ? "ожидает заказа" : redemption.status === "succeeded" ? "применена" : redemption.status === "reconciliation_required" ? "нужна проверка" : "отменена"}</Text></View><Text style={styles.redemptionStatus}>{redemption.status}</Text></View>)}</View> : null}
            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>🎯 Квесты</Text><Text style={styles.sectionHint}>Подтверждённый прогресс</Text></View>
            {questState.status === "loading" ? <LoadingCard>Загружаем квесты…</LoadingCard> : null}
            {questState.status === "error" ? <View style={styles.stateCard}><Text style={styles.stateTitle}>Квесты временно недоступны</Text><Text style={styles.stateText}>{questState.message}</Text><Pressable onPress={() => gamificationControllerRef.current?.loadQuests()} style={styles.retryButton}><Text style={styles.retryText}>Повторить</Text></Pressable></View> : null}
            {questState.status === "success" && questState.response.status === "unavailable" ? <View style={styles.stateCard}><Text style={styles.stateTitle}>Квесты временно недоступны</Text><Text style={styles.stateText}>Прогресс появится после подтверждения Backend.</Text></View> : null}
            {questState.status === "success" && questState.response.status === "confirmed" ? <View style={styles.questGrid}>{questState.response.quests.length === 0 ? <View style={styles.stateCard}><Text style={styles.emptyIcon}>🎯</Text><Text style={styles.stateTitle}>Активных квестов пока нет</Text></View> : questState.response.quests.map((item) => { const done = item.status === "earned"; const percent = item.quest.goal === 0 ? 0 : Math.min(100, Math.floor((item.progress * 100) / item.quest.goal)); const claimed = item.rewardClaim?.status === "succeeded"; return <View key={item.quest.id} style={[styles.questCard, done ? styles.questCardDone : null]} testID={`quest-card-${item.quest.code}`}><View style={[styles.questIcon, done ? styles.questIconDone : null]}><Text style={styles.questIconText}>{done ? "✅" : "🎯"}</Text></View><View style={styles.questInfo}><Text style={styles.questTitle}>{item.quest.title}</Text><Text style={styles.questDescription}>{item.quest.description}</Text><Text style={styles.questProgressText}>{done ? (claimed ? "Награда начислена" : "Награда проверяется") : formatQuestProgress(item.progress, item.quest.goal, item.quest.unit)}</Text><View accessibilityLabel={`Прогресс квеста ${item.quest.title}`} accessibilityRole="progressbar" accessibilityValue={{ max: 100, min: 0, now: percent }} style={styles.questTrack}><View style={[styles.questFill, { width: `${percent}%` }]} /></View></View></View>; })}</View> : null}
            </>
          ) : null}
        </ScrollView>
        <CustomerTabBar activeTab="passport" cartItemCount={cartItemCount} onSelect={(tab) => onTabSelect?.(tab)} />
      </View>
    </SafeAreaView>
  );
}

const styles = {
  safeArea: { alignItems: "center", backgroundColor: "#1a1a1a", flex: 1 },
  shell: { backgroundColor: "#f9f7f4", flex: 1, maxWidth: 480, width: "100%" },
  header: { backgroundColor: "#2a1810", backgroundImage: "linear-gradient(135deg,#1a1a1a 0%,#2a1810 60%,#3d1c08 100%)", overflow: "hidden", paddingHorizontal: 18, paddingTop: 18, paddingBottom: 16, position: "relative" },
  headerDecor: { backgroundColor: "#3d1c08", borderRadius: 100, height: 160, opacity: 0, position: "absolute", right: -60, top: -70, width: 160 },
  headerRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", position: "relative" },
  logo: { color: "#ff9500", flex: 1, fontSize: 22, fontWeight: "900", letterSpacing: -0.5, textShadowColor: "rgba(255,94,58,0.55)", textShadowOffset: { height: 0, width: 0 }, textShadowRadius: 8 },
  logoFlame: { color: "#ff5e3a", textShadowColor: "rgba(255,94,58,0.75)", textShadowOffset: { height: 0, width: 0 }, textShadowRadius: 9 },
  coalBalance: { alignItems: "center", backgroundColor: "rgba(255,94,58,0.22)", backgroundImage: "linear-gradient(135deg,rgba(255,149,0,0.2),rgba(255,51,51,0.2))", borderColor: "rgba(255,149,0,0.4)", borderRadius: 30, borderWidth: 1, flexDirection: "row", gap: 6, minHeight: 44, paddingHorizontal: 13 },
  coalIcon: { fontSize: 16, textShadowColor: "rgba(255,94,58,0.75)", textShadowOffset: { height: 0, width: 0 }, textShadowRadius: 7 },
  coalValue: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  content: { gap: 14, padding: 16, paddingBottom: 36 },
  passportCard: { backgroundColor: "#24170f", backgroundImage: "linear-gradient(135deg,#1a1a1a,#3d1c08)", borderRadius: 22, overflow: "hidden", padding: 20, position: "relative", shadowColor: "#000000", shadowOffset: { height: 8, width: 0 }, shadowOpacity: 0.25, shadowRadius: 18 },
  rankRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  rankCopy: { flex: 1, minWidth: 0 },
  rankName: { color: "#ffffff", fontSize: 23, fontWeight: "900" },
  rankXp: { color: "#cdbeb4", fontSize: 14, marginTop: 3 },
  rankMark: { alignItems: "center", borderColor: "rgba(255,200,61,0.55)", borderRadius: 32, borderWidth: 3, height: 60, justifyContent: "center", width: 60 },
  rankMarkCore: { backgroundColor: "#1a1a1a", borderRadius: 7, height: 18, transform: [{ rotate: "45deg" }], width: 18 },
  rankMarkDot: { backgroundColor: "#ffffff", borderRadius: 3, height: 6, position: "absolute", width: 6 },
  progressTrack: { backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 8, height: 12, marginTop: 26, overflow: "hidden", width: "100%" },
  progressFill: { backgroundColor: "#ffc83d", borderRadius: 8, height: "100%" },
  progressText: { color: "#ffffff", fontSize: 13, fontWeight: "700", marginTop: 8, opacity: 0.8 },
  sectionHeader: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  sectionTitle: { color: "#1a1a1a", fontSize: 19, fontWeight: "900" },
  sectionHint: { color: "#8a8580", fontSize: 10 },
  passportFire: { bottom: -20, fontSize: 120, opacity: 0.12, position: "absolute", right: -10 },
  ledgerCard: { backgroundColor: "#ffffff", borderRadius: 16, overflow: "hidden", shadowColor: "#000000", shadowOffset: { height: 3, width: 0 }, shadowOpacity: 0.08, shadowRadius: 10 },
  entry: { borderBottomColor: "#eee9e3", borderBottomWidth: 1, flexDirection: "row", gap: 12, justifyContent: "space-between", padding: 15 },
  entryMain: { flex: 1 },
  entryTitle: { color: "#1a1a1a", fontSize: 13, fontWeight: "800" },
  entryReason: { color: "#6e6861", fontSize: 12, marginTop: 4 },
  entryDate: { color: "#9a938b", fontSize: 10, marginTop: 5 },
  entryValues: { alignItems: "flex-end", justifyContent: "center" },
  entryValue: { color: "#d94b2d", fontSize: 12, fontWeight: "800", marginVertical: 2 },
  stateCard: { alignItems: "center", backgroundColor: "#ffffff", borderRadius: 16, gap: 8, padding: 26, shadowColor: "#000000", shadowOffset: { height: 3, width: 0 }, shadowOpacity: 0.06, shadowRadius: 10 },
  stateTitle: { color: "#1a1a1a", fontSize: 16, fontWeight: "800", textAlign: "center" },
  stateText: { color: "#8a8580", fontSize: 13, lineHeight: 19, textAlign: "center" },
  emptyIcon: { fontSize: 32 },
  retryButton: { alignItems: "center", backgroundColor: "#ff5e3a", borderRadius: 10, marginTop: 4, minHeight: 44, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 10 },
  retryText: { color: "#ffffff", fontSize: 13, fontWeight: "800" },
  rulesCard: { backgroundColor: "#fff1e9", borderColor: "#ffd8c7", borderRadius: 16, borderWidth: 1, padding: 16 },
  rulesTitle: { color: "#9f3b23", fontSize: 14, fontWeight: "900" },
  rulesText: { color: "#6e4d40", fontSize: 12, lineHeight: 18, marginTop: 7 },
  rulesMuted: { color: "#9a7567", fontSize: 11, lineHeight: 16, marginTop: 7 },
  questGrid: { gap: 12 },
  questCard: { alignItems: "center", backgroundColor: "#ffffff", borderRadius: 16, flexDirection: "row", gap: 12, padding: 14, shadowColor: "#000000", shadowOffset: { height: 3, width: 0 }, shadowOpacity: 0.08, shadowRadius: 10 },
  questCardDone: { backgroundColor: "#fffaf4" },
  questIcon: { alignItems: "center", backgroundColor: "#fff3e6", borderRadius: 14, flexShrink: 0, height: 46, justifyContent: "center", width: 46 },
  questIconDone: { backgroundColor: "#d4f5d0" },
  questIconText: { fontSize: 22 },
  questInfo: { flex: 1, minWidth: 0 },
  questTitle: { color: "#1a1a1a", fontSize: 14, fontWeight: "800" },
  questDescription: { color: "#8a8580", fontSize: 11, marginTop: 3 },
  questProgressText: { color: "#ff5e3a", fontSize: 11, fontWeight: "700", marginTop: 6 },
  questTrack: { backgroundColor: "#f0e8de", borderRadius: 6, height: 6, marginTop: 5, overflow: "hidden", width: "100%" },
  questFill: { backgroundColor: "#ff9500", borderRadius: 6, height: "100%" },
  rewardGrid: { gap: 12 },
  rewardCard: { backgroundColor: "#ffffff", borderRadius: 16, gap: 9, padding: 16, shadowColor: "#000000", shadowOffset: { height: 3, width: 0 }, shadowOpacity: 0.08, shadowRadius: 10 },
  rewardCopy: { flex: 1, minWidth: 0 },
  rewardTitle: { color: "#1a1a1a", fontSize: 14, fontWeight: "800" },
  rewardDescription: { color: "#8a8580", fontSize: 12, lineHeight: 17, marginTop: 4 },
  rewardCost: { color: "#d94b2d", fontSize: 12, fontWeight: "800", marginTop: 4 },
  rewardPrimaryButton: { alignItems: "center", backgroundColor: "#ff5e3a", borderRadius: 10, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
  rewardDisabledButton: { backgroundColor: "#c8c0b8" },
  rewardSecondaryButton: { alignItems: "center", borderColor: "#d9d0c8", borderRadius: 10, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
  rewardSecondaryText: { color: "#6e6861", fontSize: 13, fontWeight: "800" },
  rewardConfirm: { backgroundColor: "#fff1e9", borderRadius: 12, gap: 9, padding: 12 },
  rewardConfirmText: { color: "#9f3b23", fontSize: 12, fontWeight: "800" },
  rewardConfirmActions: { flexDirection: "row", gap: 8 },
  redemptionCard: { backgroundColor: "#ffffff", borderRadius: 16, overflow: "hidden", shadowColor: "#000000", shadowOffset: { height: 3, width: 0 }, shadowOpacity: 0.08, shadowRadius: 10 },
  redemptionRow: { borderBottomColor: "#eee9e3", borderBottomWidth: 1, flexDirection: "row", gap: 12, padding: 15 },
  redemptionStatus: { color: "#d94b2d", fontSize: 11, fontWeight: "800", maxWidth: 100, textAlign: "right" }
} as const;
