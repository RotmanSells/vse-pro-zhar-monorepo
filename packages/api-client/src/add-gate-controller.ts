import {
  PendingAddActionSchema,
  type AuthState,
  type PendingAddAction
} from "@vse-pro-zhar/contracts";

export interface AddGateController {
  request(action: PendingAddAction, authState: AuthState): PendingAddAction | null;
  consume(): PendingAddAction | null;
  cancel(): void;
  dispose(): void;
}

export function createAddGateController(): AddGateController {
  let pending: PendingAddAction | null = null;
  let disposed = false;
  return {
    request(action, authState) {
      if (disposed) return null;
      const valid = PendingAddActionSchema.parse(action);
      if (authState.status === "identified") return valid;
      pending = valid;
      return null;
    },
    consume() {
      if (disposed) return null;
      const current = pending;
      pending = null;
      return current;
    },
    cancel() {
      pending = null;
    },
    dispose() {
      disposed = true;
      pending = null;
    }
  };
}
