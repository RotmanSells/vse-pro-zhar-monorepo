import { createHash } from "node:crypto";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";
import {
  customerNotificationDevices,
  customerNotificationDeliveries,
  customerNotificationPreferences,
  customers,
  smsAuthChallenges,
  type CustomerNotificationDeviceRecord,
  type CustomerNotificationDeliveryRecord,
  type CustomerNotificationPreferencesRecord,
  type SmsAuthChallengeRecord
} from "./schema.js";

export type CustomerNotificationPlatform = "ios" | "android";
export type CustomerNotificationProvider = "expo";

function readPushPlatform(value: string): CustomerNotificationPlatform {
  if (value === "ios" || value === "android") return value;
  throw new Error("Notification device platform is invalid");
}

export interface RegisterNotificationDeviceInput {
  readonly customerId: number;
  readonly provider: CustomerNotificationProvider;
  readonly platform: CustomerNotificationPlatform;
  readonly token: string;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly now: Date;
}

export interface CustomerNotificationRepository {
  registerDevice(input: RegisterNotificationDeviceInput): Promise<{ readonly device: CustomerNotificationDeviceRecord; readonly created: boolean }>;
  listDevices(customerId: number): Promise<readonly CustomerNotificationDeviceRecord[]>;
  revokeDevice(customerId: number, id: number, now: Date): Promise<boolean>;
  getPreferences(customerId: number, now: Date): Promise<CustomerNotificationPreferencesRecord>;
  updatePreferences(input: { readonly customerId: number; readonly pushEnabled?: boolean; readonly smsEnabled?: boolean; readonly now: Date }): Promise<CustomerNotificationPreferencesRecord>;
}

export type CustomerPushDeliveryStatus = "pending" | "accepted" | "delivered" | "failed" | "reconciliation_required";

export interface CustomerPushDevice {
  readonly id: number;
  readonly provider: CustomerNotificationProvider;
  readonly platform: CustomerNotificationPlatform;
  readonly token: string;
}

export interface CustomerPushDeliveryCreateInput {
  readonly customerId: number;
  readonly deviceId: number;
  readonly requestKey: string;
  readonly payloadFingerprint: string;
  readonly now: Date;
}

export interface CustomerPushDeliveryUpdateInput {
  readonly status: CustomerPushDeliveryStatus;
  readonly providerTicketId?: string | null;
  readonly errorCode?: string | null;
  readonly updatedAt: Date;
}

export interface CustomerPushRepository {
  findCustomerIdByPhone(phone: string): Promise<number | null>;
  isPushEnabled(customerId: number): Promise<boolean>;
  listEnabledPushDevices(customerId: number): Promise<readonly CustomerPushDevice[]>;
  prepareDelivery(input: CustomerPushDeliveryCreateInput): Promise<{ readonly delivery: CustomerNotificationDeliveryRecord; readonly created: boolean }>;
  updateDelivery(id: number, input: CustomerPushDeliveryUpdateInput): Promise<CustomerNotificationDeliveryRecord | null>;
  listDeliveries(requestKey: string): Promise<readonly CustomerNotificationDeliveryRecord[]>;
  disableDevice(deviceId: number, now: Date): Promise<void>;
}

export class NotificationDeviceIdempotencyConflictError extends Error {
  constructor() {
    super("Notification device idempotency key conflicts");
    this.name = "NotificationDeviceIdempotencyConflictError";
  }
}

export interface SmsChallengeCreateInput {
  readonly phone: string;
  readonly purpose: "login";
  readonly codeHash: string;
  readonly expiresAt: Date;
  readonly now: Date;
}

export type SmsChallengeConsumeResult =
  | { readonly status: "verified" }
  | { readonly status: "missing" | "expired" | "invalid" | "too_many" };

export interface SmsAuthRepository {
  createChallenge(input: SmsChallengeCreateInput): Promise<void>;
  consumeChallenge(phone: string, codeHash: string, now: Date): Promise<SmsChallengeConsumeResult>;
  cleanupChallenges(now: Date): Promise<void>;
  markCustomerPhoneVerified(phone: string, now: Date): Promise<void>;
}

function challengeStatus(row: SmsAuthChallengeRecord | undefined, codeHash: string, now: Date): SmsChallengeConsumeResult {
  if (row === undefined) return { status: "missing" };
  if (row.consumedAt !== null || row.expiresAt <= now) return { status: "expired" };
  if (row.attempts >= 5) return { status: "too_many" };
  if (row.codeHash !== codeHash) return { status: "invalid" };
  return { status: "verified" };
}

