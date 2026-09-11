import { describe, expect, it } from "vitest";

import type { AdminSegmentPreviewResponse, AdminSegmentsResponse } from "@vse-pro-zhar/contracts";

import { createAdminSegmentPreviewRequestController, createAdminSegmentsListRequestController } from "../src/admin-segments-controller.js";
import { AdminSegmentsClientError, createAdminSegmentsClient } from "../src/admin-segments-client.js";
import type { AdminSegmentsClient } from "../src/admin-segments-client.js";

const definition = {
  code: "regulars" as const,
  kind: "builtin" as const,
  icon: "🔥",
  title: "Постоянные",
  description: "3 и более заказов",
  badge: { tone: "success" as const, label: "Лояльные" },
  criteria: [{ metric: "orders" as const, operator: "gte" as const, unit: "orders" as const, value: 3 }],
  count: { status: "confirmed" as const, count: 1 }
};
const builtinCodes = ["sleeping", "one_timer", "churned", "newbies", "regulars", "vip", "big_spenders", "coal_rich", "at_risk"] as const;
const listResponse: AdminSegmentsResponse = {
  status: "confirmed",
  timezone: "Europe/Moscow",
  asOf: "2026-09-01T10:00:00.000Z",
  builtins: builtinCodes.map((code, index) => ({ ...definition, code, title: code === "regulars" ? "Постоянные" : `Сегмент ${index + 1}` })),
  customSegments: [],
  customLifecycle: { status: "unavailable", reason: "owner_decision_required" }
};
const previewResponse: AdminSegmentPreviewResponse = {
  status: "confirmed",
  segment: definition,
  customers: [{ id: 1, name: "Анна", phoneMasked: "•••• 1234", orderCount: 3, spentMinor: 450_000, lastActivityAt: "2026-09-01T08:00:00.000Z" }],
  pagination: { limit: 25, offset: 0, total: 1, hasNext: false },
  dataStatus: "available"
};

describe("admin segments controllers", () => {
  it("uses the protected list/preview paths and rejects invalid bounds before fetch", async () => {
    const urls: string[] = [];
    const client = createAdminSegmentsClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl: async (input) => {
        urls.push(input);
        return new Response(JSON.stringify(input.endsWith("/admin/segments") ? listResponse : previewResponse), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    await client.list();
    await client.preview("regulars", { limit: 50, offset: 0 });
    expect(urls).toEqual(["http://127.0.0.1:3000/admin/segments", "http://127.0.0.1:3000/admin/segments/regulars?limit=50&offset=0"]);
    await expect(Promise.resolve().then(() => client.preview("regulars", { limit: 51 }))).rejects.toMatchObject({ kind: "validation" } satisfies Partial<AdminSegmentsClientError>);
  });

  it("keeps the newest list request and aborts the previous one", async () => {
    const requests: Array<{ readonly signal: AbortSignal | undefined; readonly resolve: (value: AdminSegmentsResponse) => void }> = [];
    const client: AdminSegmentsClient = {
      list: ({ signal } = {}) => new Promise<AdminSegmentsResponse>((resolve) => { requests.push({ signal, resolve }); }),
      preview: async () => previewResponse
    };
    const states: string[] = [];
    const controller = createAdminSegmentsListRequestController(client, (state) => states.push(state.status));
    controller.load();
    controller.load();
    requests[1]?.resolve(listResponse);
    await Promise.resolve();
    expect(requests[0]?.signal?.aborted).toBe(true);
    expect(states).toEqual(["loading", "loading", "success"]);
    controller.dispose();
  });

  it("keeps preview bounded and supports retry", async () => {
    let calls = 0;
    const client: AdminSegmentsClient = {
      list: async () => listResponse,
      preview: async (_code, query) => { calls += 1; expect(query).toEqual({ limit: 25, offset: 0 }); return previewResponse; }
    };
    const states: string[] = [];
    const controller = createAdminSegmentPreviewRequestController(client, (state) => states.push(state.status));
    controller.load("regulars", { limit: 25, offset: 0 });
    await Promise.resolve();
    controller.retry();
    await Promise.resolve();
    expect(calls).toBe(2);
    expect(states).toEqual(["loading", "success", "loading", "success"]);
    controller.dispose();
  });
});
