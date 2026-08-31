import type { FastifyInstance } from "fastify";

import type { ApiConfig } from "../config/env.js";
import { buildHealthResponse } from "./health.js";

export function registerHealthRoute(
  app: FastifyInstance,
  config: ApiConfig,
  now: () => Date
): void {
  app.get("/health", () => buildHealthResponse(config, now));
}
