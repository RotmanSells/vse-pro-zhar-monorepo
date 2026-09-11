import { EnvironmentSchema } from "@vse-pro-zhar/contracts";
import { z } from "zod";

const DEFAULT_CORS_ALLOWED_ORIGINS = [
  "http://127.0.0.1:8082",
  "http://localhost:8082",
  "http://127.0.0.1:5173",
  "http://localhost:5173"
] as const;
const DEVELOPMENT_SESSION_SECRET =
  "development-only-session-secret-change-me-32-bytes";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_STAFF_SESSION_TTL_SECONDS = 60 * 60 * 8;

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
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  AUTH_SESSION_SECRET: z.string().trim().min(32).optional(),
  AUTH_SESSION_TTL_SECONDS: z
    .string()
    .regex(/^\d+$/u)
    .transform(Number)
    .pipe(z.number().int().min(300).max(60 * 60 * 24 * 365))
    .optional(),
  STAFF_SESSION_TTL_SECONDS: z
    .string()
    .regex(/^\d+$/u)
    .transform(Number)
    .pipe(z.number().int().min(300).max(60 * 60 * 24))
    .optional()
});

export const ApiConfigSchema = z
  .object({
    environment: EnvironmentSchema,
    host: z.string().trim().min(1),
    port: z.number().int().min(1).max(65_535),
    corsAllowedOrigins: z.array(OriginSchema).min(1).max(20),
    sessionSecret: z.string().min(32),
    sessionTtlMs: z.number().int().min(300_000),
    staffSessionTtlMs: z.number().int().min(300_000)
  })
  .strict();

export type ApiConfig = z.infer<typeof ApiConfigSchema>;

export interface ConfigDiagnostic {
  readonly path: string;
  readonly message: string;
}

export class ApiConfigError extends Error {
  readonly issues: readonly ConfigDiagnostic[];

  constructor(issues: readonly ConfigDiagnostic[]) {
    super("Invalid API configuration");
    this.name = "ApiConfigError";
    this.issues = issues;
  }
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") {
      return `${result}[${segment}]`;
    }

    const name = String(segment);
    return result === "" ? name : `${result}.${name}`;
  }, "");
}

function getSafeIssueMessage(code: string): string {
  switch (code) {
    case "invalid_type":
      return "value has invalid type";
    case "too_small":
      return "value is missing or too short";
    case "too_big":
      return "value is too large";
    case "invalid_format":
      return "value has invalid format";
    case "invalid_value":
      return "value is not allowed";
    case "custom":
      return "value has invalid format";
    default:
      return "value is invalid";
  }
}

function toSafeDiagnostics(
  issues: readonly {
    readonly path: readonly PropertyKey[];
    readonly code: string;
  }[],
  prefix = ""
): ConfigDiagnostic[] {
  return issues.map((issue) => {
    const issuePath = formatIssuePath(issue.path);
    const path =
      prefix === "" || issuePath === ""
        ? `${prefix}${issuePath}`
        : issuePath.startsWith("[")
          ? `${prefix}${issuePath}`
          : `${prefix}.${issuePath}`;

    return {
      path: path === "" ? "configuration" : path,
      message: getSafeIssueMessage(issue.code)
    };
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = RawApiConfigSchema.safeParse(env);

  if (!parsed.success) {
    throw new ApiConfigError(toSafeDiagnostics(parsed.error.issues));
  }

  if (
    parsed.data.APP_ENV === "production" &&
    parsed.data.AUTH_SESSION_SECRET === undefined
  ) {
    throw new ApiConfigError([
      {
        path: "AUTH_SESSION_SECRET",
        message: "value is required in production"
      }
    ]);
  }

  let corsAllowedOrigins: string[];

  if (parsed.data.CORS_ALLOWED_ORIGINS === undefined) {
    if (parsed.data.APP_ENV === "production") {
      throw new ApiConfigError([
        {
          path: "CORS_ALLOWED_ORIGINS",
          message: "value is required in production"
        }
      ]);
    }

    corsAllowedOrigins = [...DEFAULT_CORS_ALLOWED_ORIGINS];
  } else {
    const parsedOrigins = CorsAllowedOriginsSchema.safeParse(
      parsed.data.CORS_ALLOWED_ORIGINS
    );

    if (!parsedOrigins.success) {
      throw new ApiConfigError(
        toSafeDiagnostics(parsedOrigins.error.issues, "CORS_ALLOWED_ORIGINS")
      );
    }

    corsAllowedOrigins = parsedOrigins.data;
  }

  const config = ApiConfigSchema.safeParse({
    environment: parsed.data.APP_ENV,
    host: parsed.data.API_HOST,
    port: parsed.data.API_PORT ?? 3000,
    corsAllowedOrigins,
    sessionSecret:
      parsed.data.AUTH_SESSION_SECRET ?? DEVELOPMENT_SESSION_SECRET,
    sessionTtlMs:
      (parsed.data.AUTH_SESSION_TTL_SECONDS ?? DEFAULT_SESSION_TTL_SECONDS) *
      1_000,
    staffSessionTtlMs:
      (parsed.data.STAFF_SESSION_TTL_SECONDS ?? DEFAULT_STAFF_SESSION_TTL_SECONDS) *
      1_000
  });

  if (!config.success) {
    throw new ApiConfigError(toSafeDiagnostics(config.error.issues));
  }

  return config.data;
}
