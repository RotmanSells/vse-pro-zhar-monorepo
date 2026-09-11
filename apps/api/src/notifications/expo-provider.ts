import { z } from "zod";

const ExpoTicketSchema = z.object({
  status: z.enum(["ok", "error"]),
  id: z.string().trim().min(1).max(128).optional(),
  message: z.string().trim().max(500).optional(),
  details: z.object({ error: z.string().trim().max(80).optional() }).passthrough().optional()
}).passthrough();

const ExpoSendResponseSchema = z.object({
  data: z.array(ExpoTicketSchema).min(1).max(1),
  errors: z.array(z.object({ code: z.string().trim().max(80), message: z.string().trim().max(500) }).passthrough()).optional()
}).passthrough();

export interface ExpoPushMessage {
  readonly token: string;
  readonly title: string;
  readonly body: string;
}

export type ExpoPushTicket =
  | { readonly status: "ok"; readonly id: string }
  | { readonly status: "error"; readonly errorCode: string | null };

export interface ExpoPushProvider {
  send(message: ExpoPushMessage): Promise<ExpoPushTicket>;
}

export type ExpoPushProviderErrorKind = "failed" | "reconciliation_required";

export class ExpoPushProviderError extends Error {
  readonly kind: ExpoPushProviderErrorKind;
  readonly errorCode: string;

  constructor(kind: ExpoPushProviderErrorKind, errorCode: string) {
    super("Expo Push Service request failed");
    this.name = "ExpoPushProviderError";
    this.kind = kind;
    this.errorCode = errorCode;
  }
}

type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const DEFAULT_EXPO_PUSH_TIMEOUT_MS = 10_000;

function safeProviderCode(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/u.test(value) ? value : fallback;
}

export function createExpoPushProvider(options: {
  readonly endpoint?: string;
  readonly accessToken?: string;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
} = {}): ExpoPushProvider {
  const endpoint = options.endpoint ?? DEFAULT_EXPO_PUSH_ENDPOINT;
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXPO_PUSH_TIMEOUT_MS;

  return {
    async send(message) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = {
          Accept: "application/json",
          "Content-Type": "application/json"
        };
        if (options.accessToken !== undefined && options.accessToken.trim() !== "") {
          headers["Authorization"] = `Bearer ${options.accessToken.trim()}`;
        }
        let response: Response;
        try {
          response = await fetchImpl(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({ to: message.token, title: message.title, body: message.body, sound: "default", priority: "high" }),
            signal: controller.signal
          });
        } catch {
          if (controller.signal.aborted) throw new ExpoPushProviderError("reconciliation_required", "provider_timeout");
          throw new ExpoPushProviderError("reconciliation_required", "provider_network_error");
        }

        let rawBody: unknown;
        try {
          rawBody = await response.json();
        } catch {
          throw new ExpoPushProviderError("reconciliation_required", "provider_invalid_response");
        }

        if (!response.ok) {
          throw new ExpoPushProviderError(
            response.status === 429 || response.status >= 500 ? "reconciliation_required" : "failed",
            `provider_http_${response.status}`
          );
        }

        const parsed = ExpoSendResponseSchema.safeParse(rawBody);
        if (!parsed.success) throw new ExpoPushProviderError("reconciliation_required", "provider_invalid_response");
        const ticket = parsed.data.data[0];
        if (ticket === undefined) throw new ExpoPushProviderError("reconciliation_required", "provider_ticket_missing");
        if (ticket.status === "ok") {
          if (ticket.id === undefined) throw new ExpoPushProviderError("reconciliation_required", "provider_ticket_missing");
          return { status: "ok", id: ticket.id };
        }
        return {
          status: "error",
          errorCode: safeProviderCode(ticket.details?.error, "provider_ticket_error")
        };
      } finally {
        clearTimeout(timeoutId);
      }
    }
  };
}

export function createExpoPushProviderFromEnvironment(env: NodeJS.ProcessEnv = process.env): ExpoPushProvider {
  return createExpoPushProvider({
    ...(env["EXPO_PUSH_ENDPOINT"] === undefined ? {} : { endpoint: env["EXPO_PUSH_ENDPOINT"] }),
    ...(env["EXPO_PUSH_ACCESS_TOKEN"] === undefined ? {} : { accessToken: env["EXPO_PUSH_ACCESS_TOKEN"] })
  });
}
