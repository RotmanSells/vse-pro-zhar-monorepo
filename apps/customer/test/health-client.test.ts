import { describe, expect, it, vi } from "vitest";

import { HealthResponseSchema } from "@vse-pro-zhar/contracts";

import { createHealthClient } from "../src/api/health-client";

const validHealthResponse = HealthResponseSchema.parse({
  service: "api",
  status: "ok",
  environment: "test",
  timestamp: "2026-08-31T10:00:00.000Z"
});

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

describe("Customer health API boundary", () => {
  it("accepts a valid shared-contract response", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("http://127.0.0.1:3000/health");
      return makeResponse(validHealthResponse);
    });
    const client = createHealthClient({ fetchImpl });

    await expect(client.getHealth()).resolves.toEqual(validHealthResponse);
  });

  it("rejects an invalid response safely", async () => {
    const client = createHealthClient({
      fetchImpl: async () => makeResponse({ service: "api", status: "broken" })
    });

    await expect(client.getHealth()).rejects.toMatchObject({
      kind: "invalid_response",
      message: "Backend API вернул некорректный ответ"
    });
  });

  it("turns a network failure into a controlled error", async () => {
    const client = createHealthClient({
      fetchImpl: async () => {
        throw new Error("network-only-detail");
      }
    });

    await expect(client.getHealth()).rejects.toMatchObject({
      kind: "network",
      message: "Не удалось связаться с Backend API"
    });
  });
});
