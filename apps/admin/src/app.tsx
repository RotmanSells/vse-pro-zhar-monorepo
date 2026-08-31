import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { HealthResponse } from "@vse-pro-zhar/contracts";

import {
  createHealthClient,
  HealthClientError,
  type HealthClient
} from "./api/health-client";
import "./styles.css";

type HealthScreenState =
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly health: HealthResponse }
  | { readonly status: "error"; readonly message: string };

export interface AppProps {
  readonly client?: HealthClient;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof HealthClientError) {
    return error.message;
  }

  return "Не удалось получить состояние Backend API";
}

export function App({ client }: AppProps): React.JSX.Element {
  const defaultClient = useMemo(() => createHealthClient(), []);
  const healthClient = client ?? defaultClient;
  const [state, setState] = useState<HealthScreenState>({ status: "loading" });
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
    };
  }, []);

  const loadHealth = useCallback((): void => {
    setState({ status: "loading" });

    void healthClient
      .getHealth()
      .then((health) => {
        if (isMounted.current) {
          setState({ status: "success", health });
        }
      })
      .catch((error: unknown) => {
        if (isMounted.current) {
          setState({ status: "error", message: getErrorMessage(error) });
        }
      });
  }, [healthClient]);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  return (
    <main className="page-shell">
      <section className="diagnostic-card" aria-labelledby="admin-title">
        <p className="eyebrow">FOUNDATION</p>
        <h1 id="admin-title">Все Про Жар — Admin</h1>
        <p className="subtitle">Минимальная web-поверхность для проверки Backend boundary</p>

        <div className="backend-panel" aria-live="polite">
          <p className="panel-label">Backend</p>

          {state.status === "loading" ? (
            <p className="status status-loading">Проверяем соединение…</p>
          ) : null}

          {state.status === "success" ? (
            <div data-testid="backend-connected">
              <p className="status status-connected">● Connected</p>
              <p className="details">
                {state.health.service} · {state.health.environment}
              </p>
            </div>
          ) : null}

          {state.status === "error" ? (
            <div>
              <p className="status status-disconnected">○ Disconnected</p>
              <p className="error-message">{state.message}</p>
              <button className="retry-button" onClick={loadHealth} type="button">
                Повторить
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
