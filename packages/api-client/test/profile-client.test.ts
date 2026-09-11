import { describe, expect, it, vi } from "vitest";

import type { AuthSessionTransport, FetchImplementation } from "../src/index.js";
import { ProfileClientError, createProfileClient } from "../src/index.js";

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

function profileResponse(): unknown {
  return {
    customer: { phone: "+79991234567", name: "Анна", birthDate: null },
    stats: {
      orderCount: 1,
      favoriteProduct: "Шашлык",
      nextMilestone: { label: "До ранга «Жар»", remaining: 550, unit: "xp", source: "loyalty_rank" }
    },
    loyalty: {
      status: "confirmed",
      summary: {
        xp: 450,
        coalBalance: 4,
        rank: { code: "spark", name: "Искра", thresholdXp: 0, benefits: [] },
        nextRank: { code: "heat", name: "Жар", thresholdXp: 1000, benefits: [] },
        xpIntoCurrentRank: 450,
        xpToNextRank: 550,
        progressPercent: 45,
        isMaxRank: false,
        version: 1,
        updatedAt: "2026-09-04T10:00:00.000Z"
      }
    },
    settings: {
      pushNotifications: { status: "unavailable", reason: "native_push_contract_pending" },
      emailSubscription: { status: "unavailable", reason: "email_consent_contract_pending" },
      darkTheme: { status: "unavailable", reason: "theme_contract_pending" }
    },
    recentOrders: []
  };
}

describe("shared profile client", () => {
  it("sends authenticated GET /profile and runtime-validates the aggregate", async () => {
    const fetchImpl: FetchImplementation = vi.fn(async (url, init) => {
      expect(url).toBe("http://127.0.0.1:3000/profile");
      expect(init?.method).toBe("GET");
      expect(init?.headers).toEqual({ Accept: "application/json", Authorization: "Bearer customer-token", "X-Session-Transport": "bearer" });
      return response(profileResponse());
    });
    const client = createProfileClient({ apiUrl: "http://127.0.0.1:3000", transport: transport(), fetchImpl });
    await expect(client.getProfile()).resolves.toMatchObject({ stats: { favoriteProduct: "Шашлык" } });
  });

  it("rejects malformed data and maps auth/unavailable responses", async () => {
    const malformed = createProfileClient({ apiUrl: "http://127.0.0.1:3000", transport: transport(), fetchImpl: async () => response({ recentOrders: [] }) });
    await expect(malformed.getProfile()).rejects.toMatchObject({ kind: "invalid_response" });

    const unauthorized = createProfileClient({ apiUrl: "http://127.0.0.1:3000", transport: transport(), fetchImpl: async () => response({ error: { code: "AUTHENTICATION_ERROR", message: "safe", requestId: "request-1" } }, 401) });
    await expect(unauthorized.getProfile()).rejects.toMatchObject({ kind: "authentication", status: 401 });

    const unavailable = createProfileClient({ apiUrl: "http://127.0.0.1:3000", transport: transport(), fetchImpl: async () => response({ error: { code: "SERVICE_UNAVAILABLE", message: "safe", requestId: "request-2" } }, 503) });
    await expect(unavailable.getProfile()).rejects.toMatchObject({ kind: "unavailable", status: 503 });
  });

  it("aborts an in-flight request", async () => {
    let resolveRequest: ((value: Response) => void) | undefined;
    const client = createProfileClient({
      apiUrl: "http://127.0.0.1:3000",
      transport: transport(),
      fetchImpl: async () => new Promise<Response>((resolve) => { resolveRequest = resolve; })
    });
    const abortController = new AbortController();
    const pending = client.getProfile({ signal: abortController.signal });
    abortController.abort();
    await expect(pending).rejects.toBeInstanceOf(ProfileClientError);
    resolveRequest?.(response(profileResponse()));
  });
});
