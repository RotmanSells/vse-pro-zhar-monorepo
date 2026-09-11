import {
  QuestStateResponseSchema,
  WheelSpinResponseSchema,
  WheelStateResponseSchema,
  type QuestStateResponse,
  type WheelSpinRequest,
  type WheelSpinResponse,
  type WheelStateResponse
} from "@vse-pro-zhar/contracts";

import { LoyaltyClientError, type LoyaltyClient } from "./loyalty-client.js";

export type WheelRequestState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "success"; readonly response: WheelStateResponse }
  | { readonly status: "error"; readonly message: string; readonly kind?: LoyaltyClientError["kind"] };
export type QuestRequestState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "success"; readonly response: QuestStateResponse }
  | { readonly status: "error"; readonly message: string };
export type WheelSpinRequestState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "success"; readonly response: WheelSpinResponse }
  | { readonly status: "error"; readonly message: string; readonly kind?: LoyaltyClientError["kind"] };

export interface LoyaltyGamificationController {
  loadWheel(): void;
  loadQuests(): void;
  spin(input: WheelSpinRequest, idempotencyKey: string): void;
  retry(): void;
  dispose(): void;
}

export function createLoyaltyGamificationController(
  client: LoyaltyClient,
  onWheel: (state: WheelRequestState) => void,
  onQuests: (state: QuestRequestState) => void,
  onSpin: (state: WheelSpinRequestState) => void
): LoyaltyGamificationController {
  let disposed = false;
  let wheelSequence = 0;
  let questSequence = 0;
  let spinSequence = 0;
  let wheelController: AbortController | null = null;
  let questController: AbortController | null = null;
  let spinController: AbortController | null = null;
  let lastSpin: { readonly input: WheelSpinRequest; readonly idempotencyKey: string } | null = null;

  const loadWheel = (): void => {
    if (disposed) return;
    const getWheel = client.getWheel;
    if (getWheel === undefined) {
      onWheel({ status: "error", message: "Рулетка пока недоступна", kind: "unavailable" });
      return;
    }
    const sequence = ++wheelSequence;
    wheelController?.abort();
    const controller = new AbortController();
    wheelController = controller;
    onWheel({ status: "loading" });
    void getWheel({ signal: controller.signal }).then(
      (response) => {
        if (!disposed && sequence === wheelSequence && !controller.signal.aborted) {
          const parsed = WheelStateResponseSchema.safeParse(response);
          onWheel(parsed.success ? { status: "success", response: parsed.data } : { status: "error", message: "Backend API вернул некорректное состояние рулетки", kind: "invalid_response" });
        }
      },
      (error: unknown) => {
        if (!disposed && sequence === wheelSequence && !(error instanceof LoyaltyClientError && error.kind === "aborted")) onWheel({ status: "error", message: error instanceof LoyaltyClientError ? error.message : "Не удалось загрузить рулетку", kind: error instanceof LoyaltyClientError ? error.kind : "network" });
      }
    );
  };

  const loadQuests = (): void => {
    if (disposed) return;
    const getQuests = client.getQuests;
    if (getQuests === undefined) {
      onQuests({ status: "error", message: "Квесты пока недоступны" });
      return;
    }
    const sequence = ++questSequence;
    questController?.abort();
    const controller = new AbortController();
    questController = controller;
    onQuests({ status: "loading" });
    void getQuests({ signal: controller.signal }).then(
      (response) => {
        if (!disposed && sequence === questSequence && !controller.signal.aborted) {
          const parsed = QuestStateResponseSchema.safeParse(response);
          onQuests(parsed.success ? { status: "success", response: parsed.data } : { status: "error", message: "Backend API вернул некорректное состояние квестов" });
        }
      },
      (error: unknown) => {
        if (!disposed && sequence === questSequence && !(error instanceof LoyaltyClientError && error.kind === "aborted")) onQuests({ status: "error", message: error instanceof LoyaltyClientError ? error.message : "Не удалось загрузить квесты" });
      }
    );
  };

  const spin = (input: WheelSpinRequest, idempotencyKey: string): void => {
    if (disposed || client.spinWheel === undefined) {
      onSpin({ status: "error", message: "Рулетка пока недоступна", kind: "unavailable" });
      return;
    }
    lastSpin = { input, idempotencyKey };
    const sequence = ++spinSequence;
    spinController?.abort();
    const controller = new AbortController();
    spinController = controller;
    onSpin({ status: "loading" });
    void client.spinWheel(input, idempotencyKey, { signal: controller.signal }).then(
      (response) => {
        if (!disposed && sequence === spinSequence && !controller.signal.aborted) {
          const parsed = WheelSpinResponseSchema.safeParse(response);
          onSpin(parsed.success ? { status: "success", response: parsed.data } : { status: "error", message: "Backend API вернул некорректный результат рулетки", kind: "invalid_response" });
        }
      },
      (error: unknown) => {
        if (!disposed && sequence === spinSequence && !(error instanceof LoyaltyClientError && error.kind === "aborted")) onSpin({ status: "error", message: error instanceof LoyaltyClientError ? error.message : "Не удалось выполнить spin", kind: error instanceof LoyaltyClientError ? error.kind : "network" });
      }
    );
  };

  return {
    loadWheel,
    loadQuests,
    spin,
    retry: () => { loadWheel(); loadQuests(); if (lastSpin !== null) spin(lastSpin.input, lastSpin.idempotencyKey); },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      wheelSequence += 1;
      questSequence += 1;
      spinSequence += 1;
      wheelController?.abort();
      questController?.abort();
      spinController?.abort();
    }
  };
}
