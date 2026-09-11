import { Platform } from "react-native";

import type { NotificationsClient } from "../api/notifications-client";
import { debugLog } from "../debug/logger";

export type NativePushRegistrationResult =
  | { readonly status: "registered"; readonly deviceId: number }
  | { readonly status: "unavailable"; readonly reason: "web" | "permission_denied" | "project_id_missing" | "registration_failed" };

function idempotencyKey(token: string): string {
  return `native-push:${token}`;
}

async function expoProjectId(): Promise<string | null> {
  const fromEnvironment = process.env["EXPO_PUBLIC_EAS_PROJECT_ID"]?.trim();
  if (fromEnvironment !== undefined && fromEnvironment !== "") return fromEnvironment;
  const { default: Constants } = await import("expo-constants");
  const fromConfig = Constants.expoConfig?.extra?.["eas"]?.["projectId"];
  return typeof fromConfig === "string" && fromConfig.trim() !== "" ? fromConfig.trim() : null;
}

export async function registerNativePushDevice(client: NotificationsClient): Promise<NativePushRegistrationResult> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    debugLog("push.registration.unavailable", { reason: "web" });
    return { status: "unavailable", reason: "web" };
  }
  const projectId = await expoProjectId();
  if (projectId === null) {
    debugLog("push.registration.unavailable", { reason: "project_id_missing" });
    return { status: "unavailable", reason: "project_id_missing" };
  }
  try {
    const Notifications = await import("expo-notifications");
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true
      })
    });
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Все Про Жар",
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250]
      });
    }
    const current = await Notifications.getPermissionsAsync();
    const permissions = current.granted ? current : await Notifications.requestPermissionsAsync();
    if (!permissions.granted) {
      debugLog("push.registration.unavailable", { reason: "permission_denied" });
      return { status: "unavailable", reason: "permission_denied" };
    }
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const response = await client.registerDevice({ idempotencyKey: idempotencyKey(token), provider: "expo", platform: Platform.OS, token });
    debugLog("push.registration.success", { deviceId: response.device.id });
    return { status: "registered", deviceId: response.device.id };
  } catch {
    debugLog("push.registration.error", { reason: "registration_failed" });
    return { status: "unavailable", reason: "registration_failed" };
  }
}
