import { and, eq, lt, or, sql } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";
import {
  customerSessions,
  customers,
  type CustomerRecord,
  type CustomerSessionRecord
} from "./schema.js";

export interface CustomerUpsertInput {
  readonly phone: string;
  readonly name: string;
  readonly birthDate: string | null;
  readonly preserveBirthDate?: boolean;
}

export interface CustomerSessionLookup {
  readonly session: CustomerSessionRecord;
  readonly customer: CustomerRecord;
}

export interface CustomerRepository {
  upsertCustomerAndCreateSession(
    input: CustomerUpsertInput,
    session: { readonly tokenHash: string; readonly expiresAt: Date },
    now: Date
  ): Promise<CustomerSessionLookup>;
  findActiveSession(
    tokenHash: string,
    now: Date
  ): Promise<CustomerSessionLookup | null>;
  revokeSession(tokenHash: string, now: Date): Promise<void>;
  cleanupExpiredSessions(now: Date): Promise<void>;
}

export function createCustomerRepository(
  client: DatabaseClient
): CustomerRepository {
  return {
    async upsertCustomerAndCreateSession(input, session, now) {
      const normalizedName = input.name.trim();
      return client.db.transaction(async (tx) => {
        const [customer] = await tx
          .insert(customers)
          .values({
            phone: input.phone,
            name: normalizedName === "" ? "Гость" : normalizedName,
            birthDate: input.birthDate ?? null,
            createdAt: now,
            updatedAt: now
          })
          .onConflictDoUpdate({
            target: customers.phone,
            set: {
              ...(normalizedName === "" ? {} : { name: normalizedName }),
              ...(input.preserveBirthDate === true ? {} : { birthDate: input.birthDate }),
              updatedAt: now
            }
          })
          .returning();

        if (customer === undefined) {
          throw new Error("Customer upsert returned no row");
        }

        const [createdSession] = await tx
          .insert(customerSessions)
          .values({
            customerId: customer.id,
            tokenHash: session.tokenHash,
            expiresAt: session.expiresAt,
            createdAt: now,
            updatedAt: now
          })
          .returning();

        if (createdSession === undefined) {
          throw new Error("Customer session insert returned no row");
        }

        return { customer, session: createdSession };
      });
    },

    async findActiveSession(tokenHash, now) {
      const rows = await client.db
        .select({ session: customerSessions, customer: customers })
        .from(customerSessions)
        .innerJoin(customers, eq(customerSessions.customerId, customers.id))
        .where(
          and(
            eq(customerSessions.tokenHash, tokenHash),
            sql`${customerSessions.revokedAt} IS NULL`,
            sql`${customerSessions.expiresAt} > ${now}`
          )
        )
        .limit(1);

      const result = rows[0];
      if (result === undefined) {
        return null;
      }

      await client.db
        .update(customerSessions)
        .set({ lastUsedAt: now, updatedAt: now })
        .where(eq(customerSessions.id, result.session.id));

      return result;
    },

    async revokeSession(tokenHash, now) {
      await client.db
        .update(customerSessions)
        .set({ revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(customerSessions.tokenHash, tokenHash),
            sql`${customerSessions.revokedAt} IS NULL`
          )
        );
    },

    async cleanupExpiredSessions(now) {
      await client.db
        .delete(customerSessions)
        .where(or(lt(customerSessions.expiresAt, now), sql`${customerSessions.revokedAt} IS NOT NULL`));
    }
  };
}
