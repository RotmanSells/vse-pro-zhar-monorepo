import { Platform } from "react-native";

import type { AuthSessionTransport } from "@vse-pro-zhar/api-client";

const SESSION_KEY = "vse-pro-zhar:session-token";
let developmentFallbackToken: string | null = null;

export interface SecureStoreAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

function createLazyNativeSecureStore(): SecureStoreAdapter {
  let modulePromise: Promise<typeof import("expo-secure-store")> | null = null;
  const load = (): Promise<typeof import("expo-secure-store")> => {
    modulePromise ??= import("expo-secure-store");
    return modulePromise;
  };
  return {
    getItemAsync: async (key) => (await load()).getItemAsync(key),
    setItemAsync: async (key, value) => (await load()).setItemAsync(key, value),
    deleteItemAsync: async (key) => (await load()).deleteItemAsync(key)
  };
}

export function createWebAuthTransport(): AuthSessionTransport {
  return {
    mode: "cookie",
    getRequestHeaders: async () => ({}),
    storeSession: async () => undefined,
    clearSession: async () => undefined
  };
}

export function createNativeAuthTransport(
  secureStore: SecureStoreAdapter = createLazyNativeSecureStore()
): AuthSessionTransport {
  const isDevelopment = process.env.NODE_ENV !== "production";
  return {
    mode: "bearer",
    getRequestHeaders: async (): Promise<Readonly<Record<string, string>>> => {
      let token: string | null;
      try {
        token = await secureStore.getItemAsync(SESSION_KEY);
      } catch (error: unknown) {
        if (!isDevelopment) throw error;
        token = developmentFallbackToken;
      }
      if (token === null) return {};
      return { Authorization: `Bearer ${token}` };
    },
    storeSession: async (token) => {
      try {
        await secureStore.setItemAsync(SESSION_KEY, token);
      } catch (error: unknown) {
        if (!isDevelopment) throw error;
        developmentFallbackToken = token;
      }
    },
    clearSession: async () => {
      try {
        await secureStore.deleteItemAsync(SESSION_KEY);
      } catch (error: unknown) {
        if (!isDevelopment) throw error;
        developmentFallbackToken = null;
      }
    }
  };
}

export function createPlatformAuthTransport(): AuthSessionTransport {
  return Platform.OS === "web" ? createWebAuthTransport() : createNativeAuthTransport();
}
