import { describe, expect, it } from "vitest";

import { MediaUploadResponseSchema } from "../src/index.js";

describe("media contracts", () => {
  it("accepts the normalized WebP upload response", () => {
    expect(
      MediaUploadResponseSchema.parse({
        format: "webp",
        height: 800,
        mimeType: "image/webp",
        sizeBytes: 48_000,
        url: "http://127.0.0.1:3000/media/example.webp",
        width: 1_200
      })
    ).toMatchObject({ format: "webp", mimeType: "image/webp" });
  });

  it("rejects non-WebP or non-http(s) upload responses", () => {
    expect(() =>
      MediaUploadResponseSchema.parse({
        format: "jpeg",
        height: 800,
        mimeType: "image/jpeg",
        sizeBytes: 48_000,
        url: "javascript:alert(1)",
        width: 1_200
      })
    ).toThrow();
  });
});
