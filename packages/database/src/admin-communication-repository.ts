import { desc, eq, sql } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";
import { communicationDraftAudit, communicationDrafts } from "./schema.js";

export type AdminCommunicationDraftStatus = "draft" | "previewed" | "archived";
export type AdminCommunicationDraftAuditAction = "created" | "updated" | "previewed" | "archived" | "restored";
export type AdminCommunicationChannel = "push" | "sms";
export type AdminCommunicationPromoType = "percent" | "fixed";

export interface AdminCommunicationDraftRepositoryRow {
  readonly id: number;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly templateCode: string;
  readonly templateVersion: number;
  readonly templateTitle: string;
  readonly body: string;
  readonly channel: AdminCommunicationChannel;
  readonly delaySeconds: number;
  readonly segmentCode: string;
  readonly segmentDefinitionId: string;
  readonly segmentDefinitionVersion: number;
  readonly previewCount: number | null;
  readonly previewGeneratedAt: Date | null;
  readonly previewSegmentAsOf: Date | null;
  readonly promoDefinitionId: number | null;
  readonly promoDefinitionVersion: number | null;
  readonly promoCode: string | null;
  readonly promoType: AdminCommunicationPromoType | null;
  readonly promoValue: number | null;
  readonly status: AdminCommunicationDraftStatus;
  readonly createdByStaffUserId: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly archivedAt: Date | null;
  readonly version: number;
}

export interface AdminCommunicationDraftAuditRepositoryRow {
  readonly id: number;
  readonly action: AdminCommunicationDraftAuditAction;
  readonly fromStatus: AdminCommunicationDraftStatus | null;
  readonly toStatus: AdminCommunicationDraftStatus;
  readonly actorStaffUserId: number;
  readonly version: number;
  readonly createdAt: Date;
}

export interface AdminCommunicationDraftRepositoryResult {
  readonly rows: readonly AdminCommunicationDraftRepositoryRow[];
  readonly total: number;
}

export interface AdminCommunicationDraftRepositoryDetail {
  readonly draft: AdminCommunicationDraftRepositoryRow;
  readonly audit: readonly AdminCommunicationDraftAuditRepositoryRow[];
}

export interface AdminCommunicationDraftCreateInput {
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly templateCode: string;
  readonly templateVersion: number;
  readonly templateTitle: string;
  readonly body: string;
  readonly channel: AdminCommunicationChannel;
  readonly delaySeconds: number;
  readonly segmentCode: string;
  readonly segmentDefinitionId: string;
  readonly segmentDefinitionVersion: number;
  readonly promoDefinitionId: number | null;
  readonly promoDefinitionVersion: number | null;
  readonly promoCode: string | null;
  readonly promoType: AdminCommunicationPromoType | null;
  readonly promoValue: number | null;
  readonly createdByStaffUserId: number;
  readonly createdAt: Date;
}

export interface AdminCommunicationDraftUpdateInput {
  readonly expectedVersion: number;
  readonly templateCode: string;
  readonly templateVersion: number;
  readonly templateTitle: string;
  readonly body: string;
  readonly channel: AdminCommunicationChannel;
  readonly delaySeconds: number;
  readonly segmentCode: string;
  readonly segmentDefinitionId: string;
  readonly segmentDefinitionVersion: number;
  readonly promoDefinitionId: number | null;
  readonly promoDefinitionVersion: number | null;
  readonly promoCode: string | null;
  readonly promoType: AdminCommunicationPromoType | null;
  readonly promoValue: number | null;
  readonly actorStaffUserId: number;
  readonly updatedAt: Date;
}

export interface AdminCommunicationDraftPreviewInput {
  readonly expectedVersion: number;
  readonly previewCount: number;
  readonly previewGeneratedAt: Date;
  readonly previewSegmentAsOf: Date;
  readonly actorStaffUserId: number;
  readonly updatedAt: Date;
}

