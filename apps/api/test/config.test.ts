import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config/env.js";

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
      port: 3100
    });
  });

  it("uses safe local defaults when optional environment values are absent", () => {
    expect(loadConfig({})).toEqual({
      environment: "development",
      host: "127.0.0.1",
      port: 3000
    });
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
});
