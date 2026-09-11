export type DebugLogValue = string | number | boolean | null;
export type DebugLogPayload = Readonly<Record<string, DebugLogValue>>;

function isEnabled(): boolean {
  return globalThis.process?.env?.["EXPO_PUBLIC_DEBUG_LOGS"] === "1" && globalThis.process?.env?.["NODE_ENV"] !== "production";
}

function timestamp(): string {
  return new Date().toISOString();
}

export function debugLog(event: string, payload: DebugLogPayload = {}): void {
  if (!isEnabled()) return;
  console.log(JSON.stringify({ timestamp: timestamp(), event, ...payload }));
}

export function debugError(event: string, error: unknown, payload: DebugLogPayload = {}): void {
  if (!isEnabled()) return;
  debugLog(event, {
    ...payload,
    error: error instanceof Error ? error.name : "unknown_error"
  });
}

export function safePath(input: string): string {
  try {
    return new URL(input).pathname;
  } catch {
    return input.split("?")[0] ?? "/unknown";
  }
}

export function createTracedFetch(
  scope: string,
  implementation?: (input: string, init?: RequestInit) => Promise<Response>
): (input: string, init?: RequestInit) => Promise<Response> {
  const fetchImpl = implementation ?? ((input: string, init?: RequestInit) => fetch(input, init));
  return async (input, init) => {
    const startedAt = Date.now();
    const path = safePath(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    debugLog("api.request.start", { scope, method, path });
    try {
      const response = await fetchImpl(input, init);
      debugLog("api.request.finish", {
        scope,
        method,
        path,
        status: response.status,
        durationMs: Date.now() - startedAt,
        requestId: response.headers.get("x-request-id") ?? null
      });
      return response;
    } catch (error: unknown) {
      debugError("api.request.error", error, { scope, method, path, durationMs: Date.now() - startedAt });
      throw error;
    }
  };
}

export function screenTrace(screen: string): () => void {
  debugLog("screen.open", { screen });
  return () => debugLog("screen.close", { screen });
}
