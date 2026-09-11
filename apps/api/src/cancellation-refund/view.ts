import {
  AdminRefundSummarySchema,
  CancellationSummarySchema,
  RefundSummarySchema,
  type AdminRefundSummary,
  type CancellationSummary,
  type RefundSummary
} from "@vse-pro-zhar/contracts";
import type {
  OrderCancellationRecord,
  RefundRecord
} from "@vse-pro-zhar/database";

function safeErrorCode(code: string | null): string | null {
  return code !== null && /^[A-Za-z0-9_.-]{1,80}$/u.test(code) ? code : null;
}

export function toCancellationSummary(
  cancellation: OrderCancellationRecord | null | undefined
): CancellationSummary | null {
  if (cancellation === null || cancellation === undefined) return null;
  const parsed = CancellationSummarySchema.safeParse({
    actorType: cancellation.actorType,
    reasonCode: cancellation.reasonCode,
    createdAt: cancellation.createdAt.toISOString(),
    updatedAt: cancellation.updatedAt.toISOString()
  });
  if (!parsed.success) throw new Error("Invalid cancellation state");
  return parsed.data;
}

export function toRefundSummary(
  refund: RefundRecord | null | undefined
): RefundSummary | null {
  if (refund === null || refund === undefined) return null;
  const parsed = RefundSummarySchema.safeParse({
    status: refund.status,
    amountMinor: refund.amountMinor,
    currency: refund.currency,
    attemptedAt: refund.lastAttemptAt?.toISOString() ?? null,
    lastConfirmedAt: refund.lastConfirmedAt?.toISOString() ?? null,
    lastErrorCode: safeErrorCode(refund.lastErrorCode)
  });
  if (!parsed.success) throw new Error("Invalid refund state");
  return parsed.data;
}

export function toAdminRefundSummary(
  refund: RefundRecord | null | undefined
): AdminRefundSummary | null {
  if (refund === null || refund === undefined) return null;
  const parsed = AdminRefundSummarySchema.safeParse({
    status: refund.status,
    amountMinor: refund.amountMinor,
    currency: refund.currency,
    providerRefundId: refund.providerRefundId,
    attemptedAt: refund.lastAttemptAt?.toISOString() ?? null,
    lastConfirmedAt: refund.lastConfirmedAt?.toISOString() ?? null,
    lastErrorCode: safeErrorCode(refund.lastErrorCode)
  });
  if (!parsed.success) throw new Error("Invalid admin refund state");
  return parsed.data;
}
