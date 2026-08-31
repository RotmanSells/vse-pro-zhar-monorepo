import { useMemo, useState } from "react";

import type {
  CatalogAdminClient,
  HealthClient
} from "@vse-pro-zhar/api-client";

import { createCatalogClient } from "./api/catalog-client";
import { CatalogScreen } from "./components/catalog-screen";
import { HealthScreen } from "./components/health-screen";
import "./styles.css";

export interface AppProps {
  readonly client?: CatalogAdminClient | HealthClient;
}

function isHealthClient(
  client: CatalogAdminClient | HealthClient
): client is HealthClient {
  return "getHealth" in client;
}

function AdminShell({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="admin-layout">
      <div className={`sidebar-backdrop ${sidebarOpen ? "show" : ""}`} />
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-logo">
          <span aria-hidden="true">🔥</span>
          <span>VPZ Admin</span>
        </div>
        <nav className="sidebar-nav" aria-label="Разделы админ-панели">
          <button className="nav-item" disabled type="button">
            <span aria-hidden="true">◉</span>
            <span>Дашборд</span>
          </button>
          <button className="nav-item" disabled type="button">
            <span aria-hidden="true">▣</span>
            <span>Заказы</span>
          </button>
          <button className="nav-item active" type="button">
            <span aria-hidden="true">🍴</span>
            <span>Меню</span>
          </button>
          <button className="nav-item" disabled type="button">
            <span aria-hidden="true">%</span>
            <span>Промокоды</span>
          </button>
          <button className="nav-item" disabled type="button">
            <span aria-hidden="true">◎</span>
            <span>Квесты</span>
          </button>
          <button className="nav-item" disabled type="button">
            <span aria-hidden="true">◌</span>
            <span>Колесо фортуны</span>
          </button>
          <button className="nav-item" disabled type="button">
            <span aria-hidden="true">♙</span>
            <span>Клиенты</span>
          </button>
        </nav>
        <div className="sidebar-footer">Каталог · M1</div>
      </aside>

      <div className="mobile-topbar">
        <button
          aria-label="Открыть меню"
          className="hamburger"
          onClick={() => setSidebarOpen((open) => !open)}
          type="button"
        >
          ☰
        </button>
        <span className="mobile-brand">🔥 Все Про Жар</span>
        <span className="mobile-page-name">Меню</span>
      </div>

      <main className="main" onClick={() => setSidebarOpen(false)}>
        {children}
      </main>
    </div>
  );
}

export function App({ client }: AppProps): React.JSX.Element {
  const defaultClient = useMemo(() => createCatalogClient(), []);

  if (client !== undefined && isHealthClient(client)) {
    return <HealthScreen client={client} />;
  }

  return (
    <AdminShell>
      <CatalogScreen client={client as CatalogAdminClient | undefined ?? defaultClient} />
    </AdminShell>
  );
}
