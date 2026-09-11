import {
  CustomerProfileResponseSchema,
  type CustomerProfileResponse
} from "@vse-pro-zhar/contracts";

import { ProfileClientError, type ProfileClient } from "./profile-client.js";

export type ProfileRequestState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "success"; readonly response: CustomerProfileResponse }
  | { readonly status: "error"; readonly message: string; readonly reason?: "authentication" | "unavailable" };

export interface ProfileRequestController {
  start(): void;
  retry(): void;
  dispose(): void;
}

export function getProfileErrorMessage(error: unknown): string {
  return error instanceof ProfileClientError ? error.message : "Не удалось загрузить профиль";
}

export function createProfileRequestController(
  client: ProfileClient,
  onState: (state: ProfileRequestState) => void
): ProfileRequestController {
  let disposed = false;
  let sequence = 0;
  let activeController: AbortController | null = null;

  const load = (): void => {
    if (disposed) return;
    const currentSequence = ++sequence;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    onState({ status: "loading" });
    void client.getProfile({ signal: controller.signal }).then(
      (response) => {
        if (!disposed && currentSequence === sequence && !controller.signal.aborted) {
          const parsed = CustomerProfileResponseSchema.safeParse(response);
          onState(parsed.success
            ? { status: "success", response: parsed.data }
            : { status: "error", message: "Backend API вернул некорректный профиль" });
        }
      },
      (error: unknown) => {
        if (
          !disposed &&
          currentSequence === sequence &&
          !(error instanceof ProfileClientError && error.kind === "aborted")
        ) {
          onState({
            status: "error",
            message: getProfileErrorMessage(error),
            ...(error instanceof ProfileClientError && error.kind === "authentication"
              ? { reason: "authentication" as const }
              : { reason: "unavailable" as const })
          });
        }
      }
    );
  };

  return {
    start: load,
    retry: load,
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      sequence += 1;
      activeController?.abort();
      activeController = null;
    }
  };
}
