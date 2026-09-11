import { describe, expect, it } from "vitest";

import {
  createIikoAvailabilityProvider,
  type IikoAvailabilityProviderOptions
} from "../src/iiko/availability.js";
import {
  IikoAvailabilityConfigurationError,
  loadIikoAvailabilityConfig
} from "../src/iiko/config.js";

const organizationId = "3e41b6b4-9f43-4f65-8e5d-0c1c4c2f9a10";
const terminalGroupId = "4c6d5f37-bda2-4ed1-b48e-1b4fa7028f21";
const iikoProductId = "10000000-0000-4000-8000-000000000001";
const appId = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-09-01T10:00:00.000Z");

function environment(
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    IIKO_BASE_URL: "http://127.0.0.1:4010",
    IIKO_API_KEY: "vpzh-test-api-key",
    IIKO_APP_ID: appId,
    IIKO_CLIENT_SECRET: "vpzh-test-client-secret",
    IIKO_ORGANIZATION_ID: organizationId,
    IIKO_TERMINAL_GROUP_ID: terminalGroupId,
    IIKO_PRODUCT_MAPPING: JSON.stringify({ "1": iikoProductId }),
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function createFetch(
  stopListItems: readonly unknown[] = []
): {
  readonly fetchImpl: NonNullable<IikoAvailabilityProviderOptions["fetchImpl"]>;
  readonly calls: readonly { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];

  const fetchImpl: NonNullable<
    IikoAvailabilityProviderOptions["fetchImpl"]
  > = async (url, init = {}) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;

    if (path === "/api/v2/access_token") {
      return jsonResponse({ correlationId: "token-correlation", token: "token" });
    }
    if (path === "/api/1/terminal_groups/is_alive") {
      return jsonResponse({
        correlationId: "alive-correlation",
        isAliveStatus: [
          { isAlive: true, terminalGroupId, organizationId }
        ]
      });
    }
    if (path === "/api/1/stop_lists") {
      return jsonResponse({
        correlationId: "stop-list-correlation",
        terminalGroupStopLists: [
          { organizationId, items: [{ terminalGroupId, items: stopListItems }] }
        ]
      });
    }

    return jsonResponse({ error: "unexpected endpoint" }, 404);
  };

  return { fetchImpl, calls };
}

describe("iiko availability configuration", () => {
  it("keeps the adapter disabled when no iiko configuration is present", () => {
    expect(loadIikoAvailabilityConfig({})).toBeNull();
  });

  it("requires a complete explicit mapping configuration", () => {
    expect(() =>
      loadIikoAvailabilityConfig(environment({ IIKO_PRODUCT_MAPPING: "{}" }))
    ).toThrow(IikoAvailabilityConfigurationError);
    expect(() =>
      loadIikoAvailabilityConfig(
        environment({ IIKO_BASE_URL: "http://127.0.0.1:4010/iiko" })
      )
    ).toThrow(IikoAvailabilityConfigurationError);
  });
});

describe("iiko availability provider", () => {
  it("uses the simulator read contract and maps available products", async () => {
    const config = loadIikoAvailabilityConfig(environment());
    if (config === null) throw new Error("Expected iiko configuration");
    const { fetchImpl, calls } = createFetch();
    const provider = createIikoAvailabilityProvider(config, {
      fetchImpl,
      now: () => now
    });

    await expect(provider.getProductAvailability([1])).resolves.toEqual([
      {
        productId: 1,
        iikoProductId,
        status: "available",
        checkedAt: now.toISOString()
      }
    ]);

    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/api/v2/access_token",
      "/api/1/terminal_groups/is_alive",
      "/api/1/stop_lists"
    ]);
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      organizationIds: [organizationId],
      terminalGroupIds: [terminalGroupId]
    });
    expect(JSON.parse(String(calls[2]?.init.body))).toEqual({
      organizationIds: [organizationId],
      terminalGroupsIds: [terminalGroupId]
    });
    expect(new Headers(calls[1]?.init.headers).get("authorization")).toBe(
      "Bearer token"
    );
  });

  it("fails closed when a mapped product is stopped", async () => {
    const config = loadIikoAvailabilityConfig(environment());
    if (config === null) throw new Error("Expected iiko configuration");
    const stoppedItem = {
      productId: iikoProductId,
      sizeId: null,
      balance: 0,
      sku: null,
      dateAdd: null
    };
    const { fetchImpl } = createFetch([stoppedItem]);
    const provider = createIikoAvailabilityProvider(config, {
      fetchImpl,
      now: () => now
    });

    await expect(provider.getProductAvailability([1])).resolves.toMatchObject([
      { productId: 1, iikoProductId, status: "unavailable" }
    ]);
  });

  it("does not call iiko when a product mapping is absent", async () => {
    const config = loadIikoAvailabilityConfig(environment());
    if (config === null) throw new Error("Expected iiko configuration");
    const { fetchImpl, calls } = createFetch();
    const provider = createIikoAvailabilityProvider(config, { fetchImpl });

    await expect(provider.getProductAvailability([999])).resolves.toEqual([
      {
        productId: 999,
        iikoProductId: null,
        status: "unknown",
        checkedAt: null
      }
    ]);
    expect(calls).toHaveLength(0);
  });

  it("rejects malformed upstream data instead of treating it as available", async () => {
    const config = loadIikoAvailabilityConfig(environment());
    if (config === null) throw new Error("Expected iiko configuration");
    const fetchImpl: NonNullable<
      IikoAvailabilityProviderOptions["fetchImpl"]
    > = async (url, init = {}) => {
      void init;
      const path = new URL(url).pathname;
      if (path === "/api/v2/access_token") {
        return jsonResponse({ correlationId: "token-correlation", token: "token" });
      }
      if (path === "/api/1/terminal_groups/is_alive") {
        return jsonResponse({ correlationId: "alive-correlation" });
      }
      return jsonResponse({});
    };
    const provider = createIikoAvailabilityProvider(config, { fetchImpl });

    await expect(provider.getProductAvailability([1])).rejects.toThrow(
      "iiko availability request failed"
    );
  });
});
