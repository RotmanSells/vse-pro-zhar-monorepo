import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";

import type { ApiConfig } from "./config/env.js";
import { registerHealthRoute } from "./health/route.js";
import { registerErrorHandlers } from "./http/errors.js";

export interface BuildAppOptions {
  readonly logger?: boolean;
  readonly now?: () => Date;
}

export function buildApp(
  config: ApiConfig,
  options: BuildAppOptions = {}
): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? { level: "info" },
    requestIdHeader: false,
    genReqId: () => randomUUID()
  });

  registerErrorHandlers(app);
  registerHealthRoute(app, config, options.now ?? (() => new Date()));

  return app;
}
