import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";
import {
  categories,
  customers,
  loyaltyRedemptionOrders,
  loyaltyRedemptions,
  orderCustomerSnapshots,
  orderIikoItems,
  orderItems,
  orders,
  orderStatusHistory,
  products,
  type OrderIikoItemRecord,
  type OrderItemRecord,
  type OrderRecord
} from "./schema.js";

export interface OrderPickupSnapshotInput {
  readonly locationId: string;
  readonly locationName: string;
  readonly locationAddress: string;
  readonly locationTimezone: string;
  readonly slotId: string;
  readonly slotLabel: string;
  readonly slotStartsAt: Date;
  readonly slotEndsAt: Date;
}

export interface OrderItemSnapshotInput {
  readonly productId: number;
  readonly productName: string;
  readonly unitPriceMinor: number;
  readonly quantity: number;
  readonly lineTotalMinor: number;
}

export interface OrderIikoItemSnapshotInput {
  readonly productId: number;
  readonly iikoProductId: string | null;
}

export interface CreateOrderInput {
  readonly customerId: number;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly pickup: OrderPickupSnapshotInput;
  readonly items: readonly OrderItemSnapshotInput[];
  readonly iikoItems?: readonly OrderIikoItemSnapshotInput[];
  readonly totalMinor: number;
  readonly subtotalMinor?: number;
  readonly discountMinor?: number;
  readonly loyaltyRedemption?: {
    readonly id: number;
    readonly rewardCode: string;
    readonly rewardName: string;
    readonly discountMinor: number;
  } | undefined;
  readonly currency: string;
  readonly status: "pending_payment";
  readonly createdAt: Date;
}

export interface OrderAggregate {
  readonly order: OrderRecord;
  readonly items: readonly OrderItemRecord[];
  readonly iikoItems?: readonly OrderIikoItemRecord[];
  readonly loyaltyRedemption?: {
    readonly id: number;
    readonly rewardCode: string;
    readonly rewardName: string;
    readonly discountMinor: number;
    readonly status: "succeeded";
  } | undefined;
}

export class OrderIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used with another request");
    this.name = "OrderIdempotencyConflictError";
  }
}

export class OrderCatalogChangedError extends Error {
  constructor() {
    super("Order catalog snapshot changed");
    this.name = "OrderCatalogChangedError";
  }
}

export interface OrderRepository {
  findByIdempotencyKey(
    customerId: number,
    idempotencyKey: string
  ): Promise<OrderAggregate | null>;
  createOrder(input: CreateOrderInput): Promise<OrderAggregate>;
  listByCustomer(customerId: number): Promise<readonly OrderRecord[]>;
  findByCustomerAndId(
    customerId: number,
    orderId: number
  ): Promise<OrderAggregate | null>;
}

function checkFingerprint(
  order: OrderRecord,
  payloadFingerprint: string
): void {
  if (order.payloadFingerprint !== payloadFingerprint) {
    throw new OrderIdempotencyConflictError();
  }
}

async function readIikoItems(
  query: Pick<DatabaseClient["db"], "select">,
  orderId: number
): Promise<readonly OrderIikoItemRecord[]> {
  return query
    .select()
    .from(orderIikoItems)
    .where(eq(orderIikoItems.orderId, orderId))
    .orderBy(asc(orderIikoItems.id));
}

async function readLoyaltyRedemptionOrder(
  query: Pick<DatabaseClient["db"], "select">,
  orderId: number
): Promise<OrderAggregate["loyaltyRedemption"]> {
  const [snapshot] = await query
    .select()
    .from(loyaltyRedemptionOrders)
    .where(eq(loyaltyRedemptionOrders.orderId, orderId))
    .limit(1);
  return snapshot === undefined
    ? undefined
    : {
        id: snapshot.redemptionId,
        rewardCode: snapshot.rewardCode,
        rewardName: snapshot.rewardName,
        discountMinor: snapshot.discountMinor,
        status: "succeeded"
      };
}

