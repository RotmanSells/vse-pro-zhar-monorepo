import { describe, expect, it } from "vitest";

import type { AuthClient } from "../src/auth-client.js";
import { AuthClientError } from "../src/auth-client.js";
import { createAuthRequestController } from "../src/auth-controller.js";

const profile = { phone: "+79991234567", name: "Анна", birthDate: null } as const;

describe("auth request controller", () => {
  it("turns an invalid session into anonymous without blocking catalog state", async () => {
    const states: string[] = [];
    const client: AuthClient = {
      identify: async () => ({ customer: profile, session: { token: null, expiresAt: "2026-09-01T10:00:00.000Z" } }),
      me: async () => {
        throw new AuthClientError("authentication", "safe", "AUTHENTICATION_ERROR", 401);
      },
      logout: async () => ({ loggedOut: true })
    };
    const controller = createAuthRequestController(client, (state) => states.push(state.status));
    controller.hydrate();
    await Promise.resolve();
    await Promise.resolve();
    expect(states).toEqual(["loading", "anonymous"]);
    controller.dispose();
  });

  it("does not publish a response after dispose", async () => {
    let resolveMe: ((value: { customer: typeof profile; session: { expiresAt: string } }) => void) | undefined;
    const states: string[] = [];
    const client: AuthClient = {
      identify: async () => ({ customer: profile, session: { token: null, expiresAt: "2026-09-01T10:00:00.000Z" } }),
      me: () => new Promise((resolve) => { resolveMe = resolve; }),
      logout: async () => ({ loggedOut: true })
    };
    const controller = createAuthRequestController(client, (state) => states.push(state.status));
    controller.hydrate();
    controller.dispose();
    resolveMe?.({ customer: profile, session: { expiresAt: "2026-09-01T10:00:00.000Z" } });
    await Promise.resolve();
    expect(states).toEqual(["loading"]);
  });

});