export function createCustomerNotificationRepository(client: DatabaseClient): CustomerNotificationRepository {
  return {
    async registerDevice(input) {
      return client.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))`);
        const [existingByKey] = await tx.select().from(customerNotificationDevices)
          .where(eq(customerNotificationDevices.idempotencyKey, input.idempotencyKey)).limit(1);
        if (existingByKey !== undefined) {
          if (existingByKey.payloadFingerprint !== input.payloadFingerprint) throw new NotificationDeviceIdempotencyConflictError();
          return { device: existingByKey, created: false };
        }
        const [device] = await tx.insert(customerNotificationDevices).values({
          customerId: input.customerId,
          provider: input.provider,
          platform: input.platform,
          token: input.token,
          enabled: true,
          idempotencyKey: input.idempotencyKey,
          payloadFingerprint: input.payloadFingerprint,
          lastSeenAt: input.now,
          createdAt: input.now,
          updatedAt: input.now
        }).onConflictDoUpdate({
          target: [customerNotificationDevices.provider, customerNotificationDevices.token],
          set: {
            customerId: input.customerId,
            platform: input.platform,
            enabled: true,
            idempotencyKey: input.idempotencyKey,
            payloadFingerprint: input.payloadFingerprint,
            lastSeenAt: input.now,
            updatedAt: input.now
          }
        }).returning();
        if (device === undefined) throw new Error("Notification device registration returned no row");
        return { device, created: true };
      });
    },

    async listDevices(customerId) {
      return client.db.select().from(customerNotificationDevices)
        .where(and(eq(customerNotificationDevices.customerId, customerId), eq(customerNotificationDevices.enabled, true)))
        .orderBy(desc(customerNotificationDevices.lastSeenAt));
    },

    async revokeDevice(customerId, id, now) {
      const result = await client.db.update(customerNotificationDevices)
        .set({ enabled: false, updatedAt: now })
        .where(and(eq(customerNotificationDevices.id, id), eq(customerNotificationDevices.customerId, customerId), eq(customerNotificationDevices.enabled, true)))
        .returning({ id: customerNotificationDevices.id });
      return result.length === 1;
    },

    async getPreferences(customerId, now) {
      const [existing] = await client.db.select().from(customerNotificationPreferences)
        .where(eq(customerNotificationPreferences.customerId, customerId)).limit(1);
      if (existing !== undefined) return existing;
      const [created] = await client.db.insert(customerNotificationPreferences)
        .values({ customerId, pushEnabled: true, smsEnabled: false, updatedAt: now })
        .onConflictDoNothing({ target: customerNotificationPreferences.customerId })
        .returning();
      if (created !== undefined) return created;
      const [raced] = await client.db.select().from(customerNotificationPreferences)
        .where(eq(customerNotificationPreferences.customerId, customerId)).limit(1);
      if (raced === undefined) throw new Error("Notification preferences returned no row");
      return raced;
    },

    async updatePreferences(input) {
      const current = await this.getPreferences(input.customerId, input.now);
      const [updated] = await client.db.update(customerNotificationPreferences)
        .set({
          pushEnabled: input.pushEnabled ?? current.pushEnabled,
          smsEnabled: input.smsEnabled ?? current.smsEnabled,
          updatedAt: input.now
        })
        .where(eq(customerNotificationPreferences.customerId, input.customerId))
        .returning();
      if (updated === undefined) throw new Error("Notification preferences update returned no row");
      return updated;
    }
  };
}

export function createCustomerPushRepository(client: DatabaseClient): CustomerPushRepository {
  return {
    async findCustomerIdByPhone(phone) {
      const [customer] = await client.db.select({ id: customers.id }).from(customers).where(eq(customers.phone, phone)).limit(1);
      return customer?.id ?? null;
    },

    async isPushEnabled(customerId) {
      const [preferences] = await client.db.select({ pushEnabled: customerNotificationPreferences.pushEnabled })
        .from(customerNotificationPreferences)
        .where(eq(customerNotificationPreferences.customerId, customerId))
        .limit(1);
      return preferences?.pushEnabled ?? true;
    },

    async listEnabledPushDevices(customerId) {
      const rows = await client.db.select({
        id: customerNotificationDevices.id,
        provider: customerNotificationDevices.provider,
        platform: customerNotificationDevices.platform,
        token: customerNotificationDevices.token
      }).from(customerNotificationDevices)
        .where(and(
          eq(customerNotificationDevices.customerId, customerId),
          eq(customerNotificationDevices.provider, "expo"),
          eq(customerNotificationDevices.enabled, true)
        ))
        .orderBy(desc(customerNotificationDevices.lastSeenAt));
      return rows.map((device) => ({
        id: device.id,
        provider: "expo" as const,
        platform: readPushPlatform(device.platform),
        token: device.token
      }));
    },

    async prepareDelivery(input) {
      return client.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(customerNotificationDeliveries)
          .where(and(
            eq(customerNotificationDeliveries.requestKey, input.requestKey),
            eq(customerNotificationDeliveries.deviceId, input.deviceId)
          ))
          .limit(1)
          .for("update");
        if (existing !== undefined) {
          if (existing.payloadFingerprint !== input.payloadFingerprint) throw new NotificationPushIdempotencyConflictError();
          return { delivery: existing, created: false };
        }
        const [delivery] = await tx.insert(customerNotificationDeliveries).values({
          customerId: input.customerId,
          deviceId: input.deviceId,
          provider: "expo",
          requestKey: input.requestKey,
          payloadFingerprint: input.payloadFingerprint,
          providerTicketId: null,
          status: "pending",
          errorCode: null,
          createdAt: input.now,
          updatedAt: input.now
        }).returning();
        if (delivery === undefined) throw new Error("Push delivery insert returned no row");
        return { delivery, created: true };
      });
    },

    async updateDelivery(id, input) {
      const [delivery] = await client.db.update(customerNotificationDeliveries)
        .set({
          status: input.status,
          ...(input.providerTicketId === undefined ? {} : { providerTicketId: input.providerTicketId }),
          ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
          updatedAt: input.updatedAt
        })
        .where(eq(customerNotificationDeliveries.id, id))
        .returning();
      return delivery ?? null;
    },

    async listDeliveries(requestKey) {
      return client.db.select().from(customerNotificationDeliveries)
        .where(eq(customerNotificationDeliveries.requestKey, requestKey))
        .orderBy(customerNotificationDeliveries.id);
    },

    async disableDevice(deviceId, now) {
      await client.db.update(customerNotificationDevices)
        .set({ enabled: false, updatedAt: now })
        .where(and(eq(customerNotificationDevices.id, deviceId), eq(customerNotificationDevices.enabled, true)));
    }
  };
}

export class NotificationPushIdempotencyConflictError extends Error {
  constructor() {
    super("Push request idempotency key conflicts");
    this.name = "NotificationPushIdempotencyConflictError";
  }
}

export function createSmsAuthRepository(client: DatabaseClient): SmsAuthRepository {
  return {
    async createChallenge(input) {
      await client.db.update(smsAuthChallenges)
        .set({ consumedAt: input.now, updatedAt: input.now })
        .where(and(eq(smsAuthChallenges.phone, input.phone), eq(smsAuthChallenges.purpose, input.purpose), isNull(smsAuthChallenges.consumedAt)));
      await client.db.insert(smsAuthChallenges).values({
        phone: input.phone,
        purpose: input.purpose,
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        attempts: 0,
        consumedAt: null,
        createdAt: input.now,
        updatedAt: input.now
      });
    },

    async consumeChallenge(phone, codeHash, now) {
      return client.db.transaction(async (tx) => {
        const [challenge] = await tx.select().from(smsAuthChallenges)
          .where(and(eq(smsAuthChallenges.phone, phone), eq(smsAuthChallenges.purpose, "login"), isNull(smsAuthChallenges.consumedAt)))
          .orderBy(desc(smsAuthChallenges.createdAt), desc(smsAuthChallenges.id)).limit(1).for("update");
        const status = challengeStatus(challenge, codeHash, now);
        if (challenge === undefined) return status;
        if (status.status === "invalid") {
          await tx.update(smsAuthChallenges).set({ attempts: challenge.attempts + 1, updatedAt: now }).where(eq(smsAuthChallenges.id, challenge.id));
        } else if (status.status === "verified") {
          await tx.update(smsAuthChallenges).set({ consumedAt: now, updatedAt: now }).where(eq(smsAuthChallenges.id, challenge.id));
        }
        return status;
      });
    },

    async cleanupChallenges(now) {
      await client.db.delete(smsAuthChallenges).where(lt(smsAuthChallenges.expiresAt, now));
    },

    async markCustomerPhoneVerified(phone, now) {
      await client.db.execute(sql`UPDATE customers SET phone_verified_at = ${now}, updated_at = ${now} WHERE phone = ${phone}`);
    }
  };
}

export function notificationPayloadFingerprint(input: { readonly provider: string; readonly platform: string; readonly token: string }): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
