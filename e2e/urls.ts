function port(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be a valid port`);
  }
  return value;
}

export const E2E_API_PORT = port("E2E_API_PORT", 3000);
export const E2E_CUSTOMER_PORT = port("E2E_CUSTOMER_PORT", 8082);
export const E2E_ADMIN_PORT = port("E2E_ADMIN_PORT", 5173);

export const E2E_API_URL = `http://127.0.0.1:${E2E_API_PORT}`;
export const E2E_CUSTOMER_URL = `http://localhost:${E2E_CUSTOMER_PORT}`;
export const E2E_ADMIN_URL = `http://127.0.0.1:${E2E_ADMIN_PORT}`;
