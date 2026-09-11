import type { CustomerRepository } from "@vse-pro-zhar/database";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CustomerIdentifyRequestSchema,
  CustomerIdentifyResponseSchema,
  CustomerLogoutResponseSchema,
  CustomerMeResponseSchema
} from "@vse-pro-zhar/contracts";
import type { CustomerIdentifyRequest } from "@vse-pro-zhar/contracts";

import type { ApiConfig } from "../config/env.js";
import { ApiRequestError } from "../http/errors.js";
import {
  CustomerAuthService,
  CustomerInputError,
  CustomerSessionError,
  type AuthTransport
} from "./service.js";

const SESSION_COOKIE = "vse-pro-zhar-session";
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const IDENTIFY_LIMIT = 20;
const SESSION_LIMIT = 120;

interface RateLimitEntry {
  count: number;
  windowStartedAt: number;
}

class InProcessRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();

  consume(key: string, limit: number, now: Date): boolean {
    const timestamp = now.getTime();
    const current = this.entries.get(key);
    if (
      current === undefined ||
      timestamp - current.windowStartedAt >= RATE_LIMIT_WINDOW_MS
    ) {
      this.entries.set(key, { count: 1, windowStartedAt: timestamp });
      return true;
    }

    if (current.count >= limit) {
      return false;
    }

    current.count += 1;
    return true;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readCookie(request: FastifyRequest, name: string): string | null {
  const raw = headerValue(request.headers.cookie);
  if (raw === undefined) return null;

  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }

  return null;
}

export function readSession(request: FastifyRequest): {
  readonly token: string | null;
  readonly transport: AuthTransport;
} {
  const authorization = headerValue(request.headers.authorization);
  if (authorization?.startsWith("Bearer ") === true) {
    const token = authorization.slice("Bearer ".length).trim();
    return { token: token === "" ? null : token, transport: "bearer" };
  }

  if (headerValue(request.headers["x-session-transport"]) === "bearer") {
    return { token: null, transport: "bearer" };
  }

  return { token: readCookie(request, SESSION_COOKIE), transport: "cookie" };
}

function requestOrigin(request: FastifyRequest): string | null {
  const origin = headerValue(request.headers.origin);
  if (origin !== undefined && origin.trim() !== "") return origin.trim();

  const referer = headerValue(request.headers.referer);
  if (referer === undefined) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return "invalid";
  }
}

export function assertSafeOrigin(request: FastifyRequest, config: ApiConfig): void {
  const origin = requestOrigin(request);
  if (origin !== null && !config.corsAllowedOrigins.includes(origin)) {
    throw new ApiRequestError("AUTHENTICATION_ERROR", 403, "Invalid origin");
  }
}

function sessionCookie(
  token: string | null,
  config: ApiConfig,
  clear = false
): string {
  const value = token === null ? "" : encodeURIComponent(token);
  const maxAge = clear ? 0 : Math.floor(config.sessionTtlMs / 1_000);
  return [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    config.environment === "production" ? "Secure" : null
  ]
    .filter((part): part is string => part !== null)
    .join("; ");
}

function parseIdentifyInput(value: unknown): CustomerIdentifyRequest {
  const parsed = CustomerIdentifyRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiRequestError("VALIDATION_ERROR", 400);
  }
  return parsed.data;
}

async function runAuthOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (
      error instanceof ApiRequestError ||
      error instanceof CustomerInputError ||
      error instanceof CustomerSessionError
    ) {
      throw error;
    }
    throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
  }
}

export function registerAuthRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  repository: CustomerRepository | undefined,
  now: () => Date = () => new Date()
): void {
  const limiter = new InProcessRateLimiter();
  const service = repository === undefined
    ? null
    : new CustomerAuthService(repository, config, now);
  const getService = (): CustomerAuthService => {
    if (service === null) throw new ApiRequestError("SERVICE_UNAVAILABLE", 503);
    return service;
  };
  const isAllowed = (request: FastifyRequest, limit: number): boolean =>
    limiter.consume(`${request.ip}:${request.routeOptions.url}`, limit, now());

  app.post("/auth/identify", async (request, reply) => {
    if (!isAllowed(request, IDENTIFY_LIMIT)) {
      throw new ApiRequestError("RATE_LIMITED", 429);
    }
    assertSafeOrigin(request, config);
    const input = parseIdentifyInput(request.body);
    const { transport } = readSession(request);
    let result;
    try {
      result = await runAuthOperation(() => getService().identify(input, transport));
    } catch (error: unknown) {
      if (error instanceof CustomerInputError) {
        throw new ApiRequestError("VALIDATION_ERROR", 400);
      }
      throw error;
    }
    const response = CustomerIdentifyResponseSchema.parse(result.response);

    if (transport === "cookie") {
      reply.header("set-cookie", sessionCookie(result.rawToken, config));
    }

    return reply.code(201).send(response);
  });

  app.get("/auth/me", async (request, reply) => {
    if (!isAllowed(request, SESSION_LIMIT)) {
      throw new ApiRequestError("RATE_LIMITED", 429);
    }
    const { token } = readSession(request);
    let response;
    try {
      response = await runAuthOperation(() => getService().me(token)).then((value) =>
        CustomerMeResponseSchema.parse(value)
      );
    } catch (error: unknown) {
      if (error instanceof CustomerSessionError) {
        throw new ApiRequestError("AUTHENTICATION_ERROR", 401);
      }
      throw error;
    }
    return reply.send(response);
  });

  app.post("/auth/logout", async (request, reply) => {
    if (!isAllowed(request, SESSION_LIMIT)) {
      throw new ApiRequestError("RATE_LIMITED", 429);
    }
    assertSafeOrigin(request, config);
    const { token, transport } = readSession(request);
    await runAuthOperation(() => getService().logout(token));
    const response = CustomerLogoutResponseSchema.parse({ loggedOut: true });
    if (transport === "cookie") {
      reply.header("set-cookie", sessionCookie(null, config, true));
    }
    return reply.send(response);
  });

  app.addHook("onResponse", async (request) => {
    if (
      request.url === "/auth/identify" ||
      request.url === "/auth/me" ||
      request.url === "/auth/logout"
    ) {
      await service?.cleanup();
    }
  });
}
