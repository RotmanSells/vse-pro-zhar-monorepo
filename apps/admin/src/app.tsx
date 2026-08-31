import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createHealthRequestController,
  type HealthRequestController,
  type HealthRequestState
} from "@vse-pro-zhar/api-client";

import { createHealthClient, type HealthClient } from "./api/health-client";
import "./styles.css";

export interface AppProps {
  readonly client?: HealthClient;
}

export function App({ client }: AppProps): React.JSX.Element {
  const defaultClient = useMemo(() => createHealthClient(), []);
  const healthClient = client ?? defaultClient;
  const [state, setState] = useState<HealthRequestState>({
    status: "loading"
  });
  const controllerRef = useRef<HealthRequestController | null>(null);

  useEffect(() => {
    const controller = createHealthRequestController(healthClient, setState);
    controllerRef.current = controller;
    controller.start();

    return () => {
      controller.dispose();

      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [healthClient]);

  const loadHealth = useCallback((): void => {
    controllerRef.current?.retry();
  }, []);

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
