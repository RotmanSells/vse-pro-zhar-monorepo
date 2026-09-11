import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";
import {
  categories,
  categoryVersions,
  products,
  type CategoryRecord,
  type ProductRecord
} from "./schema.js";

export interface CatalogSnapshot {
  readonly categories: readonly CategoryRecord[];
  readonly products: readonly ProductRecord[];
}

export interface CatalogQuoteProduct {
  readonly id: number;
  readonly priceMinor: number;
}

export interface CatalogCheckoutProduct extends CatalogQuoteProduct {
  readonly name: string;
}

export interface CatalogCategoryInput {
  readonly slug: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly isVisible: boolean;
}

export interface CatalogCategoryUpdate {
  readonly name?: string;
  readonly sortOrder?: number;
  readonly isVisible?: boolean;
  readonly expectedVersion?: number;
}

export interface CatalogCategoryMutationMetadata {
  readonly actorStaffUserId: number;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly now: Date;
}

export interface CatalogAdminCategoryRecord extends CategoryRecord {
  readonly productCount: number;
}

export class CatalogCategoryConflictError extends Error {
  constructor() {
    super("Catalog category was changed or already exists");
    this.name = "CatalogCategoryConflictError";
  }
}

export class CatalogCategoryIdempotencyConflictError extends Error {
  constructor() {
    super("Catalog category idempotency key conflicts");
    this.name = "CatalogCategoryIdempotencyConflictError";
  }
}

export class CatalogCategoryVersionConflictError extends Error {
  constructor() {
    super("Catalog category version conflicts");
    this.name = "CatalogCategoryVersionConflictError";
  }
}

export interface CatalogProductInput {
  readonly categoryId: number;
  readonly name: string;
  readonly description: string;
  readonly priceMinor: number;
  readonly imageUrl: string | null;
  readonly emoji: string;
  readonly tag: "hit" | "new" | null;
  readonly isVisible: boolean;
  readonly sortOrder: number;
}

export interface CatalogProductUpdate {
  readonly categoryId?: number;
  readonly name?: string;
  readonly description?: string;
  readonly priceMinor?: number;
  readonly imageUrl?: string | null;
  readonly emoji?: string;
  readonly tag?: "hit" | "new" | null;
  readonly isVisible?: boolean;
  readonly sortOrder?: number;
}

export interface CatalogRepository {
  getCatalog(options?: { readonly includeHidden?: boolean }): Promise<CatalogSnapshot>;
  getAdminCategories?(): Promise<readonly CatalogAdminCategoryRecord[]>;
  getProductsForQuote(
    productIds: readonly number[]
  ): Promise<readonly CatalogQuoteProduct[]>;
  /**
   * Reads the public product snapshot needed by checkout in one repository
   * boundary. It stays optional for backwards-compatible test doubles; the
   * API has a safe catalog snapshot fallback when it is not implemented.
   */
  getProductsForCheckout?(
    productIds: readonly number[]
  ): Promise<readonly CatalogCheckoutProduct[]>;
  createCategory(
    input: CatalogCategoryInput,
    metadata: CatalogCategoryMutationMetadata
  ): Promise<CategoryRecord>;
  updateCategory(
    id: number,
    input: CatalogCategoryUpdate,
    metadata: CatalogCategoryMutationMetadata
  ): Promise<CategoryRecord | null>;
  createProduct(input: CatalogProductInput): Promise<ProductRecord>;
  updateProduct(
    id: number,
    input: CatalogProductUpdate
  ): Promise<ProductRecord | null>;
}

function createCategoryValues(input: CatalogCategoryInput) {
  return {
    slug: input.slug,
    name: input.name,
    sortOrder: input.sortOrder,
    isVisible: input.isVisible,
    version: 1
  };
}

