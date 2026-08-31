import { describe, expect, it } from "vitest";

import { loadDatabaseConfig } from "../src/config/env.js";

describe("loadDatabaseConfig", () => {
  it("accepts a PostgreSQL connection URL", () => {
    expect(
      loadDatabaseConfig({
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/test"
      })
    ).toEqual({
      url: "postgresql://postgres:postgres@127.0.0.1:5432/test"
    });
  });

  it("rejects missing connection configuration", () => {
    expect(() => loadDatabaseConfig({})).toThrow(
      "Invalid database configuration"
    );
  });

  it("rejects non-PostgreSQL URLs", () => {
    expect(() =>
      loadDatabaseConfig({ DATABASE_URL: "https://example.test/database" })
    ).toThrow("Invalid database configuration");
  });
});
