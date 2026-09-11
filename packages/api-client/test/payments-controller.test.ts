import { describe, expect, it, vi } from "vitest";

import type { PaymentCreateResponse, PaymentStateResponse } from "@vse-pro-zhar/contracts";

import {
  createPaymentRequestController,
  type PaymentClient
} from "../src/index.js";

const payment = {
  id: 1,
  orderId: 7,
  provider: "yookassa" as const,
  status: "pending" as const,
  providerStatus: "pending" as const,
  amountMinor: 45_050,
  currency: "RUB",
  confirmation: { type: "redirect" as const, url: "https://yoomoney.ru/checkout/example" },
  createdAt: "2026-09-01T07:00:00.000Z",
  updatedAt: "2026-09-01T07:00:00.000Z"
};

describe("payment request controller", () => {
  it("opens only a provider confirmation URL and stays pending until refresh confirms", async () => {
    const states: string[] = [];
    const open = vi.fn();
    let refreshed = false;
    const client: PaymentClient = {
      createPayment: async (): Promise<PaymentCreateResponse> => ({
        order: { id: 7, status: "pending_payment" },
        payment
      }),
      getPayment: async (): Promise<PaymentStateResponse> => ({
        order: { id: 7, status: "payment_confirmed" },
        payment: {
          ...payment,
          status: refreshed ? "succeeded" : "pending",
          providerStatus: refreshed ? "succeeded" : "pending",
          confirmation: refreshed ? null : payment.confirmation
        }
      })
    };
    const controller = createPaymentRequestController(
      client,
      (state) => states.push(state.status),
      { open }
    );

    controller.create(7, "payment-key");
    await Promise.resolve();
    await Promise.resolve();
    expect(states).toEqual(["loading", "pending"]);
    expect(open).toHaveBeenCalledWith(payment.confirmation.url);

    refreshed = true;
    controller.refresh(7);
    await Promise.resolve();
    await Promise.resolve();
    expect(states).toEqual(["loading", "pending", "loading", "success"]);
    controller.dispose();
  });

  it("exposes canceled payments as retryable invalid state", async () => {
    const states: string[] = [];
    const client: PaymentClient = {
      createPayment: async (): Promise<PaymentCreateResponse> => ({
        order: { id: 7, status: "pending_payment" },
        payment: { ...payment, status: "canceled", providerStatus: "canceled", confirmation: null }
      }),
      getPayment: async (): Promise<PaymentStateResponse> => ({
        order: { id: 7, status: "pending_payment" },
        payment: { ...payment, status: "canceled", providerStatus: "canceled", confirmation: null }
      })
    };
    const controller = createPaymentRequestController(client, (state) => states.push(state.status));

    controller.create(7, "payment-key");
    await Promise.resolve();
    await Promise.resolve();

    expect(states).toEqual(["loading", "error"]);
    controller.dispose();
  });

  it("reports a confirmation navigation failure instead of staying pending forever", async () => {
    const states: string[] = [];
    const messages: string[] = [];
    const client: PaymentClient = {
      createPayment: async (): Promise<PaymentCreateResponse> => ({
        order: { id: 7, status: "pending_payment" },
        payment
      }),
      getPayment: async (): Promise<PaymentStateResponse> => ({
        order: { id: 7, status: "pending_payment" },
        payment
      })
    };
    const controller = createPaymentRequestController(
      client,
      (state) => {
        states.push(state.status);
        if (state.status === "error") messages.push(state.message);
      },
      { open: async () => { throw new Error("navigation unavailable"); } }
    );

    controller.create(7, "payment-key");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(states).toEqual(["loading", "pending", "error"]);
    expect(messages).toEqual(["Не удалось открыть форму оплаты. Попробуйте ещё раз."]);
    controller.dispose();
  });
});
