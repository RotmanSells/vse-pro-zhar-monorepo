import { describe, expect, it, vi } from "vitest";

import type { AuthSessionTransport } from "../src/auth-client.js";
import { createLoyaltyClient } from "../src/loyalty-client.js";

const transport: AuthSessionTransport = {
  mode: "bearer",
  getRequestHeaders: async () => ({ Authorization: "Bearer customer-token" }),
  storeSession: async () => undefined,
  clearSession: async () => undefined
};

const settings = { id: 1, enabled: true, eligibility: "completed_paid_order" as const, minOrderAmountMinor: 150_000, currency: "RUB" as const, cooldownSeconds: 86_400, maxSpins: 1, limitPeriodSeconds: 86_400, activeFrom: "2026-09-01T00:00:00.000Z", activeUntil: null, version: 1, updatedAt: "2026-09-01T00:00:00.000Z" };
const prizes = [{ id: 1, code: "no_prize", name: "Искра рядом", description: "", type: "no_prize" as const, value: 0, sortOrder: 0 }];

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("M14 shared loyalty client", () => {
  it("validates wheel/quest reads and sends only order id plus idempotency key on spin", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/loyalty/wheel")) return response({ status: "confirmed", settings, prizes, eligibility: { canSpin: false, reason: "no_eligible_order", eligibleOrderId: null, cooldownUntil: null }, spins: [] });
      if (url.endsWith("/loyalty/quests")) return response({ status: "confirmed", quests: [] });
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ "Idempotency-Key": "m14-client-spin" });
      expect(init?.body).toBe(JSON.stringify({ orderId: 7 }));
      return response({ status: "completed", spin: { id: 1, sourceOrderId: 7, prize: prizes[0], status: "completed", rewardClaimStatus: "not_applicable", createdAt: "2026-09-06T10:00:00.000Z" } });
    });
    const client = createLoyaltyClient({ apiUrl: "http://127.0.0.1:3000", transport, fetchImpl });
    await expect(client.getWheel?.()).resolves.toMatchObject({ status: "confirmed", eligibility: { canSpin: false } });
    await expect(client.getQuests?.()).resolves.toEqual({ status: "confirmed", quests: [] });
    await expect(client.spinWheel?.({ orderId: 7 }, "m14-client-spin")).resolves.toMatchObject({ status: "completed", spin: { sourceOrderId: 7 } });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects client reward authority and invalid idempotency input", () => {
    const client = createLoyaltyClient({ apiUrl: "http://127.0.0.1:3000", transport, fetchImpl: async () => response({ status: "confirmed", settings, prizes, eligibility: { canSpin: false, reason: "no_eligible_order", eligibleOrderId: null, cooldownUntil: null }, spins: [] }) });
    expect(() => client.spinWheel?.({ orderId: 7, rewardValue: 999 } as never, "m14-spin")).toThrow();
    expect(() => client.spinWheel?.({ orderId: 7 }, "")).toThrow();
  });
});
