import { describe, expect, test } from "bun:test";
import { CUT_SLOW_FACTOR, PACE_RAMP_MS, readReplayPace } from "@/lib/seabed/scene/director/replay-pace";

const CUT_MS = Date.parse("2024-12-25T16:44:00Z");
const MINUTE_MS = 60_000;

describe("readReplayPace", () => {
  test("runs thirty times slower from 6 minutes before a cut to 2 minutes after it", () => {
    expect(readReplayPace([CUT_MS], CUT_MS - 6 * MINUTE_MS)).toBeCloseTo(1 / CUT_SLOW_FACTOR, 10);
    expect(readReplayPace([CUT_MS], CUT_MS)).toBeCloseTo(1 / CUT_SLOW_FACTOR, 10);
    expect(readReplayPace([CUT_MS], CUT_MS + 2 * MINUTE_MS)).toBeCloseTo(1 / CUT_SLOW_FACTOR, 10);
  });

  test("runs at normal pace past the ramps", () => {
    expect(readReplayPace([CUT_MS], CUT_MS - 6 * MINUTE_MS - PACE_RAMP_MS)).toBe(1);
    expect(readReplayPace([CUT_MS], CUT_MS + 2 * MINUTE_MS + PACE_RAMP_MS)).toBe(1);
    expect(readReplayPace([], CUT_MS)).toBe(1);
  });

  test("eases geometrically across a ramp: halfway is the square root of the slow pace", () => {
    expect(readReplayPace([CUT_MS], CUT_MS + 2 * MINUTE_MS + PACE_RAMP_MS / 2)).toBeCloseTo(Math.sqrt(1 / CUT_SLOW_FACTOR), 10);
  });

  test("takes the slower pace where two cuts' stretches overlap", () => {
    const secondCutMs = CUT_MS + 9 * MINUTE_MS;
    // 3 minutes after the first cut: on its ramp, and inside the second cut's approach.
    expect(readReplayPace([CUT_MS, secondCutMs], CUT_MS + 3 * MINUTE_MS)).toBeCloseTo(1 / CUT_SLOW_FACTOR, 10);
  });
});
