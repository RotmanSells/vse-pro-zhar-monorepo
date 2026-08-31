import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ApiErrorSchema,
  HealthResponseSchema
} from "@vse-pro-zhar/contracts";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";

const fixedTimestamp = "2026-08-31T10:00:00.000Z";

describe("API HTTP foundation", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      now: () => new Date(fixedTimestamp)
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns a shared-contract-valid health response", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    const body: unknown = response.json();
    expect(HealthResponseSchema.parse(body)).toEqual({
      service: "api",
      status: "ok",
      environment: "test",
      timestamp: fixedTimestamp
    });
  });

  it("limits browser access to the configured origins", async () => {
    const allowedResponse = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://localhost:8082" }
    });

    expect(allowedResponse.headers["access-control-allow-origin"]).toBe(
      "http://localhost:8082"
    );
    expect(allowedResponse.headers["access-control-allow-origin"]).not.toBe(
      "*"
    );

    const disallowedResponse = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://malicious.example" }
    });

    expect(
      disallowedResponse.headers["access-control-allow-origin"]
    ).toBeUndefined();
  });

  it("returns a safe error envelope for an unknown route", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/definitely-not-found",
      headers: {
        "request-id": "client-supplied-id"
      }
    });

    expect(response.statusCode).toBe(404);
    const body: unknown = response.json();
    const error = ApiErrorSchema.parse(body);
    expect(error.error.code).toBe("NOT_FOUND");
    expect(error.error.message).toBe("Ресурс не найден");
    expect(error.error.requestId).not.toBe("client-supplied-id");
    expect(JSON.stringify(error)).not.toContain("stack");
  });

  it("hides unexpected errors behind a safe error envelope", async () => {
    app.get("/test-only-unexpected-error", async () => {
      throw new Error("internal-only-detail");
    });

    const response = await app.inject({
      method: "GET",
      url: "/test-only-unexpected-error"
    });

    expect(response.statusCode).toBe(500);
    const body: unknown = response.json();
    const error = ApiErrorSchema.parse(body);
    expect(error.error.code).toBe("INTERNAL_ERROR");
    expect(error.error.message).toBe("Внутренняя ошибка сервера");
    expect(JSON.stringify(error)).not.toContain("internal-only-detail");
  });
});
