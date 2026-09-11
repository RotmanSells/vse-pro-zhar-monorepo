import {
  AdminBuiltinSegmentDefinitionSchema,
  AdminSegmentCodeSchema,
  AdminSegmentPreviewResponseSchema,
  AdminSegmentsResponseSchema,
  type AdminBuiltinSegmentDefinition,
  type AdminSegmentCode,
  type AdminSegmentPreviewQuery,
  type AdminSegmentPreviewResponse,
  type AdminSegmentsResponse
} from "@vse-pro-zhar/contracts";
import type {
  AdminSegmentRepository,
  AdminSegmentRepositoryCount,
  AdminSegmentRepositoryPreview
} from "@vse-pro-zhar/database";

export const ADMIN_SEGMENT_TIMEZONE = "Europe/Moscow" as const;
export const ADMIN_SEGMENT_DEFINITION_VERSION = 1 as const;

const BUILTIN_SEGMENTS: readonly Omit<AdminBuiltinSegmentDefinition, "count">[] = [
  {
    code: "sleeping",
    kind: "builtin",
    icon: "😴",
    title: "Спящие",
    description: "Не заказывали больше 30 дней",
    badge: { tone: "warning", label: "Риск" },
    criteria: [{ metric: "inactive_days", operator: "gte", unit: "days", value: 30 }]
  },
  {
    code: "one_timer",
    kind: "builtin",
    icon: "🎰",
    title: "Одноразовые",
    description: "Заказали только 1 раз",
    badge: { tone: "danger", label: "Уходят" },
    criteria: [{ metric: "orders", operator: "eq", unit: "orders", value: 1 }]
  },
  {
    code: "churned",
    kind: "builtin",
    icon: "💔",
    title: "Потерянные",
    description: "Не заказывали 14–30 дней",
    badge: { tone: "warning", label: "На грани" },
    criteria: [
      { metric: "inactive_days", operator: "gte", unit: "days", value: 14 },
      { metric: "inactive_days", operator: "lt", unit: "days", value: 30 }
    ]
  },
  {
    code: "newbies",
    kind: "builtin",
    icon: "🌟",
    title: "Новички",
    description: "Первый заказ за последние 7 дней",
    badge: { tone: "info", label: "Новые" },
    criteria: [
      { metric: "orders", operator: "eq", unit: "orders", value: 1 },
      { metric: "active_days", operator: "lte", unit: "days", value: 7 }
    ]
  },
  {
    code: "regulars",
    kind: "builtin",
    icon: "🔥",
    title: "Постоянные",
    description: "3 и более заказов",
    badge: { tone: "success", label: "Лояльные" },
    criteria: [{ metric: "orders", operator: "gte", unit: "orders", value: 3 }]
  },
  {
    code: "vip",
    kind: "builtin",
    icon: "👑",
    title: "VIP",
    description: "Потратили больше 5000₽",
    badge: { tone: "purple", label: "VIP" },
    criteria: [{ metric: "spend", operator: "gte", unit: "RUB_minor", value: 500_000 }]
  },
  {
    code: "big_spenders",
    kind: "builtin",
    icon: "💰",
    title: "Крупные чеки",
    description: "Средний чек больше 1500₽",
    badge: { tone: "success", label: "Топ" },
    criteria: [{ metric: "average_check", operator: "gte", unit: "RUB_minor", value: 150_000 }]
  },
  {
    code: "coal_rich",
    kind: "builtin",
    icon: "💎",
    title: "Богатые угольками",
    description: "Больше 300 угольков",
    badge: { tone: "info", label: "Копят" },
    criteria: [{ metric: "coal_balance", operator: "gte", unit: "coal", value: 300 }]
  },
  {
    code: "at_risk",
    kind: "builtin",
    icon: "⚠️",
    title: "Уходят",
    description: "Были активны, но пропали на 7–14 дней",
    badge: { tone: "danger", label: "Риск" },
    criteria: [
      { metric: "inactive_days", operator: "gte", unit: "days", value: 7 },
      { metric: "inactive_days", operator: "lt", unit: "days", value: 14 }
    ]
  }
];

