import { describe, expect, test } from "bun:test";
import { formatUtcClock, formatUtcDate, formatUtcDay } from "./format-utc";

describe("UTC formatting", () => {
  test("formats in UTC whatever the machine's zone", () => {
    const atMs = Date.parse("2024-12-25T10:26:00Z");
    expect(formatUtcClock(atMs)).toBe("10:26");
    expect(formatUtcDate(atMs)).toBe("25 Dec 2024");
    expect(formatUtcDay(atMs)).toBe("25 Dec");
  });

  test("uses a 24-hour clock past midnight and a placeholder for a bad time", () => {
    expect(formatUtcClock(Date.parse("2024-12-24T23:05:00Z"))).toBe("23:05");
    expect(formatUtcClock(Date.parse("2024-12-25T00:00:00Z"))).toBe("00:00");
    expect(formatUtcClock(Number.NaN)).toBe("--:--");
  });
});
