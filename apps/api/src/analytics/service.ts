import {
  AdminAnalyticsExportResponseSchema,
  AdminAnalyticsPeriodSchema,
  AdminAnalyticsResponseSchema,
  type AdminAnalyticsExportResponse,
  type AdminAnalyticsPeriod,
  type AdminAnalyticsResponse
} from "@vse-pro-zhar/contracts";
import type {
  AdminAnalyticsRepository,
  AdminAnalyticsRepositoryResult,
  AdminAnalyticsWindow,
  AdminAnalyticsWindowResult
} from "@vse-pro-zhar/database";

const TIMEZONE = "Europe/Moscow" as const;

interface LocalDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface AdminAnalyticsPeriodBounds {
  readonly period: AdminAnalyticsPeriod;
  readonly timezone: typeof TIMEZONE;
  readonly current: AdminAnalyticsWindow;
  readonly previous: AdminAnalyticsWindow;
  readonly currentStart: LocalDateParts;
}

const localDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function localDateParts(value: Date): LocalDateParts {
  const parts = localDateFormatter.formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(values.get("year"));
  const month = Number(values.get("month"));
  const day = Number(values.get("day"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error("Could not resolve analytics local date");
  }
  return { year, month, day };
}

function timezonePartsAt(value: Date): LocalDateParts & { readonly hour: number; readonly minute: number; readonly second: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second"))
  };
}

function instantAtLocalMidnight(parts: LocalDateParts): Date {
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const guess = new Date(localAsUtc);
  const resolved = timezonePartsAt(guess);
  const resolvedAsUtc = Date.UTC(resolved.year, resolved.month - 1, resolved.day, resolved.hour, resolved.minute, resolved.second);
  const offsetMs = resolvedAsUtc - localAsUtc;
  return new Date(localAsUtc - offsetMs);
}

