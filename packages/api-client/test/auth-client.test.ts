import { describe, expect, it, vi } from "vitest";

import type { AuthSessionTransport } from "../src/auth-client.js";
import { AuthClientError, createAuthClient } from "../src/auth-client.js";

function transport(): AuthSessionTransport & { readonly stored: string[] } {
  const stored: string[] = [];
  return {
    mode: "bearer",
    stored,
    getRequestHeaders: async () => ({ Authorization: "Bearer old-token" }),
    storeSession: async (token) => {
      stored.push(token);
    },
    clearSession: async () => undefined
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("shared auth client", () => {
  it("sends bearer transport and stores only the server token", async () => {
    const session = transport();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "X-Session-Transport": "bearer" });
      return response({
        customer: { phone: "+79991234567", name: "Анна", birthDate: null },
        session: { token: "n".repeat(43), expiresAt: "2026-09-01T10:00:00.000Z" }
      }, 201);
    });
    const client = createAuthClient({ apiUrl: "http://127.0.0.1:3000", transport: session, fetchImpl });

    await expect(client.identify({ phone: "+79991234567", name: "Анна" })).resolves.toMatchObject({
      customer: { phone: "+79991234567" }
    });
    expect(session.stored).toEqual(["n".repeat(43)]);
  });

  it("maps safe HTTP errors and aborts", async () => {
    const session = transport();
    const client = createAuthClient({
      apiUrl: "http://127.0.0.1:3000",
      transport: session,
      fetchImpl: async () => response({ error: { code: "RATE_LIMITED", message: "safe", requestId: "r" } }, 429)
    });
    await expect(client.me()).rejects.toMatchObject({ kind: "rate_limited" });
    const controller = new AbortController();
    controller.abort();
    await expect(client.me({ signal: controller.signal })).rejects.toBeInstanceOf(AuthClientError);
  });

  it("does not let a slower identify response overwrite a newer native session", async () => {
    const pending: Array<(value: Response) => void> = [];
    const session = transport();
    const client = createAuthClient({
      apiUrl: "http://127.0.0.1:3000",
      transport: session,
      fetchImpl: async () => new Promise<Response>((resolve) => pending.push(resolve))
    });
    const first = client.identify({ phone: "+79991234567", name: "Первый" });
    const second = client.identify({ phone: "+79991234568", name: "Второй" });
    await Promise.resolve();
    await Promise.resolve();

    pending[1]?.(response({
      customer: { phone: "+79991234568", name: "Второй", birthDate: null },
      session: { token: "b".repeat(43), expiresAt: "2026-09-01T11:00:00.000Z" }
    }, 201));
    await second;
    pending[0]?.(response({
      customer: { phone: "+79991234567", name: "Первый", birthDate: null },
      session: { token: "a".repeat(43), expiresAt: "2026-09-01T10:00:00.000Z" }
    }, 201));
    await first;

    expect(session.stored).toEqual(["b".repeat(43)]);
  });

});
