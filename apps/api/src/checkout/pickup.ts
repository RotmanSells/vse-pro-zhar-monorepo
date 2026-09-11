import {
  CheckoutOptionsResponseSchema,
  type CheckoutOptionsResponse,
  type CheckoutPickupSelection,
  type CheckoutSelectedPickup,
  type PickupSlot
} from "@vse-pro-zhar/contracts";
import { z } from "zod";

import {
  CheckoutConfigurationError,
  CheckoutPickupUnavailableError
} from "./errors.js";

const DEFAULT_TIMEZONE = "Europe/Moscow";
const MINUTES_PER_HOUR = 60;

const ClockTimeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/u)
  .refine((value) => {
    const parts = value.split(":");
    const hours = Number(parts[0] ?? Number.NaN);
    const minutes = Number(parts[1] ?? Number.NaN);
    return (
      Number.isInteger(hours) &&
      Number.isInteger(minutes) &&
      hours >= 0 &&
      hours <= 23 &&
      minutes >= 0 &&
      minutes <= 59
    );
  });

const PickupWorkingHoursSchema = z
  .object({
    opensAt: ClockTimeSchema,
    closesAt: ClockTimeSchema
  })
  .strict();

const PickupLocationConfigurationSchema = z
  .object({
    id: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:[-_:][a-z0-9]+)*$/u),
    name: z.string().trim().min(1).max(240),
    address: z.string().trim().min(1).max(240),
    timezone: z.string().trim().min(1).max(80),
    workingHours: PickupWorkingHoursSchema,
    slotDurationMinutes: z.number().int().min(5).max(240)
  })
  .strict();

const PickupConfigurationSchema = z
  .object({
    locations: z.array(PickupLocationConfigurationSchema).min(1).max(10),
    daysAhead: z.number().int().min(1).max(7)
  })
  .strict();

export interface PickupLocationConfiguration {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly timezone: string;
  readonly workingHours: {
    readonly opensAt: string;
    readonly closesAt: string;
  };
  readonly slotDurationMinutes: number;
}

export interface PickupConfiguration {
  readonly locations: readonly PickupLocationConfiguration[];
  readonly daysAhead: number;
}

/**
 * Server-owned M6 contract. This is configuration, not a customer-side
 * constant and not a persisted Order/Pickup business entity.
 */
export const DEFAULT_PICKUP_CONFIGURATION: PickupConfiguration = {
  locations: [
    {
      id: "main-grill",
      name: "Основная точка самовывоза «Все Про Жар»",
      address: "Основная точка самовывоза",
      timezone: DEFAULT_TIMEZONE,
      workingHours: { opensAt: "10:00", closesAt: "22:00" },
      slotDurationMinutes: 30
    }
  ],
  daysAhead: 1
};

interface ZonedDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function numberPart(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
): number {
  const value = parts.find((part) => part.type === type)?.value;
  const parsed = value === undefined ? Number.NaN : Number(value);
  if (!Number.isInteger(parsed)) {
    throw new CheckoutConfigurationError();
  }
  return parsed;
}

function getZonedDateParts(date: Date, timezone: string): ZonedDateParts {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
  } catch {
    throw new CheckoutConfigurationError();
  }

  const parts = formatter.formatToParts(date);
  return {
    year: numberPart(parts, "year"),
    month: numberPart(parts, "month"),
    day: numberPart(parts, "day"),
    hour: numberPart(parts, "hour"),
    minute: numberPart(parts, "minute")
  };
}

