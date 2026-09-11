import { z } from "zod";

import { OrderStatusSchema } from "./orders.js";

const SafeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const MoneyMinorSchema = SafeIntegerSchema;
const DateTimeSchema = z.iso.datetime({ offset: true });
const DateSchema = z.iso.date();

export const AdminAnalyticsPeriodSchema = z.union([
  z.literal(7),
  z.literal(30),
  z.literal(90)
]);
export type AdminAnalyticsPeriod = z.infer<typeof AdminAnalyticsPeriodSchema>;

export const AdminAnalyticsQuerySchema = z
  .object({ days: AdminAnalyticsPeriodSchema })
  .strict();
export type AdminAnalyticsQuery = z.infer<typeof AdminAnalyticsQuerySchema>;

export const AdminAnalyticsComparisonSchema = z
  .object({ percent: z.number().finite().nullable() })
  .strict();
export type AdminAnalyticsComparison = z.infer<typeof AdminAnalyticsComparisonSchema>;

export const AdminAnalyticsKpiSchema = z
  .object({
    revenueMinor: MoneyMinorSchema,
    orders: SafeIntegerSchema,
    averageCheckMinor: MoneyMinorSchema.nullable(),
    customers: SafeIntegerSchema,
    currency: z.literal("RUB")
  })
  .strict();
export type AdminAnalyticsKpi = z.infer<typeof AdminAnalyticsKpiSchema>;

export const AdminAnalyticsDailyRevenueSchema = z
  .object({ date: DateSchema, revenueMinor: MoneyMinorSchema })
  .strict();
export type AdminAnalyticsDailyRevenue = z.infer<typeof AdminAnalyticsDailyRevenueSchema>;

export const AdminAnalyticsTopDishSchema = z
  .object({
    productId: z.number().int().positive().max(2_147_483_647),
    name: z.string().trim().min(1).max(160),
    quantity: SafeIntegerSchema,
    revenueMinor: MoneyMinorSchema
  })
  .strict();
export type AdminAnalyticsTopDish = z.infer<typeof AdminAnalyticsTopDishSchema>;

export const AdminAnalyticsStatusDistributionSchema = z
  .object({ status: OrderStatusSchema, count: SafeIntegerSchema })
  .strict();
export type AdminAnalyticsStatusDistribution = z.infer<typeof AdminAnalyticsStatusDistributionSchema>;

export const AdminAnalyticsOrderTypeSchema = z.literal("pickup");
export const AdminAnalyticsTypeDistributionSchema = z
  .object({ type: AdminAnalyticsOrderTypeSchema, count: SafeIntegerSchema })
  .strict();
export type AdminAnalyticsTypeDistribution = z.infer<typeof AdminAnalyticsTypeDistributionSchema>;

export const AdminAnalyticsCategorySchema = z
  .object({ name: z.string().trim().min(1).max(160), revenueMinor: MoneyMinorSchema })
  .strict();
export type AdminAnalyticsCategory = z.infer<typeof AdminAnalyticsCategorySchema>;

export const AdminAnalyticsCategoryDataSchema = z
  .object({
    status: z.enum(["available", "unavailable"]),
    reason: z.enum(["historical_snapshot_missing"]).nullable(),
    items: z.array(AdminAnalyticsCategorySchema).max(10).readonly()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "available" && value.reason !== null) {
      context.addIssue({ code: "custom", message: "Available category data cannot have an unavailable reason" });
    }
    if (value.status === "unavailable" && value.reason === null) {
      context.addIssue({ code: "custom", message: "Unavailable category data must have a reason" });
    }
    if (value.status === "unavailable" && value.items.length > 0) {
      context.addIssue({ code: "custom", message: "Unavailable category data cannot contain items" });
    }
  });
export type AdminAnalyticsCategoryData = z.infer<typeof AdminAnalyticsCategoryDataSchema>;

export const AdminAnalyticsRecentOrderSchema = z
  .object({
    id: z.number().int().positive().max(2_147_483_647),
    customerName: z.string().trim().min(1).max(160).nullable(),
    totalMinor: MoneyMinorSchema,
    currency: z.literal("RUB"),
    status: OrderStatusSchema,
    createdAt: DateTimeSchema
  })
  .strict();
export type AdminAnalyticsRecentOrder = z.infer<typeof AdminAnalyticsRecentOrderSchema>;

export const AdminAnalyticsResponseSchema = z
  .object({
    period: AdminAnalyticsPeriodSchema,
    timezone: z.literal("Europe/Moscow"),
    range: z
      .object({ start: DateTimeSchema, end: DateTimeSchema })
      .strict(),
    comparisonRange: z
      .object({ start: DateTimeSchema, end: DateTimeSchema })
      .strict(),
    dataStatus: z.enum(["available", "empty", "reconciliation_required"]),
    kpi: AdminAnalyticsKpiSchema,
    comparison: z
      .object({
        revenue: AdminAnalyticsComparisonSchema,
        orders: AdminAnalyticsComparisonSchema,
        averageCheck: AdminAnalyticsComparisonSchema,
        customers: AdminAnalyticsComparisonSchema
      })
      .strict(),
    revenueByDay: z.array(AdminAnalyticsDailyRevenueSchema).max(90).readonly(),
    topDishes: z.array(AdminAnalyticsTopDishSchema).max(10).readonly(),
    statuses: z.array(AdminAnalyticsStatusDistributionSchema).max(8).readonly(),
    types: z.array(AdminAnalyticsTypeDistributionSchema).max(2).readonly(),
    categories: AdminAnalyticsCategoryDataSchema,
    recentOrders: z.array(AdminAnalyticsRecentOrderSchema).max(10).readonly()
  })
  .strict();
export type AdminAnalyticsResponse = z.infer<typeof AdminAnalyticsResponseSchema>;

export const AdminAnalyticsExportMetadataSchema = z
  .object({
    filename: z.string().regex(/^admin-analytics-(7|30|90)-days-[0-9]{4}-[0-9]{2}-[0-9]{2}\.csv$/u),
    contentType: z.literal("text/csv; charset=utf-8"),
    period: AdminAnalyticsPeriodSchema
  })
  .strict();
export type AdminAnalyticsExportMetadata = z.infer<typeof AdminAnalyticsExportMetadataSchema>;

export const AdminAnalyticsExportResponseSchema = z
  .object({
    metadata: AdminAnalyticsExportMetadataSchema,
    content: z.string().max(300_000)
  })
  .strict();
export type AdminAnalyticsExportResponse = z.infer<typeof AdminAnalyticsExportResponseSchema>;
