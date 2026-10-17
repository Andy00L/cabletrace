import { describe, expect, test } from "bun:test";
import { formatUtcClock, formatUtcDate, formatUtcDay, formatUtcDaySpan, formatZonedDateTime, isSameUtcDay } from "./format-utc";

describe("UTC formatting", () => {
  test("formats in UTC whatever the machine's zone", () => {
    const atMs = Date.parse("2024-12-25T10:26:00Z");
    expect(formatUtcClock(atMs)).toBe("10:26");
    expect(formatUtcDate(atMs)).toBe("25 Dec 2024");
    expect(formatUtcDay(atMs)).toBe("25 Dec");
  });

  test("names the UTC days a window covers", () => {
    expect(formatUtcDaySpan(Date.parse("2024-12-25T10:00:00Z"), Date.parse("2024-12-25T23:00:00Z"))).toBe("25 December");
    expect(formatUtcDaySpan(Date.parse("2024-11-17T07:45:00Z"), Date.parse("2024-11-18T11:00:00Z"))).toBe("17 and 18 November");
    expect(formatUtcDaySpan(Date.parse("2024-11-17T07:45:00Z"), Date.parse("2024-11-19T11:00:00Z"))).toBe("17 to 19 November");
    expect(formatUtcDaySpan(Date.parse("2024-11-30T22:00:00Z"), Date.parse("2024-12-01T02:00:00Z"))).toBe("30 November to 1 December");
    expect(isSameUtcDay(Date.parse("2024-11-17T23:59:00Z"), Date.parse("2024-11-18T00:00:00Z"))).toBe(false);
  });

  test("shows the local date and wall clock, past midnight included", () => {
    expect(formatZonedDateTime(Date.parse("2024-12-25T16:50:00Z"), "Europe/Helsinki")).toBe("25 Dec 2024, 18:50");
    expect(formatZonedDateTime(Date.parse("2024-12-25T22:28:00Z"), "Europe/Helsinki")).toBe("26 Dec 2024, 00:28");
    expect(formatZonedDateTime(Number.NaN, "Europe/Helsinki")).toBe("");
  });

  test("uses a 24-hour clock past midnight and a placeholder for a bad time", () => {
    expect(formatUtcClock(Date.parse("2024-12-24T23:05:00Z"))).toBe("23:05");
    expect(formatUtcClock(Date.parse("2024-12-25T00:00:00Z"))).toBe("00:00");
    expect(formatUtcClock(Number.NaN)).toBe("--:--");
  });
});
