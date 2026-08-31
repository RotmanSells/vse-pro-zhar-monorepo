import { ApiConfigError } from "./env.js";

export function formatApiStartupError(error: unknown): string {
  if (error instanceof ApiConfigError) {
    return JSON.stringify({
      category: "configuration",
      event: "api_startup_failed",
      issues: error.issues
    });
  }

  return JSON.stringify({
    category: "startup",
    event: "api_startup_failed",
    message: "API failed to start"
  });
}
