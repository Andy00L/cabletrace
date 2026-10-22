import { describe, expect, test } from "bun:test";
import { EAGLE_S_2024 } from "@/data/cases/eagle-s-2024";
import { EAGLE_S_FOOTAGE, findReplayTimeForVideoSeconds, findVideoSecondsForReplayTime, type ReplayFootage } from "@/lib/landing/replay-footage";

const MINUTE_MS = 60_000;
// A footage of 10 s of time-lapse over 100 minutes, then 2 s held: one replay minute per 0.1 video second.
const FOOTAGE: ReplayFootage = { ...EAGLE_S_FOOTAGE, replayStartMs: 0, replayEndMs: 100 * MINUTE_MS, durationSeconds: 12, holdSeconds: 2 };

describe("findVideoSecondsForReplayTime", () => {
  test("maps the window linearly onto the time-lapse", () => {
    expect(findVideoSecondsForReplayTime(FOOTAGE, 0)).toBe(0);
    expect(findVideoSecondsForReplayTime(FOOTAGE, 25 * MINUTE_MS)).toBeCloseTo(2.5, 10);
    expect(findVideoSecondsForReplayTime(FOOTAGE, 50 * MINUTE_MS)).toBeCloseTo(5, 10);
  });

  test("puts a moment before the window on the first frame", () => {
    expect(findVideoSecondsForReplayTime(FOOTAGE, -30 * MINUTE_MS)).toBe(0);
  });

  test("puts the window's end and anything after it on the first frame of the held end, not the video's last", () => {
    expect(findVideoSecondsForReplayTime(FOOTAGE, 100 * MINUTE_MS)).toBe(10);
    expect(findVideoSecondsForReplayTime(FOOTAGE, 500 * MINUTE_MS)).toBe(10);
  });

  test("answers 0 for a moment that is not a number", () => {
    expect(findVideoSecondsForReplayTime(FOOTAGE, Number.NaN)).toBe(0);
  });
});

describe("findReplayTimeForVideoSeconds", () => {
  test("is the inverse of findVideoSecondsForReplayTime inside the time-lapse", () => {
    for (const atMs of [MINUTE_MS, 37 * MINUTE_MS, 99 * MINUTE_MS]) {
      expect(findReplayTimeForVideoSeconds(FOOTAGE, findVideoSecondsForReplayTime(FOOTAGE, atMs))).toBeCloseTo(atMs, 3);
    }
  });

  test("holds the window's end through the held end and past the video's end", () => {
    expect(findReplayTimeForVideoSeconds(FOOTAGE, 10)).toBe(100 * MINUTE_MS);
    expect(findReplayTimeForVideoSeconds(FOOTAGE, 11.5)).toBe(100 * MINUTE_MS);
    expect(findReplayTimeForVideoSeconds(FOOTAGE, 30)).toBe(100 * MINUTE_MS);
  });

  test("answers the window's start before 0 and for a time that is not a number", () => {
    expect(findReplayTimeForVideoSeconds(FOOTAGE, -1)).toBe(0);
    expect(findReplayTimeForVideoSeconds(FOOTAGE, Number.NaN)).toBe(0);
  });
});

describe("EAGLE_S_FOOTAGE", () => {
  test("covers 10:00 to 17:00 UTC on 25 Dec 2024 in 20 s, then holds 1.5 s", () => {
    expect(EAGLE_S_FOOTAGE.replayStartMs).toBe(Date.parse("2024-12-25T10:00:00Z"));
    expect(EAGLE_S_FOOTAGE.replayEndMs).toBe(Date.parse("2024-12-25T17:00:00Z"));
    expect(EAGLE_S_FOOTAGE.durationSeconds - EAGLE_S_FOOTAGE.holdSeconds).toBe(20);
    expect(EAGLE_S_FOOTAGE.holdSeconds).toBe(1.5);
  });

  test("lists the case file's events inside the window, in order, each at its video time", () => {
    const inWindow = EAGLE_S_2024.events.filter((event) => Date.parse(event.atUtc) >= EAGLE_S_FOOTAGE.replayStartMs && Date.parse(event.atUtc) <= EAGLE_S_FOOTAGE.replayEndMs);
    expect(EAGLE_S_FOOTAGE.events.map((event) => event.title)).toEqual(inWindow.map((event) => event.title));
    const estlink = EAGLE_S_FOOTAGE.events.find((event) => event.title === "Estlink 2 trips");
    // 26 of the window's 420 minutes into 20 s.
    expect(estlink?.videoSeconds).toBeCloseTo((26 / 420) * 20, 10);
    const lastEvent = EAGLE_S_FOOTAGE.events.at(-1);
    expect(lastEvent?.atMs).toBe(EAGLE_S_FOOTAGE.replayEndMs);
    expect(lastEvent?.videoSeconds).toBe(20);
  });

  test("names every file under /landing/footage/ at its crop's size", () => {
    expect(EAGLE_S_FOOTAGE.files.desktop).toMatchObject({ mp4: "/landing/footage/eagle-s-2024-desktop.mp4", width: 1600, height: 1000 });
    expect(EAGLE_S_FOOTAGE.files.phone).toMatchObject({ posterAvif: "/landing/footage/eagle-s-2024-phone-poster.avif", width: 900, height: 1124 });
  });
});