export interface AdminCommunicationDraftsQuery {
  readonly limit: number;
  readonly offset: number;
  readonly status?: AdminCommunicationDraftStatus | undefined;
  readonly search: string;
}

export class AdminCommunicationDraftVersionConflictError extends Error {
  readonly current: AdminCommunicationDraftRepositoryRow;

  constructor(current: AdminCommunicationDraftRepositoryRow) {
    super("Communication draft version is stale");
    this.name = "AdminCommunicationDraftVersionConflictError";
    this.current = current;
  }
}

export class AdminCommunicationDraftIdempotencyConflictError extends Error {
  constructor() {
    super("Communication draft idempotency key was reused with different data");
    this.name = "AdminCommunicationDraftIdempotencyConflictError";
  }
}

export interface AdminCommunicationDraftRepository {
  list(query: AdminCommunicationDraftsQuery): Promise<AdminCommunicationDraftRepositoryResult>;
  get(id: number): Promise<AdminCommunicationDraftRepositoryDetail | null>;
  getByIdempotencyKey(idempotencyKey: string): Promise<AdminCommunicationDraftRepositoryRow | null>;
  create(input: AdminCommunicationDraftCreateInput): Promise<{ readonly draft: AdminCommunicationDraftRepositoryRow; readonly created: boolean }>;
  update(id: number, input: AdminCommunicationDraftUpdateInput): Promise<AdminCommunicationDraftRepositoryDetail | null>;
  markPreviewed(id: number, input: AdminCommunicationDraftPreviewInput): Promise<AdminCommunicationDraftRepositoryDetail | null>;
  archive(id: number, expectedVersion: number, actorStaffUserId: number, updatedAt: Date): Promise<AdminCommunicationDraftRepositoryDetail | null>;
  restore(id: number, expectedVersion: number, actorStaffUserId: number, updatedAt: Date): Promise<AdminCommunicationDraftRepositoryDetail | null>;
}

type DatabaseWriter = Pick<DatabaseClient["db"], "insert">;
type QueryRow = Record<string, unknown>;

function integer(raw: unknown, field: string): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Communication field ${field} is malformed`);
  return parsed;
}

function text(raw: unknown, field: string): string {
  if (typeof raw !== "string" || raw.trim() === "") throw new Error(`Communication field ${field} is malformed`);
  return raw.trim();
}

function nullableText(raw: unknown, field: string): string | null {
  return raw === null || raw === undefined ? null : text(raw, field);
}

function date(raw: unknown, field: string): Date {
  const parsed = raw instanceof Date ? new Date(raw.getTime()) : new Date(String(raw ?? ""));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Communication field ${field} is malformed`);
  return parsed;
}

function nullableDate(raw: unknown, field: string): Date | null {
  return raw === null || raw === undefined ? null : date(raw, field);
}

function status(raw: unknown, field: string): AdminCommunicationDraftStatus {
  const parsed = text(raw, field);
  if (parsed !== "draft" && parsed !== "previewed" && parsed !== "archived") throw new Error(`Communication field ${field} is unknown`);
  return parsed;
}

function channel(raw: unknown): AdminCommunicationChannel {
  const parsed = text(raw, "channel");
  if (parsed !== "push" && parsed !== "sms") throw new Error("Communication channel is unknown");
  return parsed;
}

function promoType(raw: unknown): AdminCommunicationPromoType | null {
  if (raw === null || raw === undefined) return null;
  const parsed = text(raw, "promo_type");
  if (parsed !== "percent" && parsed !== "fixed") throw new Error("Communication promo type is unknown");
  return parsed;
}

