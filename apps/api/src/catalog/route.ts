import {
  CatalogCategoryInputSchema,
  CatalogCategoryUpdateSchema,
  CatalogCategorySchema,
  CatalogProductInputSchema,
  CatalogProductSchema,
  CatalogProductUpdateSchema,
  CatalogResponseSchema,
  type CatalogCategory,
  type CatalogProduct
} from "@vse-pro-zhar/contracts";
import type {
  CatalogCategoryInput,
  CatalogCategoryUpdate,
  CatalogProductInput,
  CatalogProductUpdate,
  CatalogRepository,
  CatalogSnapshot
} from "@vse-pro-zhar/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  CatalogNotFoundError,
  CatalogUnavailableError,
  CatalogValidationError
} from "./errors.js";

interface IdParams {
  readonly id: string;
}

function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new CatalogValidationError();
  }

  return parsed.data;
}

function parseId(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^\d+$/u.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  ) {
    throw new CatalogValidationError();
  }

  return Number(value);
}

function mapCategory(row: CatalogSnapshot["categories"][number]): CatalogCategory {
  return CatalogCategorySchema.parse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    sortOrder: row.sortOrder,
    isVisible: row.isVisible
  });
}

function mapProduct(row: CatalogSnapshot["products"][number]): CatalogProduct {
  return CatalogProductSchema.parse({
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    priceMinor: row.priceMinor,
    imageUrl: row.imageUrl,
    emoji: row.emoji,
    tag: row.tag,
    isVisible: row.isVisible,
    sortOrder: row.sortOrder
  });
}

function toCatalogResponse(
  snapshot: CatalogSnapshot,
  includeHidden: boolean
) {
  const categories = snapshot.categories
    .filter((category) => includeHidden || category.isVisible)
    .map((category) => ({
      ...mapCategory(category),
      products: snapshot.products
        .filter(
          (product) =>
            product.categoryId === category.id &&
            (includeHidden || product.isVisible)
        )
        .map(mapProduct)
    }));

  return CatalogResponseSchema.parse({ categories });
}

async function withCatalog<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (
      error instanceof CatalogValidationError ||
      error instanceof CatalogNotFoundError ||
      error instanceof CatalogUnavailableError
    ) {
      throw error;
    }

    throw new CatalogUnavailableError();
  }
}

function mapCategoryInput(
  input: ReturnType<typeof CatalogCategoryInputSchema.parse>
): CatalogCategoryInput {
  return {
    slug: input.slug,
    name: input.name,
    sortOrder: input.sortOrder,
    isVisible: input.isVisible
  };
}

function mapCategoryUpdate(
  input: ReturnType<typeof CatalogCategoryUpdateSchema.parse>
): CatalogCategoryUpdate {
  const update: {
    slug?: string;
    name?: string;
    sortOrder?: number;
    isVisible?: boolean;
  } = {};

  if (input.slug !== undefined) update.slug = input.slug;
  if (input.name !== undefined) update.name = input.name;
  if (input.sortOrder !== undefined) update.sortOrder = input.sortOrder;
  if (input.isVisible !== undefined) update.isVisible = input.isVisible;

  return update;
}

function mapProductInput(
  input: ReturnType<typeof CatalogProductInputSchema.parse>
): CatalogProductInput {
  return input;
}

function mapProductUpdate(
  input: ReturnType<typeof CatalogProductUpdateSchema.parse>
): CatalogProductUpdate {
  const update: {
    categoryId?: number;
    name?: string;
    description?: string;
    priceMinor?: number;
    imageUrl?: string | null;
    emoji?: string;
    tag?: "hit" | "new" | null;
    isVisible?: boolean;
    sortOrder?: number;
  } = {};

  if (input.categoryId !== undefined) update.categoryId = input.categoryId;
  if (input.name !== undefined) update.name = input.name;
  if (input.description !== undefined) update.description = input.description;
  if (input.priceMinor !== undefined) update.priceMinor = input.priceMinor;
  if (input.imageUrl !== undefined) update.imageUrl = input.imageUrl;
  if (input.emoji !== undefined) update.emoji = input.emoji;
  if (input.tag !== undefined) update.tag = input.tag;
  if (input.isVisible !== undefined) update.isVisible = input.isVisible;
  if (input.sortOrder !== undefined) update.sortOrder = input.sortOrder;

  return update;
}

export function registerCatalogRoutes(
  app: FastifyInstance,
  repository: CatalogRepository
): void {
  app.get("/catalog", () =>
    withCatalog(async () =>
      toCatalogResponse(await repository.getCatalog(), false)
    )
  );

  app.get("/admin/catalog", () =>
    withCatalog(async () =>
      toCatalogResponse(
        await repository.getCatalog({ includeHidden: true }),
        true
      )
    )
  );

  app.post("/admin/categories", async (request, reply) => {
    const input = mapCategoryInput(
      parseRequest(CatalogCategoryInputSchema, request.body)
    );
    const category = await withCatalog(() => repository.createCategory(input));

    return reply.code(201).send({ category: mapCategory(category) });
  });

  app.patch<{ Params: IdParams }>(
    "/admin/categories/:id",
    async (request, reply) => {
      const input = mapCategoryUpdate(
        parseRequest(CatalogCategoryUpdateSchema, request.body)
      );
      const category = await withCatalog(() =>
        repository.updateCategory(parseId(request.params.id), input)
      );

      if (category === null) {
        throw new CatalogNotFoundError();
      }

      return reply.send({ category: mapCategory(category) });
    }
  );

  app.post("/admin/products", async (request, reply) => {
    const input = mapProductInput(
      parseRequest(CatalogProductInputSchema, request.body)
    );
    const product = await withCatalog(() => repository.createProduct(input));

    return reply.code(201).send({ product: mapProduct(product) });
  });

  app.patch<{ Params: IdParams }>(
    "/admin/products/:id",
    async (request, reply) => {
      const input = mapProductUpdate(
        parseRequest(CatalogProductUpdateSchema, request.body)
      );
      const product = await withCatalog(() =>
        repository.updateProduct(parseId(request.params.id), input)
      );

      if (product === null) {
        throw new CatalogNotFoundError();
      }

      return reply.send({ product: mapProduct(product) });
    }
  );
}
