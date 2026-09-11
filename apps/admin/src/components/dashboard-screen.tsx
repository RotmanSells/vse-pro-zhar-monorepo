import { useCallback, useEffect, useRef, useState } from "react";

import {
  createAdminAnalyticsRequestController,
  type AdminAnalyticsClient,
  type AdminAnalyticsRequestController,
  type AdminAnalyticsState
} from "@vse-pro-zhar/api-client";
import type {
  AdminAnalyticsCategory,
  AdminAnalyticsDailyRevenue,
  AdminAnalyticsPeriod,
  AdminAnalyticsResponse,
  AdminAnalyticsStatusDistribution,
  AdminAnalyticsTopDish,
  AdminAnalyticsTypeDistribution
} from "@vse-pro-zhar/contracts";

const periods: readonly AdminAnalyticsPeriod[] = [7, 30, 90];
const statusLabels: Record<string, string> = {
  pending_payment: "Ожидает оплаты",
  payment_confirmed: "Оплачен",
  kitchen_accepted: "Принят кухней",
  preparing: "Готовится",
  ready_for_pickup: "Готов к выдаче",
  completed: "Завершён",
  fulfillment_problem: "Проблема исполнения",
  canceled: "Отменён"
};

function formatCurrency(valueMinor: number | null): string {
  if (valueMinor === null) return "—";
  return `${(valueMinor / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}₽`;
}

function formatPercent(value: number | null): string {
  if (value === null) return "Нет данных";
  const formatted = value.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  return `${value > 0 ? "+" : ""}${formatted}% к прошлому периоду`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" });
}

function shortLabel(value: string, maxLength = 14): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function ChartEmpty(): React.JSX.Element {
  return <div className="analytics-empty">Нет данных за период</div>;
}

function RevenueChart({ data }: { readonly data: readonly AdminAnalyticsDailyRevenue[] }): React.JSX.Element {
  if (data.length === 0 || data.every((entry) => entry.revenueMinor === 0)) return <ChartEmpty />;
  const max = Math.max(...data.map((entry) => entry.revenueMinor), 1);
  const points = data.map((entry, index) => {
    const x = data.length === 1 ? 320 : 24 + (index * 592) / (data.length - 1);
    const y = 170 - (entry.revenueMinor / max) * 136;
    return `${x},${y}`;
  }).join(" ");
  const labelStep = Math.max(1, Math.ceil(data.length / 7));
  return <svg aria-label="Выручка по дням" className="analytics-svg analytics-line-chart" role="img" viewBox="0 0 640 220"><line className="analytics-axis" x1="24" x2="616" y1="170" y2="170" /><polyline className="analytics-line" fill="none" points={points} />{data.map((entry, index) => { if (index % labelStep !== 0 && index !== data.length - 1) return null; const x = data.length === 1 ? 320 : 24 + (index * 592) / (data.length - 1); const y = 170 - (entry.revenueMinor / max) * 136; return <g key={entry.date}><circle className="analytics-point" cx={x} cy={y} r="4" /><text className="analytics-label" textAnchor="middle" x={x} y="199">{entry.date.slice(5)}</text></g>; })}</svg>;
}

function BarChart({ data, ariaLabel, valueFormatter = String }: { readonly data: readonly { readonly label: string; readonly value: number }[]; readonly ariaLabel: string; readonly valueFormatter?: (value: number) => string }): React.JSX.Element {
  if (data.length === 0 || data.every((entry) => entry.value === 0)) return <ChartEmpty />;
  const max = Math.max(...data.map((entry) => entry.value), 1);
  const slot = 592 / data.length;
  const barWidth = Math.min(64, slot * 0.62);
  return <svg aria-label={ariaLabel} className="analytics-svg analytics-bar-chart" role="img" viewBox="0 0 640 220"><line className="analytics-axis" x1="24" x2="616" y1="170" y2="170" />{data.map((entry, index) => { const x = 24 + slot * index + (slot - barWidth) / 2; const height = (entry.value / max) * 136; return <g key={`${entry.label}-${index}`}><title>{`${entry.label}: ${valueFormatter(entry.value)}`}</title><rect className="analytics-bar" height={height} rx="5" width={barWidth} x={x} y={170 - height} /><text className="analytics-value" textAnchor="middle" x={x + barWidth / 2} y={Math.max(18, 160 - height)}>{shortLabel(valueFormatter(entry.value), 11)}</text><text className="analytics-label" textAnchor="middle" x={x + barWidth / 2} y="198">{shortLabel(entry.label)}</text></g>; })}</svg>;
}