export function createOrderRepository(client: DatabaseClient): OrderRepository {
  return {
    async findByIdempotencyKey(customerId, idempotencyKey) {
      const [order] = await client.db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.customerId, customerId),
            eq(orders.idempotencyKey, idempotencyKey)
          )
        )
        .limit(1);

      if (order === undefined) return null;

      const items = await client.db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id))
        .orderBy(asc(orderItems.id));

      return { order, items, iikoItems: await readIikoItems(client.db, order.id), loyaltyRedemption: await readLoyaltyRedemptionOrder(client.db, order.id) };
    },

    async createOrder(input) {
      return client.db.transaction(async (tx) => {
        const readExisting = async (): Promise<OrderAggregate | null> => {
          const [existingOrder] = await tx
            .select()
            .from(orders)
            .where(
              and(
                eq(orders.customerId, input.customerId),
                eq(orders.idempotencyKey, input.idempotencyKey)
              )
            )
            .limit(1);

          if (existingOrder === undefined) return null;

          const existingItems = await tx
            .select()
            .from(orderItems)
            .where(eq(orderItems.orderId, existingOrder.id))
            .orderBy(asc(orderItems.id));

          checkFingerprint(existingOrder, input.payloadFingerprint);
          return {
            order: existingOrder,
            items: existingItems,
            iikoItems: await readIikoItems(tx, existingOrder.id),
            loyaltyRedemption: await readLoyaltyRedemptionOrder(tx, existingOrder.id)
          };
        };

        const existing = await readExisting();
        if (existing !== null) return existing;

        const productIds = input.items.map((item) => item.productId);
        const currentProducts = await tx
          .select({
            id: products.id,
            name: products.name,
            priceMinor: products.priceMinor,
            productVisible: products.isVisible,
            categoryVisible: categories.isVisible
          })
          .from(products)
          .innerJoin(categories, eq(products.categoryId, categories.id))
          .where(inArray(products.id, productIds))
          // Serialize the order snapshot against concurrent Admin catalog
          // updates. The lock is held only for the short local write
          // transaction; iiko is checked before entering this repository.
          .for("share");
        const currentById = new Map(
          currentProducts.map((product) => [product.id, product])
        );
        if (currentById.size !== input.items.length) {
          throw new OrderCatalogChangedError();
        }
        for (const item of input.items) {
          const current = currentById.get(item.productId);
          if (
            current === undefined ||
            !current.productVisible ||
            !current.categoryVisible ||
            current.name.trim() !== item.productName.trim() ||
            current.priceMinor !== item.unitPriceMinor ||
            current.priceMinor * item.quantity !== item.lineTotalMinor
          ) {
            throw new OrderCatalogChangedError();
          }
        }

        const calculatedSubtotalMinor = input.items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
        const subtotalMinor = input.subtotalMinor ?? calculatedSubtotalMinor;
        const discountMinor = input.discountMinor ?? 0;
        if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor !== calculatedSubtotalMinor || !Number.isSafeInteger(discountMinor) || discountMinor < 0 || discountMinor > subtotalMinor || subtotalMinor - discountMinor !== input.totalMinor) {
          throw new OrderCatalogChangedError();
        }
        if (input.loyaltyRedemption !== undefined && input.loyaltyRedemption.discountMinor !== discountMinor) {
          throw new OrderCatalogChangedError();
        }

        const [createdOrder] = await tx
          .insert(orders)
          .values({
            customerId: input.customerId,
            pickupLocationId: input.pickup.locationId,
            pickupLocationName: input.pickup.locationName,
            pickupLocationAddress: input.pickup.locationAddress,
            pickupLocationTimezone: input.pickup.locationTimezone,
            pickupSlotId: input.pickup.slotId,
            pickupSlotLabel: input.pickup.slotLabel,
            pickupSlotStartsAt: input.pickup.slotStartsAt,
            pickupSlotEndsAt: input.pickup.slotEndsAt,
            status: input.status,
            totalMinor: input.totalMinor,
            currency: input.currency,
            idempotencyKey: input.idempotencyKey,
            payloadFingerprint: input.payloadFingerprint,
            createdAt: input.createdAt,
            updatedAt: input.createdAt
          })
          .onConflictDoNothing({
            target: [orders.customerId, orders.idempotencyKey]
          })
          .returning();

        if (createdOrder === undefined) {
          const raced = await readExisting();
          if (raced === null) {
            throw new Error("Idempotent order insert returned no row");
          }
          return raced;
        }

        const [customer] = await tx
          .select({ phone: customers.phone, name: customers.name })
          .from(customers)
          .where(eq(customers.id, input.customerId))
          .limit(1)
          .for("share");
        if (customer === undefined) throw new Error("Order customer snapshot source is missing");
        const [createdCustomerSnapshot] = await tx
          .insert(orderCustomerSnapshots)
          .values({
            orderId: createdOrder.id,
            customerId: input.customerId,
            phone: customer.phone,
            name: customer.name,
            createdAt: input.createdAt
          })
          .returning();
        if (createdCustomerSnapshot === undefined) throw new Error("Order customer snapshot insert returned no row");

        const createdItems = await tx
          .insert(orderItems)
          .values(
            input.items.map((item) => ({
              orderId: createdOrder.id,
              productId: item.productId,
              productName: item.productName,
              unitPriceMinor: item.unitPriceMinor,
              quantity: item.quantity,
              lineTotalMinor: item.lineTotalMinor
            }))
          )
          .returning();

        if (createdItems.length !== input.items.length) {
          throw new Error("Order item insert returned an incomplete result");
        }

        if (input.loyaltyRedemption !== undefined) {
          const [redemption] = await tx
            .select()
            .from(loyaltyRedemptions)
            .where(and(eq(loyaltyRedemptions.id, input.loyaltyRedemption.id), eq(loyaltyRedemptions.customerId, input.customerId)))
            .limit(1)
            .for("update");
          if (
            redemption === undefined || redemption.status !== "pending" ||
            redemption.rewardCode !== input.loyaltyRedemption.rewardCode ||
            redemption.rewardName !== input.loyaltyRedemption.rewardName ||
            redemption.discountMinor !== input.loyaltyRedemption.discountMinor ||
            redemption.expiresAt <= input.createdAt
          ) {
            throw new OrderCatalogChangedError();
          }
          const [linked] = await tx.insert(loyaltyRedemptionOrders).values({
            redemptionId: redemption.id,
            orderId: createdOrder.id,
            customerId: input.customerId,
            rewardCode: redemption.rewardCode,
            rewardName: redemption.rewardName,
            discountMinor: redemption.discountMinor,
            createdAt: input.createdAt
          }).returning();
          if (linked === undefined) throw new Error("Loyalty redemption order snapshot insert returned no row");
          const [completedRedemption] = await tx.update(loyaltyRedemptions).set({ status: "succeeded", completedAt: input.createdAt, updatedAt: input.createdAt }).where(and(eq(loyaltyRedemptions.id, redemption.id), eq(loyaltyRedemptions.status, "pending"))).returning();
          if (completedRedemption === undefined) throw new OrderCatalogChangedError();
        }

        const iikoItems = await tx
          .insert(orderIikoItems)
          .values(
            createdItems.map((createdItem, index) => ({
              orderId: createdOrder.id,
              orderItemId: createdItem.id,
              productId: createdItem.productId,
              iikoProductId:
                input.iikoItems?.[index]?.productId === createdItem.productId
                  ? (input.iikoItems[index]?.iikoProductId ?? null)
                  : null,
              createdAt: input.createdAt
            }))
          )
          .returning();

        if (iikoItems.length !== input.items.length) {
          throw new Error("Order iiko snapshot insert returned an incomplete result");
        }

        const [createdHistory] = await tx
          .insert(orderStatusHistory)
          .values({
            orderId: createdOrder.id,
            status: input.status,
            createdAt: input.createdAt
          })
          .returning();

        if (createdHistory === undefined) {
          throw new Error("Order status history insert returned no row");
        }

        return {
          order: createdOrder,
          items: createdItems,
          iikoItems,
          loyaltyRedemption: input.loyaltyRedemption === undefined ? undefined : {
            id: input.loyaltyRedemption.id,
            rewardCode: input.loyaltyRedemption.rewardCode,
            rewardName: input.loyaltyRedemption.rewardName,
            discountMinor: input.loyaltyRedemption.discountMinor,
            status: "succeeded" as const
          }
        };
      });
    },

    async listByCustomer(customerId) {
      return client.db
        .select()
        .from(orders)
        .where(eq(orders.customerId, customerId))
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(100);
    },

    async findByCustomerAndId(customerId, orderId) {
      const [order] = await client.db
        .select()
        .from(orders)
        .where(and(eq(orders.customerId, customerId), eq(orders.id, orderId)))
        .limit(1);

      if (order === undefined) return null;

      const items = await client.db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id))
        .orderBy(asc(orderItems.id));

      return { order, items, iikoItems: await readIikoItems(client.db, order.id), loyaltyRedemption: await readLoyaltyRedemptionOrder(client.db, order.id) };
    }
  };
}