function dateKey(date: Pick<ZonedDateParts, "year" | "month" | "day">): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(
    2,
    "0"
  )}-${String(date.day).padStart(2, "0")}`;
}

function addLocalDays(
  date: Pick<ZonedDateParts, "year" | "month" | "day">,
  days: number
): Pick<ZonedDateParts, "year" | "month" | "day"> {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate()
  };
}

function parseClock(value: string): number {
  const parsed = ClockTimeSchema.safeParse(value);
  if (!parsed.success) {
    throw new CheckoutConfigurationError();
  }

  const parts = value.split(":");
  const hours = Number(parts[0] ?? Number.NaN);
  const minutes = Number(parts[1] ?? Number.NaN);
  return hours * MINUTES_PER_HOUR + minutes;
}

function localDateTimeToInstant(
  date: Pick<ZonedDateParts, "year" | "month" | "day">,
  minutes: number,
  timezone: string
): Date {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const minute = minutes % MINUTES_PER_HOUR;
  const localAsUtc = Date.UTC(date.year, date.month - 1, date.day, hours, minute);
  let candidate = localAsUtc;

  // Two passes are enough for the fixed-offset M6 timezone and also keep the
  // adapter correct for ordinary DST transitions if the owner changes it.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getZonedDateParts(new Date(candidate), timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute
    );
    const offset = actualAsUtc - candidate;
    candidate = localAsUtc - offset;
  }

  return new Date(candidate);
}

function formatDateLabel(
  date: Pick<ZonedDateParts, "year" | "month" | "day">,
  currentDate: Pick<ZonedDateParts, "year" | "month" | "day">,
  offset: number
): string {
  if (offset === 0 && dateKey(date) === dateKey(currentDate)) return "Сегодня";
  if (offset === 1) return "Завтра";
  return `${String(date.day).padStart(2, "0")}.${String(date.month).padStart(
    2,
    "0"
  )}.${date.year}`;
}

function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / MINUTES_PER_HOUR)).padStart(
    2,
    "0"
  )}:${String(minutes % MINUTES_PER_HOUR).padStart(2, "0")}`;
}

function createSlots(
  location: PickupLocationConfiguration,
  now: Date,
  currentDate: ZonedDateParts,
  offset: number
): PickupSlot[] {
  const opensAt = parseClock(location.workingHours.opensAt);
  const closesAt = parseClock(location.workingHours.closesAt);
  if (closesAt <= opensAt || closesAt - opensAt < location.slotDurationMinutes) {
    throw new CheckoutConfigurationError();
  }

  const localDate = addLocalDays(currentDate, offset);
  const slots: PickupSlot[] = [];
  for (
    let startMinutes = opensAt;
    startMinutes + location.slotDurationMinutes <= closesAt;
    startMinutes += location.slotDurationMinutes
  ) {
    const endMinutes = startMinutes + location.slotDurationMinutes;
    const startsAt = localDateTimeToInstant(localDate, startMinutes, location.timezone);
    const endsAt = localDateTimeToInstant(localDate, endMinutes, location.timezone);
    if (startsAt.getTime() <= now.getTime()) continue;

    const localDateKey = dateKey(localDate);
    slots.push({
      id: `${location.id}-${localDateKey}-${formatTime(startMinutes).replace(":", "")}`,
      label: `${formatDateLabel(localDate, currentDate, offset)}, ${formatTime(
        startMinutes
      )}–${formatTime(endMinutes)}`,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString()
    });
  }

  return slots;
}

export function createPickupOptions(
  configuration: PickupConfiguration = DEFAULT_PICKUP_CONFIGURATION,
  now: Date = new Date()
): CheckoutOptionsResponse {
  const parsedConfiguration = PickupConfigurationSchema.safeParse(configuration);
  if (!parsedConfiguration.success || Number.isNaN(now.getTime())) {
    throw new CheckoutConfigurationError();
  }

  const locations = parsedConfiguration.data.locations.map((location) => {
    const currentDate = getZonedDateParts(now, location.timezone);
    const slots = Array.from(
      { length: parsedConfiguration.data.daysAhead + 1 },
      (_, offset) => createSlots(location, now, currentDate, offset)
    ).flat();

    return {
      id: location.id,
      name: location.name,
      address: location.address,
      timezone: location.timezone,
      slots
    };
  });

  const parsed = CheckoutOptionsResponseSchema.safeParse({ locations });
  if (!parsed.success) {
    throw new CheckoutConfigurationError();
  }
  return parsed.data;
}

export function findPickupSelection(
  options: CheckoutOptionsResponse,
  selection: CheckoutPickupSelection
): CheckoutSelectedPickup {
  const location = options.locations.find((candidate) => candidate.id === selection.locationId);
  const slot = location?.slots.find((candidate) => candidate.id === selection.slotId);
  if (location === undefined || slot === undefined) {
    throw new CheckoutPickupUnavailableError();
  }

  const selectedLocation = {
    id: location.id,
    name: location.name,
    address: location.address,
    timezone: location.timezone
  };

  return { location: selectedLocation, slot };
}
