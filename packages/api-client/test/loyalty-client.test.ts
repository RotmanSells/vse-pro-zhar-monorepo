import { describe, expect, it, vi } from "vitest";

import type { AuthSessionTransport } from "../src/auth-client.js";
import { LoyaltyClientError, createLoyaltyClient } from "../src/loyalty-client.js";

function transport(): AuthSessionTransport {
  return {
    mode: "bearer",
    getRequestHeaders: async () => ({ Authorization: "Bearer customer-token" }),
    storeSession: async () => undefined,
    clearSession: async () => undefined
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("shared loyalty client", () => {
  it("uses Customer transport and validates a server-owned summary/ledger", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer customer-token", "X-Session-Transport": "bearer" });
      if (url.endsWith("/loyalty")) return response({ status: "confirmed", summary: { xp: 1_500, coalBalance: 15, rank: { code: "heat", name: "Жар", thresholdXp: 1_000, benefits: [] }, nextRank: { code: "flame", name: "Пламя", thresholdXp: 5_000, benefits: [] }, xpIntoCurrentRank: 500, xpToNextRank: 3_500, progressPercent: 12, isMaxRank: false, version: 1, updatedAt: "2026-09-04T10:00:00.000Z" } });
      return response({ status: "confirmed", entries: [], pagination: { limit: 50, offset: 0, total: 0, hasNext: false } });
    });
    const client = createLoyaltyClient({ apiUrl: "http://127.0.0.1:3000", transport: transport(), fetchImpl });
    await expect(client.getSummary()).resolves.toMatchObject({ status: "confirmed", summary: { xp: 1_500 } });
    await expect(client.getLedger()).resolves.toMatchObject({ status: "confirmed", entries: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a summary with an invalid rank-progress projection", async () => {
    const client = createLoyaltyClient({
      apiUrl: "http://127.0.0.1:3000",
      transport: transport(),
      fetchImpl: async () => response({
        status: "confirmed",
        summary: {
          xp: 1_500,
          coalBalance: 15,
          rank: { code: "heat", name: "Жар", thresholdXp: 1_000, benefits: [] },
          nextRank: { code: "flame", name: "Пламя", thresholdXp: 5_000, benefits: [] },
          xpIntoCurrentRank: 500,
          xpToNextRank: 3_500,
          progressPercent: 101,
          isMaxRank: false,
          version: 1,
          updatedAt: "2026-09-04T10:00:00.000Z"
        }
      })
    });
    await expect(client.getSummary()).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("keeps unavailable state explicit and rejects client-authoritative filters", async () => {
    const client = createLoyaltyClient({ apiUrl: "http://127.0.0.1:3000", transport: transport(), fetchImpl: async () => response({ status: "unavailable", reason: "reconciliation_required" }) });
    await expect(client.getSummary()).resolves.toEqual({ status: "unavailable", reason: "reconciliation_required" });
    expect(() => client.getLedger({ xp: 999 } as never)).toThrow(LoyaltyClientError);
    expect(() => createLoyaltyClient({ apiUrl: "postgresql://not-a-backend", transport: transport() })).toThrow(LoyaltyClientError);
  });
});