function MetricCard({ className, icon, label, value, comparison }: { readonly className: string; readonly icon: string; readonly label: string; readonly value: string; readonly comparison: number | null }): React.JSX.Element {
  const comparisonClass = comparison === null ? "unavailable" : comparison >= 0 ? "up" : "down";
  return <article className={`metric-card ${className}`}><div aria-hidden="true" className="metric-icon">{icon}</div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className={`metric-change ${comparisonClass}`}>{formatPercent(comparison)}</div></article>;
}

function ChartCard({ title, children, className = "" }: { readonly title: string; readonly children: React.ReactNode; readonly className?: string }): React.JSX.Element {
  return <article className={`chart-card ${className}`}><h2>{title}</h2>{children}</article>;
}

function AnalyticsLoading(): React.JSX.Element {
  return <div aria-label="Загрузка аналитики" className="dashboard-content" role="status"><div className="metrics">{["revenue", "orders", "avg", "customers"].map((className) => <article className={`metric-card ${className} analytics-skeleton-card`} key={className}><span /><span /><span /></article>)}</div>{["revenue-row", "status-row", "orders-row"].map((row) => <div className="charts-row" key={row}><article className="chart-card analytics-skeleton-chart"><span /><span /><div /></article><article className="chart-card analytics-skeleton-chart"><span /><span /><div /></article></div>)}</div>;
}

function categoryContent(categories: AdminAnalyticsResponse["categories"]): React.JSX.Element {
  if (categories.status === "unavailable") return <div className="analytics-unavailable" role="status"><strong>Исторические категории недоступны</strong><span>В order snapshot пока не сохраняется категория товара.</span></div>;
  const data: readonly AdminAnalyticsCategory[] = categories.items;
  return <BarChart ariaLabel="Популярные категории" data={data.map((entry) => ({ label: entry.name, value: entry.revenueMinor }))} valueFormatter={formatCurrency} />;
}

function DashboardContent({ response }: { readonly response: AdminAnalyticsResponse }): React.JSX.Element {
  const statusData: readonly { readonly label: string; readonly value: number }[] = response.statuses.map((entry: AdminAnalyticsStatusDistribution) => ({ label: statusLabels[entry.status] ?? entry.status, value: entry.count }));
  const typeData: readonly { readonly label: string; readonly value: number }[] = response.types.map((entry: AdminAnalyticsTypeDistribution) => ({ label: entry.type === "pickup" ? "Самовывоз" : entry.type, value: entry.count }));
  const dishData: readonly { readonly label: string; readonly value: number }[] = response.topDishes.map((entry: AdminAnalyticsTopDish) => ({ label: entry.name, value: entry.quantity }));
  return <div className="dashboard-content">{response.dataStatus === "reconciliation_required" ? <div className="analytics-data-banner" role="alert"><strong>Часть данных требует сверки</strong><span>Надёжные агрегаты показаны без неподтверждённых возвратов.</span></div> : null}<div className="metrics"><MetricCard className="revenue" comparison={response.comparison.revenue.percent} icon="💰" label="Выручка" value={formatCurrency(response.kpi.revenueMinor)} /><MetricCard className="orders" comparison={response.comparison.orders.percent} icon="📦" label="Заказов" value={response.kpi.orders.toLocaleString("ru-RU")} /><MetricCard className="avg" comparison={response.comparison.averageCheck.percent} icon="🧾" label="Средний чек" value={formatCurrency(response.kpi.averageCheckMinor)} /><MetricCard className="customers" comparison={response.comparison.customers.percent} icon="👥" label="Клиентов" value={response.kpi.customers.toLocaleString("ru-RU")} /></div><div className="charts-row"><ChartCard title="📈 Выручка по дням"><RevenueChart data={response.revenueByDay} /></ChartCard><ChartCard title="🏆 Топ блюд"><BarChart ariaLabel="Топ блюд" data={dishData} /></ChartCard></div><div className="charts-row"><ChartCard title="📊 Статусы заказов"><BarChart ariaLabel="Статусы заказов" data={statusData} /></ChartCard><ChartCard title="🚗 Способ получения"><BarChart ariaLabel="Способы получения" data={typeData} /></ChartCard></div><div className="charts-row"><ChartCard title="📦 Последние заказы" className="recent-orders-card"><div className="dashboard-table-scroll"><table><thead><tr><th>#</th><th>Клиент</th><th>Сумма</th><th>Статус</th><th>Время</th></tr></thead><tbody>{response.recentOrders.length === 0 ? <tr><td className="dashboard-table-empty" colSpan={5}>Нет заказов за период</td></tr> : response.recentOrders.map((order) => <tr key={order.id}><td data-label="#">#{order.id}</td><td data-label="Клиент">{order.customerName ?? "Клиент не указан"}</td><td data-label="Сумма">{formatCurrency(order.totalMinor)}</td><td data-label="Статус"><span className="status-badge status-visible">{statusLabels[order.status] ?? order.status}</span></td><td data-label="Время">{formatDate(order.createdAt)}</td></tr>)}</tbody></table></div></ChartCard><ChartCard title="🔥 Популярные категории">{categoryContent(response.categories)}</ChartCard></div></div>;
}