function assertMutationMetadata(
  metadata: CatalogCategoryMutationMetadata,
  expectedVersion?: number
): void {
  if (
    !Number.isSafeInteger(metadata.actorStaffUserId) ||
    metadata.actorStaffUserId < 1 ||
    metadata.requestId.trim() === "" ||
    metadata.idempotencyKey.trim() === "" ||
    !/^[0-9a-f]{64}$/u.test(metadata.payloadFingerprint) ||
    !(metadata.now instanceof Date) ||
    !Number.isFinite(metadata.now.getTime()) ||
    (expectedVersion !== undefined &&
      (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1))
  ) {
    throw new CatalogCategoryConflictError();
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export function createCatalogRepository(client: DatabaseClient): CatalogRepository {
  return {
    async getCatalog(options = {}): Promise<CatalogSnapshot> {
      const includeHidden = options.includeHidden ?? false;
      const [categoryRows, productRows] = await Promise.all([
        client.db
          .select()
          .from(categories)
          .where(includeHidden ? undefined : eq(categories.isVisible, true))
          .orderBy(asc(categories.sortOrder), asc(categories.id)),
        client.db
          .select()
          .from(products)
          .where(includeHidden ? undefined : eq(products.isVisible, true))
          .orderBy(asc(products.sortOrder), asc(products.id))
      ]);

      return {
        categories: categoryRows,
        products: productRows
      };
    },

    async getAdminCategories(): Promise<readonly CatalogAdminCategoryRecord[]> {
      const snapshot = await this.getCatalog({ includeHidden: true });
      return snapshot.categories.map((category) => ({
        ...category,
        productCount: snapshot.products.filter(
          (product) => product.categoryId === category.id
        ).length
      }));
    },

    async getProductsForQuote(
      productIds
    ): Promise<readonly CatalogQuoteProduct[]> {
      if (productIds.length === 0) {
        return [];
      }

      return client.db
        .select({
          id: products.id,
          priceMinor: products.priceMinor
        })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .where(
          and(
            inArray(products.id, [...productIds]),
            eq(products.isVisible, true),
            eq(categories.isVisible, true)
          )
        );
    },

    async getProductsForCheckout(
      productIds
    ): Promise<readonly CatalogCheckoutProduct[]> {
      if (productIds.length === 0) {
        return [];
      }

      return client.db
        .select({
          id: products.id,
          name: products.name,
          priceMinor: products.priceMinor
        })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .where(
          and(
            inArray(products.id, [...productIds]),
            eq(products.isVisible, true),
            eq(categories.isVisible, true)
          )
        );
    },

    async createCategory(input, metadata): Promise<CategoryRecord> {
      assertMutationMetadata(metadata);
      try {
        return await client.db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${metadata.idempotencyKey}, 0))`
          );
          const [known] = await tx
            .select()
            .from(categoryVersions)
            .where(eq(categoryVersions.idempotencyKey, metadata.idempotencyKey))
            .limit(1);
          if (known !== undefined) {
            if (
              known.payloadFingerprint !== metadata.payloadFingerprint ||
              known.action !== "created"
            ) {
              throw new CatalogCategoryIdempotencyConflictError();
            }
            const [category] = await tx
              .select()
              .from(categories)
              .where(eq(categories.id, known.categoryId))
              .limit(1);
            if (category === undefined) throw new CatalogCategoryConflictError();
            return category;
          }

          const [category] = await tx
            .insert(categories)
            .values(createCategoryValues(input))
            .returning();
          if (category === undefined) throw new CatalogCategoryConflictError();

          await tx.insert(categoryVersions).values({
            categoryId: category.id,
            version: category.version,
            action: "created",
            slug: category.slug,
            name: category.name,
            sortOrder: category.sortOrder,
            isVisible: category.isVisible,
            actorStaffUserId: metadata.actorStaffUserId,
            requestId: metadata.requestId,
            idempotencyKey: metadata.idempotencyKey,
            payloadFingerprint: metadata.payloadFingerprint,
            createdAt: metadata.now
          });
          return category;
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) throw new CatalogCategoryConflictError();
        throw error;
      }
    },

    async updateCategory(id, input, metadata): Promise<CategoryRecord | null> {
      const categoryInput: {
        name?: string;
        sortOrder?: number;
        isVisible?: boolean;
      } = {};
      if (input.name !== undefined) categoryInput.name = input.name;
      if (input.sortOrder !== undefined) categoryInput.sortOrder = input.sortOrder;
      if (input.isVisible !== undefined) categoryInput.isVisible = input.isVisible;
      assertMutationMetadata(metadata, input.expectedVersion);
      if (input.expectedVersion === undefined) {
        throw new CatalogCategoryConflictError();
      }
      try {
        return await client.db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${metadata.idempotencyKey}, 0))`
          );
          const [known] = await tx
            .select()
            .from(categoryVersions)
            .where(eq(categoryVersions.idempotencyKey, metadata.idempotencyKey))
            .limit(1);
          if (known !== undefined) {
            if (
              known.payloadFingerprint !== metadata.payloadFingerprint ||
              known.categoryId !== id ||
              known.action === "created"
            ) {
              throw new CatalogCategoryIdempotencyConflictError();
            }
            const [category] = await tx
              .select()
              .from(categories)
              .where(eq(categories.id, id))
              .limit(1);
            return category ?? null;
          }

          const [current] = await tx
            .select()
            .from(categories)
            .where(eq(categories.id, id))
            .limit(1)
            .for("update");
          if (current === undefined) return null;
          if (current.version !== input.expectedVersion) {
            throw new CatalogCategoryVersionConflictError();
          }
          if (current.version >= 2_147_483_647) {
            throw new CatalogCategoryConflictError();
          }

          const [category] = await tx
            .update(categories)
            .set({
              ...categoryInput,
              version: current.version + 1,
              updatedAt: metadata.now
            })
            .where(
              and(
                eq(categories.id, id),
                eq(categories.version, input.expectedVersion)
              )
            )
            .returning();
          if (category === undefined) throw new CatalogCategoryVersionConflictError();

          await tx.insert(categoryVersions).values({
            categoryId: category.id,
            version: category.version,
            action: category.isVisible ? "updated" : "archived",
            slug: category.slug,
            name: category.name,
            sortOrder: category.sortOrder,
            isVisible: category.isVisible,
            actorStaffUserId: metadata.actorStaffUserId,
            requestId: metadata.requestId,
            idempotencyKey: metadata.idempotencyKey,
            payloadFingerprint: metadata.payloadFingerprint,
            createdAt: metadata.now
          });
          return category;
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) throw new CatalogCategoryConflictError();
        throw error;
      }
    },

    async createProduct(input): Promise<ProductRecord> {
      const [product] = await client.db
        .insert(products)
        .values({
          categoryId: input.categoryId,
          name: input.name,
          description: input.description,
          priceMinor: input.priceMinor,
          imageUrl: input.imageUrl,
          emoji: input.emoji,
          tag: input.tag,
          isVisible: input.isVisible,
          sortOrder: input.sortOrder
        })
        .returning();

      if (product === undefined) {
        throw new Error("Product insert returned no row");
      }

      return product;
    },

    async updateProduct(id, input): Promise<ProductRecord | null> {
      const [product] = await client.db
        .update(products)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(products.id, id))
        .returning();

      return product ?? null;
    }
  };
}
