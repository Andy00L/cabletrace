import { describe, expect, test } from "bun:test";
import { daySpan, locateMoment } from "./live-day";

const SLOT_MS = 10 * 60 * 1000;
const START_MS = Date.parse("2026-10-17T09:10:00Z");
// Three frames with the 09:30 slot missing (a collector run that failed).
const ENTRIES = [0, 1, 3].map((slot) => ({ path: `frames/${slot}`, slotStartMs: START_MS + slot * SLOT_MS, bytes: 1 }));

describe("locateMoment", () => {
  test("blends between the frames around the moment, across a missing slot", () => {
    expect(locateMoment(ENTRIES, START_MS + 5 * 60 * 1000)).toEqual({ earlierIndex: 0, laterIndex: 1, blend: 0.5 });
    expect(locateMoment(ENTRIES, START_MS + 2 * SLOT_MS)).toEqual({ earlierIndex: 1, laterIndex: 2, blend: 0.5 });
  });

  test("holds the newest frame at and after it, and the oldest before it", () => {
    expect(locateMoment(ENTRIES, START_MS + 3 * SLOT_MS)).toEqual({ earlierIndex: 2, laterIndex: null, blend: 0 });
    expect(locateMoment(ENTRIES, START_MS - SLOT_MS)).toEqual({ earlierIndex: 0, laterIndex: 1, blend: 0 });
  });
});

describe("daySpan", () => {
  test("runs from the oldest slot to the newest", () => {
    expect(daySpan(ENTRIES)).toEqual({ startMs: START_MS, endMs: START_MS + 3 * SLOT_MS });
  });
});
