import type {
  OperationalAvailabilityRecord,
  OperationalAvailabilityStatus
} from "@vse-pro-zhar/contracts";

export const DEFAULT_AVAILABILITY_MAX_AGE_MS = 5 * 60 * 1_000;

export interface OperationalAvailabilityProvider {
  /**
   * The adapter owns the iiko call/read. `unknown` is intentional here: the
   * checkout service validates provider output before it can affect a quote.
   */
  getProductAvailability(
    productIds: readonly number[]
  ): Promise<readonly unknown[]>;
}

/**
 * When no complete iiko mapping/availability adapter configuration is
 * provided, every product is unknown. This keeps the checkout boundary fail
 * closed instead of silently treating public catalog visibility as kitchen
 * availability.
 */
export function createFailClosedAvailabilityProvider(): OperationalAvailabilityProvider {
  return {
    async getProductAvailability(
      productIds
    ): Promise<readonly OperationalAvailabilityRecord[]> {
      return productIds.map((productId) => ({
        productId,
        iikoProductId: null,
        status: "unknown" as OperationalAvailabilityStatus,
        checkedAt: null
      }));
    }
  };
}
