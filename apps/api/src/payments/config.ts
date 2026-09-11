import { z } from "zod";

const YOOKASSA_KEYS = [
  "YOOKASSA_SHOP_ID",
  "YOOKASSA_SECRET_KEY",
  "YOOKASSA_API_URL",
  "YOOKASSA_RETURN_URL",
  "YOOKASSA_TEST_MODE"
] as const;

const ShopIdSchema = z.string().trim().regex(/^\d{1,20}$/u);
const SecretKeySchema = z.string().trim().min(16).regex(/^\S+$/u);

export interface YooKassaConfig {
  readonly shopId: string;
  readonly secretKey: string;
  readonly baseUrl: string;
  readonly returnUrl: string;
  readonly testMode: true;
}

export class YooKassaConfigurationError extends Error {
  constructor() {
    super("Invalid YooKassa configuration");
    this.name = "YooKassaConfigurationError";
  }
}

function hasConfiguredValue(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

function parseUrl(value: string, allowPath: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new YooKassaConfigurationError();
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    (!allowPath && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new YooKassaConfigurationError();
  }
  return allowPath ? url.toString() : url.origin;
}

export function loadYooKassaConfig(
  env: NodeJS.ProcessEnv = process.env
): YooKassaConfig | null {
  const hasAnyConfiguration = YOOKASSA_KEYS.some((key) => hasConfiguredValue(env[key]));
  if (!hasAnyConfiguration) return null;

  const shopId = ShopIdSchema.safeParse(env["YOOKASSA_SHOP_ID"]);
  const secretKey = SecretKeySchema.safeParse(env["YOOKASSA_SECRET_KEY"]);
  if (!shopId.success || !secretKey.success) throw new YooKassaConfigurationError();

  const baseUrl = parseUrl(
    env["YOOKASSA_API_URL"]?.trim() || "https://api.yookassa.ru",
    false
  );
  const returnUrl = parseUrl(
    env["YOOKASSA_RETURN_URL"]?.trim() || "http://localhost:8082/payment/return",
    true
  );
  const testMode = env["YOOKASSA_TEST_MODE"]?.trim() ?? "true";
  if (testMode !== "true") throw new YooKassaConfigurationError();

  return {
    shopId: shopId.data,
    secretKey: secretKey.data,
    baseUrl,
    returnUrl,
    testMode: true
  };
}
