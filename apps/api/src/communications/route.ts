import {
  AdminCommunicationDraftCreateRequestSchema,
  AdminCommunicationDraftDetailResponseSchema,
  AdminCommunicationDraftListResponseSchema,
  AdminCommunicationDraftResponseSchema,
  AdminCommunicationDraftsQuerySchema,
  AdminCommunicationDraftUpdateRequestSchema,
  AdminCommunicationDraftVersionRequestSchema,
  AdminCommunicationPreviewRequestSchema,
  AdminCommunicationPreviewResponseSchema,
  AdminCommunicationsResponseSchema
} from "@vse-pro-zhar/contracts";
import {
  AdminCommunicationDraftIdempotencyConflictError,
  AdminCommunicationDraftVersionConflictError,
  type AdminCommunicationDraftRepository,
  type AdminPromoRepository,
  type AdminSegmentRepository
} from "@vse-pro-zhar/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { assertSafeOrigin } from "../auth/route.js";
import type { StaffGuard } from "../auth/staff-route.js";
import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";
import {
  AdminCommunicationNotFoundError,
  AdminCommunicationUnavailableError,
  AdminCommunicationValidationError,
  archiveAdminCommunicationDraft,
  createAdminCommunicationDraft,
  getAdminCommunicationDraft,
  getAdminCommunications,
  listAdminCommunicationDrafts,
  previewAdminCommunication,
  restoreAdminCommunicationDraft,
  updateAdminCommunicationDraft
} from "./service.js";

const ParamsSchema = z.object({ id: z.coerce.number().int().positive() }).strict();

export interface AdminCommunicationRouteOptions {
  readonly segmentRepository?: AdminSegmentRepository;
  readonly draftRepository?: AdminCommunicationDraftRepository;
  readonly promoRepository?: AdminPromoRepository;
  readonly staffGuard: StaffGuard;
  readonly config: ApiConfig;
  readonly now?: () => Date;
}

function mapError(error: unknown): never {
  if (error instanceof AdminCommunicationValidationError) throw new ApiRequestError("VALIDATION_ERROR", 400);
  if (error instanceof AdminCommunicationNotFoundError) throw new ApiRequestError("NOT_FOUND", 404);
  if (error instanceof AdminCommunicationDraftVersionConflictError) throw new ApiRequestError("COMMUNICATION_DRAFT_CONFLICT", 409);
  if (error instanceof AdminCommunicationDraftIdempotencyConflictError) throw new ApiRequestError("COMMUNICATION_IDEMPOTENCY_CONFLICT", 409);
  if (error instanceof AdminCommunicationUnavailableError) throw new ApiRequestError("COMMUNICATION_UNAVAILABLE", 503);
  throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    mapError(error);
  }
}

export function registerAdminCommunicationRoutes(app: FastifyInstance, options: AdminCommunicationRouteOptions): void {
  const now = options.now ?? (() => new Date());
  const draftRepository = (): AdminCommunicationDraftRepository => {
    if (options.draftRepository === undefined) throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    return options.draftRepository;
  };
  const segmentRepository = (): AdminSegmentRepository => {
    if (options.segmentRepository === undefined) throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    return options.segmentRepository;
  };

  app.get("/admin/communications", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    await options.staffGuard.require(request);
    const query = AdminCommunicationDraftsQuerySchema.safeParse(request.query);
    if (!query.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => getAdminCommunications(draftRepository(), options.promoRepository, query.data, now()));
    return reply.send(AdminCommunicationsResponseSchema.parse(response));
  });

  app.get("/admin/communications/drafts", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    await options.staffGuard.require(request);
    const query = AdminCommunicationDraftsQuerySchema.safeParse(request.query);
    if (!query.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => listAdminCommunicationDrafts(draftRepository(), query.data));
    return reply.send(AdminCommunicationDraftListResponseSchema.parse(response));
  });

  app.get("/admin/communications/drafts/:id", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    await options.staffGuard.require(request);
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => getAdminCommunicationDraft(draftRepository(), params.data.id));
    return reply.send(AdminCommunicationDraftDetailResponseSchema.parse(response));
  });

  app.post("/admin/communications/drafts", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    const staff = await options.staffGuard.require(request);
    const input = AdminCommunicationDraftCreateRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => createAdminCommunicationDraft(draftRepository(), segmentRepository(), options.promoRepository, input.data, staff.user.id, now()));
    return reply.code(response.created ? 201 : 200).send(AdminCommunicationDraftResponseSchema.parse(response.response));
  });

  app.patch("/admin/communications/drafts/:id", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    const staff = await options.staffGuard.require(request);
    const params = ParamsSchema.safeParse(request.params);
    const input = AdminCommunicationDraftUpdateRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => updateAdminCommunicationDraft(draftRepository(), segmentRepository(), options.promoRepository, params.data.id, input.data, staff.user.id, now()));
    return reply.send(AdminCommunicationDraftResponseSchema.parse(response));
  });

  app.post("/admin/communications/drafts/:id/archive", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    const staff = await options.staffGuard.require(request);
    const params = ParamsSchema.safeParse(request.params);
    const input = AdminCommunicationDraftVersionRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => archiveAdminCommunicationDraft(draftRepository(), params.data.id, input.data.expectedVersion, staff.user.id, now()));
    return reply.send(AdminCommunicationDraftResponseSchema.parse(response));
  });

  app.post("/admin/communications/drafts/:id/restore", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    const staff = await options.staffGuard.require(request);
    const params = ParamsSchema.safeParse(request.params);
    const input = AdminCommunicationDraftVersionRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => restoreAdminCommunicationDraft(draftRepository(), params.data.id, input.data.expectedVersion, staff.user.id, now()));
    return reply.send(AdminCommunicationDraftResponseSchema.parse(response));
  });

  app.post("/admin/communications/preview", async (request, reply) => {
    assertSafeOrigin(request, options.config);
    const staff = await options.staffGuard.require(request);
    const input = AdminCommunicationPreviewRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    const response = await run(() => previewAdminCommunication(segmentRepository(), options.draftRepository, options.promoRepository, input.data, staff.user.id, now()));
    return reply.send(AdminCommunicationPreviewResponseSchema.parse(response));
  });
}
