import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  createHealthRequestController,
  type HealthRequestController,
  type HealthRequestState
} from "@vse-pro-zhar/api-client";

import { createHealthClient, type HealthClient } from "../api/health-client";

export interface HealthScreenProps {
  readonly client?: HealthClient;
}

export function HealthScreen({ client }: HealthScreenProps): React.JSX.Element {
  const defaultClient = useMemo(() => createHealthClient(), []);
  const healthClient = client ?? defaultClient;
  const [state, setState] = useState<HealthRequestState>({
    status: "loading"
  });
  const controllerRef = useRef<HealthRequestController | null>(null);

  useEffect(() => {
    const controller = createHealthRequestController(healthClient, setState);
    controllerRef.current = controller;
    controller.start();

    return () => {
      controller.dispose();

      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [healthClient]);

  const loadHealth = useCallback((): void => {
    controllerRef.current?.retry();
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.eyebrow}>FOUNDATION</Text>
        <Text style={styles.title}>Все Про Жар</Text>
        <Text style={styles.subtitle}>Customer Web</Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Backend</Text>

          {state.status === "loading" ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color="#f97316" size="small" />
              <Text style={styles.statusText}>Проверяем соединение…</Text>
            </View>
          ) : null}

          {state.status === "success" ? (
            <View testID="backend-connected">
              <Text style={styles.connected}>● Connected</Text>
              <Text style={styles.details}>
                {state.health.service} · {state.health.environment}
              </Text>
            </View>
          ) : null}

          {state.status === "error" ? (
            <View>
              <Text style={styles.disconnected}>○ Disconnected</Text>
              <Text style={styles.errorText}>{state.message}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={loadHealth}
                style={styles.retryButton}
              >
                <Text style={styles.retryText}>Повторить</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = {
  safeArea: {
    backgroundColor: "#fff7ed",
    flex: 1
  },
  container: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24
  },
  eyebrow: {
    color: "#c2410c",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 12
  },
  title: {
    color: "#431407",
    fontSize: 36,
    fontWeight: "800",
    textAlign: "center"
  },
  subtitle: {
    color: "#9a3412",
    fontSize: 16,
    marginTop: 8
  },
  card: {
    backgroundColor: "#ffffff",
    borderColor: "#fed7aa",
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 32,
    maxWidth: 420,
    padding: 24,
    width: "100%"
  },
  cardLabel: {
    color: "#7c2d12",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 12
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  statusText: {
    color: "#57534e",
    fontSize: 16
  },
  connected: {
    color: "#15803d",
    fontSize: 20,
    fontWeight: "800"
  },
  disconnected: {
    color: "#b91c1c",
    fontSize: 20,
    fontWeight: "800"
  },
  details: {
    color: "#78716c",
    fontSize: 14,
    marginTop: 6
  },
  errorText: {
    color: "#78716c",
    fontSize: 14,
    marginTop: 8
  },
  retryButton: {
    alignItems: "center",
    backgroundColor: "#ea580c",
    borderRadius: 10,
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  retryText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700"
  }
} as const;
