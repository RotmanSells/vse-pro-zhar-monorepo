import { z } from "zod";

const DatabaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, context) => {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      context.issues.push({
        code: "custom",
        input: value,
        message: "DATABASE_URL must be a valid PostgreSQL URL"
      });
      return z.NEVER;
    }

    if (
      (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
      url.hostname === ""
    ) {
      context.issues.push({
        code: "custom",
        input: value,
        message: "DATABASE_URL must use the postgres or postgresql scheme"
      });
      return z.NEVER;
    }

    return url.toString();
  });

const RawDatabaseConfigSchema = z.object({
  DATABASE_URL: DatabaseUrlSchema
});

export const DatabaseConfigSchema = z
  .object({
    url: DatabaseUrlSchema
  })
  .strict();

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

export interface ConfigDiagnostic {
  readonly path: string;
  readonly message: string;
}

export class DatabaseConfigError extends Error {
  readonly issues: readonly ConfigDiagnostic[];

  constructor(issues: readonly ConfigDiagnostic[]) {
    super("Invalid database configuration");
    this.name = "DatabaseConfigError";
    this.issues = issues;
  }
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
  }[]
): ConfigDiagnostic[] {
  return issues.map((issue) => ({
    path:
      issue.path.length === 0
        ? "DATABASE_URL"
        : issue.path.map((segment) => String(segment)).join("."),
    message: getSafeIssueMessage(issue.code)
  }));
}

export function loadDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env
): DatabaseConfig {
  const parsed = RawDatabaseConfigSchema.safeParse(env);

  if (!parsed.success) {
    throw new DatabaseConfigError(toSafeDiagnostics(parsed.error.issues));
  }

  const config = DatabaseConfigSchema.safeParse({
    url: parsed.data.DATABASE_URL
  });

  if (!config.success) {
    throw new DatabaseConfigError(toSafeDiagnostics(config.error.issues));
  }

  return config.data;
}

export type DatabaseOperation = "probe" | "migration";

export function formatDatabaseFailure(
  operation: DatabaseOperation,
  error: unknown
): string {
  const event = `database_${operation}_failed`;

  if (error instanceof DatabaseConfigError) {
    return JSON.stringify({
      category: "configuration",
      event,
      issues: error.issues
    });
  }

  return JSON.stringify({
    category: "runtime",
    event,
    message: "Database operation failed"
  });
}
