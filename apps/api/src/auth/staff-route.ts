import type { StaffRepository, StaffSessionLookup } from "@vse-pro-zhar/database";
import {
  AdminAuthLoginRequestSchema,
  AdminAuthLoginResponseSchema,
  AdminAuthLogoutResponseSchema,
  AdminAuthMeResponseSchema
} from "@vse-pro-zhar/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { assertSafeOrigin } from "./route.js";
import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";
import {
  StaffAuthService,
  StaffAuthenticationError,
  StaffInputError,
  StaffSessionError,
  STAFF_SESSION_COOKIE
} from "./staff-service.js";

const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const LOGIN_RATE_LIMIT = 10;

interface RateLimitEntry {
  count: number;
  windowStartedAt: number;
}

class StaffLoginRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();

  consume(key: string, now: Date): boolean {
    const timestamp = now.getTime();
    const current = this.entries.get(key);
    if (current === undefined || timestamp - current.windowStartedAt >= LOGIN_RATE_LIMIT_WINDOW_MS) {
      this.entries.set(key, { count: 1, windowStartedAt: timestamp });
      return true;
    }
    if (current.count >= LOGIN_RATE_LIMIT) return false;
    current.count += 1;
    return true;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function readStaffSession(request: FastifyRequest): string | null {
  const raw = headerValue(request.headers.cookie);
  if (raw === undefined) return null;
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== STAFF_SESSION_COOKIE) continue;
    try {
      const value = decodeURIComponent(part.slice(separator + 1).trim());
      return value === "" ? null : value;
    } catch {
      return null;
    }
  }
  return null;
}

function staffCookie(token: string | null, config: ApiConfig, clear = false): string {
  return [
    `${STAFF_SESSION_COOKIE}=${token === null ? "" : encodeURIComponent(token)}`,
    "Path=/admin",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${clear ? 0 : Math.floor(config.staffSessionTtlMs / 1_000)}`,
    config.environment === "production" ? "Secure" : null
  ].filter((part): part is string => part !== null).join("; ");
}

export interface StaffGuard {
  require(request: FastifyRequest): Promise<StaffSessionLookup>;
}

export function createStaffGuard(
  repository: StaffRepository | undefined,
  config: ApiConfig,
  now: () => Date = () => new Date()
): StaffGuard {
  const service = repository === undefined ? null : new StaffAuthService(repository, config, now);
  return {
    async require(request) {
      if (service === null) throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
      try {
        return await service.getActiveSession(readStaffSession(request));
      } catch (error: unknown) {
        if (error instanceof ApiRequestError) throw error;
        if (error instanceof StaffSessionError) {
          throw new ApiRequestError("AUTHENTICATION_ERROR", 401);
        }
        throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
      }
    }
  };
}

export interface StaffAuthRouteOptions {
  readonly repository?: StaffRepository;
  readonly now?: () => Date;
}

export function registerStaffAuthRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  options: StaffAuthRouteOptions = {}
): void {
  const now = options.now ?? (() => new Date());
  const service = options.repository === undefined
    ? null
    : new StaffAuthService(options.repository, config, now);
  const limiter = new StaffLoginRateLimiter();
  const getService = (): StaffAuthService => {
    if (service === null) throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    return service;
  };

  app.post("/admin/auth/login", async (request, reply) => {
    assertSafeOrigin(request, config);
    if (!limiter.consume(request.ip, now())) throw new ApiRequestError("RATE_LIMITED", 429);
    const input = AdminAuthLoginRequestSchema.safeParse(request.body);
    if (!input.success) throw new ApiRequestError("VALIDATION_ERROR", 400);
    try {
      const result = await getService().login(input.data, request.id);
      reply.header("set-cookie", staffCookie(result.rawToken, config));
      return reply.code(200).send(AdminAuthLoginResponseSchema.parse(result.response));
    } catch (error: unknown) {
      if (error instanceof StaffInputError) throw new ApiRequestError("VALIDATION_ERROR", 400);
      if (error instanceof StaffAuthenticationError) throw new ApiRequestError("AUTHENTICATION_ERROR", 401);
      throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    }
  });

  app.get("/admin/auth/me", async (request, reply) => {
    try {
      const response = await getService().me(readStaffSession(request));
      return reply.send(AdminAuthMeResponseSchema.parse(response));
    } catch (error: unknown) {
      if (error instanceof StaffSessionError) throw new ApiRequestError("AUTHENTICATION_ERROR", 401);
      throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    }
  });

  app.post("/admin/auth/logout", async (request, reply) => {
    assertSafeOrigin(request, config);
    try {
      await getService().logout(readStaffSession(request), request.id);
    } catch {
      throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    }
    reply.header("set-cookie", staffCookie(null, config, true));
    return reply.send(AdminAuthLogoutResponseSchema.parse({ loggedOut: true }));
  });

  app.addHook("onResponse", async (request) => {
    if (request.url === "/admin/auth/login" || request.url === "/admin/auth/me" || request.url === "/admin/auth/logout") {
      await service?.cleanup();
    }
  });
}