function shiftLocalDate(parts: LocalDateParts, days: number): LocalDateParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function dateKey(parts: LocalDateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function assertValidNow(now: Date): void {
  if (Number.isNaN(now.getTime())) throw new Error("Analytics clock returned an invalid date");
}

export function calculateAdminAnalyticsPeriod(days: AdminAnalyticsPeriod, now: Date): AdminAnalyticsPeriodBounds {
  const parsedDays = AdminAnalyticsPeriodSchema.safeParse(days);
  if (!parsedDays.success) throw new Error("Unsupported analytics period");
  assertValidNow(now);
  const today = localDateParts(now);
  const currentStartParts = shiftLocalDate(today, -(days - 1));
  const currentEndParts = shiftLocalDate(today, 1);
  const previousStartParts = shiftLocalDate(today, -(days * 2 - 1));
  const currentStart = instantAtLocalMidnight(currentStartParts);
  return {
    period: days,
    timezone: TIMEZONE,
    current: { start: currentStart, end: instantAtLocalMidnight(currentEndParts) },
    previous: { start: instantAtLocalMidnight(previousStartParts), end: currentStart },
    currentStart: currentStartParts
  };
}

function comparisonPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function averageCheckMinor(window: AdminAnalyticsWindowResult): number | null {
  if (window.qualifyingOrders === 0) return null;
  return Math.floor(window.revenueMinor / window.qualifyingOrders);
}

function filledRevenueSeries(window: AdminAnalyticsWindowResult, start: LocalDateParts, days: AdminAnalyticsPeriod): readonly { readonly date: string; readonly revenueMinor: number }[] {
  const values = new Map(window.revenueByDay.map((entry) => [entry.date, entry.revenueMinor]));
  return Array.from({ length: days }, (_, index) => {
    const date = dateKey(shiftLocalDate(start, index));
    return { date, revenueMinor: values.get(date) ?? 0 };
  });
}

function buildResponse(
  bounds: AdminAnalyticsPeriodBounds,
  result: AdminAnalyticsRepositoryResult
): AdminAnalyticsResponse {
  const currentAverage = averageCheckMinor(result.current);
  const previousAverage = averageCheckMinor(result.previous);
  const response = {
    period: bounds.period,
    timezone: TIMEZONE,
    range: { start: bounds.current.start.toISOString(), end: bounds.current.end.toISOString() },
    comparisonRange: { start: bounds.previous.start.toISOString(), end: bounds.previous.end.toISOString() },
    dataStatus: result.current.reconciliationRequired
      ? "reconciliation_required"
      : result.current.orders === 0
        ? "empty"
        : "available",
    kpi: {
      revenueMinor: result.current.revenueMinor,
      orders: result.current.orders,
      averageCheckMinor: currentAverage,
      customers: result.current.customers,
      currency: "RUB"
    },
    comparison: {
      revenue: { percent: comparisonPercent(result.current.revenueMinor, result.previous.revenueMinor) },
      orders: { percent: comparisonPercent(result.current.orders, result.previous.orders) },
      averageCheck: {
        percent: currentAverage === null || previousAverage === null
          ? null
          : comparisonPercent(currentAverage, previousAverage)
      },
      customers: { percent: comparisonPercent(result.current.customers, result.previous.customers) }
    },
    revenueByDay: filledRevenueSeries(result.current, bounds.currentStart, bounds.period),
    topDishes: result.current.topDishes,
    statuses: result.current.statuses,
    types: result.current.pickupOrders === 0 ? [] : [{ type: "pickup", count: result.current.pickupOrders }],
    categories: result.categories,
    recentOrders: result.current.recentOrders.map((order) => ({
      id: order.id,
      customerName: order.customerName,
      totalMinor: order.totalMinor,
      currency: "RUB",
      status: order.status,
      createdAt: order.createdAt.toISOString()
    }))
  } satisfies AdminAnalyticsResponse;
  return AdminAnalyticsResponseSchema.parse(response);
}

export async function getAdminAnalytics(
  repository: AdminAnalyticsRepository,
  days: AdminAnalyticsPeriod,
  now: Date
): Promise<AdminAnalyticsResponse> {
  const bounds = calculateAdminAnalyticsPeriod(days, now);
  const result = await repository.read({ current: bounds.current, previous: bounds.previous });
  return buildResponse(bounds, result);
}

function csvCell(value: string | number): string {
  const raw = String(value);
  const safe = /^[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csvRow(values: readonly (string | number)[]): string {
  return values.map(csvCell).join(",");
}

export function buildAdminAnalyticsExport(response: AdminAnalyticsResponse): AdminAnalyticsExportResponse {
  const rows: string[] = [
    csvRow(["Раздел", "Показатель", "Значение", "Единица"]),
    csvRow(["Период", "Дней", response.period, "calendar_days"]),
    csvRow(["Период", "Часовой пояс", response.timezone, "timezone"]),
    csvRow(["KPI", "Выручка", response.kpi.revenueMinor, "RUB minor units"]),
    csvRow(["KPI", "Заказы", response.kpi.orders, "orders"]),
    csvRow(["KPI", "Средний чек", response.kpi.averageCheckMinor ?? "—", "RUB minor units"]),
    csvRow(["KPI", "Клиенты", response.kpi.customers, "customers"]),
    csvRow(["Выручка по дням", "Дата", "Выручка", "RUB minor units"]),
    ...response.revenueByDay.map((entry) => csvRow(["Выручка по дням", entry.date, entry.revenueMinor, "RUB minor units"])),
    csvRow(["Статусы", "Статус", "Количество", "orders"]),
    ...response.statuses.map((entry) => csvRow(["Статусы", entry.status, entry.count, "orders"])),
    csvRow(["Способ получения", "Тип", "Количество", "orders"]),
    ...response.types.map((entry) => csvRow(["Способ получения", entry.type, entry.count, "orders"])),
    csvRow(["Топ блюд", "Блюдо", "Количество", "Выручка, RUB minor units"]),
    ...response.topDishes.map((entry) => csvRow(["Топ блюд", entry.name, entry.quantity, entry.revenueMinor])),
    csvRow(["Категории", "Статус", response.categories.status, response.categories.reason ?? "available"]),
    csvRow(["Качество данных", "Статус", response.dataStatus, "state"])
  ];
  const content = `\uFEFF${rows.join("\r\n")}\r\n`;
  return AdminAnalyticsExportResponseSchema.parse({
    metadata: {
      filename: `admin-analytics-${response.period}-days-${dateKey(localDateParts(new Date(response.range.start)))}.csv`,
      contentType: "text/csv; charset=utf-8",
      period: response.period
    },
    content
  });
}
