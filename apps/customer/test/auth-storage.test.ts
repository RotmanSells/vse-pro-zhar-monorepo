import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

import { createNativeAuthTransport } from "../src/auth/storage";

describe("Customer native auth storage adapter", () => {
  it("stores opaque session tokens outside cart persistence", async () => {
    let value: string | null = null;
    const transport = createNativeAuthTransport({
      getItemAsync: async () => value,
      setItemAsync: async (_key, next) => {
        value = next;
      },
      deleteItemAsync: async () => {
        value = null;
      }
    });

    await transport.storeSession("s".repeat(43), "2026-09-01T10:00:00.000Z");
    expect(await transport.getRequestHeaders()).toEqual({
      Authorization: `Bearer ${"s".repeat(43)}`
    });
    await transport.clearSession();
    expect(await transport.getRequestHeaders()).toEqual({});
  });

  it("keeps Expo Go development usable when SecureStore is unavailable", async () => {
    const transport = createNativeAuthTransport({
      getItemAsync: async () => { throw new Error("native module unavailable"); },
      setItemAsync: async () => { throw new Error("native module unavailable"); },
      deleteItemAsync: async () => { throw new Error("native module unavailable"); }
    });
    await transport.storeSession("d".repeat(43), "2026-09-01T10:00:00.000Z");
    expect(await transport.getRequestHeaders()).toEqual({ Authorization: `Bearer ${"d".repeat(43)}` });
    await transport.clearSession();
    expect(await transport.getRequestHeaders()).toEqual({});
  });
});
