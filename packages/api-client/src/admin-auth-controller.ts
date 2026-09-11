import {
  AdminAuthLoginRequestSchema,
  AdminAuthStateSchema,
  type AdminAuthLoginRequest,
  type AdminAuthState,
  type StaffProfile
} from "@vse-pro-zhar/contracts";

import { AdminAuthClientError, type AdminAuthClient } from "./admin-auth-client.js";

export interface AdminAuthRequestController {
  readonly getState: () => AdminAuthState;
  hydrate(): void;
  login(input: AdminAuthLoginRequest): Promise<StaffProfile>;
  logout(): Promise<void>;
  clearError(): void;
  dispose(): void;
}

export function getAdminAuthErrorMessage(error: unknown): string {
  return error instanceof AdminAuthClientError ? error.message : "Не удалось выполнить вход в Admin";
}

export function createAdminAuthRequestController(
  client: AdminAuthClient,
  onStateChange: (state: AdminAuthState) => void
): AdminAuthRequestController {
  let disposed = false;
  let sequence = 0;
  let state: AdminAuthState = { status: "unknown" };
  let activeController: AbortController | null = null;
  const setState = (next: AdminAuthState): void => {
    if (disposed) return;
    state = AdminAuthStateSchema.parse(next);
    onStateChange(state);
  };
  const begin = (): { id: number; controller: AbortController } | null => {
    if (disposed) return null;
    const id = ++sequence;
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
          if (!disposed && started.id === sequence && !started.controller.signal.aborted) setState({ status: "authenticated", staff: response.staff });
        },
        (error: unknown) => {
          if (disposed || started.id !== sequence || (error instanceof AdminAuthClientError && error.kind === "aborted")) return;
          setState(error instanceof AdminAuthClientError && error.kind === "authentication" ? { status: "anonymous" } : { status: "error", message: getAdminAuthErrorMessage(error) });
        }
      );
    },
    login: async (input): Promise<StaffProfile> => {
      const parsed = AdminAuthLoginRequestSchema.safeParse(input);
      if (!parsed.success) {
        const error = new AdminAuthClientError("validation", "Проверьте логин и пароль");
        setState({ status: "error", message: error.message });
        throw error;
      }
      const started = begin();
      if (started === null) throw new AdminAuthClientError("aborted", "Запрос к Backend API отменён");
      try {
        const response = await client.login(parsed.data, { signal: started.controller.signal });
        if (disposed || started.id !== sequence || started.controller.signal.aborted) throw new AdminAuthClientError("aborted", "Запрос к Backend API отменён");
        setState({ status: "authenticated", staff: response.staff });
        return response.staff;
      } catch (error: unknown) {
        if (!disposed && started.id === sequence && !(error instanceof AdminAuthClientError && error.kind === "aborted")) setState({ status: "error", message: getAdminAuthErrorMessage(error) });
        throw error;
      }
    },
    logout: async (): Promise<void> => {
      const started = begin();
      if (started === null) return;
      try {
        await client.logout({ signal: started.controller.signal });
        if (!disposed && started.id === sequence && !started.controller.signal.aborted) setState({ status: "anonymous" });
      } catch (error: unknown) {
        if (!disposed && started.id === sequence && !(error instanceof AdminAuthClientError && error.kind === "aborted")) setState({ status: "error", message: getAdminAuthErrorMessage(error) });
        throw error;
      }
    },
    clearError: (): void => { if (state.status === "error") setState({ status: "anonymous" }); },
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      sequence += 1;
      activeController?.abort();
    }
  };
}
