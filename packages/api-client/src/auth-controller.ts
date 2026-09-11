import {
  AuthStateSchema,
  type AuthState,
  type CustomerIdentifyRequest,
  type CustomerProfile
} from "@vse-pro-zhar/contracts";

import { AuthClientError, type AuthClient } from "./auth-client.js";

export interface AuthRequestController {
  readonly getState: () => AuthState;
  hydrate(): void;
  identify(input: CustomerIdentifyRequest): Promise<CustomerProfile>;
  logout(): Promise<void>;
  clearError(): void;
  dispose(): void;
}

export function getAuthErrorMessage(error: unknown): string {
  if (error instanceof AuthClientError) return error.message;
  return "Не удалось сохранить данные Customer";
}

export function createAuthRequestController(
  client: AuthClient,
  onStateChange: (state: AuthState) => void
): AuthRequestController {
  let disposed = false;
  let sequence = 0;
  let state: AuthState = AuthStateSchema.parse({ status: "unknown" });
  let activeController: AbortController | null = null;

  const setState = (next: AuthState): void => {
    if (disposed) return;
    state = AuthStateSchema.parse(next);
    onStateChange(state);
  };

  const begin = (): { id: number; controller: AbortController } | null => {
    if (disposed) return null;
    const id = sequence + 1;
    sequence = id;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    setState({ status: "loading" });
    return { id, controller };
  };

  return {
    getState: () => state,
    hydrate: (): void => {
      const started = begin();
      if (started === null) return;
      void client.me({ signal: started.controller.signal }).then(
        (response) => {
          if (!disposed && started.id === sequence && !started.controller.signal.aborted) {
            setState({ status: "identified", customer: response.customer });
          }
        },
        (error: unknown) => {
          if (disposed || started.id !== sequence || (started.controller.signal.aborted && error instanceof AuthClientError && error.kind === "aborted")) return;
          if (error instanceof AuthClientError && error.kind === "authentication") setState({ status: "anonymous" });
          else setState({ status: "error", message: getAuthErrorMessage(error) });
        }
      );
    },
    identify: async (input): Promise<CustomerProfile> => {
      const started = begin();
      if (started === null) throw new AuthClientError("aborted", "Запрос к Backend API отменён");
      try {
        const response = await client.identify(input, { signal: started.controller.signal });
        if (disposed || started.id !== sequence || started.controller.signal.aborted) {
          throw new AuthClientError("aborted", "Запрос к Backend API отменён");
        }
        setState({ status: "identified", customer: response.customer });
        return response.customer;
      } catch (error: unknown) {
        if (!disposed && started.id === sequence && !(error instanceof AuthClientError && error.kind === "aborted")) {
          setState({ status: "error", message: getAuthErrorMessage(error) });
        }
        throw error;
      }
    },
    logout: async (): Promise<void> => {
      if (disposed) return;
      const started = begin();
      if (started === null) return;
      try {
        await client.logout({ signal: started.controller.signal });
        if (!disposed && started.id === sequence && !started.controller.signal.aborted) setState({ status: "anonymous" });
      } catch (error: unknown) {
        if (!disposed && started.id === sequence && !(error instanceof AuthClientError && error.kind === "aborted")) setState({ status: "error", message: getAuthErrorMessage(error) });
        throw error;
      }
    },
    clearError: (): void => {
      if (state.status === "error") setState({ status: "anonymous" });
    },
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      sequence += 1;
      activeController?.abort();
      activeController = null;
    }
  };
}
