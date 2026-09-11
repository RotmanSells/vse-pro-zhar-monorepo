import { describe, expect, it } from "vitest";

import {
  addCartItem,
  clearCart,
  createCartPersistence,
  decrementCartItem,
  getCartItemCount,
  incrementCartItem,
  loadCart,
  normalizeCartItems,
  parseStoredCart,
  removeCartItem,
  serializeCart,
  type CartStorageAdapter
} from "../src/index.js";

describe("cart domain", () => {
  it("normalizes invalid items, combines duplicates and caps quantities", () => {
    expect(
      normalizeCartItems([
        { productId: 1, quantity: 2 },
        { productId: 1, quantity: 98 },
        { productId: 2, quantity: 0 },
        { productId: "3", quantity: 1 },
        { productId: 2, quantity: 1 }
      ])
    ).toEqual([
      { productId: 1, quantity: 99 },
      { productId: 2, quantity: 1 }
    ]);

    const oneHundredItems = Array.from({ length: 101 }, (_, index) => ({
      productId: index + 1,
      quantity: 1
    }));
    expect(normalizeCartItems(oneHundredItems)).toHaveLength(100);
  });

  it("adds, increments, decrements, removes and clears reference-only items", () => {
    let items = addCartItem([], 10);
    items = incrementCartItem(items, 10);
    items = incrementCartItem(items, 11);
    expect(items).toEqual([
      { productId: 10, quantity: 2 },
      { productId: 11, quantity: 1 }
    ]);
    expect(getCartItemCount(items)).toBe(3);

    items = decrementCartItem(items, 10);
    expect(items).toEqual([
      { productId: 10, quantity: 1 },
      { productId: 11, quantity: 1 }
    ]);
    items = decrementCartItem(items, 10);
    expect(items).toEqual([{ productId: 11, quantity: 1 }]);
    expect(removeCartItem(items, 11)).toEqual([]);
    expect(clearCart()).toEqual([]);
  });
});

describe("cart storage", () => {
  it("round-trips a versioned payload without prices or product snapshots", async () => {
    const writes: string[] = [];
    const storage: CartStorageAdapter = {
      async getItem(): Promise<string | null> {
        return writes.at(-1) ?? null;
      },
      async setItem(_key, value): Promise<void> {
        writes.push(value);
      }
    };
    const persistence = createCartPersistence(storage);

    await persistence.save([{ productId: 7, quantity: 3 }]);
    expect(JSON.parse(writes[0] ?? "{}") as unknown).toEqual({
      version: 1,
      items: [{ productId: 7, quantity: 3 }]
    });
    expect(writes[0]).not.toContain("price");
    expect(writes[0]).not.toContain("name");
    expect(writes[0]).not.toContain("total");
    expect(await loadCart(storage)).toEqual({
      items: [{ productId: 7, quantity: 3 }],
      error: null
    });
  });

  it("starts empty for malformed or old payloads", () => {
    expect(parseStoredCart("not-json")).toEqual([]);
    expect(parseStoredCart(JSON.stringify({ version: 2, items: [] }))).toEqual([]);
    expect(
      parseStoredCart(
        JSON.stringify({ version: 1, items: [{ productId: 1, quantity: 1, priceMinor: 500 }] })
      )
    ).toEqual([]);
  });

  it("serializes writes and reports storage failures without rejecting the mutation", async () => {
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const writes: string[] = [];
    const storage: CartStorageAdapter = {
      async getItem(): Promise<string | null> {
        return null;
      },
      async setItem(_key, value): Promise<void> {
        activeWrites += 1;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
        await Promise.resolve();
        writes.push(value);
        activeWrites -= 1;
      }
    };
    const persistence = createCartPersistence(storage);

    await Promise.all([
      persistence.save([{ productId: 1, quantity: 1 }]),
      persistence.save([{ productId: 1, quantity: 2 }]),
      persistence.save([{ productId: 1, quantity: 3 }])
    ]);

    expect(maxActiveWrites).toBe(1);
    expect(JSON.parse(writes.at(-1) ?? "{}") as unknown).toEqual({
      version: 1,
      items: [{ productId: 1, quantity: 3 }]
    });

    const errors: string[] = [];
    const failingPersistence = createCartPersistence(
      {
        async getItem(): Promise<string | null> {
          return null;
        },
        async setItem(): Promise<void> {
          throw new Error("storage failed");
        }
      },
      (message) => errors.push(message)
    );
    await expect(
      failingPersistence.save([{ productId: 2, quantity: 1 }])
    ).resolves.toBeUndefined();
    expect(errors).toEqual(["Не удалось сохранить корзину на устройстве"]);
  });

  it("returns an explicit load error when storage cannot be read", async () => {
    const result = await loadCart({
      async getItem(): Promise<string | null> {
        throw new Error("read failed");
      },
      async setItem(): Promise<void> {
        return undefined;
      }
    });

    expect(result.items).toEqual([]);
    expect(result.error).toBe("Не удалось восстановить корзину на устройстве");
  });

  it("does not report a queued storage failure after disposal", async () => {
    let rejectWrite: ((error: Error) => void) | undefined;
    const errors: string[] = [];
    const persistence = createCartPersistence(
      {
        async getItem() { return null; },
        async setItem() {
          await new Promise<void>((_resolve, reject) => {
            rejectWrite = reject;
          });
        }
      },
      (message) => errors.push(message)
    );

    const save = persistence.save([{ productId: 4, quantity: 1 }]);
    await Promise.resolve();
    persistence.dispose();
    rejectWrite?.(new Error("late storage failure"));
    await expect(save).resolves.toBeUndefined();
    expect(errors).toEqual([]);
  });

  it("serializes normalized items only", () => {
    expect(serializeCart([{ productId: 3, quantity: 1 }, { productId: 3, quantity: 2 }])).toBe(
      JSON.stringify({ version: 1, items: [{ productId: 3, quantity: 3 }] })
    );
  });
});
