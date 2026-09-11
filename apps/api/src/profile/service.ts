import {
  CustomerProfileResponseSchema,
  type CustomerProfileMilestone,
  type CustomerProfileResponse,
  type LoyaltySummaryResponse
} from "@vse-pro-zhar/contracts";
import type {
  CustomerProfileRepository,
  CustomerProfileOrderAggregate,
  CustomerNotificationRepository
} from "@vse-pro-zhar/database";

import { CustomerAuthService, CustomerSessionError } from "../auth/service.js";
import type { LoyaltyService } from "../loyalty/service.js";
import { aggregateCustomerProfileStats, ProfileDataInvariantError } from "./domain.js";

export class ProfileAuthenticationError extends Error {
  constructor() {
    super("Customer profile session is invalid");
    this.name = "ProfileAuthenticationError";
  }
}

export class ProfileDependencyError extends Error {
  constructor() {
    super("Customer profile data is unavailable");
    this.name = "ProfileDependencyError";
  }
}

const UNAVAILABLE_PROFILE_SETTINGS = {
  pushNotifications: { status: "unavailable", reason: "native_push_contract_pending" },
  emailSubscription: { status: "unavailable", reason: "email_consent_contract_pending" },
  darkTheme: { status: "unavailable", reason: "theme_contract_pending" }
} as const;

function unavailableLoyalty(): LoyaltySummaryResponse {
  return { status: "unavailable", reason: "not_configured" };
}

function milestoneFromLoyalty(loyalty: LoyaltySummaryResponse): CustomerProfileMilestone | null {
  if (loyalty.status !== "confirmed" || loyalty.summary.isMaxRank || loyalty.summary.nextRank === null) {
    return null;
  }
  return {
    label: `До ранга «${loyalty.summary.nextRank.name}»`,
    remaining: loyalty.summary.xpToNextRank,
    unit: "xp",
    source: "loyalty_rank"
  };
}

function toRecentOrder(aggregate: CustomerProfileOrderAggregate) {
  const order = aggregate.order;
  if (aggregate.items.length === 0) throw new ProfileDataInvariantError();
  return {
    id: order.id,
    status: order.status,
    totalMinor: order.totalMinor,
    currency: order.currency,
    pickup: {
      location: {
        id: order.pickupLocationId,
        name: order.pickupLocationName,
        address: order.pickupLocationAddress,
        timezone: order.pickupLocationTimezone
      },
      slot: {
        id: order.pickupSlotId,
        label: order.pickupSlotLabel,
        startsAt: order.pickupSlotStartsAt.toISOString(),
        endsAt: order.pickupSlotEndsAt.toISOString()
      }
    },
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: aggregate.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      lineTotalMinor: item.lineTotalMinor
    }))
  };
}

export interface ProfileServiceOptions {
  readonly repository: CustomerProfileRepository;
  readonly authService: CustomerAuthService;
  readonly loyaltyService?: LoyaltyService;
  readonly notificationRepository?: CustomerNotificationRepository;
  readonly now?: () => Date;
}

export class ProfileService {
  constructor(private readonly options: ProfileServiceOptions) {}

  private async requireCustomer(token: string | null) {
    try {
      return await this.options.authService.getActiveSession(token);
    } catch (error: unknown) {
      if (error instanceof CustomerSessionError) throw new ProfileAuthenticationError();
      throw error;
    }
  }

  private async loyaltyForCustomer(customerId: number): Promise<LoyaltySummaryResponse> {
    if (this.options.loyaltyService === undefined) return unavailableLoyalty();
    return this.options.loyaltyService.getSummaryForCustomer(customerId);
  }

  async get(token: string | null): Promise<CustomerProfileResponse> {
    const session = await this.requireCustomer(token);
    const [data, loyalty, notificationPreferences] = await Promise.all([
      this.options.repository.getCustomerProfileData(session.customer.id),
      this.loyaltyForCustomer(session.customer.id),
      this.options.notificationRepository === undefined
        ? Promise.resolve(null)
        : this.options.notificationRepository.getPreferences(session.customer.id, this.options.now?.() ?? new Date())
    ]);

    if (data.recentOrders.some((aggregate) => aggregate.order.customerId !== session.customer.id)) {
      throw new ProfileDependencyError();
    }
    if (data.recentOrders.some((aggregate) => aggregate.items.some((item) => item.orderId !== aggregate.order.id))) {
      throw new ProfileDependencyError();
    }

    const stats = aggregateCustomerProfileStats({
      customerId: session.customer.id,
      orderCount: data.orderCount,
      itemSnapshots: data.itemSnapshots
    });
    const response = {
      customer: {
        phone: session.customer.phone,
        name: session.customer.name,
        birthDate: session.customer.birthDate
      },
      stats: { ...stats, nextMilestone: milestoneFromLoyalty(loyalty) },
      loyalty,
      settings: notificationPreferences === null
        ? UNAVAILABLE_PROFILE_SETTINGS
        : {
            pushNotifications: { status: "confirmed" as const, enabled: notificationPreferences.pushEnabled },
            emailSubscription: UNAVAILABLE_PROFILE_SETTINGS.emailSubscription,
            darkTheme: UNAVAILABLE_PROFILE_SETTINGS.darkTheme
          },
      recentOrders: data.recentOrders.map(toRecentOrder)
    };
    const parsed = CustomerProfileResponseSchema.safeParse(response);
    if (!parsed.success) throw new ProfileDependencyError();
    return parsed.data;
  }
}
