import {
  HealthResponseSchema,
  type HealthResponse
} from "@vse-pro-zhar/contracts";

import type { ApiConfig } from "../config/env.js";

export function buildHealthResponse(
  config: ApiConfig,
  now: () => Date = () => new Date()
): HealthResponse {
  return HealthResponseSchema.parse({
    service: "api",
    status: "ok",
    environment: config.environment,
    timestamp: now().toISOString()
  });
}