function definitionFor(code: AdminSegmentCode): Omit<AdminBuiltinSegmentDefinition, "count"> {
  const definition = BUILTIN_SEGMENTS.find((candidate) => candidate.code === code);
  if (definition === undefined) throw new Error("Built-in segment definition is missing");
  return definition;
}

function countFor(result: AdminSegmentRepositoryCount): AdminBuiltinSegmentDefinition["count"] {
  return result.unavailableReason === null
    ? { status: "confirmed", count: result.count }
    : { status: "unavailable", reason: result.unavailableReason };
}

function segmentWithCount(result: AdminSegmentRepositoryCount): AdminBuiltinSegmentDefinition {
  return AdminBuiltinSegmentDefinitionSchema.parse({
    ...definitionFor(result.code),
    count: countFor(result)
  });
}

function listResult(
  results: readonly AdminSegmentRepositoryCount[],
  now: Date
): AdminSegmentsResponse {
  const byCode = new Map(results.map((result) => [result.code, result]));
  const builtins = BUILTIN_SEGMENTS.map((definition) => {
    const result = byCode.get(definition.code);
    if (result === undefined) throw new Error("Built-in segment count is missing");
    return segmentWithCount(result);
  });
  return AdminSegmentsResponseSchema.parse({
    status: "confirmed",
    timezone: ADMIN_SEGMENT_TIMEZONE,
    asOf: now.toISOString(),
    builtins,
    customSegments: [],
    customLifecycle: { status: "unavailable", reason: "owner_decision_required" }
  });
}

function previewResponse(
  code: AdminSegmentCode,
  query: AdminSegmentPreviewQuery,
  preview: AdminSegmentRepositoryPreview
): AdminSegmentPreviewResponse {
  const count: AdminBuiltinSegmentDefinition["count"] = preview.unavailableReason === null
    ? { status: "confirmed", count: preview.total }
    : { status: "unavailable", reason: preview.unavailableReason };
  const segment = AdminBuiltinSegmentDefinitionSchema.parse({ ...definitionFor(code), count });
  const pagination = {
    limit: query.limit,
    offset: query.offset,
    total: preview.unavailableReason === null ? preview.total : 0,
    hasNext: preview.unavailableReason === null && query.offset + preview.rows.length < preview.total
  };
  if (preview.unavailableReason !== null) {
    return AdminSegmentPreviewResponseSchema.parse({
      status: "unavailable",
      segment,
      reason: preview.unavailableReason,
      customers: [],
      pagination
    });
  }
  return AdminSegmentPreviewResponseSchema.parse({
    status: "confirmed",
    segment,
    customers: preview.rows.map((row) => ({
      ...row,
      lastActivityAt: row.lastActivityAt?.toISOString() ?? null
    })),
    pagination,
    dataStatus: preview.total === 0 ? "empty" : "available"
  });
}

export function getBuiltinSegmentDefinitions(): readonly Omit<AdminBuiltinSegmentDefinition, "count">[] {
  return BUILTIN_SEGMENTS;
}

export async function getAdminSegments(
  repository: AdminSegmentRepository,
  now: Date
): Promise<AdminSegmentsResponse> {
  if (Number.isNaN(now.getTime())) throw new Error("Segment clock is invalid");
  return listResult(await repository.listBuiltinCounts(now), now);
}

export async function getAdminSegmentPreview(
  repository: AdminSegmentRepository,
  codeInput: string,
  query: AdminSegmentPreviewQuery,
  now: Date
): Promise<AdminSegmentPreviewResponse> {
  const parsedCode = AdminSegmentCodeSchema.safeParse(codeInput);
  if (!parsedCode.success) throw new Error("Segment code is invalid");
  if (Number.isNaN(now.getTime())) throw new Error("Segment clock is invalid");
  return previewResponse(parsedCode.data, query, await repository.preview(parsedCode.data, query, now));
}