function draftFromRecord(record: typeof communicationDrafts.$inferSelect): AdminCommunicationDraftRepositoryRow {
  return {
    id: record.id,
    idempotencyKey: record.idempotencyKey,
    payloadFingerprint: record.payloadFingerprint,
    templateCode: record.templateCode,
    templateVersion: record.templateVersion,
    templateTitle: record.templateTitle,
    body: record.body,
    channel: channel(record.channel),
    delaySeconds: record.delaySeconds,
    segmentCode: record.segmentCode,
    segmentDefinitionId: record.segmentDefinitionId,
    segmentDefinitionVersion: record.segmentDefinitionVersion,
    previewCount: record.previewCount,
    previewGeneratedAt: nullableDate(record.previewGeneratedAt, "preview_generated_at"),
    previewSegmentAsOf: nullableDate(record.previewSegmentAsOf, "preview_segment_as_of"),
    promoDefinitionId: record.promoDefinitionId,
    promoDefinitionVersion: record.promoDefinitionVersion,
    promoCode: nullableText(record.promoCode, "promo_code"),
    promoType: promoType(record.promoType),
    promoValue: record.promoValue,
    status: status(record.status, "status"),
    createdByStaffUserId: record.createdByStaffUserId,
    createdAt: date(record.createdAt, "created_at"),
    updatedAt: date(record.updatedAt, "updated_at"),
    archivedAt: nullableDate(record.archivedAt, "archived_at"),
    version: record.version
  };
}

function auditFromRecord(record: typeof communicationDraftAudit.$inferSelect): AdminCommunicationDraftAuditRepositoryRow {
  const action = text(record.action, "action");
  if (!("created updated previewed archived restored".split(" ") as readonly string[]).includes(action)) throw new Error("Communication audit action is unknown");
  return {
    id: record.id,
    action: action as AdminCommunicationDraftAuditAction,
    fromStatus: record.fromStatus === null ? null : status(record.fromStatus, "from_status"),
    toStatus: status(record.toStatus, "to_status"),
    actorStaffUserId: record.actorStaffUserId,
    version: record.version,
    createdAt: date(record.createdAt, "created_at")
  };
}

function auditValues(input: {
  readonly draftId: number;
  readonly action: AdminCommunicationDraftAuditAction;
  readonly fromStatus: AdminCommunicationDraftStatus | null;
  readonly toStatus: AdminCommunicationDraftStatus;
  readonly actorStaffUserId: number;
  readonly version: number;
  readonly createdAt: Date;
}) {
  return {
    draftId: input.draftId,
    action: input.action,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    actorStaffUserId: input.actorStaffUserId,
    version: input.version,
    createdAt: input.createdAt
  };
}

async function insertAudit(
  tx: DatabaseWriter,
  input: Parameters<typeof auditValues>[0]
): Promise<void> {
  await tx.insert(communicationDraftAudit).values(auditValues(input));
}

function whereClause(query: AdminCommunicationDraftsQuery) {
  const conditions = [sql`TRUE`];
  if (query.status !== undefined) conditions.push(sql`d.status = ${query.status}`);
  const search = query.search.trim();
  if (search !== "") {
    conditions.push(sql`(d.segment_code ILIKE ${`%${search}%`} OR d.template_code ILIKE ${`%${search}%`} OR d.body ILIKE ${`%${search}%`})`);
  }
  return sql.join(conditions, sql` AND `);
}

async function auditFor(
  tx: Pick<DatabaseClient["db"], "select">,
  draftId: number
): Promise<readonly AdminCommunicationDraftAuditRepositoryRow[]> {
  const rows = await tx.select().from(communicationDraftAudit).where(eq(communicationDraftAudit.draftId, draftId)).orderBy(desc(communicationDraftAudit.createdAt), desc(communicationDraftAudit.id)).limit(100);
  return rows.map(auditFromRecord);
}

async function detailFor(
  tx: Pick<DatabaseClient["db"], "select">,
  id: number
): Promise<AdminCommunicationDraftRepositoryDetail | null> {
  const [record] = await tx.select().from(communicationDrafts).where(eq(communicationDrafts.id, id)).limit(1);
  if (record === undefined) return null;
  return { draft: draftFromRecord(record), audit: await auditFor(tx, id) };
}

