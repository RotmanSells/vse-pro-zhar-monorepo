import type { FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import { loadConfig, type ApiConfig } from "./config/env.js";
import { formatApiStartupError } from "./config/diagnostics.js";

export function installGracefulShutdown(app: FastifyInstance): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    app.log.info({ signal }, "Shutting down API");

    try {
      await app.close();
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
  const app = buildApp(config);
  installGracefulShutdown(app);
  await app.listen({ host: config.host, port: config.port });
  app.log.info({ host: config.host, port: config.port }, "API listening");
  return app;
}

async function main(): Promise<void> {
  await startServer(loadConfig());
}

void main().catch((error: unknown) => {
  console.error(formatApiStartupError(error));
  process.exitCode = 1;
});
