import {
  CheckoutOptionsResponseSchema,
  CheckoutQuoteRequestSchema,
  CheckoutQuoteResponseSchema,
  CartMoneyMinorSchema,
  OperationalAvailabilityRecordSchema,
  type CheckoutOptionsResponse,
  type CheckoutQuoteRequest,
  type CheckoutQuoteResponse,
  type CustomerProfile
} from "@vse-pro-zhar/contracts";
import type {
  CatalogCheckoutProduct,
  CatalogRepository,
  LoyaltyRepository
} from "@vse-pro-zhar/database";

import {
  CustomerAuthService,
  CustomerSessionError
} from "../auth/service.js";
import {
  CheckoutAuthenticationError,
  CheckoutCartUnavailableError,
  CheckoutConfigurationError,
  CheckoutDependencyError,
  CheckoutOperationalUnavailableError,
  CheckoutRewardUnavailableError,
  CheckoutValidationError
} from "./errors.js";
import {
  DEFAULT_AVAILABILITY_MAX_AGE_MS,
  type OperationalAvailabilityProvider
} from "./availability.js";
import {
  createPickupOptions,
  findPickupSelection,
  type PickupConfiguration
} from "./pickup.js";

const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

export interface CheckoutServiceOptions {
  readonly catalogRepository: CatalogRepository;
  readonly authService: CustomerAuthService;
  readonly availabilityProvider: OperationalAvailabilityProvider;
  readonly pickupConfiguration: PickupConfiguration;
  readonly now: () => Date;
  readonly availabilityMaxAgeMs?: number;
  readonly loyaltyRepository?: Pick<LoyaltyRepository, "getRedemptionForCheckout">;
}

export interface CheckoutQuoteWithAvailability {
  readonly quote: CheckoutQuoteResponse;
  readonly iikoProductIds: ReadonlyMap<number, string>;
}

function isSafeMinor(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_SAFE_MINOR;
}

function mapCustomerProfile(customer: CustomerProfile): CustomerProfile {
  return {
    phone: customer.phone,
    name: customer.name,
    birthDate: customer.birthDate
  };
}

export class CheckoutService {
  private readonly availabilityMaxAgeMs: number;

  constructor(private readonly options: CheckoutServiceOptions) {
    this.availabilityMaxAgeMs = options.availabilityMaxAgeMs ?? DEFAULT_AVAILABILITY_MAX_AGE_MS;
    if (
      !Number.isSafeInteger(this.availabilityMaxAgeMs) ||
      this.availabilityMaxAgeMs <= 0
    ) {
      throw new CheckoutConfigurationError();
    }
  }

  private async requireSession(token: string | null) {
    try {
      return await this.options.authService.getActiveSession(token);
    } catch (error: unknown) {
      if (error instanceof CustomerSessionError) {
        throw new CheckoutAuthenticationError();
      }
      throw error;
    }
  }

  async getOptions(token: string | null): Promise<CheckoutOptionsResponse> {
    await this.requireSession(token);

    try {
      return CheckoutOptionsResponseSchema.parse(
        createPickupOptions(this.options.pickupConfiguration, this.options.now())
      );
    } catch (error: unknown) {
      if (error instanceof CheckoutConfigurationError) throw error;
      throw new CheckoutDependencyError();
    }
  }

  private async readProducts(
    productIds: readonly number[]
  ): Promise<readonly CatalogCheckoutProduct[]> {
    if (this.options.catalogRepository.getProductsForCheckout !== undefined) {
      // One repository statement owns name, price and visibility so a
      // concurrent Admin edit cannot produce a mixed-version quote.
      return this.options.catalogRepository.getProductsForCheckout(productIds);
    }

    const snapshot = await this.options.catalogRepository.getCatalog();
    const visibleCategoryIds = new Set(
      snapshot.categories
        .filter((category) => category.isVisible)
        .map((category) => category.id)
    );
    const requestedIds = new Set(productIds);
    return snapshot.products
      .filter(
        (product) =>
          requestedIds.has(product.id) &&
          product.isVisible &&
          visibleCategoryIds.has(product.categoryId)
      )
      .map((product) => ({
        id: product.id,
        name: product.name,
        priceMinor: product.priceMinor
      }));
  }

