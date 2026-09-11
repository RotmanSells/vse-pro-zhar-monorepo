import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { createDatabaseClient, createStaffRepository, StaffUserExistsError } from "@vse-pro-zhar/database";

import { hashStaffPassword, normalizeStaffLogin } from "./staff-service.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for explicit staff bootstrap`);
  }
  return value;
}

async function main(): Promise<void> {
  const login = normalizeStaffLogin(requiredEnvironment("STAFF_BOOTSTRAP_LOGIN"));
  const password = requiredEnvironment("STAFF_BOOTSTRAP_PASSWORD");
  const displayName = requiredEnvironment("STAFF_BOOTSTRAP_DISPLAY_NAME");
  if (login === null || password.length < 12 || password.length > 128) {
    throw new Error("STAFF_BOOTSTRAP_LOGIN or password is invalid");
  }
  const database = createDatabaseClient();
  try {
    const repository = createStaffRepository(database);
    let user;
    try {
      user = await repository.createUser({ login, displayName, passwordHash: await hashStaffPassword(password), createdAt: new Date() });
    } catch (error: unknown) {
      if (error instanceof StaffUserExistsError && process.env["STAFF_BOOTSTRAP_ALLOW_EXISTING"] === "true") {
        user = await repository.findByLogin(login);
        if (user === null) throw error;
      } else {
        throw error;
      }
    }
    console.log(JSON.stringify({ id: user.id, login: user.login, displayName: user.displayName }));
  } finally {
    await database.close();
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && resolve(entryPath) === resolve(fileURLToPath(import.meta.url))) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Staff bootstrap failed");
    process.exitCode = 1;
  });
}
