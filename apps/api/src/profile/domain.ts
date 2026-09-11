import type {
  CustomerProfileStats
} from "@vse-pro-zhar/contracts";
import type {
  CustomerProfileItemSnapshot
} from "@vse-pro-zhar/database";

export class ProfileDataInvariantError extends Error {
  constructor(message = "Customer profile data is invalid") {
    super(message);
    this.name = "ProfileDataInvariantError";
  }
}

interface FavoriteProductCandidate {
  readonly productId: number;
  readonly name: string;
  readonly quantity: number;
  readonly orderCreatedAt: number;
  readonly orderId: number;
  readonly itemId: number;
}

function isSafeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isLaterSnapshot(
  candidate: Pick<FavoriteProductCandidate, "orderCreatedAt" | "orderId" | "itemId">,
  current: FavoriteProductCandidate
): boolean {
  if (candidate.orderCreatedAt !== current.orderCreatedAt) return candidate.orderCreatedAt > current.orderCreatedAt;
  if (candidate.orderId !== current.orderId) return candidate.orderId > current.orderId;
  return candidate.itemId > current.itemId;
}

function validateItemSnapshot(
  customerId: number,
  snapshot: CustomerProfileItemSnapshot
): void {
  const { item } = snapshot;
  if (
    snapshot.customerId !== customerId ||
    item.orderId !== snapshot.orderId ||
    !Number.isSafeInteger(item.productId) ||
    item.productId < 1 ||
    item.productName.trim() === "" ||
    item.productName.trim().length > 160 ||
    !Number.isSafeInteger(item.quantity) ||
    item.quantity < 1 ||
    item.quantity > 99 ||
    !isSafeNonNegativeInteger(item.unitPriceMinor) ||
    !isSafeNonNegativeInteger(item.lineTotalMinor) ||
    item.unitPriceMinor * item.quantity !== item.lineTotalMinor ||
    !Number.isSafeInteger(item.unitPriceMinor * item.quantity) ||
    Number.isNaN(snapshot.orderCreatedAt.getTime())
  ) {
    throw new ProfileDataInvariantError();
  }
}

function chooseFavorite(
  current: FavoriteProductCandidate | undefined,
  candidate: FavoriteProductCandidate
): FavoriteProductCandidate {
  if (current === undefined) return candidate;
  if (candidate.quantity !== current.quantity) {
    return candidate.quantity > current.quantity ? candidate : current;
  }
  if (candidate.productId !== current.productId) {
    return candidate.productId < current.productId ? candidate : current;
  }
  return isLaterSnapshot(candidate, current) ? candidate : current;
}

export function aggregateCustomerProfileStats(input: {
  readonly customerId: number;
  readonly orderCount: number;
  readonly itemSnapshots: readonly CustomerProfileItemSnapshot[];
}): CustomerProfileStats {
  if (
    !Number.isSafeInteger(input.customerId) ||
    input.customerId < 1 ||
    !Number.isSafeInteger(input.orderCount) ||
    input.orderCount < 0 ||
    input.orderCount > 2_147_483_647
  ) {
    throw new ProfileDataInvariantError();
  }

  const byProduct = new Map<number, FavoriteProductCandidate>();
  for (const snapshot of input.itemSnapshots) {
    validateItemSnapshot(input.customerId, snapshot);
    const previous = byProduct.get(snapshot.item.productId);
    const candidate: FavoriteProductCandidate = {
      productId: snapshot.item.productId,
      name: snapshot.item.productName.trim(),
      quantity: (previous?.quantity ?? 0) + snapshot.item.quantity,
      orderCreatedAt: snapshot.orderCreatedAt.getTime(),
      orderId: snapshot.orderId,
      itemId: snapshot.item.id
    };
    if (!Number.isSafeInteger(candidate.quantity)) throw new ProfileDataInvariantError();
    byProduct.set(snapshot.item.productId, chooseFavorite(previous, candidate));
  }

  let favorite: FavoriteProductCandidate | undefined;
  for (const candidate of byProduct.values()) {
    favorite = chooseFavorite(favorite, candidate);
  }

  return {
    orderCount: input.orderCount,
    favoriteProduct: favorite?.name ?? null,
    nextMilestone: null
  };
}
