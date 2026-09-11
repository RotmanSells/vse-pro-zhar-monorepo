import { describe, expect, it } from "vitest";

import {
  formatRussianDateInput,
  formatRussianPhoneInput,
  parseRussianDateInput
} from "../src/auth-input.js";

describe("customer auth input formatting", () => {
  it("keeps the Russian phone prefix and formats the number while typing", () => {
    expect(formatRussianPhoneInput("")).toBe("+7");
    expect(formatRussianPhoneInput("89991234567")).toBe("+7 (999) 123-45-67");
    expect(formatRussianPhoneInput("+7 (999) 123-45-67")).toBe("+7 (999) 123-45-67");
    expect(formatRussianPhoneInput("9991234567")).toBe("+7 (999) 123-45-67");
  });

  it("formats DD.MM.YYYY and converts valid dates to API ISO", () => {
    expect(formatRussianDateInput("01021990")).toBe("01.02.1990");
    expect(formatRussianDateInput("01.02.1990")).toBe("01.02.1990");
    expect(parseRussianDateInput("01.02.1990")).toBe("1990-02-01");
    expect(parseRussianDateInput("31.02.1990")).toBeNull();
  });
});
