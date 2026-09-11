import { describe, expect, it } from "vitest";

import type { AdminQuestsResponse } from "@vse-pro-zhar/contracts";

import { createAdminLoyaltyClient } from "../src/admin-loyalty-client.js";

const response: AdminQuestsResponse = {
  status: "confirmed",
  quests: [{ id: 1, code: "first_order", title: "Первый жар", description: "", goal: 1, unit: "order", rewardType: "xp", rewardValue: 100, isVisible: true, activeFrom: null, activeUntil: null, sortOrder: 0, version: 2 }]
};

const wheelResponse = {
  status: "confirmed" as const,
  settings: { id: 1, enabled: true, eligibility: "completed_paid_order" as const, minOrderAmountMinor: 150_000, currency: "RUB" as const, cooldownSeconds: 86_400, maxSpins: 1, limitPeriodSeconds: 86_400, activeFrom: null, activeUntil: null, version: 1, updatedAt: "2026-09-01T00:00:00.000Z" },
  prizes: [{ id: 1, code: "no_prize", name: "Искра рядом", description: "", type: "no_prize" as const, value: 0, weight: 100, isVisible: true, activeFrom: null, activeUntil: null, sortOrder: 0, version: 1 }]
};

describe("Admin loyalty quest client", () => {
  it("sends protected quest create/update requests with idempotency and version boundaries", async () => {
    const requests: Array<{ readonly url: string; readonly method: string; readonly headers: Headers; readonly body: string | undefined }> = [];
    const client = createAdminLoyaltyClient({ apiUrl: "http://127.0.0.1:3000", fetchImpl: async (input, init) => {
      requests.push({ url: input, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: typeof init?.body === "string" ? init.body : undefined });
      return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
    } });

    await client.getQuests();
    await client.createQuest({ code: "spring_fire", title: "Весенний жар", description: "", goal: 3, unit: "order", rewardType: "coal", rewardValue: 20, isVisible: true, activeFrom: null, activeUntil: null, sortOrder: 100 }, { idempotencyKey: "quest-create-1" });
    await client.updateQuest(1, { expectedVersion: 2, title: "Новый заголовок" });

    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["GET", "http://127.0.0.1:3000/admin/loyalty/quests"],
      ["POST", "http://127.0.0.1:3000/admin/loyalty/quests"],
      ["PATCH", "http://127.0.0.1:3000/admin/loyalty/quests/1"]
    ]);
    expect(requests[1]?.headers.get("Idempotency-Key")).toBe("quest-create-1");
    expect((JSON.parse(requests[1]?.body ?? "{}") as { code?: string }).code).toBe("spring_fire");
    expect((JSON.parse(requests[2]?.body ?? "{}") as { expectedVersion?: number }).expectedVersion).toBe(2);
  });

  it("maps stale or duplicate quest mutations to a visible conflict", async () => {
    const client = createAdminLoyaltyClient({ apiUrl: "http://127.0.0.1:3000", fetchImpl: async () => new Response(JSON.stringify({ error: { code: "LOYALTY_QUEST_CONFLICT", message: "safe", requestId: "req-1" } }), { status: 409 }) });
    await expect(client.updateQuest(1, { expectedVersion: 1, isVisible: false })).rejects.toMatchObject({ kind: "conflict", code: "LOYALTY_QUEST_CONFLICT" });
  });

  it("sends the full versioned wheel settings mutation with an idempotency key", async () => {
    let request: { readonly headers: Headers; readonly body: string } | undefined;
    const client = createAdminLoyaltyClient({ apiUrl: "http://127.0.0.1:3000", fetchImpl: async (_input, init) => {
      request = { headers: new Headers(init?.headers), body: String(init?.body) };
      return new Response(JSON.stringify(wheelResponse), { status: 200, headers: { "content-type": "application/json" } });
    } });
    await client.updateWheelSettings({ expectedVersion: 1, enabled: false, minOrderAmountMinor: 200_000, cooldownSeconds: 3_600, maxSpins: 2, limitPeriodSeconds: 172_800, activeFrom: null, activeUntil: null }, { idempotencyKey: "wheel-settings-1" });
    expect(request?.headers.get("Idempotency-Key")).toBe("wheel-settings-1");
    expect(JSON.parse(request?.body ?? "{}") as { expectedVersion?: number; maxSpins?: number }).toMatchObject({ expectedVersion: 1, maxSpins: 2 });
  });

  it("maps wheel settings conflicts without exposing backend details", async () => {
    const client = createAdminLoyaltyClient({ apiUrl: "http://127.0.0.1:3000", fetchImpl: async () => new Response(JSON.stringify({ error: { code: "LOYALTY_WHEEL_SETTINGS_CONFLICT", message: "safe", requestId: "req-1" } }), { status: 409 }) });
    await expect(client.updateWheelSettings({ expectedVersion: 1, enabled: false }, { idempotencyKey: "wheel-settings-1" })).rejects.toMatchObject({ kind: "conflict", code: "LOYALTY_WHEEL_SETTINGS_CONFLICT" });
  });

  it("sends the expected prize version and idempotency key for a Wheel prize update", async () => {
    let request: { readonly headers: Headers; readonly body: string } | undefined;
    const client = createAdminLoyaltyClient({ apiUrl: "http://127.0.0.1:3000", fetchImpl: async (_input, init) => {
      request = { headers: new Headers(init?.headers), body: String(init?.body) };
      return new Response(JSON.stringify(wheelResponse), { status: 200, headers: { "content-type": "application/json" } });
    } });
    await client.updateWheelPrize(1, { expectedVersion: 1, type: "xp", value: 111, weight: 20 }, { idempotencyKey: "wheel-prize-1" });
    expect(request?.headers.get("Idempotency-Key")).toBe("wheel-prize-1");
    expect(JSON.parse(request?.body ?? "{}") as { expectedVersion?: number; type?: string; value?: number }).toMatchObject({ expectedVersion: 1, type: "xp", value: 111 });
  });
});
