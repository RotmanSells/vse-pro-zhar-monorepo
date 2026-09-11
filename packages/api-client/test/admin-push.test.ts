import { describe, expect, it, vi } from "vitest";

import { createAdminPushClient, AdminPushClientError } from "../src/admin-push-client.js";

function response(body: unknown, status = 202): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const pushResponse = {
  status: "confirmed" as const,
  customerId: 1,
  replayed: false,
  deliveries: [{ id: 7, deviceId: 10, provider: "expo" as const, status: "accepted" as const, providerTicketId: "ticket-1", errorCode: null, createdAt: "2026-09-11T10:00:00.000Z", updatedAt: "2026-09-11T10:00:00.000Z" }]
};

describe("admin push client", () => {
  it("sends the target and idempotency key through the protected API boundary", async () => {
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "Idempotency-Key": "push-1" });
      expect(JSON.parse(String(init?.body))).toEqual({ phone: "+79991234567", title: "Тест", body: "Сообщение" });
      return response(pushResponse);
    });
    const client = createAdminPushClient({ apiUrl: "http://127.0.0.1:3000", fetchImpl });
    await expect(client.send({ phone: "+79991234567", title: "Тест", body: "Сообщение" }, { idempotencyKey: "push-1" })).resolves.toEqual(pushResponse);
  });

  it("maps safe provider/API errors", async () => {
    const client = createAdminPushClient({ apiUrl: "http://127.0.0.1:3000", fetchImpl: async () => response({ error: { code: "NOTIFICATION_PUSH_CONFLICT", message: "safe", requestId: "request-1" } }, 409) });
    await expect(client.send({ phone: "+79991234567", title: "Тест", body: "Сообщение" }, { idempotencyKey: "push-1" })).rejects.toMatchObject({ kind: "conflict", code: "NOTIFICATION_PUSH_CONFLICT" });
    await expect(client.send({ phone: "", title: "Тест", body: "Сообщение" }, { idempotencyKey: "push-1" })).rejects.toBeInstanceOf(AdminPushClientError);
  });
});
