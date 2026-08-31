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

export function loadDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env
): DatabaseConfig {
  const parsed = RawDatabaseConfigSchema.safeParse(env);

  if (!parsed.success) {
    throw new Error("Invalid database configuration", { cause: parsed.error });
  }

  return DatabaseConfigSchema.parse({ url: parsed.data.DATABASE_URL });
}
