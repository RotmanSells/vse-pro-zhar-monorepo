import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ApiErrorSchema,
  MediaUploadResponseSchema
} from "@vse-pro-zhar/contracts";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { createMemoryStaffRepository, staffCookie, type MemoryStaffState } from "./staff-fixtures.js";
import {
  createMediaStorage,
  MAX_MEDIA_UPLOAD_BYTES
} from "../src/media/storage.js";

interface MultipartPayload {
  readonly contentType: string;
  readonly payload: Buffer;
}

async function createMultipartPayload(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<MultipartPayload> {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), filename);
  const request = new Request("http://api.test/admin/media/images", {
    body: form,
    method: "POST"
  });

  return {
    contentType: request.headers.get("content-type") ?? "",
    payload: Buffer.from(await request.arrayBuffer())
  };
}

describe("media upload API", () => {
  let app: FastifyInstance;
  let mediaDirectory: string;
  let staff: MemoryStaffState;
  let adminSession: string;

  beforeEach(async () => {
    mediaDirectory = await mkdtemp(join(tmpdir(), "vse-pro-zhar-media-"));
    staff = await createMemoryStaffRepository();
    app = buildApp(loadConfig({ APP_ENV: "test" }), {
      logger: false,
      staffRepository: staff.repository,
      mediaStorage: createMediaStorage({
        directory: mediaDirectory,
        publicUrl: "http://127.0.0.1:3000"
      })
    });
    await app.ready();
    adminSession = await staffCookie(app);
  });

  afterEach(async () => {
    await app.close();
    await rm(mediaDirectory, { force: true, recursive: true });
  });

  it("converts an accepted image to resized WebP and serves it", async () => {
    const source = await sharp({
      create: {
        channels: 3,
        height: 1_200,
        background: { b: 45, g: 120, r: 220 },
        width: 2_400
      }
    })
      .png()
      .toBuffer();
    const multipart = await createMultipartPayload(
      source,
      "image/png",
      "dish.png"
    );

    const uploadResponse = await app.inject({
      method: "POST",
      url: "/admin/media/images",
      headers: { "content-type": multipart.contentType, cookie: adminSession },
      payload: multipart.payload
    });

    expect(uploadResponse.statusCode, uploadResponse.body).toBe(201);
    const asset = MediaUploadResponseSchema.parse(uploadResponse.json());
    expect(asset).toMatchObject({
      format: "webp",
      height: 800,
      mimeType: "image/webp",
      width: 1_600
    });
    expect(asset.sizeBytes).toBeGreaterThan(0);

    const servedResponse = await app.inject({
      method: "GET",
      url: new URL(asset.url).pathname
    });
    expect(servedResponse.statusCode).toBe(200);
    expect(servedResponse.headers["content-type"]).toContain("image/webp");

    const servedMetadata = await sharp(servedResponse.rawPayload).metadata();
    expect(servedMetadata).toMatchObject({
      format: "webp",
      height: 800,
      width: 1_600
    });
  });

  it("rejects unsupported and malformed image inputs safely", async () => {
    const unsupported = await createMultipartPayload(
      Buffer.from("not an image"),
      "image/gif",
      "dish.gif"
    );
    const unsupportedResponse = await app.inject({
      method: "POST",
      url: "/admin/media/images",
      headers: { "content-type": unsupported.contentType, cookie: adminSession },
      payload: unsupported.payload
    });

    expect(unsupportedResponse.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(unsupportedResponse.json()).error.code).toBe(
      "VALIDATION_ERROR"
    );

    const malformed = await createMultipartPayload(
      Buffer.from("not a png"),
      "image/png",
      "dish.png"
    );
    const malformedResponse = await app.inject({
      method: "POST",
      url: "/admin/media/images",
      headers: { "content-type": malformed.contentType, cookie: adminSession },
      payload: malformed.payload
    });

    expect(malformedResponse.statusCode).toBe(400);
    expect(JSON.stringify(malformedResponse.json())).not.toContain("not a png");
  });

  it("rejects cross-origin Admin image uploads before storing a file", async () => {
    const source = await sharp({
      create: {
        channels: 3,
        height: 1,
        background: { b: 45, g: 120, r: 220 },
        width: 1
      }
    })
      .png()
      .toBuffer();
    const multipart = await createMultipartPayload(source, "image/png", "dish.png");
    const response = await app.inject({
      method: "POST",
      url: "/admin/media/images",
      headers: {
        "content-type": multipart.contentType,
        origin: "https://attacker.example"
      },
      payload: multipart.payload
    });

    expect(response.statusCode).toBe(403);
    expect(ApiErrorSchema.parse(response.json()).error.code).toBe(
      "AUTHENTICATION_ERROR"
    );
  });

  it("rejects files over the upload limit", async () => {
    const oversized = await createMultipartPayload(
      Buffer.alloc(MAX_MEDIA_UPLOAD_BYTES + 1, 7),
      "image/jpeg",
      "large.jpg"
    );
    const response = await app.inject({
      method: "POST",
      url: "/admin/media/images",
      headers: { "content-type": oversized.contentType, cookie: adminSession },
      payload: oversized.payload
    });

    expect(response.statusCode).toBe(413);
    expect(ApiErrorSchema.parse(response.json()).error.code).toBe(
      "PAYLOAD_TOO_LARGE"
    );
  });

  it("does not expose arbitrary filesystem paths", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/media/not-a-media-file.webp"
    });

    expect(response.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(response.json()).error.code).toBe("NOT_FOUND");
  });
});