export function createAdminCommunicationRepository(client: DatabaseClient): AdminCommunicationDraftRepository {
  return {
    async list(query) {
      const where = whereClause(query);
      const totalResult = await client.db.execute(sql`SELECT COUNT(*)::text AS total FROM communication_drafts d WHERE ${where}`);
      const total = integer((totalResult.rows[0] as QueryRow | undefined)?.["total"], "total");
      const records = await client.db.select().from(communicationDrafts).where(where).orderBy(desc(communicationDrafts.updatedAt), desc(communicationDrafts.id)).limit(query.limit).offset(query.offset);
      return { rows: records.map(draftFromRecord), total };
    },

    async get(id) {
      return client.db.transaction((tx) => detailFor(tx, id));
    },

    async getByIdempotencyKey(idempotencyKey) {
      const [record] = await client.db.select().from(communicationDrafts).where(eq(communicationDrafts.idempotencyKey, idempotencyKey)).limit(1);
      return record === undefined ? null : draftFromRecord(record);
    },

    async create(input) {
      return client.db.transaction(async (tx) => {
        const [created] = await tx.insert(communicationDrafts).values({
          idempotencyKey: input.idempotencyKey,
          payloadFingerprint: input.payloadFingerprint,
          templateCode: input.templateCode,
          templateVersion: input.templateVersion,
          templateTitle: input.templateTitle,
          body: input.body,
          channel: input.channel,
          delaySeconds: input.delaySeconds,
          segmentCode: input.segmentCode,
          segmentDefinitionId: input.segmentDefinitionId,
          segmentDefinitionVersion: input.segmentDefinitionVersion,
          previewCount: null,
          previewGeneratedAt: null,
          previewSegmentAsOf: null,
          promoDefinitionId: input.promoDefinitionId,
          promoDefinitionVersion: input.promoDefinitionVersion,
          promoCode: input.promoCode,
          promoType: input.promoType,
          promoValue: input.promoValue,
          status: "draft",
          createdByStaffUserId: input.createdByStaffUserId,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
          archivedAt: null,
          version: 1
        }).onConflictDoNothing({ target: communicationDrafts.idempotencyKey }).returning();

        if (created !== undefined) {
          await insertAudit(tx, { draftId: created.id, action: "created", fromStatus: null, toStatus: "draft", actorStaffUserId: input.createdByStaffUserId, version: 1, createdAt: input.createdAt });
          return { draft: draftFromRecord(created), created: true };
        }

        const [existing] = await tx.select().from(communicationDrafts).where(eq(communicationDrafts.idempotencyKey, input.idempotencyKey)).limit(1);
        if (existing === undefined) throw new Error("Communication idempotency row disappeared");
        if (existing.payloadFingerprint !== input.payloadFingerprint) throw new AdminCommunicationDraftIdempotencyConflictError();
        return { draft: draftFromRecord(existing), created: false };
      });
    },

    async update(id, input) {
      return client.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM communication_drafts WHERE id = ${id} FOR UPDATE`);
        const [currentRecord] = await tx.select().from(communicationDrafts).where(eq(communicationDrafts.id, id)).limit(1);
        if (currentRecord === undefined) return null;
        const current = draftFromRecord(currentRecord);
        if (current.version !== input.expectedVersion) throw new AdminCommunicationDraftVersionConflictError(current);
        if (current.status === "archived") throw new Error("Archived communication draft must be restored before update");
        const [updated] = await tx.update(communicationDrafts).set({
          templateCode: input.templateCode,
          templateVersion: input.templateVersion,
          templateTitle: input.templateTitle,
          body: input.body,
          channel: input.channel,
          delaySeconds: input.delaySeconds,
          segmentCode: input.segmentCode,
          segmentDefinitionId: input.segmentDefinitionId,
          segmentDefinitionVersion: input.segmentDefinitionVersion,
          previewCount: null,
          previewGeneratedAt: null,
          previewSegmentAsOf: null,
          promoDefinitionId: input.promoDefinitionId,
          promoDefinitionVersion: input.promoDefinitionVersion,
          promoCode: input.promoCode,
          promoType: input.promoType,
          promoValue: input.promoValue,
          status: "draft",
          updatedAt: input.updatedAt,
          version: sql`${communicationDrafts.version} + 1`
        }).where(eq(communicationDrafts.id, id)).returning();
        if (updated === undefined) throw new Error("Communication draft update returned no row");
        await insertAudit(tx, { draftId: id, action: "updated", fromStatus: current.status, toStatus: "draft", actorStaffUserId: input.actorStaffUserId, version: updated.version, createdAt: input.updatedAt });
        return detailFor(tx, id);
      });
    },

    async markPreviewed(id, input) {
      return client.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM communication_drafts WHERE id = ${id} FOR UPDATE`);
        const [currentRecord] = await tx.select().from(communicationDrafts).where(eq(communicationDrafts.id, id)).limit(1);
        if (currentRecord === undefined) return null;
        const current = draftFromRecord(currentRecord);
        if (current.version !== input.expectedVersion) throw new AdminCommunicationDraftVersionConflictError(current);
        if (current.status === "archived") throw new Error("Archived communication draft cannot be previewed");
        const [updated] = await tx.update(communicationDrafts).set({
          status: "previewed",
          previewCount: input.previewCount,
          previewGeneratedAt: input.previewGeneratedAt,
          previewSegmentAsOf: input.previewSegmentAsOf,
          updatedAt: input.updatedAt,
          version: sql`${communicationDrafts.version} + 1`
        }).where(eq(communicationDrafts.id, id)).returning();
        if (updated === undefined) throw new Error("Communication preview update returned no row");
        await insertAudit(tx, { draftId: id, action: "previewed", fromStatus: current.status, toStatus: "previewed", actorStaffUserId: input.actorStaffUserId, version: updated.version, createdAt: input.updatedAt });
        return detailFor(tx, id);
      });
    },

    async archive(id, expectedVersion, actorStaffUserId, updatedAt) {
      return client.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM communication_drafts WHERE id = ${id} FOR UPDATE`);
        const [currentRecord] = await tx.select().from(communicationDrafts).where(eq(communicationDrafts.id, id)).limit(1);
        if (currentRecord === undefined) return null;
        const current = draftFromRecord(currentRecord);
        if (current.status === "archived") return detailFor(tx, id);
        if (current.version !== expectedVersion) throw new AdminCommunicationDraftVersionConflictError(current);
        const [updated] = await tx.update(communicationDrafts).set({ status: "archived", archivedAt: updatedAt, updatedAt, version: sql`${communicationDrafts.version} + 1` }).where(eq(communicationDrafts.id, id)).returning();
        if (updated === undefined) throw new Error("Communication archive update returned no row");
        await insertAudit(tx, { draftId: id, action: "archived", fromStatus: current.status, toStatus: "archived", actorStaffUserId, version: updated.version, createdAt: updatedAt });
        return detailFor(tx, id);
      });
    },

    async restore(id, expectedVersion, actorStaffUserId, updatedAt) {
      return client.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM communication_drafts WHERE id = ${id} FOR UPDATE`);
        const [currentRecord] = await tx.select().from(communicationDrafts).where(eq(communicationDrafts.id, id)).limit(1);
        if (currentRecord === undefined) return null;
        const current = draftFromRecord(currentRecord);
        if (current.status !== "archived") return detailFor(tx, id);
        if (current.version !== expectedVersion) throw new AdminCommunicationDraftVersionConflictError(current);
        const [updated] = await tx.update(communicationDrafts).set({ status: "draft", archivedAt: null, updatedAt, version: sql`${communicationDrafts.version} + 1` }).where(eq(communicationDrafts.id, id)).returning();
        if (updated === undefined) throw new Error("Communication restore update returned no row");
        await insertAudit(tx, { draftId: id, action: "restored", fromStatus: "archived", toStatus: "draft", actorStaffUserId, version: updated.version, createdAt: updatedAt });
        return detailFor(tx, id);
      });
    }
  };
}
