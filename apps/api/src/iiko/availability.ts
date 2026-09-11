import {
  OperationalAvailabilityRecordSchema,
  type OperationalAvailabilityRecord
} from "@vse-pro-zhar/contracts";
import { z } from "zod";

import {
  createFailClosedAvailabilityProvider,
  type OperationalAvailabilityProvider
} from "../checkout/availability.js";
import {
  loadIikoAvailabilityConfig,
  type IikoAvailabilityConfig
} from "./config.js";

const DEFAULT_IIKO_TIMEOUT_MS = 5_000;
const IikoIdSchema = z.string().trim().uuid();
const IikoCorrelationIdSchema = z.string().trim().min(1);

const IikoTokenResponseSchema = z.object({
  correlationId: IikoCorrelationIdSchema,
  token: z.string().trim().min(1)
});

const IikoTerminalAliveStatusSchema = z.object({
  isAlive: z.boolean(),
  terminalGroupId: IikoIdSchema,
  organizationId: IikoIdSchema
});

const IikoTerminalAliveResponseSchema = z.object({
  correlationId: IikoCorrelationIdSchema,
  isAliveStatus: z.array(IikoTerminalAliveStatusSchema).min(1)
});

const IikoStopListItemSchema = z.object({
  productId: IikoIdSchema,
  sizeId: IikoIdSchema.nullable().optional(),
  balance: z.number().finite(),
  sku: z.string().nullable().optional(),
  dateAdd: z.string().nullable().optional()
});

const IikoStopListTerminalSchema = z.object({
  terminalGroupId: IikoIdSchema,
  items: z.array(IikoStopListItemSchema)
});

const IikoStopListOrganizationSchema = z.object({
  organizationId: IikoIdSchema,
  items: z.array(IikoStopListTerminalSchema)
});

const IikoStopListsResponseSchema = z.object({
  correlationId: IikoCorrelationIdSchema,
  terminalGroupStopLists: z.array(IikoStopListOrganizationSchema).min(1)
});

type IikoFetchImplementation = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export interface IikoAvailabilityProviderOptions {
  readonly fetchImpl?: IikoFetchImplementation;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

class IikoAvailabilityProviderError extends Error {
  constructor() {
    super("iiko availability request failed");
    this.name = "IikoAvailabilityProviderError";
  }
}

function createProviderError(): IikoAvailabilityProviderError {
  return new IikoAvailabilityProviderError();
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

function resolveTimeout(timeoutMs: number | undefined): number {
  const resolved = timeoutMs ?? DEFAULT_IIKO_TIMEOUT_MS;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw createProviderError();
  }
  return resolved;
}

async function postJson(
  fetchImpl: IikoFetchImplementation,
  url: string,
  body: unknown,
  token: string | null,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const request = Promise.resolve()
    .then(() =>
      fetchImpl(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(token === null ? {} : { Authorization: `Bearer ${token}` })
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    )
    .then(async (response) => {
      if (!response.ok) {
        throw createProviderError();
      }

      try {
        return await response.json();
      } catch {
        throw createProviderError();
      }
    });

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(createProviderError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } catch {
    throw createProviderError();
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function unknownRecords(
  productIds: readonly number[],
  config: IikoAvailabilityConfig
): readonly OperationalAvailabilityRecord[] {
  return productIds.map((productId) =>
    OperationalAvailabilityRecordSchema.parse({
      productId,
      iikoProductId: config.productMapping.get(productId) ?? null,
      status: "unknown",
      checkedAt: null
    })
  );
}

function readTerminalAlive(
  raw: unknown,
  config: IikoAvailabilityConfig
): boolean {
  const parsed = IikoTerminalAliveResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw createProviderError();
  }

  const matches = parsed.data.isAliveStatus.filter(
    (status) =>
      status.organizationId === config.organizationId &&
      status.terminalGroupId === config.terminalGroupId
  );

  if (matches.length !== 1) {
    throw createProviderError();
  }

  return matches[0]?.isAlive === true;
}

function readStoppedProductIds(
  raw: unknown,
  config: IikoAvailabilityConfig
): ReadonlySet<string> {
  const parsed = IikoStopListsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw createProviderError();
  }

  const organizationMatches = parsed.data.terminalGroupStopLists.filter(
    (entry) => entry.organizationId === config.organizationId
  );
  if (organizationMatches.length !== 1) {
    throw createProviderError();
  }

  const terminalMatches = organizationMatches[0]?.items.filter(
    (entry) => entry.terminalGroupId === config.terminalGroupId
  );
  if (terminalMatches === undefined || terminalMatches.length !== 1) {
    throw createProviderError();
  }

  return new Set(terminalMatches[0]?.items.map((item) => item.productId));
}

export function createIikoAvailabilityProvider(
  config: IikoAvailabilityConfig,
  options: IikoAvailabilityProviderOptions = {}
): OperationalAvailabilityProvider {
  const fetchImpl =
    options.fetchImpl ??
    ((input: string, init?: RequestInit) => fetch(input, init));
  const now = options.now ?? (() => new Date());
  const timeoutMs = resolveTimeout(options.timeoutMs);

  return {
    async getProductAvailability(productIds) {
      const missingMapping = productIds.some(
        (productId) => !config.productMapping.has(productId)
      );
      if (missingMapping) {
        return unknownRecords(productIds, config);
      }

      try {
        const tokenRaw = await postJson(
          fetchImpl,
          endpoint(config.baseUrl, "/api/v2/access_token"),
          {
            apiKey: config.apiKey,
            appId: config.appId,
            clientSecret: config.clientSecret
          },
          null,
          timeoutMs
        );
        const token = IikoTokenResponseSchema.safeParse(tokenRaw);
        if (!token.success) {
          throw createProviderError();
        }

        const [terminalAliveRaw, stopListsRaw] = await Promise.all([
          postJson(
            fetchImpl,
            endpoint(config.baseUrl, "/api/1/terminal_groups/is_alive"),
            {
              organizationIds: [config.organizationId],
              terminalGroupIds: [config.terminalGroupId]
            },
            token.data.token,
            timeoutMs
          ),
          postJson(
            fetchImpl,
            endpoint(config.baseUrl, "/api/1/stop_lists"),
            {
              organizationIds: [config.organizationId],
              terminalGroupsIds: [config.terminalGroupId]
            },
            token.data.token,
            timeoutMs
          )
        ]);

        const terminalAlive = readTerminalAlive(terminalAliveRaw, config);
        const stoppedProductIds = readStoppedProductIds(stopListsRaw, config);
        const checkedAt = now().toISOString();

        return productIds.map((productId) => {
          const iikoProductId = config.productMapping.get(productId);
          if (iikoProductId === undefined) {
            throw createProviderError();
          }

          return OperationalAvailabilityRecordSchema.parse({
            productId,
            iikoProductId,
            status:
              terminalAlive && !stoppedProductIds.has(iikoProductId)
                ? "available"
                : "unavailable",
            checkedAt
          });
        });
      } catch {
        throw createProviderError();
      }
    }
  };
}

export function createAvailabilityProviderFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: IikoAvailabilityProviderOptions = {}
): OperationalAvailabilityProvider {
  const config = loadIikoAvailabilityConfig(env);
  return config === null
    ? createFailClosedAvailabilityProvider()
    : createIikoAvailabilityProvider(config, options);
}
