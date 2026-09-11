import type { FastifyInstance } from "fastify";

import type {
  StaffAuditAction,
  StaffRepository,
  StaffSessionRecord,
  StaffUserRecord
} from "@vse-pro-zhar/database";

import { hashStaffPassword } from "../src/auth/staff-service.js";

const FIXTURE_PASSWORD = "correct-horse-battery";
const fixtureNow = new Date("2026-09-01T10:00:00.000Z");

export interface MemoryStaffState {
  readonly repository: StaffRepository;
  readonly users: StaffUserRecord[];
  readonly sessions: StaffSessionRecord[];
  readonly audits: Array<{ readonly staffUserId: number | null; readonly action: StaffAuditAction; readonly orderId?: number; readonly requestId?: string }>;
}

export async function createMemoryStaffRepository(): Promise<MemoryStaffState> {
  const users: StaffUserRecord[] = [
    { id: 1, login: "admin", displayName: "Главный администратор", passwordHash: await hashStaffPassword(FIXTURE_PASSWORD), isActive: true, createdAt: fixtureNow, updatedAt: fixtureNow }
  ];
  const sessions: StaffSessionRecord[] = [];
  const audits: MemoryStaffState["audits"] = [];
  let nextSessionId = 1;
  const repository: StaffRepository = {
    async findByLogin(login) { return users.find((user) => user.login === login) ?? null; },
    async createUser(input) {
      if (users.some((user) => user.login === input.login)) throw new Error("duplicate");
      const user: StaffUserRecord = { id: users.length + 1, login: input.login, displayName: input.displayName, passwordHash: input.passwordHash, isActive: true, createdAt: input.createdAt, updatedAt: input.createdAt };
      users.push(user);
      return user;
    },
    async createSession(input) {
      const user = users.find((candidate) => candidate.id === input.staffUserId);
      if (user === undefined) throw new Error("missing user");
      const session: StaffSessionRecord = { id: nextSessionId++, staffUserId: input.staffUserId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, revokedAt: null, lastUsedAt: null, createdAt: input.createdAt, updatedAt: input.createdAt };
      sessions.push(session);
      return { user, session };
    },
    async findActiveSession(tokenHash, now) {
      const session = sessions.find((candidate) => candidate.tokenHash === tokenHash && candidate.revokedAt === null && candidate.expiresAt > now);
      if (session === undefined) return null;
      const user = users.find((candidate) => candidate.id === session.staffUserId && candidate.isActive);
      if (user === undefined) return null;
      Object.assign(session, { lastUsedAt: now, updatedAt: now });
      return { user, session };
    },
    async revokeSession(tokenHash, now) { const session = sessions.find((candidate) => candidate.tokenHash === tokenHash && candidate.revokedAt === null); if (session !== undefined) session.revokedAt = now; },
    async recordAudit(input) { audits.push(input); },
    async cleanupExpiredSessions(now) { for (let index = sessions.length - 1; index >= 0; index -= 1) { const session = sessions[index]; if (session !== undefined && (session.revokedAt !== null || session.expiresAt <= now)) sessions.splice(index, 1); } }
  };
  return { repository, users, sessions, audits };
}

export async function staffCookie(app: FastifyInstance, login = "admin"): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/admin/auth/login", payload: { login, password: FIXTURE_PASSWORD } });
  if (response.statusCode !== 200) throw new Error(`Fixture staff login failed: ${response.statusCode}`);
  return String(response.headers["set-cookie"]).split(";")[0] ?? "";
}

export { FIXTURE_PASSWORD };
