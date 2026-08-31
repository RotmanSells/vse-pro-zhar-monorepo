import { asc, eq } from "drizzle-orm";

import type { DatabaseClient } from "./db.js";
import {
  categories,
  products,
  type CategoryRecord,
  type ProductRecord
} from "./schema.js";

export interface CatalogSnapshot {
  readonly categories: readonly CategoryRecord[];
  readonly products: readonly ProductRecord[];
}

export interface CatalogCategoryInput {
  readonly slug: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly isVisible: boolean;
}

export interface CatalogCategoryUpdate {
  readonly slug?: string;
  readonly name?: string;
  readonly sortOrder?: number;
  readonly isVisible?: boolean;
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
  createCategory(input: CatalogCategoryInput): Promise<CategoryRecord>;
  updateCategory(
    id: number,
    input: CatalogCategoryUpdate
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
    isVisible: input.isVisible
  };
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

    async createCategory(input): Promise<CategoryRecord> {
      const [category] = await client.db
        .insert(categories)
        .values(createCategoryValues(input))
        .returning();

      if (category === undefined) {
        throw new Error("Category insert returned no row");
      }

      return category;
    },

    async updateCategory(id, input): Promise<CategoryRecord | null> {
      const [category] = await client.db
        .update(categories)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(categories.id, id))
        .returning();

      return category ?? null;
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
