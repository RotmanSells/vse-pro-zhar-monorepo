import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AdminAuthClient,
  AdminAuthRequestController,
  AdminAnalyticsClient,
  AdminCustomersClient,
  AdminPushClient,
  AdminCommunicationsClient,
  AdminSegmentsClient,
  AdminLoyaltyClient,
  AdminOrdersClient,
  AdminPromosClient,
  CatalogAdminClient,
  HealthClient
} from "@vse-pro-zhar/api-client";
import { createAdminAuthRequestController } from "@vse-pro-zhar/api-client";
import type { AdminAuthState, AdminSegmentCode, StaffProfile } from "@vse-pro-zhar/contracts";

import { createAdminAuthClient } from "./api/admin-auth-client";
import { createAdminOrdersClient } from "./api/admin-orders-client";
import { createAdminLoyaltyClient } from "./api/admin-loyalty-client";
import { createAdminAnalyticsClient } from "./api/admin-analytics-client";
import { createAdminCustomersClient } from "./api/admin-customers-client";
import { createAdminPushClient } from "./api/admin-push-client";
import { createAdminSegmentsClient } from "./api/admin-segments-client";
import { createAdminPromosClient } from "./api/admin-promos-client";
import { createAdminCommunicationsClient } from "./api/admin-communications-client";
import { createCatalogClient } from "./api/catalog-client";
import { CatalogScreen } from "./components/catalog-screen";
import { HealthScreen } from "./components/health-screen";
import { LoginScreen } from "./components/login-screen";
import { OrdersScreen } from "./components/orders-screen";
import { LoyaltyScreen } from "./components/loyalty-screen";
import { DashboardScreen } from "./components/dashboard-screen";
import { CustomersScreen } from "./components/customers-screen";
import { SegmentsScreen } from "./components/segments-screen";
import { PromosScreen } from "./components/promos-screen";
import { CommunicationsScreen } from "./components/communications-screen";
import { NavIcon } from "./components/nav-icon";
import "./styles.css";

export type AdminSection =
  | "dashboard"
  | "catalog"
  | "orders"
  | "loyalty"
  | "rewards"
  | "promos"
  | "quests"
  | "wheel"
  | "customers"
  | "segments"
  | "communications";

const navigationItems: readonly { readonly section: AdminSection; readonly label: string; readonly icon: Parameters<typeof NavIcon>[0]["name"] }[] = [
  { section: "dashboard", label: "Дашборд", icon: "dashboard" },
  { section: "orders", label: "Заказы", icon: "orders" },
  { section: "catalog", label: "Меню", icon: "catalog" },
  { section: "loyalty", label: "Лояльность", icon: "loyalty" },
  { section: "rewards", label: "Награды", icon: "loyalty" },
  { section: "promos", label: "Промокоды", icon: "promos" },
  { section: "quests", label: "Квесты", icon: "quests" },
  { section: "wheel", label: "Колесо фортуны", icon: "wheel" },
  { section: "customers", label: "Клиенты", icon: "customers" },
  { section: "segments", label: "Сегменты", icon: "segments" },
  { section: "communications", label: "Рассылки", icon: "communications" },
];

export interface AppProps {
  readonly client?: CatalogAdminClient | HealthClient;
  readonly authClient?: AdminAuthClient;
  readonly ordersClient?: AdminOrdersClient;
  readonly loyaltyClient?: AdminLoyaltyClient;
  readonly analyticsClient?: AdminAnalyticsClient;
  readonly customersClient?: AdminCustomersClient;
  readonly pushClient?: AdminPushClient;
  readonly segmentsClient?: AdminSegmentsClient;
  readonly promosClient?: AdminPromosClient;
  readonly communicationsClient?: AdminCommunicationsClient;
}

function isHealthClient(client: CatalogAdminClient | HealthClient): client is HealthClient {
  return "getHealth" in client;
}

interface AdminShellProps {
  readonly children: React.ReactNode;
  readonly section: AdminSection;
  readonly staff: StaffProfile | null;
  readonly onSectionChange?: (section: AdminSection) => void;
  readonly onLogout?: () => void;
}

