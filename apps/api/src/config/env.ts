import { EnvironmentSchema } from "@vse-pro-zhar/contracts";
import { z } from "zod";

const DEFAULT_CORS_ALLOWED_ORIGINS = [
  "http://127.0.0.1:8082",
  "http://localhost:8082",
  "http://127.0.0.1:5173",
  "http://localhost:5173"
] as const;

const OriginSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, context) => {
    let parsed: URL;

    try {
      parsed = new URL(value);
    } catch {
      context.issues.push({
        code: "custom",
        input: value,
        message: "Origin must be a valid URL"
      });
      return z.NEVER;
    }

    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      context.issues.push({
        code: "custom",
        input: value,
        message: "Origin must contain only an http(s) scheme, host and port"
      });
      return z.NEVER;
    }

    return parsed.origin;
  });

const CorsAllowedOriginsSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.split(","))
  .pipe(z.array(OriginSchema).min(1).max(20));

const PortSchema = z
  .string()
  .regex(/^\d+$/u)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65_535));

const RawApiConfigSchema = z.object({
  APP_ENV: EnvironmentSchema.default("development"),
  API_HOST: z.string().trim().min(1).default("127.0.0.1"),
  API_PORT: PortSchema.optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional()
});

export const ApiConfigSchema = z
  .object({
    environment: EnvironmentSchema,
    host: z.string().trim().min(1),
    port: z.number().int().min(1).max(65_535),
    corsAllowedOrigins: z.array(OriginSchema).min(1).max(20)
  })
  .strict();

export type ApiConfig = z.infer<typeof ApiConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = RawApiConfigSchema.safeParse(env);

  if (!parsed.success) {
    throw new Error("Invalid API configuration", { cause: parsed.error });
  }

  try {
    const corsAllowedOrigins =
      parsed.data.CORS_ALLOWED_ORIGINS === undefined
        ? parsed.data.APP_ENV === "production"
          ? undefined
          : [...DEFAULT_CORS_ALLOWED_ORIGINS]
        : CorsAllowedOriginsSchema.parse(parsed.data.CORS_ALLOWED_ORIGINS);

    return ApiConfigSchema.parse({
      environment: parsed.data.APP_ENV,
      host: parsed.data.API_HOST,
      port: parsed.data.API_PORT ?? 3000,
      corsAllowedOrigins
    });
  } catch (error: unknown) {
    throw new Error("Invalid API configuration", { cause: error });
  }
}
