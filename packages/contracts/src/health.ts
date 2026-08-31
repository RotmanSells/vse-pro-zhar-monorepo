import { z } from "zod";

export const EnvironmentSchema = z.enum(["development", "test", "production"]);
export type ApiEnvironment = z.infer<typeof EnvironmentSchema>;

export const HealthResponseSchema = z
  .object({
    service: z.literal("api"),
    status: z.literal("ok"),
    environment: EnvironmentSchema,
    timestamp: z.iso.datetime({ offset: true })
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorCodeSchema = z.enum([
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "SERVICE_UNAVAILABLE",
  "PAYLOAD_TOO_LARGE",
  "INTERNAL_ERROR"
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: ApiErrorCodeSchema,
        message: z.string().trim().min(1),
        requestId: z.string().trim().min(1)
      })
      .strict()
  })
  .strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;
