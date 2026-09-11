import { createHash } from "node:crypto";

import {
  CancellationRequestSchema,
  IdempotencyKeySchema,
  YooKassaRefundObjectSchema,
  YooKassaWebhookPayloadSchema,
  YooKassaRefundWebhookEventSchema,
  type CancellationOutcome
} from "@vse-pro-zhar/contracts";
import type {
  CancelOrderResult,
  CancellationRefundOrderState,
  CancellationRefundRepository,
  StaffRepository
} from "@vse-pro-zhar/database";
import {
  CancellationNotAllowedError,
  CancellationOrderNotFoundError,
  OrderAlreadyCanceledError,
  RefundInvariantError
} from "@vse-pro-zhar/database";

import {
  CustomerAuthService,
  CustomerSessionError
} from "../auth/service.js";
import { YooKassaProviderError, type RefundProvider } from "../payments/provider.js";
import {
  CancellationAuthenticationError,
  CancellationNotFoundError,
  CancellationUnavailableError,
  CancellationValidationError,
  RefundPendingError,
  RefundReconciliationRequiredError
} from "./errors.js";

export interface CancellationRefundServiceOptions {
  readonly repository: CancellationRefundRepository;
  readonly authService?: CustomerAuthService;
  readonly refundProvider?: RefundProvider;
  readonly staffRepository?: StaffRepository;
  readonly now: () => Date;
}

export interface CancellationOperationResult {
  readonly state: CancellationRefundOrderState;
  readonly outcome: CancellationOutcome;
}

function outcomeForState(
  result: CancelOrderResult,
  requested: boolean
): CancellationOutcome {
  if (result.outcome === "already_canceled") {
    return result.state.refund?.status === "reconciliation_required"
      ? "reconciliation_required"
      : result.state.refund?.status === "pending"
        ? "refund_pending"
        : result.state.refund?.status === "canceled"
          ? "refund_failed"
        : "already_canceled";
  }
  if (!requested) return "already_canceled";
  if (result.state.refund?.status === "reconciliation_required") return "reconciliation_required";
  if (result.state.refund?.status === "pending") return "refund_pending";
  if (result.state.refund?.status === "canceled") return "refund_failed";
  return "accepted";
}

function validateId(orderId: number, idempotencyKey: string): string {
  const parsed = IdempotencyKeySchema.safeParse(idempotencyKey);
  if (!Number.isSafeInteger(orderId) || orderId < 1 || !parsed.success) {
    throw new CancellationValidationError();
  }
  return parsed.data;
}

function mapRepositoryError(error: unknown): never {
  if (error instanceof CancellationOrderNotFoundError) throw new CancellationNotFoundError();
  if (error instanceof OrderAlreadyCanceledError) throw error;
  if (error instanceof CancellationNotAllowedError) throw error;
  if (error instanceof RefundInvariantError) throw new CancellationUnavailableError();
  throw error;
}

export class CancellationRefundService {
  constructor(private readonly options: CancellationRefundServiceOptions) {}

  private async requireCustomer(token: string | null) {
    if (this.options.authService === undefined) throw new CancellationUnavailableError();
    try {
      return await this.options.authService.getActiveSession(token);
    } catch (error: unknown) {
      if (error instanceof CustomerSessionError) throw new CancellationAuthenticationError();
      throw error;
    }
  }

  async cancelCustomer(
    token: string | null,
    orderId: number,
    input: unknown,
    idempotencyKey: string
  ): Promise<CancellationOperationResult> {
    const normalizedIdempotencyKey = validateId(orderId, idempotencyKey);
    if (!CancellationRequestSchema.safeParse(input).success) throw new CancellationValidationError();
    const session = await this.requireCustomer(token);
    const state = await this.options.repository.findByCustomerAndOrder(session.customer.id, orderId);
    if (state === null) throw new CancellationNotFoundError();
    try {
      const result = await this.options.repository.cancelOrder({
        orderId,
        actorType: "customer",
        customerId: session.customer.id,
        reasonCode: "customer_requested",
        idempotencyKey: normalizedIdempotencyKey,
        now: this.options.now()
      });
      return { state: result.state, outcome: outcomeForState(result, true) };
    } catch (error: unknown) {
      mapRepositoryError(error);
    }
  }

  async cancelAdmin(
    orderId: number,
    staffUserId: number,
    requestId: string,
    idempotencyKey: string
  ): Promise<CancellationOperationResult> {
    const normalizedIdempotencyKey = validateId(orderId, idempotencyKey);
    try {
      const result = await this.options.repository.cancelOrder({
        orderId,
        actorType: "admin",
        staffUserId,
        reasonCode: "admin_requested",
        idempotencyKey: normalizedIdempotencyKey,
        requestId,
        now: this.options.now()
      });
      return { state: result.state, outcome: outcomeForState(result, true) };
    } catch (error: unknown) {
      mapRepositoryError(error);
    }
  }

