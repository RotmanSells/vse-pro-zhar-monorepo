import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AdminCustomersClient } from "@vse-pro-zhar/api-client";

import { CustomersScreen } from "../src/components/customers-screen";

function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : text(child)).join("");
}

describe("Admin customers screen", () => {
  beforeAll(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });

  it("renders masked customer data and keeps export unavailable", async () => {
    const client: AdminCustomersClient = {
      list: async () => ({ status: "confirmed", customers: [{ id: 1, name: "Анна", phoneMasked: "•••• 1234", orderCount: 2, spentMinor: 100_000, coalBalance: 10, xp: 100, rank: "spark", lastActivityAt: "2026-09-01T10:00:00.000Z" }], pagination: { limit: 25, offset: 0, total: 1, hasNext: false } })
    };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => { renderer = create(<CustomersScreen client={client} />); await Promise.resolve(); await Promise.resolve(); });
    if (renderer === null) throw new Error("Expected customers renderer");
    expect(text(renderer.root)).toContain("Анна");
    expect(text(renderer.root)).toContain("•••• 1234");
    expect(text(renderer.root)).toContain("1\u00a0000 ₽");
    const exportButton = renderer.root.find((node) => node.props["aria-disabled"] === "true");
    expect(exportButton.props.disabled).toBe(true);
    await act(async () => { renderer?.unmount(); await Promise.resolve(); });
  });
});
