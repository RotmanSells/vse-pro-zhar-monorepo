import {
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions
} from "node:crypto";

import type {
  AdminAuthLoginRequest,
  AdminAuthLoginResponse,
  StaffProfile
} from "@vse-pro-zhar/contracts";
import type { StaffRepository, StaffSessionLookup } from "@vse-pro-zhar/database";

import type { ApiConfig } from "../config/env.js";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_LENGTH = 16;
const DUMMY_PASSWORD = "staff-login-dummy-password";
let dummyPasswordHashPromise: Promise<string> | null = null;

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) => {
      if (error !== null) reject(error);
      else resolve(derived);
    });
  });
}

export const STAFF_SESSION_COOKIE = "vse-pro-zhar-admin-session";

export class StaffInputError extends Error {
  constructor() {
    super("Staff input is invalid");
    this.name = "StaffInputError";
  }
}

export class StaffAuthenticationError extends Error {
  constructor() {
    super("Staff credentials are invalid");
    this.name = "StaffAuthenticationError";
  }
}

export class StaffSessionError extends Error {
  constructor() {
    super("Staff session is invalid");
    this.name = "StaffSessionError";
  }
}

export function normalizeStaffLogin(value: string): string | null {
  const login = value.trim().toLocaleLowerCase("en-US");
  return /^[a-z0-9][a-z0-9._-]{0,79}$/u.test(login) ? login : null;
}

export async function hashStaffPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const derived = await deriveKey(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 32 * 1024 * 1024
  });
  return [
    "scrypt",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64url"),
    derived.toString("base64url")
  ].join("$");
}

export async function verifyStaffPassword(
  password: string,
  encodedHash: string
): Promise<boolean> {
  const parts = encodedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltText = parts[4];
  const derivedText = parts[5];
  if (
    !Number.isSafeInteger(n) ||
    !Number.isSafeInteger(r) ||
    !Number.isSafeInteger(p) ||
    saltText === undefined ||
    derivedText === undefined
  ) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltText, "base64url");
    expected = Buffer.from(derivedText, "base64url");
  } catch {
    return false;
  }
  if (salt.length !== SCRYPT_SALT_LENGTH || expected.length !== SCRYPT_KEY_LENGTH) {
    return false;
  }
  const actual = await deriveKey(password, salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: 32 * 1024 * 1024
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sessionTokenHash(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

function toProfile(lookup: StaffSessionLookup): StaffProfile {
  return {
    id: lookup.user.id,
    login: lookup.user.login,
    displayName: lookup.user.displayName
  };
}

export class StaffAuthService {
  constructor(
    private readonly repository: StaffRepository,
    private readonly config: ApiConfig,
    private readonly now: () => Date = () => new Date()
  ) {}

  async login(
    input: AdminAuthLoginRequest,
    requestId: string
  ): Promise<{ readonly response: AdminAuthLoginResponse; readonly rawToken: string }> {
    const login = normalizeStaffLogin(input.login);
    if (login === null) throw new StaffInputError();
    const user = await this.repository.findByLogin(login);
    if (dummyPasswordHashPromise === null) {
      dummyPasswordHashPromise = hashStaffPassword(DUMMY_PASSWORD);
    }
    const passwordHash = user?.passwordHash ?? (await dummyPasswordHashPromise);
    const passwordMatches = await verifyStaffPassword(input.password, passwordHash);
    if (user === null || !user.isActive || !passwordMatches) {
      throw new StaffAuthenticationError();
    }

    const now = this.now();
    const rawToken = randomBytes(32).toString("base64url");
    const session = await this.repository.createSession({
      staffUserId: user.id,
      tokenHash: sessionTokenHash(rawToken, this.config.sessionSecret),
      expiresAt: new Date(now.getTime() + this.config.staffSessionTtlMs),
      createdAt: now
    });
    await this.repository.recordAudit({
      staffUserId: user.id,
      action: "staff_login",
      requestId,
      createdAt: now
    });
    return {
      rawToken,
      response: {
        staff: toProfile(session),
        session: { expiresAt: session.session.expiresAt.toISOString() }
      }
    };
  }

  async getActiveSession(token: string | null): Promise<StaffSessionLookup> {
    if (token === null || token === "") throw new StaffSessionError();
    const session = await this.repository.findActiveSession(
      sessionTokenHash(token, this.config.sessionSecret),
      this.now()
    );
    if (session === null) throw new StaffSessionError();
    toProfile(session);
    return session;
  }

  async me(token: string | null): Promise<AdminAuthLoginResponse> {
    const session = await this.getActiveSession(token);
    return {
      staff: toProfile(session),
      session: { expiresAt: session.session.expiresAt.toISOString() }
    };
  }

  async logout(token: string | null, requestId: string): Promise<void> {
    if (token === null || token === "") return;
    try {
      const session = await this.getActiveSession(token);
      await this.repository.revokeSession(
        sessionTokenHash(token, this.config.sessionSecret),
        this.now()
      );
      await this.repository.recordAudit({
        staffUserId: session.user.id,
        action: "staff_logout",
        requestId,
        createdAt: this.now()
      });
    } catch (error: unknown) {
      if (!(error instanceof StaffSessionError)) throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.repository.cleanupExpiredSessions(this.now());
  }
}

export function staffProfileFromSession(session: StaffSessionLookup): StaffProfile {
  return toProfile(session);
}

export function hashStaffSessionToken(token: string, secret: string): string {
  return sessionTokenHash(token, secret);
}
