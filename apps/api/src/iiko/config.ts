import { z } from "zod";

const IikoUuidSchema = z.string().trim().uuid();

const IikoEnvironmentSchema = z.object({
  IIKO_BASE_URL: z.string().trim().min(1),
  IIKO_API_KEY: z.string().trim().min(1),
  IIKO_APP_ID: IikoUuidSchema,
  IIKO_CLIENT_SECRET: z.string().trim().min(1),
  IIKO_ORGANIZATION_ID: IikoUuidSchema,
  IIKO_TERMINAL_GROUP_ID: IikoUuidSchema,
  IIKO_PRODUCT_MAPPING: z.string().trim().min(2)
});

const IikoFulfillmentEnvironmentSchema = z.object({
  IIKO_ORDER_TYPE_ID: IikoUuidSchema,
  IIKO_PAYMENT_TYPE_ID: IikoUuidSchema
});

const IIKO_ENVIRONMENT_KEYS = [
  "IIKO_BASE_URL",
  "IIKO_API_KEY",
  "IIKO_APP_ID",
  "IIKO_CLIENT_SECRET",
  "IIKO_ORGANIZATION_ID",
  "IIKO_TERMINAL_GROUP_ID",
  "IIKO_PRODUCT_MAPPING"
] as const;
const IIKO_FULFILLMENT_KEYS = ["IIKO_ORDER_TYPE_ID", "IIKO_PAYMENT_TYPE_ID"] as const;

export interface IikoAvailabilityConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly appId: string;
  readonly clientSecret: string;
  readonly organizationId: string;
  readonly terminalGroupId: string;
  readonly productMapping: ReadonlyMap<number, string>;
}

export interface IikoFulfillmentConfig extends IikoAvailabilityConfig {
  readonly orderTypeId: string;
  readonly paymentTypeId: string;
}

export class IikoAvailabilityConfigurationError extends Error {
  constructor() {
    super("Invalid iiko availability configuration");
    this.name = "IikoAvailabilityConfigurationError";
  }
}

export class IikoFulfillmentConfigurationError extends Error {
  constructor() {
    super("Invalid iiko fulfillment configuration");
    this.name = "IikoFulfillmentConfigurationError";
  }
}

function hasConfiguredValue(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

function parseBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new IikoAvailabilityConfigurationError();
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new IikoAvailabilityConfigurationError();
  }

  return url.origin;
}

function parseProductMapping(value: string): ReadonlyMap<number, string> {
  let raw: unknown;

  try {
    raw = JSON.parse(value) as unknown;
  } catch {
    throw new IikoAvailabilityConfigurationError();
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new IikoAvailabilityConfigurationError();
  }

  const mapping = new Map<number, string>();

  for (const [productIdText, iikoProductId] of Object.entries(raw)) {
    if (!/^\d+$/u.test(productIdText)) {
      throw new IikoAvailabilityConfigurationError();
    }

    const productId = Number(productIdText);
    if (!Number.isSafeInteger(productId) || productId < 1) {
      throw new IikoAvailabilityConfigurationError();
    }

    const parsedIikoProductId = IikoUuidSchema.safeParse(iikoProductId);
    if (!parsedIikoProductId.success) {
      throw new IikoAvailabilityConfigurationError();
    }

    mapping.set(productId, parsedIikoProductId.data);
  }

  if (mapping.size === 0) {
    throw new IikoAvailabilityConfigurationError();
  }

  return mapping;
}

export function loadIikoAvailabilityConfig(
  env: NodeJS.ProcessEnv = process.env
): IikoAvailabilityConfig | null {
  const hasAnyIikoConfiguration = IIKO_ENVIRONMENT_KEYS.some((key) =>
    hasConfiguredValue(env[key])
  );

  if (!hasAnyIikoConfiguration) {
    return null;
  }

  const parsed = IikoEnvironmentSchema.safeParse({
    IIKO_BASE_URL: env["IIKO_BASE_URL"],
    IIKO_API_KEY: env["IIKO_API_KEY"],
    IIKO_APP_ID: env["IIKO_APP_ID"],
    IIKO_CLIENT_SECRET: env["IIKO_CLIENT_SECRET"],
    IIKO_ORGANIZATION_ID: env["IIKO_ORGANIZATION_ID"],
    IIKO_TERMINAL_GROUP_ID: env["IIKO_TERMINAL_GROUP_ID"],
    IIKO_PRODUCT_MAPPING: env["IIKO_PRODUCT_MAPPING"]
  });

  if (!parsed.success) {
    throw new IikoAvailabilityConfigurationError();
  }

  return {
    baseUrl: parseBaseUrl(parsed.data.IIKO_BASE_URL),
    apiKey: parsed.data.IIKO_API_KEY,
    appId: parsed.data.IIKO_APP_ID,
    clientSecret: parsed.data.IIKO_CLIENT_SECRET,
    organizationId: parsed.data.IIKO_ORGANIZATION_ID,
    terminalGroupId: parsed.data.IIKO_TERMINAL_GROUP_ID,
    productMapping: parseProductMapping(parsed.data.IIKO_PRODUCT_MAPPING)
  };
}

export function loadIikoFulfillmentConfig(
  env: NodeJS.ProcessEnv = process.env
): IikoFulfillmentConfig | null {
  const hasAnyWriteConfiguration = IIKO_FULFILLMENT_KEYS.some((key) =>
    hasConfiguredValue(env[key])
  );
  const availability = loadIikoAvailabilityConfig(env);

  if (!hasAnyWriteConfiguration) return null;
  if (availability === null) {
    throw new IikoFulfillmentConfigurationError();
  }

  const parsed = IikoFulfillmentEnvironmentSchema.safeParse({
    IIKO_ORDER_TYPE_ID: env["IIKO_ORDER_TYPE_ID"],
    IIKO_PAYMENT_TYPE_ID: env["IIKO_PAYMENT_TYPE_ID"]
  });
  if (!parsed.success) throw new IikoFulfillmentConfigurationError();

  return {
    ...availability,
    orderTypeId: parsed.data.IIKO_ORDER_TYPE_ID,
    paymentTypeId: parsed.data.IIKO_PAYMENT_TYPE_ID
  };
}
