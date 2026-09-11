import { Pressable, Text, View } from "react-native";

export type CustomerTab = "menu" | "roulette" | "passport" | "cart" | "profile";

interface CustomerTabBarProps {
  readonly activeTab: CustomerTab;
  readonly cartItemCount: number;
  readonly onSelect: (tab: CustomerTab) => void;
}

const tabs: readonly { readonly id: CustomerTab; readonly icon: string; readonly label: string; readonly enabled: boolean }[] = [
  { id: "menu", icon: "🔥", label: "Меню", enabled: true },
  { id: "roulette", icon: "◎", label: "Рулетка", enabled: true },
  { id: "passport", icon: "♜", label: "Паспорт", enabled: true },
  { id: "cart", icon: "🛒", label: "Корзина", enabled: true },
  { id: "profile", icon: "●", label: "Профиль", enabled: true }
];

export function CustomerTabBar({ activeTab, cartItemCount, onSelect }: CustomerTabBarProps): React.JSX.Element {
  return (
    <View accessibilityRole="tablist" style={styles.tabBar}>
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <Pressable
            accessibilityLabel={tab.id === "cart" ? "Открыть корзину" : tab.label}
            accessibilityRole={tab.id === "cart" ? "button" : "tab"}
            accessibilityState={{ disabled: !tab.enabled, selected: active }}
            key={tab.id}
            onPress={() => { if (tab.enabled) onSelect(tab.id); }}
            style={[styles.tab, active ? styles.tabActive : null, !tab.enabled ? styles.tabDisabled : null]}
          >
            {active ? <View style={styles.activeIndicator} /> : null}
            <View style={styles.iconWrap}>
              <Text style={[styles.tabIcon, active ? styles.tabIconActive : null]}>{tab.icon}</Text>
              {tab.id === "cart" && cartItemCount > 0 ? <Text style={styles.tabBadge}>{cartItemCount}</Text> : null}
            </View>
            <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = {
  tabBar: { alignItems: "flex-start", backgroundColor: "rgba(26,26,26,0.98)", borderTopColor: "rgba(255,149,0,0.2)", borderTopWidth: 1, flexDirection: "row", flexShrink: 0, height: 78, paddingBottom: 8, paddingHorizontal: 0, paddingTop: 10 },
  tab: { alignItems: "center", backgroundColor: "transparent", flex: 1, justifyContent: "flex-start", minHeight: 58, paddingHorizontal: 0, paddingVertical: 6, position: "relative" },
  tabActive: { backgroundColor: "transparent" },
  tabDisabled: { opacity: 0.95 },
  activeIndicator: { backgroundColor: "#ff5e3a", borderRadius: 3, height: 3, marginBottom: 7, width: 32 },
  iconWrap: { alignItems: "center", justifyContent: "center", minHeight: 23, minWidth: 28, position: "relative" },
  tabIcon: { color: "#8a8580", fontSize: 19 },
  tabIconActive: { color: "#ff5e3a" },
  tabLabel: { color: "#8a8580", fontSize: 11, fontWeight: "700", marginTop: 2 },
  tabLabelActive: { color: "#ff9500" },
  tabBadge: { backgroundColor: "#ff3333", borderColor: "#1a1a1a", borderRadius: 9, borderWidth: 2, color: "#ffffff", fontSize: 9, fontWeight: "900", minWidth: 19, paddingHorizontal: 3, paddingVertical: 1, position: "absolute", right: -4, textAlign: "center", top: -4 }
} as const;
