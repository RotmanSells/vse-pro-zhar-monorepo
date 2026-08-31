import { describe, expect, it } from "vitest";

import {
  formatDatabaseFailure,
  loadDatabaseConfig,
  DatabaseConfigError
} from "../src/config/env.js";

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

  it("reports the invalid variable without exposing database credentials", () => {
    const password = "super-secret-password";
    let error: unknown;

    try {
      loadDatabaseConfig({
        DATABASE_URL: `mysql://postgres:${password}@127.0.0.1:3306/test`
      });
    } catch (caught: unknown) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DatabaseConfigError);
    const diagnostic = formatDatabaseFailure("probe", error);

    expect(diagnostic).toContain('"path":"DATABASE_URL"');
    expect(diagnostic).toContain("configuration");
    expect(diagnostic).not.toContain(password);
    expect(diagnostic).not.toContain("postgresql://");
  });
});
