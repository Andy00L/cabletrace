import { describe, expect, test } from "bun:test";
import { summarizeFrameDurations } from "./frame-stats";

describe("summarizeFrameDurations", () => {
  test("returns null when no frame was measured", () => {
    expect(summarizeFrameDurations([])).toBeNull();
    expect(summarizeFrameDurations([0, -4, Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
  });

  test("averages frames and reports the 95th percentile as the slow frame", () => {
    const durations = [...Array.from({ length: 19 }, () => 16), 100];
    const summary = summarizeFrameDurations(durations);
    expect(summary).not.toBeNull();
    expect(summary?.frameCount).toBe(20);
    expect(summary?.averageMs).toBeCloseTo(20.2, 5);
    expect(summary?.slowFrameMs).toBe(16);
    expect(summary?.framesPerSecond).toBeCloseTo(1000 / 20.2, 5);
  });

  test("ignores invalid samples instead of letting them skew the average", () => {
    const summary = summarizeFrameDurations([10, Number.NaN, 30, 0]);
    expect(summary?.frameCount).toBe(2);
    expect(summary?.averageMs).toBe(20);
  });
});
