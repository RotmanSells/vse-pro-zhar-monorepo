import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import type { CatalogRepository } from "@vse-pro-zhar/database";

import { registerCatalogRoutes } from "./catalog/route.js";
import type { ApiConfig } from "./config/env.js";
import { registerHealthRoute } from "./health/route.js";
import { registerErrorHandlers } from "./http/errors.js";
import { registerMediaRoutes } from "./media/route.js";
import {
  MAX_MEDIA_UPLOAD_BYTES,
  type MediaStorage
} from "./media/storage.js";

export interface BuildAppOptions {
  readonly logger?: boolean;
  readonly now?: () => Date;
  readonly catalogRepository?: CatalogRepository;
  readonly mediaStorage?: MediaStorage;
}

export function buildApp(
  config: ApiConfig,
  options: BuildAppOptions = {}
): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? { level: "info" },
    requestIdHeader: false,
    genReqId: () => randomUUID()
  });

  void app.register(cors, {
    origin: config.corsAllowedOrigins,
    methods: ["GET", "HEAD", "POST", "PATCH", "OPTIONS"]
  });
  void app.register(multipart, {
    limits: {
      fields: 0,
      fileSize: MAX_MEDIA_UPLOAD_BYTES,
      files: 1,
      parts: 1
    },
    throwFileSizeLimit: true
  });
  registerErrorHandlers(app);
  registerHealthRoute(app, config, options.now ?? (() => new Date()));
  registerCatalogRoutes(
    app,
    options.catalogRepository ?? {
      getCatalog: async () => {
        throw new Error("Catalog storage is not configured");
      },
      createCategory: async () => {
        throw new Error("Catalog storage is not configured");
      },
      updateCategory: async () => {
        throw new Error("Catalog storage is not configured");
      },
      createProduct: async () => {
        throw new Error("Catalog storage is not configured");
      },
      updateProduct: async () => {
        throw new Error("Catalog storage is not configured");
      }
    }
  );
  registerMediaRoutes(
    app,
    options.mediaStorage ?? {
      readImage: async () => {
        throw new Error("Media storage is not configured");
      },
      saveImage: async () => {
        throw new Error("Media storage is not configured");
      }
    }
  );

  return app;
}
