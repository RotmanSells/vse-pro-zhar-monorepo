import { createHmac, randomBytes } from "node:crypto";

import type {
  CustomerIdentifyRequest,
  CustomerIdentifyResponse,
  CustomerMeResponse,
  CustomerProfile
} from "@vse-pro-zhar/contracts";
import type {
  CustomerRepository,
  CustomerSessionLookup
} from "@vse-pro-zhar/database";

import type { ApiConfig } from "../config/env.js";

export type AuthTransport = "cookie" | "bearer";

export interface CustomerIdentifyResult {
  readonly response: CustomerIdentifyResponse;
  readonly rawToken: string;
}

export function normalizePhone(value: string): string | null {
  let compact = value.trim().replace(/[\s().-]/gu, "");

  if (compact.startsWith("00")) {
    compact = `+${compact.slice(2)}`;
  }

  if (/^8\d{10}$/u.test(compact)) {
    compact = `+7${compact.slice(1)}`;
  } else if (/^7\d{10}$/u.test(compact)) {
    compact = `+${compact}`;
  } else if (/^\d{10}$/u.test(compact)) {
    compact = `+7${compact}`;
  }

  return /^\+[1-9]\d{7,14}$/u.test(compact) ? compact : null;
}

export function hashSessionToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

function toProfile(lookup: CustomerSessionLookup): CustomerProfile {
  return {
    phone: lookup.customer.phone,
    name: lookup.customer.name,
    birthDate: lookup.customer.birthDate
  };
}

function toIsoDate(value: Date): string {
  return value.toISOString();
}

export class CustomerInputError extends Error {
  constructor() {
    super("Customer input is invalid");
    this.name = "CustomerInputError";
  }
}

export class CustomerSessionError extends Error {
  constructor() {
    super("Customer session is invalid");
    this.name = "CustomerSessionError";
  }
}

export class CustomerAuthService {
  constructor(
    private readonly repository: CustomerRepository,
    private readonly config: ApiConfig,
    private readonly now: () => Date = () => new Date()
  ) {}

  async identify(
    input: CustomerIdentifyRequest,
    transport: AuthTransport
  ): Promise<CustomerIdentifyResult> {
    const phone = normalizePhone(input.phone);
    if (phone === null) {
      throw new CustomerInputError();
    }

    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlMs);
    const lookup = await this.repository.upsertCustomerAndCreateSession(
      { phone, name: input.name?.trim() ?? "", birthDate: input.birthDate ?? null },
      { tokenHash: hashSessionToken(token, this.config.sessionSecret), expiresAt },
      now
    );

    return {
      rawToken: token,
      response: {
        customer: toProfile(lookup),
        session: {
          expiresAt: toIsoDate(lookup.session.expiresAt),
          token: transport === "bearer" ? token : null
        }
      }
    };
  }

  async me(token: string | null): Promise<CustomerMeResponse> {
    const lookup = await this.getActiveSession(token);

    return {
      customer: toProfile(lookup),
      session: { expiresAt: toIsoDate(lookup.session.expiresAt) }
    };
  }

  async getActiveSession(token: string | null): Promise<CustomerSessionLookup> {
    if (token === null) {
      throw new CustomerSessionError();
    }

    const now = this.now();
    const lookup = await this.repository.findActiveSession(
      hashSessionToken(token, this.config.sessionSecret),
      now
    );
    if (lookup === null) {
      throw new CustomerSessionError();
    }

    return lookup;
  }

  async logout(token: string | null): Promise<void> {
    if (token !== null) {
      await this.repository.revokeSession(
        hashSessionToken(token, this.config.sessionSecret),
        this.now()
      );
    }
  }

  async cleanup(): Promise<void> {
    await this.repository.cleanupExpiredSessions(this.now());
  }
}
