import { asc, count, desc, eq, inArray } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";
import {
  orderItems,
  orders,
  type OrderItemRecord,
  type OrderRecord
} from "./schema.js";

export const CUSTOMER_PROFILE_RECENT_ORDER_LIMIT = 5;

export interface CustomerProfileOrderAggregate {
  readonly order: OrderRecord;
  readonly items: readonly OrderItemRecord[];
}

export interface CustomerProfileItemSnapshot {
  readonly item: OrderItemRecord;
  readonly orderCreatedAt: Date;
  readonly orderId: number;
  readonly customerId: number;
}

export interface CustomerProfileData {
  readonly orderCount: number;
  readonly recentOrders: readonly CustomerProfileOrderAggregate[];
  readonly itemSnapshots: readonly CustomerProfileItemSnapshot[];
}

export interface CustomerProfileRepository {
  getCustomerProfileData(customerId: number): Promise<CustomerProfileData>;
}

function parseCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 2_147_483_647) {
    throw new Error("Customer profile order count is invalid");
  }
  return parsed;
}

export function createCustomerProfileRepository(
  client: DatabaseClient
): CustomerProfileRepository {
  return {
    async getCustomerProfileData(customerId) {
      const [countRow] = await client.db
        .select({ orderCount: count(orders.id) })
        .from(orders)
        .where(eq(orders.customerId, customerId));

      const recentOrders = await client.db
        .select()
        .from(orders)
        .where(eq(orders.customerId, customerId))
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(CUSTOMER_PROFILE_RECENT_ORDER_LIMIT);

      const recentOrderIds = recentOrders.map((order) => order.id);
      const recentItems = recentOrderIds.length === 0
        ? []
        : await client.db
            .select()
            .from(orderItems)
            .where(inArray(orderItems.orderId, recentOrderIds))
            .orderBy(asc(orderItems.orderId), asc(orderItems.id));
      const itemsByOrderId = new Map<number, OrderItemRecord[]>();
      for (const item of recentItems) {
        const current = itemsByOrderId.get(item.orderId);
        if (current === undefined) itemsByOrderId.set(item.orderId, [item]);
        else current.push(item);
      }

      const itemSnapshots = await client.db
        .select({
          item: orderItems,
          orderCreatedAt: orders.createdAt,
          orderId: orders.id,
          customerId: orders.customerId
        })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(eq(orders.customerId, customerId))
        .orderBy(desc(orders.createdAt), desc(orders.id), desc(orderItems.id));

      return {
        orderCount: parseCount(countRow?.orderCount),
        recentOrders: recentOrders.map((order) => ({
          order,
          items: itemsByOrderId.get(order.id) ?? []
        })),
        itemSnapshots
      };
    }
  };
}
