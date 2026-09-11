import { createHash } from "node:crypto";

import {
  CatalogAdminCategoriesResponseSchema,
  CatalogAdminCategoryResponseSchema,
  CatalogAdminCategoryMutationSchema,
  CatalogAdminCategorySchema,
  CatalogCategoryIdempotencyKeySchema,
  CatalogCategoryInputSchema,
  CatalogCategoryUpdateSchema,
  CatalogCategorySchema,
  CartQuoteRequestSchema,
  CartQuoteResponseSchema,
  CatalogProductInputSchema,
  CatalogProductSchema,
  CatalogProductUpdateSchema,
  CatalogResponseSchema,
  type CatalogCategory,
  type CatalogProduct,
  type CartItem,
  type CartQuoteResponse
} from "@vse-pro-zhar/contracts";
import type {
  CatalogAdminCategoryRecord,
  CatalogCategoryMutationMetadata,
  CatalogCategoryInput,
  CatalogCategoryUpdate,
  CatalogQuoteProduct,
  CatalogProductInput,
  CatalogProductUpdate,
  CatalogRepository,
  CatalogSnapshot
} from "@vse-pro-zhar/database";
import {
  CatalogCategoryConflictError,
  CatalogCategoryIdempotencyConflictError,
  CatalogCategoryVersionConflictError
} from "@vse-pro-zhar/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { assertSafeOrigin } from "../auth/route.js";
import type { StaffGuard } from "../auth/staff-route.js";
import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";
import {
  CatalogNotFoundError,
  CatalogUnavailableError,
  CatalogValidationError,
  CartItemUnavailableError
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

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseIdempotencyKey(value: string | string[] | undefined): string {
  const parsed = CatalogCategoryIdempotencyKeySchema.safeParse(headerValue(value));
  if (!parsed.success) throw new CatalogValidationError();
  return parsed.data;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function payloadFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
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

function mapAdminCategory(
  row: CatalogAdminCategoryRecord,
  productCount = row.productCount
) {
  return CatalogAdminCategorySchema.parse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    sortOrder: row.sortOrder,
    isVisible: row.isVisible,
    version: row.version ?? 1,
    productCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  });
}

function mapAdminCategoryMutation(row: CatalogAdminCategoryRecord) {
  return CatalogAdminCategoryMutationSchema.parse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    sortOrder: row.sortOrder,
    isVisible: row.isVisible,
    version: row.version ?? 1,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  });
}

