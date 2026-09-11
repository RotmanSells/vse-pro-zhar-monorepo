import { describe, expect, it, vi } from "vitest";

import { createNotificationsClient } from "../src/notifications-client.js";
import type { AuthSessionTransport } from "../src/auth-client.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("shared notifications client", () => {
  it("sends authenticated native registration and parses the server response", async () => {
    const transport: AuthSessionTransport = {
      mode: "bearer",
      getRequestHeaders: async () => ({ Authorization: "Bearer session-token" }),
      storeSession: async () => undefined,
      clearSession: async () => undefined
    };
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://127.0.0.1:3000/notifications/devices");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer session-token", "X-Session-Transport": "bearer" });
      return response({ status: "confirmed", device: { id: 7, provider: "expo", platform: "android", token: "ExponentPushToken[test]", enabled: true, lastSeenAt: "2026-09-09T10:00:00.000Z" } }, 201);
    });
    const client = createNotificationsClient({ apiUrl: "http://127.0.0.1:3000", transport, fetchImpl });
    await expect(client.registerDevice({ idempotencyKey: "push-test", provider: "expo", platform: "android", token: "ExponentPushToken[test]" })).resolves.toMatchObject({ device: { id: 7, platform: "android" } });
  });
});
