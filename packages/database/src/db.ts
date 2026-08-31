import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { loadDatabaseConfig, type DatabaseConfig } from "./config/env.js";

export function createDatabaseClient(
  config: DatabaseConfig = loadDatabaseConfig()
) {
  const pool = new Pool({ connectionString: config.url });
  const db = drizzle({ client: pool });

  return {
    db,
    pool,
    async probe(): Promise<void> {
      await db.execute(sql`SELECT 1`);
    },
    async close(): Promise<void> {
      await pool.end();
    }
  };
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
