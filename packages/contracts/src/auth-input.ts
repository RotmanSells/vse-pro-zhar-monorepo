import { CustomerBirthDateSchema } from "./auth.js";

const RUSSIAN_PHONE_DIGITS = 11;

/** Formats a Russian phone while the customer is typing. */
export function formatRussianPhoneInput(input: string): string {
  const digits = input.replace(/\D/gu, "");
  if (digits.length === 0) return "+7";

  let normalized = digits;
  if (normalized.startsWith("8")) {
    normalized = `7${normalized.slice(1)}`;
  } else if (!normalized.startsWith("7")) {
    normalized = `7${normalized}`;
  }

  const subscriber = normalized.slice(1, RUSSIAN_PHONE_DIGITS);
  if (subscriber.length === 0) return "+7";

  let result = "+7";
  result += ` (${subscriber.slice(0, 3)}`;
  if (subscriber.length >= 3) result += ")";
  if (subscriber.length > 3) result += ` ${subscriber.slice(3, 6)}`;
  if (subscriber.length > 6) result += `-${subscriber.slice(6, 8)}`;
  if (subscriber.length > 8) result += `-${subscriber.slice(8, 10)}`;
  return result;
}

/** Formats a date-only value as the Russian customer-facing DD.MM.YYYY input. */
export function formatRussianDateInput(input: string): string {
  const digits = input.replace(/\D/gu, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

/** Converts a Russian DD.MM.YYYY input to the ISO date used by the API. */
export function parseRussianDateInput(input: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(input.trim());
  if (match === null) return null;

  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  return CustomerBirthDateSchema.safeParse(iso).success ? iso : null;
}