export interface DashboardScreenProps { readonly client: AdminAnalyticsClient; }

export function DashboardScreen({ client }: DashboardScreenProps): React.JSX.Element {
  const [days, setDays] = useState<AdminAnalyticsPeriod>(30);
  const [state, setState] = useState<AdminAnalyticsState>({ status: "loading", days: 30 });
  const [exportState, setExportState] = useState<"idle" | "loading" | "error">("idle");
  const controllerRef = useRef<AdminAnalyticsRequestController | null>(null);

  useEffect(() => {
    const controller = createAdminAnalyticsRequestController(client, setState, days);
    controllerRef.current = controller;
    controller.load(days);
    return () => { controller.dispose(); if (controllerRef.current === controller) controllerRef.current = null; };
  }, [client]);

  const retry = useCallback((): void => { controllerRef.current?.retry(); }, []);
  const changePeriod = useCallback((value: string): void => { const next = Number(value) as AdminAnalyticsPeriod; if (!periods.includes(next)) return; setDays(next); controllerRef.current?.load(next); }, []);
  const exportCsv = useCallback(async (): Promise<void> => {
    setExportState("loading");
    try {
      const result = await client.exportCsv({ days });
      const blob = new Blob([result.content], { type: result.metadata.contentType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.metadata.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportState("idle");
    } catch {
      setExportState("error");
    }
  }, [client, days]);

  return <section aria-labelledby="dashboard-title" className="dashboard-screen"><div className="page-header"><div><h1 className="page-title" id="dashboard-title">Дашборд</h1><p className="page-subtitle">Серверная аналитика по данным PostgreSQL</p></div><div className="header-actions dashboard-actions"><label className="analytics-period-control"><span className="sr-only">Период аналитики</span><select aria-label="Период аналитики" className="table-search" onChange={(event) => changePeriod(event.target.value)} value={days}><option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option></select></label><button className="btn btn-outline" disabled={exportState === "loading" || state.status !== "success"} onClick={() => { void exportCsv(); }} type="button">⇩ {exportState === "loading" ? "Готовим CSV…" : "Экспорт CSV"}</button></div></div>{exportState === "error" ? <div className="catalog-action-error" role="alert">Не удалось подготовить CSV. Повторите попытку.</div> : null}{state.status === "loading" ? <AnalyticsLoading /> : state.status === "error" ? <div className="catalog-state catalog-state-error" role="alert"><strong>Не удалось загрузить аналитику</strong><span>{state.message}</span><button className="btn btn-outline" onClick={retry} type="button">Повторить</button></div> : state.status === "success" ? <DashboardContent response={state.response} /> : <AnalyticsLoading />}</section>;
}
