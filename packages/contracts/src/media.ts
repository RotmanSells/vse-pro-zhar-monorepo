import { z } from "zod";

import { CatalogImageUrlSchema } from "./catalog.js";

export const MediaUploadResponseSchema = z
  .object({
    url: CatalogImageUrlSchema,
    format: z.literal("webp"),
    mimeType: z.literal("image/webp"),
    sizeBytes: z.number().int().positive().max(10_485_760),
    width: z.number().int().positive().max(1_600),
    height: z.number().int().positive().max(1_600)
  })
  .strict();

export type MediaUploadResponse = z.infer<typeof MediaUploadResponseSchema>;
