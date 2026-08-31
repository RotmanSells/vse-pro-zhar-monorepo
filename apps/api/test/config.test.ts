import { describe, expect, it } from "vitest";

import { formatApiStartupError } from "../src/config/diagnostics.js";
import { ApiConfigError, loadConfig } from "../src/config/env.js";

describe("loadConfig", () => {
  it("accepts valid runtime configuration", () => {
    expect(
      loadConfig({
        APP_ENV: "test",
        API_HOST: "127.0.0.1",
        API_PORT: "3100"
      })
    ).toEqual({
      environment: "test",
      host: "127.0.0.1",
      port: 3100,
      corsAllowedOrigins: [
        "http://127.0.0.1:8082",
        "http://localhost:8082",
        "http://127.0.0.1:5173",
        "http://localhost:5173"
      ]
    });
  });

  it("uses safe local defaults when optional environment values are absent", () => {
    expect(loadConfig({})).toEqual({
      environment: "development",
      host: "127.0.0.1",
      port: 3000,
      corsAllowedOrigins: [
        "http://127.0.0.1:8082",
        "http://localhost:8082",
        "http://127.0.0.1:5173",
        "http://localhost:5173"
      ]
    });
  });

  it("requires an explicit origin allowlist in production", () => {
    expect(() => loadConfig({ APP_ENV: "production" })).toThrow(
      "Invalid API configuration"
    );

    expect(
      loadConfig({
        APP_ENV: "production",
        CORS_ALLOWED_ORIGINS: "https://customer.example, https://admin.example"
      }).corsAllowedOrigins
    ).toEqual(["https://customer.example", "https://admin.example"]);
  });

  it("rejects an unsupported environment", () => {
    expect(() => loadConfig({ APP_ENV: "staging" })).toThrow(
      "Invalid API configuration"
    );
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ API_PORT: "not-a-port" })).toThrow(
      "Invalid API configuration"
    );
  });

  it("provides structured startup diagnostics without raw values", () => {
    let error: unknown;

    try {
      loadConfig({ APP_ENV: "production", CORS_ALLOWED_ORIGINS: "not-an-origin" });
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ApiConfigError);
    expect(formatApiStartupError(error)).toBe(
      JSON.stringify({
        category: "configuration",
        event: "api_startup_failed",
        issues: [
          {
            path: "CORS_ALLOWED_ORIGINS[0]",
            message: "value has invalid format"
          }
        ]
      })
    );
    expect(formatApiStartupError(error)).not.toContain("not-an-origin");
  });
});
