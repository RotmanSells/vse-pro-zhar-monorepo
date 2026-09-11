import { and, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";
import {
  staffAuditLog,
  staffSessions,
  staffUsers,
  type StaffSessionRecord,
  type StaffUserRecord
} from "./schema.js";

export type StaffAuditAction =
  | "staff_login"
  | "staff_logout"
  | "order_fulfillment_retry"
  | "order_cancel"
  | "refund_reconcile";

export interface CreateStaffUserInput {
  readonly login: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly createdAt: Date;
}

export interface StaffSessionLookup {
  readonly user: StaffUserRecord;
  readonly session: StaffSessionRecord;
}

export interface StaffRepository {
  findByLogin(login: string): Promise<StaffUserRecord | null>;
  createUser(input: CreateStaffUserInput): Promise<StaffUserRecord>;
  createSession(input: {
    readonly staffUserId: number;
    readonly tokenHash: string;
    readonly expiresAt: Date;
    readonly createdAt: Date;
  }): Promise<StaffSessionLookup>;
  findActiveSession(tokenHash: string, now: Date): Promise<StaffSessionLookup | null>;
  revokeSession(tokenHash: string, now: Date): Promise<void>;
  recordAudit(input: {
    readonly staffUserId: number | null;
    readonly action: StaffAuditAction;
    readonly orderId?: number;
    readonly requestId?: string;
    readonly createdAt: Date;
  }): Promise<void>;
  cleanupExpiredSessions(now: Date): Promise<void>;
}

export class StaffUserExistsError extends Error {
  constructor() {
    super("Staff login already exists");
    this.name = "StaffUserExistsError";
  }
}

function lookup(
  user: StaffUserRecord,
  session: StaffSessionRecord
): StaffSessionLookup {
  return { user, session };
}

export function createStaffRepository(client: DatabaseClient): StaffRepository {
  return {
    async findByLogin(login) {
      const [user] = await client.db
        .select()
        .from(staffUsers)
        .where(eq(staffUsers.login, login))
        .limit(1);
      return user ?? null;
    },

    async createUser(input) {
      const [user] = await client.db
        .insert(staffUsers)
        .values({
          login: input.login,
          displayName: input.displayName,
          passwordHash: input.passwordHash,
          isActive: true,
          createdAt: input.createdAt,
          updatedAt: input.createdAt
        })
        .onConflictDoNothing({ target: staffUsers.login })
        .returning();
      if (user === undefined) throw new StaffUserExistsError();
      return user;
    },

    async createSession(input) {
      return client.db.transaction(async (tx) => {
        const [session] = await tx
          .insert(staffSessions)
          .values({
            staffUserId: input.staffUserId,
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
            createdAt: input.createdAt,
            updatedAt: input.createdAt
          })
          .returning();
        if (session === undefined) throw new Error("Staff session insert returned no row");

        const [user] = await tx
          .select()
          .from(staffUsers)
          .where(eq(staffUsers.id, input.staffUserId))
          .limit(1);
        if (user === undefined) throw new Error("Staff user disappeared during session creation");
        return lookup(user, session);
      });
    },

    async findActiveSession(tokenHash, now) {
      const [row] = await client.db
        .select({ user: staffUsers, session: staffSessions })
        .from(staffSessions)
        .innerJoin(staffUsers, eq(staffUsers.id, staffSessions.staffUserId))
        .where(
          and(
            eq(staffSessions.tokenHash, tokenHash),
            eq(staffUsers.isActive, true),
            isNull(staffSessions.revokedAt),
            gt(staffSessions.expiresAt, now)
          )
        )
        .limit(1);
      if (row === undefined || row.session.revokedAt !== null) return null;

      const [updated] = await client.db
        .update(staffSessions)
        .set({ lastUsedAt: now, updatedAt: now })
        .where(eq(staffSessions.id, row.session.id))
        .returning();
      return lookup(
        row.user,
        updated ?? { ...row.session, lastUsedAt: now, updatedAt: now }
      );
    },

    async revokeSession(tokenHash, now) {
      await client.db
        .update(staffSessions)
        .set({ revokedAt: now, updatedAt: now })
        .where(and(eq(staffSessions.tokenHash, tokenHash), isNull(staffSessions.revokedAt)));
    },

    async recordAudit(input) {
      await client.db.insert(staffAuditLog).values({
        staffUserId: input.staffUserId,
        action: input.action,
        orderId: input.orderId,
        requestId: input.requestId,
        createdAt: input.createdAt
      });
    },

    async cleanupExpiredSessions(now) {
      await client.db
        .delete(staffSessions)
        .where(or(isNotNull(staffSessions.revokedAt), lte(staffSessions.expiresAt, now)));
    }
  };
}
