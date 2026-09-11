import { z } from "zod";

const CatalogIdSchema = z.number().int().positive();

const CatalogSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

const CatalogNameSchema = z.string().trim().min(1).max(160);
const CatalogDateTimeSchema = z.iso.datetime({ offset: true });
const CatalogPositiveVersionSchema = z.number().int().positive().max(2_147_483_647);
const CatalogCountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const CatalogImageUrlSchema = z
  .string()
  .trim()
  .max(1_000)
  .url()
  .refine((value) => /^https?:\/\//u.test(value));

export const CatalogTagSchema = z.enum(["hit", "new"]);
export type CatalogTag = z.infer<typeof CatalogTagSchema>;

export const CatalogCategorySchema = z
  .object({
    id: CatalogIdSchema,
    slug: CatalogSlugSchema,
    name: CatalogNameSchema,
    sortOrder: z.number().int().min(0).max(100_000),
    isVisible: z.boolean()
  })
  .strict();
export type CatalogCategory = z.infer<typeof CatalogCategorySchema>;

export const CatalogAdminCategorySchema = CatalogCategorySchema.extend({
  version: CatalogPositiveVersionSchema,
  productCount: CatalogCountSchema,
  createdAt: CatalogDateTimeSchema,
  updatedAt: CatalogDateTimeSchema
}).strict();
export type CatalogAdminCategory = z.infer<typeof CatalogAdminCategorySchema>;

export const CatalogAdminCategoriesResponseSchema = z.object({
  status: z.literal("confirmed"),
  categories: z.array(CatalogAdminCategorySchema).max(10_000).readonly()
}).strict();
export type CatalogAdminCategoriesResponse = z.infer<
  typeof CatalogAdminCategoriesResponseSchema
>;

export const CatalogAdminCategoryMutationSchema = CatalogAdminCategorySchema.omit({
  productCount: true
}).strict();
export type CatalogAdminCategoryMutation = z.infer<
  typeof CatalogAdminCategoryMutationSchema
>;

export const CatalogAdminCategoryResponseSchema = z.object({
  status: z.literal("confirmed"),
  category: CatalogAdminCategoryMutationSchema
}).strict();
export type CatalogAdminCategoryResponse = z.infer<
  typeof CatalogAdminCategoryResponseSchema
>;

export const CatalogProductSchema = z
  .object({
    id: CatalogIdSchema,
    categoryId: CatalogIdSchema,
    name: CatalogNameSchema,
    description: z.string().trim().max(500),
    priceMinor: z.number().int().min(0).max(100_000_000),
    imageUrl: CatalogImageUrlSchema.nullable(),
    emoji: z.string().trim().min(1).max(32),
    tag: CatalogTagSchema.nullable(),
    isVisible: z.boolean(),
    sortOrder: z.number().int().min(0).max(100_000)
  })
  .strict();
export type CatalogProduct = z.infer<typeof CatalogProductSchema>;

export const CatalogCategoryWithProductsSchema = CatalogCategorySchema.extend({
  products: z.array(CatalogProductSchema)
}).strict();
export type CatalogCategoryWithProducts = z.infer<
  typeof CatalogCategoryWithProductsSchema
>;

export const CatalogResponseSchema = z
  .object({
    categories: z.array(CatalogCategoryWithProductsSchema)
  })
  .strict();
export type CatalogResponse = z.infer<typeof CatalogResponseSchema>;

const CatalogProductWriteFields = {
  categoryId: CatalogIdSchema,
  name: CatalogNameSchema,
  description: z.string().trim().max(500),
  priceMinor: z.number().int().min(0).max(100_000_000),
  imageUrl: CatalogImageUrlSchema.nullable().default(null),
  emoji: z.string().trim().min(1).max(32).default("🍽️"),
  tag: CatalogTagSchema.nullable().default(null),
  isVisible: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100_000).default(0)
} as const;

export const CatalogProductInputSchema = z
  .object(CatalogProductWriteFields)
  .strict();
export type CatalogProductInput = z.input<typeof CatalogProductInputSchema>;

export const CatalogProductUpdateSchema = z
  .object(CatalogProductWriteFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export type CatalogProductUpdate = z.input<typeof CatalogProductUpdateSchema>;

export const CatalogCategoryInputSchema = z
  .object({
    slug: CatalogSlugSchema,
    name: CatalogNameSchema,
    sortOrder: z.number().int().min(0).max(100_000).default(0),
    isVisible: z.boolean().default(true)
  })
  .strict();
export type CatalogCategoryInput = z.input<typeof CatalogCategoryInputSchema>;

export const CatalogCategoryUpdateSchema = z
  .object({
    name: CatalogNameSchema,
    sortOrder: z.number().int().min(0).max(100_000),
    isVisible: z.boolean()
  })
  .partial()
  .extend({ expectedVersion: CatalogPositiveVersionSchema })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export type CatalogCategoryUpdate = z.input<
  typeof CatalogCategoryUpdateSchema
>;

export const CatalogCategoryIdempotencyKeySchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 32 && codePoint !== 127;
  }))
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(255));
export type CatalogCategoryIdempotencyKey = z.infer<
  typeof CatalogCategoryIdempotencyKeySchema
>;
