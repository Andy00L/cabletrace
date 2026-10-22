import { describe, expect, test } from "bun:test";
import { formatCountdown, readMinutesToNextEvent } from "@/lib/console/event-countdown";

const at = (clock: string) => Date.parse(`2024-12-25T${clock}:00Z`);

describe("readMinutesToNextEvent", () => {
  const events = [at("10:23"), at("16:44"), at("10:26")];

  test("counts whole minutes to the first event still ahead, in any order", () => {
    expect(readMinutesToNextEvent(events, at("10:24"))).toBe(2);
    expect(readMinutesToNextEvent(events, at("16:06"))).toBe(38);
  });

  test("rounds up, so a part minute still counts as one", () => {
    expect(readMinutesToNextEvent(events, at("16:43") + 59_000)).toBe(1);
  });

  test("passes an event the moment it happens, and has nothing to count after the last one", () => {
    expect(readMinutesToNextEvent(events, at("10:26"))).toBe(378);
    expect(readMinutesToNextEvent(events, at("16:44"))).toBeNull();
    expect(readMinutesToNextEvent([], at("10:00"))).toBeNull();
  });
});

describe("formatCountdown", () => {
  test("reads minutes under an hour and hours with two-digit minutes above", () => {
    expect(formatCountdown(1)).toBe("in 1 min");
    expect(formatCountdown(38)).toBe("in 38 min");
    expect(formatCountdown(60)).toBe("in 1 h");
    expect(formatCountdown(125)).toBe("in 2 h 05 min");
  });

  test("reads days and whole hours from a day out", () => {
    expect(formatCountdown(24 * 60)).toBe("in 1 day");
    expect(formatCountdown(25 * 60 + 30)).toBe("in 1 day 1 h");
    expect(formatCountdown(130 * 60 + 41)).toBe("in 5 days 10 h");
  });
});
