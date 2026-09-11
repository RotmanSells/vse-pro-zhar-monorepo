import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AdminCustomersClient, AdminPushClient } from "@vse-pro-zhar/api-client";
import type { AdminPushSendResponse } from "@vse-pro-zhar/contracts";

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

  it("sends a single-device Push through the Admin client", async () => {
    const client: AdminCustomersClient = {
      list: async () => ({ status: "confirmed", customers: [], pagination: { limit: 25, offset: 0, total: 0, hasNext: false } })
    };
    const response: AdminPushSendResponse = {
      status: "confirmed",
      customerId: 1,
      replayed: false,
      deliveries: [{ id: 7, deviceId: 10, provider: "expo", status: "accepted", providerTicketId: "ticket-1", errorCode: null, createdAt: "2026-09-11T10:00:00.000Z", updatedAt: "2026-09-11T10:00:00.000Z" }]
    };
    const send = vi.fn(async () => response);
    const pushClient: AdminPushClient = { send };
    let renderer: ReactTestRenderer | null = null;
    await act(async () => { renderer = create(<CustomersScreen client={client} pushClient={pushClient} />); await Promise.resolve(); await Promise.resolve(); });
    if (renderer === null) throw new Error("Expected customers renderer");
    const mountedRenderer = renderer as ReactTestRenderer;
    const phone = mountedRenderer.root.findByProps({ "aria-label": "Номер телефона для Push" });
    await act(async () => { phone.props.onChange({ target: { value: "+7 (999) 123-45-67" } }); await Promise.resolve(); });
    const sendButton = mountedRenderer.root.findAll((node) => text(node) === "Отправить Push" && typeof node.props.onClick === "function")[0];
    if (sendButton === undefined) throw new Error("Expected Push button");
    await act(async () => { sendButton.props.onClick(); await Promise.resolve(); await Promise.resolve(); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(text(mountedRenderer.root)).toContain("Expo принял Push");
  });
});
