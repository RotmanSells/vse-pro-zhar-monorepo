import {
  CartItemSchema,
  CartQuantitySchema,
  MAX_CART_ITEM_QUANTITY,
  MAX_CART_ITEMS,
  type CartItem,
  type CartQuoteItem
} from "@vse-pro-zhar/contracts";

export function normalizeCartItems(items: readonly unknown[]): CartItem[] {
  const normalized: CartItem[] = [];
  const indexes = new Map<number, number>();

  for (const candidate of items) {
    const parsed = CartItemSchema.safeParse(candidate);
    if (!parsed.success) {
      continue;
    }

    const existingIndex = indexes.get(parsed.data.productId);
    if (existingIndex !== undefined) {
      const existing = normalized[existingIndex];
      if (existing !== undefined) {
        normalized[existingIndex] = {
          productId: existing.productId,
          quantity: Math.min(
            MAX_CART_ITEM_QUANTITY,
            existing.quantity + parsed.data.quantity
          )
        };
      }
      continue;
    }

    if (normalized.length >= MAX_CART_ITEMS) {
      continue;
    }

    indexes.set(parsed.data.productId, normalized.length);
    normalized.push(parsed.data);
  }

  return normalized;
}

export function addCartItem(
  items: readonly unknown[],
  productId: number,
  quantity = 1
): CartItem[] {
  const candidate = CartItemSchema.safeParse({ productId, quantity });
  if (!candidate.success) {
    return normalizeCartItems(items);
  }

  return normalizeCartItems([...items, candidate.data]);
}

export function incrementCartItem(
  items: readonly unknown[],
  productId: number
): CartItem[] {
  return addCartItem(items, productId);
}

export function decrementCartItem(
  items: readonly unknown[],
  productId: number
): CartItem[] {
  const normalized = normalizeCartItems(items);
  const item = normalized.find((candidate) => candidate.productId === productId);

  if (item === undefined || item.quantity <= 1) {
    return removeCartItem(normalized, productId);
  }

  return normalized.map((candidate) =>
    candidate.productId === productId
      ? { productId: candidate.productId, quantity: candidate.quantity - 1 }
      : candidate
  );
}

export function removeCartItem(
  items: readonly unknown[],
  productId: number
): CartItem[] {
  return normalizeCartItems(items).filter(
    (candidate) => candidate.productId !== productId
  );
}

export function clearCart(): CartItem[] {
  return [];
}

export function getCartItemCount(items: readonly unknown[]): number {
  return normalizeCartItems(items).reduce(
    (count, item) => count + item.quantity,
    0
  );
}

export function isCartEmpty(items: readonly unknown[]): boolean {
  return normalizeCartItems(items).length === 0;
}

export function cartQuoteMatchesItems(
  items: readonly CartItem[],
  quoteItems: readonly Pick<CartQuoteItem, "productId" | "quantity">[]
): boolean {
  return (
    items.length === quoteItems.length &&
    items.every((item, index) => {
      const quoteItem = quoteItems[index];

      return (
        quoteItem !== undefined &&
        quoteItem.productId === item.productId &&
        quoteItem.quantity === item.quantity
      );
    })
  );
}

export function isValidCartQuantity(quantity: number): boolean {
  return CartQuantitySchema.safeParse(quantity).success;
}
