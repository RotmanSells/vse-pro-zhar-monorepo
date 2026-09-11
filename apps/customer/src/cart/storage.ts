import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import type { CartStorage } from "@vse-pro-zhar/api-client";

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getBrowserStorage(): WebStorageLike | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function createWebCartStorage(
  storage: WebStorageLike | null = getBrowserStorage()
): CartStorage {
  return {
    async getItem(key): Promise<string | null> {
      if (storage === null) {
        throw new Error("Web storage is unavailable");
      }

      return storage.getItem(key);
    },
    async setItem(key, value): Promise<void> {
      if (storage === null) {
        throw new Error("Web storage is unavailable");
      }

      storage.setItem(key, value);
    }
  };
}

export function createNativeCartStorage(): CartStorage {
  return {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value)
  };
}

export function createPlatformCartStorage(): CartStorage {
  return Platform.OS === "web"
    ? createWebCartStorage()
    : createNativeCartStorage();
}
