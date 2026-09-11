import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ApiErrorSchema,
  CustomerIdentifyResponseSchema,
  CustomerMeResponseSchema
} from "@vse-pro-zhar/contracts";
import type {
  CustomerRecord,
  CustomerRepository,
  CustomerSessionLookup,
  CustomerSessionRecord,
  CustomerUpsertInput
} from "@vse-pro-zhar/database";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";

function createMemoryCustomerRepository(): CustomerRepository & {
  readonly customers: CustomerRecord[];
  readonly sessions: CustomerSessionRecord[];
} {
  const customers: CustomerRecord[] = [];
  const sessions: CustomerSessionRecord[] = [];
  let nextCustomerId = 1;
  let nextSessionId = 1;

  const lookup = (session: CustomerSessionRecord): CustomerSessionLookup | null => {
    const customer = customers.find((candidate) => candidate.id === session.customerId);
    return customer === undefined ? null : { customer, session };
  };

  return {
    customers,
    sessions,
    async upsertCustomerAndCreateSession(
      input: CustomerUpsertInput,
      session,
      now
    ): Promise<CustomerSessionLookup> {
      const existing = customers.find((candidate) => candidate.phone === input.phone);
      const customer = existing ?? {
        id: nextCustomerId++,
        phone: input.phone,
        name: input.name || "Гость",
        birthDate: input.birthDate,
        createdAt: now,
        updatedAt: now
      };
      if (existing === undefined) customers.push(customer);
      else Object.assign(existing, { ...(input.name === "" ? {} : { name: input.name }), birthDate: input.birthDate, updatedAt: now });
      const createdSession: CustomerSessionRecord = {
        id: nextSessionId++,
        customerId: customer.id,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now
      };
      sessions.push(createdSession);
      return { customer, session: createdSession };
    },
    async findActiveSession(tokenHash, now) {
      const session = sessions.find(
        (candidate) =>
          candidate.tokenHash === tokenHash &&
          candidate.revokedAt === null &&
          candidate.expiresAt > now
      );
      if (session === undefined) return null;
      session.lastUsedAt = now;
      return lookup(session);
    },
    async revokeSession(tokenHash, now) {
      const session = sessions.find((candidate) => candidate.tokenHash === tokenHash);
      if (session !== undefined && session.revokedAt === null) session.revokedAt = now;
    },
    async cleanupExpiredSessions(now) {
      for (let index = sessions.length - 1; index >= 0; index -= 1) {
        const session = sessions[index];
        if (session !== undefined && (session.revokedAt !== null || session.expiresAt <= now)) {
          sessions.splice(index, 1);
        }
      }
    }
  };
}

describe("customer auth API", () => {
  let app: FastifyInstance;
  let repository: ReturnType<typeof createMemoryCustomerRepository>;
  const now = new Date("2026-09-01T10:00:00.000Z");

  beforeEach(() => {
    repository = createMemoryCustomerRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      now: () => now,
      customerRepository: repository
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("identifies through a cookie, restores the profile and logs out idempotently", async () => {
    const identified = await app.inject({
      method: "POST",
      url: "/auth/identify",
      payload: { phone: "8 (999) 123-45-67", name: " Анна ", birthDate: "1990-02-28" }
    });
    expect(identified.statusCode).toBe(201);
    const identifiedBody = CustomerIdentifyResponseSchema.parse(identified.json());
    expect(identifiedBody).toMatchObject({
      customer: { phone: "+79991234567", name: "Анна", birthDate: "1990-02-28" },
      session: { token: null }
    });
    expect(identified.headers["set-cookie"]).toContain("HttpOnly");
    expect(repository.customers).toHaveLength(1);

    const cookie = String(identified.headers["set-cookie"]).split(";")[0];
    const me = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(CustomerMeResponseSchema.parse(me.json()).customer.phone).toBe("+79991234567");

    const loggedOut = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie } });
    expect(loggedOut.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/auth/me", headers: { cookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/auth/logout" })).statusCode).toBe(200);
  });

  it("returns a bearer token for native transport and upserts by normalized phone", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/auth/identify",
      headers: { "x-session-transport": "bearer" },
      payload: { phone: "+7 999 123 45 67", name: "Анна" }
    });
    const token = CustomerIdentifyResponseSchema.parse(first.json()).session.token;
    expect(token).not.toBeNull();

    const second = await app.inject({
      method: "POST",
      url: "/auth/identify",
      headers: { "x-session-transport": "bearer" },
      payload: { phone: "89991234567", name: "Анна 2", birthDate: null }
    });
    expect(second.statusCode).toBe(201);
    expect(repository.customers).toHaveLength(1);
    expect(repository.customers[0]?.name).toBe("Анна 2");
    expect(repository.sessions[0]?.tokenHash).not.toContain(token);

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${token ?? ""}` }
    });
    expect(me.statusCode).toBe(200);
  });

  it("allows phone-only identification without sending an SMS code", async () => {
    const identified = await app.inject({
      method: "POST",
      url: "/auth/identify",
      headers: { "x-session-transport": "bearer" },
      payload: { phone: "+79991234567" }
    });
    expect(identified.statusCode).toBe(201);
    expect(CustomerIdentifyResponseSchema.parse(identified.json()).customer.name).toBe("Гость");
    expect((await app.inject({ method: "POST", url: "/auth/sms/request", payload: { phone: "+79991234567", purpose: "login" } })).statusCode).toBe(404);
  });

  it("rejects malformed input and untrusted browser origins safely", async () => {
    const invalid = await app.inject({
      method: "POST",
      url: "/auth/identify",
      payload: { phone: "not a phone", name: "" }
    });
    expect(invalid.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(invalid.json()).error.code).toBe("VALIDATION_ERROR");

    const forbidden = await app.inject({
      method: "POST",
      url: "/auth/identify",
      headers: { origin: "https://malicious.example" },
      payload: { phone: "+79991234567", name: "Анна" }
    });
    expect(forbidden.statusCode).toBe(403);
    expect(repository.customers).toHaveLength(0);
    expect(JSON.stringify(forbidden.json())).not.toContain("malicious");
  });

  it("limits repeated identify attempts in the application process", async () => {
    const responses = await Promise.all(
      Array.from({ length: 21 }, (_, index) =>
        app.inject({
          method: "POST",
          url: "/auth/identify",
          payload: { phone: `+7999123${String(index).padStart(4, "0")}`, name: "Rate test" }
        })
      )
    );
    expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(1);
  });

});
