import { describe, expect, it } from "vitest";

import type { AdminSegmentRepository, AdminSegmentRepositoryCount, AdminSegmentRepositoryPreview } from "@vse-pro-zhar/database";

import { getAdminSegmentPreview, getAdminSegments } from "../src/segments/service.js";

const now = new Date("2026-09-01T10:00:00.000Z");
const codes = ["sleeping", "one_timer", "churned", "newbies", "regulars", "vip", "big_spenders", "coal_rich", "at_risk"] as const;

function repository(overrides: Partial<AdminSegmentRepository> = {}): AdminSegmentRepository {
  const counts: readonly AdminSegmentRepositoryCount[] = codes.map((code, index) => ({ code, count: index + 1, unavailableReason: null }));
  const preview: AdminSegmentRepositoryPreview = {
    rows: [{ id: 4, name: "Анна", phoneMasked: "•••• 1234", orderCount: 3, spentMinor: 450_000, lastActivityAt: new Date("2026-09-01T08:00:00.000Z") }],
    total: 1,
    unavailableReason: null
  };
  return {
    listBuiltinCounts: async () => counts,
    preview: async () => preview,
    ...overrides
  };
}

describe("admin segments service", () => {
  it("returns all server-owned built-in definitions and counts", async () => {
    const response = await getAdminSegments(repository(), now);
    expect(response.timezone).toBe("Europe/Moscow");
    expect(response.builtins).toHaveLength(9);
    expect(response.builtins.find((segment) => segment.code === "vip")?.count).toEqual({ status: "confirmed", count: 6 });
    expect(response.customSegments).toEqual([]);
    expect(response.customLifecycle).toEqual({ status: "unavailable", reason: "owner_decision_required" });
  });

  it("keeps reconciliation and unavailable states explicit", async () => {
    const response = await getAdminSegments(repository({ listBuiltinCounts: async () => codes.map((code) => ({ code, count: 0, unavailableReason: code === "coal_rich" ? "reconciliation_required" : null })) }), now);
    expect(response.builtins.find((segment) => segment.code === "coal_rich")?.count).toEqual({ status: "unavailable", reason: "reconciliation_required" });
    const preview = await getAdminSegmentPreview(repository({ preview: async () => ({ rows: [], total: 0, unavailableReason: "reconciliation_required" }) }), "coal_rich", { limit: 25, offset: 0 }, now);
    expect(preview.status).toBe("unavailable");
    if (preview.status === "unavailable") expect(preview.customers).toEqual([]);
  });

  it("returns bounded deterministic preview metadata and rejects unknown codes", async () => {
    const response = await getAdminSegmentPreview(repository(), "regulars", { limit: 25, offset: 0 }, now);
    expect(response.status).toBe("confirmed");
    if (response.status === "confirmed") {
      expect(response.pagination).toEqual({ limit: 25, offset: 0, total: 1, hasNext: false });
      expect(response.customers[0]?.phoneMasked).toBe("•••• 1234");
    }
    await expect(getAdminSegmentPreview(repository(), "not-a-segment", { limit: 25, offset: 0 }, now)).rejects.toThrow("Segment code is invalid");
  });
});
