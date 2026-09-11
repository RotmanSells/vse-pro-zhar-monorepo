import { describe, expect, it } from "vitest";

import type { AdminCustomersResponse } from "@vse-pro-zhar/contracts";

import { createAdminCustomersRequestController } from "../src/admin-customers-controller.js";
import type { AdminCustomersClient } from "../src/admin-customers-client.js";

const response: AdminCustomersResponse = {
  status: "confirmed",
  customers: [{ id: 1, name: "Анна", phoneMasked: "•••• 1234", orderCount: 2, spentMinor: 100_000, coalBalance: 10, xp: 100, rank: "spark", lastActivityAt: "2026-09-01T10:00:00.000Z" }],
  pagination: { limit: 25, offset: 0, total: 1, hasNext: false }
};

describe("admin customers controller", () => {
  it("keeps the newest search result and aborts the previous request", async () => {
    const requests: Array<{ readonly signal: AbortSignal | undefined; readonly resolve: (value: AdminCustomersResponse) => void }> = [];
    const client: AdminCustomersClient = {
      list: (_query, { signal } = {}) => new Promise<AdminCustomersResponse>((resolve) => { requests.push({ signal, resolve }); })
    };
    const states: string[] = [];
    const controller = createAdminCustomersRequestController(client, (state) => states.push(state.status));
    controller.load({ limit: 25, offset: 0, search: "А" });
    controller.load({ limit: 25, offset: 0, search: "Ан" });
    requests[1]?.resolve(response);
    await Promise.resolve();
    expect(requests[0]?.signal?.aborted).toBe(true);
    expect(states).toEqual(["loading", "loading", "success"]);
    controller.dispose();
  });
});
