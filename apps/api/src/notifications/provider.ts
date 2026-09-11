export interface SmsProvider {
  readonly configured: boolean;
  sendCode(input: { readonly phone: string; readonly code: string }): Promise<{ readonly providerMessageId: string | null }>;
}

export class SmsProviderUnavailableError extends Error {
  constructor() {
    super("SMS provider is not configured");
    this.name = "SmsProviderUnavailableError";
  }
}

export class SmsProviderRequestError extends Error {
  constructor() {
    super("SMS provider request failed");
    this.name = "SmsProviderRequestError";
  }
}

interface SmsRuResponse {
  readonly status?: unknown;
  readonly sms?: Record<string, { readonly status?: unknown; readonly status_code?: unknown; readonly sms_id?: unknown }>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function isSuccessfulSmsResponse(value: unknown, phone: string): { readonly providerMessageId: string | null } | null {
  const record = asRecord(value) as SmsRuResponse | null;
  if (record?.status !== "OK") return null;
  const sms = record.sms?.[phone] ?? record.sms?.[`7${phone.slice(-10)}`];
  if (sms === undefined || sms.status !== "OK" || sms.status_code !== 100) return null;
  return { providerMessageId: typeof sms.sms_id === "string" ? sms.sms_id : null };
}

export interface SmsRuProviderOptions {
  readonly apiId: string;
  readonly sender?: string;
  readonly fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
}

export class SmsRuProvider implements SmsProvider {
  readonly configured = true;

  constructor(private readonly options: SmsRuProviderOptions) {}

  async sendCode(input: { readonly phone: string; readonly code: string }): Promise<{ readonly providerMessageId: string | null }> {
    const form = new URLSearchParams({
      api_id: this.options.apiId,
      to: input.phone.replace(/^\+/u, ""),
      msg: `Код входа «Все Про Жар»: ${input.code}. Никому его не сообщайте.`,
      json: "1"
    });
    if (this.options.sender !== undefined && this.options.sender.trim() !== "") form.set("from", this.options.sender.trim());
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8_000);
    try {
      const response = await (this.options.fetchImpl ?? ((url, init) => fetch(url, init)))(this.options.baseUrl ?? "https://sms.ru/sms/send", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: controller.signal
      });
      if (!response.ok) throw new SmsProviderRequestError();
      let body: unknown;
      try {
        body = await response.json() as unknown;
      } catch {
        throw new SmsProviderRequestError();
      }
      const result = isSuccessfulSmsResponse(body, input.phone.replace(/^\+/u, ""));
      if (result === null) throw new SmsProviderRequestError();
      return result;
    } catch (error: unknown) {
      if (error instanceof SmsProviderRequestError) throw error;
      throw new SmsProviderRequestError();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export function createSmsProviderFromEnvironment(env: NodeJS.ProcessEnv = process.env): SmsProvider {
  const apiId = env["SMS_RU_API_ID"]?.trim();
  if (apiId === undefined || apiId === "") {
    return {
      configured: false,
      async sendCode() { throw new SmsProviderUnavailableError(); }
    };
  }
  return new SmsRuProvider({ apiId, ...(env["SMS_RU_SENDER"] === undefined ? {} : { sender: env["SMS_RU_SENDER"] }) });
}
