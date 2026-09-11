import { describe, expect, it } from "vitest";

import type { CustomerProfileResponse } from "@vse-pro-zhar/contracts";

import { ProfileClientError, createProfileRequestController, type ProfileClient } from "../src/index.js";

const response = { customer: { phone: "+79991234567", name: "Анна", birthDate: null }, stats: { orderCount: 0, favoriteProduct: null, nextMilestone: null }, loyalty: { status: "unavailable", reason: "not_configured" }, settings: { pushNotifications: { status: "unavailable", reason: "native_push_contract_pending" }, emailSubscription: { status: "unavailable", reason: "email_consent_contract_pending" }, darkTheme: { status: "unavailable", reason: "theme_contract_pending" } }, recentOrders: [] } as CustomerProfileResponse;

describe("profile request controller", () => {
  it("publishes only the latest response and supports retry", async () => {
    const pending: Array<(value: CustomerProfileResponse) => void> = [];
    const states: string[] = [];
    const client: ProfileClient = { getProfile: async () => new Promise((resolve) => pending.push(resolve)) };
    const controller = createProfileRequestController(client, (state) => states.push(state.status));
    controller.start();
    controller.retry();
    await Promise.resolve();
    await Promise.resolve();
    pending[1]?.(response);
    pending[0]?.(response);
    await Promise.resolve();
    await Promise.resolve();
    expect(states).toEqual(["loading", "loading", "success"]);
    controller.dispose();
  });

  it("reports retryable errors and ignores aborted requests", async () => {
    const states: string[] = [];
    let rejectRequest: ((error: unknown) => void) | undefined;
    const client: ProfileClient = { getProfile: async () => new Promise((_resolve, reject) => { rejectRequest = reject; }) };
    const controller = createProfileRequestController(client, (state) => states.push(state.status));
    controller.start();
    await Promise.resolve();
    await Promise.resolve();
    rejectRequest?.(new ProfileClientError("network", "Сеть недоступна"));
    await Promise.resolve();
    await Promise.resolve();
    expect(states).toEqual(["loading", "error"]);
    controller.dispose();
  });
});