  async reconcileAdmin(
    orderId: number,
    staffUserId: number,
    requestId: string
  ): Promise<CancellationOperationResult> {
    if (!Number.isSafeInteger(orderId) || orderId < 1) throw new CancellationValidationError();
    const state = await this.options.repository.findByOrderId(orderId);
    if (state === null) throw new CancellationNotFoundError();
    const refund = state.refund;
    if (refund === null) throw new RefundReconciliationRequiredError();
    if (refund.status === "succeeded") return { state, outcome: "accepted" };
    if (refund.status === "pending" && refund.providerRefundId === null) throw new RefundPendingError();
    if (refund.providerRefundId === null) throw new RefundReconciliationRequiredError();
    const provider = this.options.refundProvider;
    if (provider === undefined) throw new CancellationUnavailableError();
    try {
      const result = await provider.getRefund(refund.providerRefundId);
      const updated = await this.options.repository.applyProviderResult(refund.id, result, this.options.now());
      await this.options.staffRepository?.recordAudit({
        staffUserId,
        action: "refund_reconcile",
        orderId,
        requestId,
        createdAt: this.options.now()
      });
      const finalState = await this.options.repository.findByOrderId(orderId);
      if (finalState === null) throw new CancellationUnavailableError();
      return {
        state: finalState,
        outcome: updated.status === "succeeded" ? "accepted" : updated.status === "pending" ? "refund_pending" : updated.status === "canceled" ? "refund_failed" : "reconciliation_required"
      };
    } catch (error: unknown) {
      if (error instanceof YooKassaProviderError) {
        await this.options.repository.markReconciliationRequired(refund.id, "provider_unavailable", this.options.now());
        throw new RefundReconciliationRequiredError();
      }
      if (error instanceof RefundInvariantError) throw new CancellationUnavailableError();
      throw error;
    }
  }

  async processClaimedRefund(
    claimed: Awaited<ReturnType<CancellationRefundRepository["claimNextDue"]>>,
    maxAttempts = 12
  ): Promise<void> {
    if (claimed === null) return;
    const provider = this.options.refundProvider;
    if (provider === undefined) {
      await this.options.repository.markReconciliationRequired(claimed.refund.id, "provider_not_configured", this.options.now());
      return;
    }
    if (
      claimed.order.status !== "canceled" ||
      claimed.payment.status !== "succeeded" ||
      claimed.payment.providerStatus !== "succeeded" ||
      claimed.payment.amountMinor !== claimed.refund.amountMinor ||
      claimed.payment.currency !== claimed.refund.currency
    ) {
      await this.options.repository.markReconciliationRequired(claimed.refund.id, "local_invariant_failed", this.options.now());
      return;
    }
    if (claimed.refund.attemptCount > maxAttempts) {
      await this.options.repository.markReconciliationRequired(claimed.refund.id, "retry_exhausted", this.options.now());
      return;
    }
    try {
      const result = claimed.refund.providerRefundId === null
        ? await provider.createRefund({
            orderId: claimed.order.id,
            paymentProviderId: claimed.payment.providerPaymentId,
            amountMinor: claimed.refund.amountMinor,
            currency: claimed.refund.currency,
            idempotencyKey: claimed.refund.idempotencyKey
          })
        : await provider.getRefund(claimed.refund.providerRefundId);
      await this.options.repository.applyProviderResult(claimed.refund.id, result, this.options.now());
    } catch (error: unknown) {
      if (error instanceof YooKassaProviderError) {
        await this.options.repository.markReconciliationRequired(
          claimed.refund.id,
          error.kind === "invalid_response" ? "provider_invalid_response" : "provider_unknown_result",
          this.options.now()
        );
        return;
      }
      if (error instanceof RefundInvariantError) {
        await this.options.repository.markReconciliationRequired(claimed.refund.id, "provider_mismatch", this.options.now());
        return;
      }
      throw error;
    }
  }

  async handleRefundWebhook(input: unknown): Promise<"processed" | "duplicate" | "ignored"> {
    const envelope = YooKassaWebhookPayloadSchema.safeParse(input);
    if (!envelope.success || !YooKassaRefundWebhookEventSchema.safeParse(envelope.data.event).success) {
      return "ignored";
    }
    const object = YooKassaRefundObjectSchema.safeParse(envelope.data.object);
    if (!object.success || object.data.status !== "succeeded") {
      throw new CancellationUnavailableError();
    }
    const local = await this.options.repository.findByProviderRefundId(object.data.id);
    if (local === null) throw new CancellationUnavailableError();
    const provider = this.options.refundProvider;
    if (provider === undefined) throw new CancellationUnavailableError();
    let current;
    try {
      current = await provider.getRefund(object.data.id);
    } catch (error: unknown) {
      if (error instanceof YooKassaProviderError) throw new CancellationUnavailableError();
      throw error;
    }
    const [rublesText, kopecksText] = object.data.amount.value.split(".");
    if (rublesText === undefined || kopecksText === undefined) throw new CancellationUnavailableError();
    let amountMinor: number;
    try {
      const value = BigInt(rublesText) * 100n + BigInt(kopecksText);
      if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error();
      amountMinor = Number(value);
    } catch {
      throw new CancellationUnavailableError();
    }
    if (
      current.providerRefundId !== object.data.id ||
      current.providerStatus !== "succeeded" ||
      current.paymentProviderId !== object.data.payment_id ||
      current.amountMinor !== amountMinor ||
      current.currency !== object.data.amount.currency
    ) throw new CancellationUnavailableError();
    const result = await this.options.repository.recordProviderEvent({
      provider: "yookassa",
      providerRefundId: current.providerRefundId,
      eventType: "refund.succeeded",
      eventFingerprint: CancellationRefundService.fingerprintWebhook({
        id: object.data.id,
        status: object.data.status,
        paymentId: object.data.payment_id,
        amountMinor,
        currency: object.data.amount.currency
      }),
      providerStatus: current.providerStatus,
      paymentProviderId: current.paymentProviderId,
      amountMinor: current.amountMinor,
      currency: current.currency,
      receivedAt: this.options.now()
    });
    if (result.duplicate) return "duplicate";
    return result.ignored ? "ignored" : "processed";
  }

  static fingerprintWebhook(input: { readonly id: string; readonly status: string; readonly paymentId: string; readonly amountMinor: number; readonly currency: string }): string {
    return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
  }
}
