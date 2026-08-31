import type { FastifyInstance } from "fastify";
import { resolve } from "node:path";
import {
  createCatalogRepository,
  createDatabaseClient,
  type DatabaseClient
} from "@vse-pro-zhar/database";

import { buildApp } from "./app.js";
import { loadConfig, type ApiConfig } from "./config/env.js";
import { formatApiStartupError } from "./config/diagnostics.js";
import { createMediaStorage } from "./media/storage.js";

export function installGracefulShutdown(
  app: FastifyInstance,
  closeResources: () => Promise<void> = async () => undefined
): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    app.log.info({ signal }, "Shutting down API");

    try {
      await app.close();
      await closeResources();
    } catch (error: unknown) {
      app.log.error({ err: error }, "API shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

export async function startServer(config: ApiConfig): Promise<FastifyInstance> {
  let database: DatabaseClient | undefined;

  const databaseUrl = process.env["DATABASE_URL"];

  if (databaseUrl !== undefined && databaseUrl.trim() !== "") {
    database = createDatabaseClient();
  }

  const mediaDirectory = process.env["MEDIA_DIR"]?.trim();
  const mediaPublicUrl = process.env["MEDIA_PUBLIC_URL"]?.trim();
  const mediaStorage = createMediaStorage({
    directory:
      mediaDirectory === undefined || mediaDirectory === ""
        ? resolve(process.cwd(), "data/media")
        : mediaDirectory,
    publicUrl:
      mediaPublicUrl === undefined || mediaPublicUrl === ""
        ? `http://127.0.0.1:${config.port}`
        : mediaPublicUrl
  });

  const app =
    database === undefined
      ? buildApp(config, { mediaStorage })
      : buildApp(config, {
          catalogRepository: createCatalogRepository(database),
          mediaStorage
        });
  installGracefulShutdown(app, async () => {
    await database?.close();
  });

  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info({ host: config.host, port: config.port }, "API listening");
    return app;
  } catch (error: unknown) {
    await app.close();
    await database?.close();
    throw error;
  }
}

async function main(): Promise<void> {
  await startServer(loadConfig());
}

void main().catch((error: unknown) => {
  console.error(formatApiStartupError(error));
  process.exitCode = 1;
});
