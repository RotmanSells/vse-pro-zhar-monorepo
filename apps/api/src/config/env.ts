import { EnvironmentSchema } from "@vse-pro-zhar/contracts";
import { z } from "zod";

const PortSchema = z
  .string()
  .regex(/^\d+$/u)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65_535));

const RawApiConfigSchema = z.object({
  APP_ENV: EnvironmentSchema.default("development"),
  API_HOST: z.string().trim().min(1).default("127.0.0.1"),
  API_PORT: PortSchema.optional()
});

export const ApiConfigSchema = z
  .object({
    environment: EnvironmentSchema,
    host: z.string().trim().min(1),
    port: z.number().int().min(1).max(65_535)
  })
  .strict();

export type ApiConfig = z.infer<typeof ApiConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = RawApiConfigSchema.safeParse(env);

  if (!parsed.success) {
    throw new Error("Invalid API configuration", { cause: parsed.error });
  }

  return ApiConfigSchema.parse({
    environment: parsed.data.APP_ENV,
    host: parsed.data.API_HOST,
    port: parsed.data.API_PORT ?? 3000
  });
}
