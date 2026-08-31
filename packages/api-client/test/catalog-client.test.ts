import { describe, expect, it, vi } from "vitest";

import {
  CatalogResponseSchema,
  MediaUploadResponseSchema
} from "@vse-pro-zhar/contracts";

import {
  CatalogClientError,
  createCatalogClient
} from "../src/catalog-client.js";
import type { FetchImplementation } from "../src/health-client.js";

const validCatalog = CatalogResponseSchema.parse({
  categories: [
    {
      id: 1,
      slug: "shashlyk",
      name: "Шашлык",
      sortOrder: 10,
      isVisible: true,
      products: [
        {
          id: 1,
          categoryId: 1,
          name: "Шашлык из свинины",
          description: "Сочный шашлык на углях",
          priceMinor: 45_000,
          imageUrl: null,
          emoji: "🥩",
          tag: "hit",
          isVisible: true,
          sortOrder: 0
        }
      ]
    }
  ]
});

const validUpload = MediaUploadResponseSchema.parse({
  format: "webp",
  height: 800,
  mimeType: "image/webp",
  sizeBytes: 48_000,
  url: "http://127.0.0.1:3000/media/example.webp",
  width: 1_200
});

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}

describe("shared catalog client", () => {
  it("requests and validates the public catalog", async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async (url, init) => {
      expect(url).toBe("http://127.0.0.1:3000/catalog");
      expect(init?.method).toBe("GET");
      expect(init?.headers).toEqual({ Accept: "application/json" });
      return makeResponse(validCatalog);
    });
    const client = createCatalogClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl
    });

    await expect(client.getCatalog()).resolves.toEqual(validCatalog);
  });

  it("validates mutation payloads before making a request", async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async () =>
      makeResponse({})
    );
    const client = createCatalogClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl
    });

    await expect(
      client.createProduct({
        categoryId: 1,
        name: "Блюдо",
        description: "",
        priceMinor: 450.5
      })
    ).rejects.toMatchObject({
      kind: "validation",
      message: "Проверьте данные каталога"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("normalizes API failures without exposing transport details", async () => {
    const client = createCatalogClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl: async () =>
        makeResponse(
          {
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Каталог временно недоступен",
              requestId: "request-1"
            }
          },
          503
        )
    });

    const error = await client.getCatalog().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CatalogClientError);
    expect(error).toMatchObject({
      kind: "http",
      message: "Каталог временно недоступен"
    });
  });

  it("rejects an invalid response safely", async () => {
    const client = createCatalogClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl: async () => makeResponse({ categories: [{ id: 1 }] })
    });

    await expect(client.getCatalog()).rejects.toMatchObject({
      kind: "invalid_response",
      message: "Backend API вернул некорректный ответ"
    });
  });

  it("uploads a Blob as multipart without overriding its boundary", async () => {
    const fetchImpl = vi.fn<FetchImplementation>(async (url, init) => {
      expect(url).toBe("http://127.0.0.1:3000/admin/media/images");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ Accept: "application/json" });
      expect(init?.body).toBeInstanceOf(FormData);

      const formData = init?.body as FormData;
      expect(formData.get("file")).toBeInstanceOf(Blob);

      return makeResponse(validUpload, 201);
    });
    const client = createCatalogClient({
      apiUrl: "http://127.0.0.1:3000",
      fetchImpl
    });

    await expect(
      client.uploadImage(new Blob(["image"], { type: "image/jpeg" }))
    ).resolves.toEqual(validUpload);
  });
});