function categoryMutationMetadata(
  request: { readonly id: string },
  staffUserId: number,
  idempotencyKey: string,
  input: unknown
): CatalogCategoryMutationMetadata {
  return {
    actorStaffUserId: staffUserId,
    requestId: request.id,
    idempotencyKey,
    payloadFingerprint: payloadFingerprint(input),
    now: new Date()
  };
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

function toCartQuote(
  items: readonly CartItem[],
  rows: readonly CatalogQuoteProduct[]
): CartQuoteResponse {
  if (rows.length !== items.length) {
    throw new CartItemUnavailableError();
  }

  const prices = new Map<number, number>();
  for (const row of rows) {
    if (
      !Number.isSafeInteger(row.id) ||
      row.id < 1 ||
      !Number.isSafeInteger(row.priceMinor) ||
      row.priceMinor < 0 ||
      prices.has(row.id)
    ) {
      throw new CatalogUnavailableError();
    }

    prices.set(row.id, row.priceMinor);
  }

  let totalMinor = 0;
  const quoteItems = items.map((item) => {
    const unitPriceMinor = prices.get(item.productId);
    if (unitPriceMinor === undefined) {
      throw new CartItemUnavailableError();
    }

    const lineTotalMinor = unitPriceMinor * item.quantity;
    if (!Number.isSafeInteger(lineTotalMinor)) {
      throw new CatalogUnavailableError();
    }

    totalMinor += lineTotalMinor;
    if (!Number.isSafeInteger(totalMinor)) {
      throw new CatalogUnavailableError();
    }

    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPriceMinor,
      lineTotalMinor
    };
  });

  return CartQuoteResponseSchema.parse({ items: quoteItems, totalMinor });
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
      error instanceof CatalogUnavailableError ||
      error instanceof CartItemUnavailableError ||
      error instanceof CatalogCategoryConflictError ||
      error instanceof CatalogCategoryIdempotencyConflictError ||
      error instanceof CatalogCategoryVersionConflictError
    ) {
      if (error instanceof CatalogCategoryIdempotencyConflictError) {
        throw new ApiRequestError("CATALOG_CATEGORY_IDEMPOTENCY_CONFLICT", 409);
      }
      if (error instanceof CatalogCategoryVersionConflictError) {
        throw new ApiRequestError("CATALOG_CATEGORY_CONFLICT", 409);
      }
      if (error instanceof CatalogCategoryConflictError) {
        throw new ApiRequestError("CATALOG_CATEGORY_CONFLICT", 409);
      }
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
    name?: string;
    sortOrder?: number;
    isVisible?: boolean;
  } = {};

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
  repository: CatalogRepository,
  config: ApiConfig,
  staffGuard: StaffGuard
): void {
  app.get("/catalog", () =>
    withCatalog(async () =>
      toCatalogResponse(await repository.getCatalog(), false)
    )
  );

  app.get("/admin/catalog", async (request) => {
    await staffGuard.require(request);
    return withCatalog(async () =>
      toCatalogResponse(await repository.getCatalog({ includeHidden: true }), true)
    );
  });

  app.get("/admin/categories", async (request, reply) => {
    await staffGuard.require(request);
    const categories = await withCatalog(async () => {
      if (repository.getAdminCategories !== undefined) {
        return repository.getAdminCategories();
      }
      const snapshot = await repository.getCatalog({ includeHidden: true });
      return snapshot.categories.map((category) => ({
        ...category,
        productCount: snapshot.products.filter(
          (product) => product.categoryId === category.id
        ).length
      }));
    });
    return reply.send(
      CatalogAdminCategoriesResponseSchema.parse({
        status: "confirmed",
        categories: categories.map((category) => mapAdminCategory(category))
      })
    );
  });

  app.post("/cart/quote", async (request, reply) => {
    const input = parseRequest(CartQuoteRequestSchema, request.body);
    const quote = await withCatalog(async () =>
      toCartQuote(
        input.items,
        await repository.getProductsForQuote(
          input.items.map((item) => item.productId)
        )
      )
    );

    return reply.send(quote);
  });

  app.post("/admin/categories", async (request, reply) => {
    assertSafeOrigin(request, config);
    const staff = await staffGuard.require(request);
    const parsedInput = parseRequest(CatalogCategoryInputSchema, request.body);
    const input = mapCategoryInput(parsedInput);
    const idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
    const category = await withCatalog(() =>
      repository.createCategory(
        input,
        categoryMutationMetadata(request, staff.user.id, idempotencyKey, parsedInput)
      )
    );

    return reply.code(201).send(
      CatalogAdminCategoryResponseSchema.parse({
        status: "confirmed",
        category: mapAdminCategoryMutation({ ...category, productCount: 0 })
      })
    );
  });

  app.patch<{ Params: IdParams }>(
    "/admin/categories/:id",
    async (request, reply) => {
      assertSafeOrigin(request, config);
      const staff = await staffGuard.require(request);
      const parsedInput = parseRequest(CatalogCategoryUpdateSchema, request.body);
      const input = mapCategoryUpdate(parsedInput);
      const idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
      const category = await withCatalog(() =>
        repository.updateCategory(
          parseId(request.params.id),
          { ...input, expectedVersion: parsedInput.expectedVersion },
          categoryMutationMetadata(request, staff.user.id, idempotencyKey, parsedInput)
        )
      );

      if (category === null) {
        throw new CatalogNotFoundError();
      }

      return reply.send(
        CatalogAdminCategoryResponseSchema.parse({
          status: "confirmed",
          category: mapAdminCategoryMutation({ ...category, productCount: 0 })
        })
      );
    }
  );

  app.post("/admin/products", async (request, reply) => {
    assertSafeOrigin(request, config);
    await staffGuard.require(request);
    const input = mapProductInput(
      parseRequest(CatalogProductInputSchema, request.body)
    );
    const product = await withCatalog(() => repository.createProduct(input));

    return reply.code(201).send({ product: mapProduct(product) });
  });

  app.patch<{ Params: IdParams }>(
    "/admin/products/:id",
    async (request, reply) => {
      assertSafeOrigin(request, config);
      await staffGuard.require(request);
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