function AdminShell({ children, section, staff, onSectionChange, onLogout }: AdminShellProps): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = (next: AdminSection): void => {
    onSectionChange?.(next);
    setSidebarOpen(false);
  };
  const mobilePageName = navigationItems.find((item) => item.section === section)?.label ?? "Заказы";

  useEffect(() => {
    if (!sidebarOpen || typeof document === "undefined") return;

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSidebarOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sidebarOpen]);

  return (
    <div className="admin-layout">
      <button aria-label="Закрыть меню" className={`sidebar-backdrop ${sidebarOpen ? "show" : ""}`} disabled={!sidebarOpen} onClick={() => setSidebarOpen(false)} tabIndex={sidebarOpen ? 0 : -1} type="button" />
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`} id="admin-sidebar">
        <div className="sidebar-logo"><span aria-hidden="true">🔥</span><span>VPZ Admin</span></div>
        <nav className="sidebar-nav" aria-label="Разделы админ-панели">
          {navigationItems.map((item) => <button aria-current={section === item.section ? "page" : undefined} aria-label={item.label} className={`nav-item ${section === item.section ? "active" : ""}`} key={item.section} onClick={() => navigate(item.section)} title={item.label} type="button"><NavIcon name={item.icon} /><span>{item.label}</span></button>)}
        </nav>
        <div className="sidebar-footer"><span>{staff === null ? "Каталог · M1" : staff.displayName}</span>{onLogout !== undefined ? <button className="sidebar-logout" onClick={onLogout} type="button">Выйти</button> : null}</div>
      </aside>
      <div className="mobile-topbar"><button aria-controls="admin-sidebar" aria-expanded={sidebarOpen} aria-label={sidebarOpen ? "Закрыть меню" : "Открыть меню"} className="hamburger" onClick={() => setSidebarOpen((open) => !open)} type="button"><NavIcon name="menu" /></button><span className="mobile-brand">🔥 Все Про Жар</span><span className="mobile-page-name">{mobilePageName}</span></div>
      <main className="main" onClick={() => setSidebarOpen(false)}>{children}</main>
    </div>
  );
}

export function App({ client, authClient, ordersClient, loyaltyClient, analyticsClient, customersClient, pushClient, segmentsClient, promosClient, communicationsClient }: AppProps): React.JSX.Element {
  const defaultCatalogClient = useMemo(() => createCatalogClient(), []);
  if (client !== undefined && isHealthClient(client)) return <HealthScreen client={client} />;
  // A supplied catalog client is the focused component-test seam retained from M1.
  // The production entrypoint has no client prop and always goes through staff auth.
  if (client !== undefined) return <AdminShell section="catalog" staff={null}><CatalogScreen client={client} /></AdminShell>;
  return <AuthenticatedAdminApp analyticsClient={analyticsClient} catalogClient={defaultCatalogClient} authClient={authClient} ordersClient={ordersClient} loyaltyClient={loyaltyClient} customersClient={customersClient} pushClient={pushClient} segmentsClient={segmentsClient} promosClient={promosClient} communicationsClient={communicationsClient} />;
}

function AuthenticatedAdminApp({ catalogClient, authClient, ordersClient, loyaltyClient, analyticsClient, customersClient, pushClient, segmentsClient, promosClient, communicationsClient }: { readonly catalogClient: CatalogAdminClient; readonly authClient?: AdminAuthClient | undefined; readonly ordersClient?: AdminOrdersClient | undefined; readonly loyaltyClient?: AdminLoyaltyClient | undefined; readonly analyticsClient?: AdminAnalyticsClient | undefined; readonly customersClient?: AdminCustomersClient | undefined; readonly pushClient?: AdminPushClient | undefined; readonly segmentsClient?: AdminSegmentsClient | undefined; readonly promosClient?: AdminPromosClient | undefined; readonly communicationsClient?: AdminCommunicationsClient | undefined }): React.JSX.Element {
  const resolvedAuthClient = useMemo(() => authClient ?? createAdminAuthClient(), [authClient]);
  const resolvedOrdersClient = useMemo(() => ordersClient ?? createAdminOrdersClient(), [ordersClient]);
  const resolvedLoyaltyClient = useMemo(() => loyaltyClient ?? createAdminLoyaltyClient(), [loyaltyClient]);
  const resolvedAnalyticsClient = useMemo(() => analyticsClient ?? createAdminAnalyticsClient(), [analyticsClient]);
  const resolvedCustomersClient = useMemo(() => customersClient ?? createAdminCustomersClient(), [customersClient]);
  const resolvedPushClient = useMemo(() => pushClient ?? createAdminPushClient(), [pushClient]);
  const resolvedSegmentsClient = useMemo(() => segmentsClient ?? createAdminSegmentsClient(), [segmentsClient]);
  const resolvedPromosClient = useMemo(() => promosClient ?? createAdminPromosClient(), [promosClient]);
  const resolvedCommunicationsClient = useMemo(() => communicationsClient ?? createAdminCommunicationsClient(), [communicationsClient]);
  const [authState, setAuthState] = useState<AdminAuthState>({ status: "unknown" });
  const [section, setSection] = useState<AdminSection>("catalog");
  const [communicationSegmentCode, setCommunicationSegmentCode] = useState<AdminSegmentCode | null>(null);
  const controllerRef = useRef<AdminAuthRequestController | null>(null);
  useEffect(() => {
    const controller = createAdminAuthRequestController(resolvedAuthClient, setAuthState);
    controllerRef.current = controller;
    controller.hydrate();
    return () => { controller.dispose(); if (controllerRef.current === controller) controllerRef.current = null; };
  }, [resolvedAuthClient]);

  if (authState.status === "unknown" || authState.status === "loading") return <div className="page-shell"><div className="diagnostic-card"><p className="eyebrow">VPZ ADMIN</p><h1>Проверяем сессию…</h1></div></div>;
  if (authState.status === "anonymous" || authState.status === "error") {
    return controllerRef.current === null ? <div className="page-shell"><div className="diagnostic-card">Admin auth недоступен</div></div> : <LoginScreen controller={controllerRef.current} message={authState.status === "error" ? authState.message : undefined} />;
  }
  const staff = authState.staff;
  return <AdminShell section={section} staff={staff} onLogout={() => { void controllerRef.current?.logout(); }} onSectionChange={setSection}>{section === "dashboard" ? <DashboardScreen client={resolvedAnalyticsClient} /> : section === "catalog" ? <CatalogScreen client={catalogClient} /> : section === "customers" ? <CustomersScreen client={resolvedCustomersClient} pushClient={resolvedPushClient} /> : section === "segments" ? <SegmentsScreen client={resolvedSegmentsClient} onOpenCommunications={(code) => { setCommunicationSegmentCode(code); setSection("communications"); }} /> : section === "communications" ? <CommunicationsScreen client={resolvedCommunicationsClient} initialSegmentCode={communicationSegmentCode} onComposerClosed={() => setCommunicationSegmentCode(null)} /> : section === "promos" ? <PromosScreen client={resolvedPromosClient} /> : section === "loyalty" || section === "rewards" || section === "quests" || section === "wheel" ? <LoyaltyScreen client={resolvedLoyaltyClient} section={section === "quests" ? "quests" : section === "wheel" ? "wheel" : section === "rewards" ? "rewards" : "overview"} /> : <OrdersScreen client={resolvedOrdersClient} />}</AdminShell>;
}
