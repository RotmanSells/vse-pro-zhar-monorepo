import {
  CART_STORAGE_VERSION,
  CartStoragePayloadSchema,
  type CartItem
} from "@vse-pro-zhar/contracts";

import { normalizeCartItems } from "./cart.js";

export const CART_STORAGE_KEY = "vse-pro-zhar:guest-cart";
export const CART_STORAGE_ERROR_MESSAGE =
  "Не удалось сохранить корзину на устройстве";
export const CART_LOAD_ERROR_MESSAGE =
  "Не удалось восстановить корзину на устройстве";

export interface CartStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type CartStorage = CartStorageAdapter;

export interface CartLoadResult {
  readonly items: CartItem[];
  readonly error: string | null;
}

export interface CartPersistence {
  save(items: readonly unknown[]): Promise<void>;
  dispose(): void;
}

export function serializeCart(items: readonly unknown[]): string {
  return JSON.stringify({
    version: CART_STORAGE_VERSION,
    items: normalizeCartItems(items)
  });
}

export function parseStoredCart(raw: string | null): CartItem[] {
  if (raw === null) {
    return [];
  }

  let decoded: unknown;

  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }

  const parsed = CartStoragePayloadSchema.safeParse(decoded);
  return parsed.success ? normalizeCartItems(parsed.data.items) : [];
}

export async function loadCart(
  storage: CartStorageAdapter,
  key = CART_STORAGE_KEY
): Promise<CartLoadResult> {
  try {
    return {
      items: parseStoredCart(await storage.getItem(key)),
      error: null
    };
  } catch {
    return { items: [], error: CART_LOAD_ERROR_MESSAGE };
  }
}

export function createCartPersistence(
  storage: CartStorageAdapter,
  onError?: (message: string) => void,
  key = CART_STORAGE_KEY
): CartPersistence {
  let queue = Promise.resolve();
  let disposed = false;

  return {
    save(items): Promise<void> {
      if (disposed) {
        return Promise.resolve();
      }

      const payload = serializeCart(items);
      queue = queue.then(async () => {
        try {
          await storage.setItem(key, payload);
        } catch {
          if (!disposed) {
            onError?.(CART_STORAGE_ERROR_MESSAGE);
          }
        }
      });

      return queue;
    },

    dispose(): void {
      disposed = true;
    }
  };
}