  private async assertOperationalAvailability(
    productIds: readonly number[]
  ): Promise<ReadonlyMap<number, string>> {
    let rawRecords: readonly unknown[];
    try {
      rawRecords = await this.options.availabilityProvider.getProductAvailability(
        productIds
      );
    } catch {
      throw new CheckoutDependencyError();
    }

    const records = rawRecords.map((record) =>
      OperationalAvailabilityRecordSchema.safeParse(record)
    );
    if (records.some((record) => !record.success)) {
      throw new CheckoutOperationalUnavailableError();
    }

    const byProductId = new Map<number, (typeof records)[number]["data"]>();
    for (const parsed of records) {
      if (!parsed.success || byProductId.has(parsed.data.productId)) {
        throw new CheckoutOperationalUnavailableError();
      }
      byProductId.set(parsed.data.productId, parsed.data);
    }

    if (byProductId.size !== productIds.length) {
      throw new CheckoutOperationalUnavailableError();
    }

    // Measure freshness after the provider response arrives. A provider is
    // allowed to stamp a successful read at the end of its upstream call;
    // comparing it with a timestamp taken before that call would reject a
    // valid response as being a few milliseconds in the future.
    const now = this.options.now();

    const iikoProductIds = new Map<number, string>();
    for (const productId of productIds) {
      const record = byProductId.get(productId);
      if (
        record === undefined ||
        record.status !== "available" ||
        record.iikoProductId === null ||
        record.checkedAt === null
      ) {
        throw new CheckoutOperationalUnavailableError();
      }

      const checkedAt = new Date(record.checkedAt).getTime();
      const age = now.getTime() - checkedAt;
      if (
        !Number.isFinite(checkedAt) ||
        !Number.isFinite(age) ||
        age < 0 ||
        age > this.availabilityMaxAgeMs
      ) {
        throw new CheckoutOperationalUnavailableError();
      }
      iikoProductIds.set(productId, record.iikoProductId);
    }

    return iikoProductIds;
  }

  async quoteWithAvailability(
    token: string | null,
    input: CheckoutQuoteRequest
  ): Promise<CheckoutQuoteWithAvailability> {
    const session = await this.requireSession(token);
    const customer = mapCustomerProfile(session.customer);
    const parsedInput = CheckoutQuoteRequestSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new CheckoutValidationError();
    }

    const now = this.options.now();
    const options = createPickupOptions(this.options.pickupConfiguration, now);
    findPickupSelection(options, parsedInput.data.pickup);
    const productIds = parsedInput.data.items.map((item) => item.productId);
    const [products, iikoProductIds] = await Promise.all([
      this.readProducts(productIds),
      this.assertOperationalAvailability(productIds)
    ]);

    if (products.length !== parsedInput.data.items.length) {
      throw new CheckoutCartUnavailableError();
    }

    // Catalog and iiko reads can outlive a short pickup slot. Rebuild the
    // server-owned options after those reads so an expired selection cannot
    // be quoted or persisted merely because it was valid when the request
    // started.
    const currentOptions = createPickupOptions(
      this.options.pickupConfiguration,
      this.options.now()
    );
    const selectedPickup = findPickupSelection(
      currentOptions,
      parsedInput.data.pickup
    );

    const productsById = new Map<number, CatalogCheckoutProduct>();
    for (const product of products) {
      if (
        !Number.isSafeInteger(product.id) ||
        product.id < 1 ||
        productsById.has(product.id) ||
        typeof product.name !== "string" ||
        product.name.trim() === "" ||
        !isSafeMinor(product.priceMinor)
      ) {
        throw new CheckoutDependencyError();
      }
      productsById.set(product.id, product);
    }

    let totalMinor = 0;
    const items = parsedInput.data.items.map((item) => {
      const product = productsById.get(item.productId);
      if (product === undefined) {
        throw new CheckoutCartUnavailableError();
      }

      const lineTotalMinor = product.priceMinor * item.quantity;
      if (!isSafeMinor(lineTotalMinor)) {
        throw new CheckoutDependencyError();
      }
      totalMinor += lineTotalMinor;
      if (!isSafeMinor(totalMinor)) {
        throw new CheckoutDependencyError();
      }

      return {
        productId: item.productId,
        productName: product.name.trim(),
        quantity: item.quantity,
        unitPriceMinor: product.priceMinor,
        lineTotalMinor
      };
    });

    if (!isSafeMinor(totalMinor) || !CartMoneyMinorSchema.safeParse(totalMinor).success) {
      throw new CheckoutDependencyError();
    }

    let discountMinor = 0;
    let loyaltyRedemption: CheckoutQuoteResponse["loyaltyRedemption"];
    if (parsedInput.data.redemptionId !== undefined) {
      if (this.options.loyaltyRepository?.getRedemptionForCheckout === undefined) throw new CheckoutRewardUnavailableError();
      const redemption = await this.options.loyaltyRepository.getRedemptionForCheckout(session.customer.id, parsedInput.data.redemptionId, this.options.now());
      if (redemption === null || redemption.rewardType !== "fixed_discount" || redemption.discountMinor > totalMinor) throw new CheckoutRewardUnavailableError();
      discountMinor = redemption.discountMinor;
      loyaltyRedemption = {
        id: redemption.id,
        rewardCode: redemption.rewardCode,
        rewardName: redemption.rewardName,
        discountMinor,
        status: "pending"
      };
    }
    const response = {
      customer,
      items,
      subtotalMinor: totalMinor,
      discountMinor,
      totalMinor: totalMinor - discountMinor,
      ...(loyaltyRedemption === undefined ? {} : { loyaltyRedemption }),
      pickup: selectedPickup,
      confirmationText: `Проверка завершена. Самовывоз: ${selectedPickup.location.name}, ${selectedPickup.slot.label}. Заказ ещё не создан.`
    };

    return {
      quote: CheckoutQuoteResponseSchema.parse(response),
      iikoProductIds
    };
  }

  async quote(
    token: string | null,
    input: CheckoutQuoteRequest
  ): Promise<CheckoutQuoteResponse> {
    return (await this.quoteWithAvailability(token, input)).quote;
  }
}
