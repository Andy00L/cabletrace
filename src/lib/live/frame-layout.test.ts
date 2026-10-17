import { describe, expect, test } from "bun:test";
import {
  buildFrameIndex,
  FRAME_RETENTION_MS,
  frameObjectName,
  frameObjectPath,
  parseFrameIndex,
  parseFrameObjectName,
  selectExpiredFrames,
  selectLiveFrames,
  SLOT_MS,
  slotStartMs,
} from "./frame-layout";

const NOW_MS = Date.UTC(2026, 9, 17, 14, 27, 13);
const CURRENT_SLOT_MS = Date.UTC(2026, 9, 17, 14, 20);
const HOUR_MS = 60 * 60_000;

describe("frame names", () => {
  test("name each 10-minute UTC slot and read it back", () => {
    expect(slotStartMs(NOW_MS)).toBe(CURRENT_SLOT_MS);
    expect(frameObjectName(CURRENT_SLOT_MS)).toBe("20261017T1420Z.bin.gz");
    expect(frameObjectPath(CURRENT_SLOT_MS)).toBe("frames/20261017T1420Z.bin.gz");
    expect(parseFrameObjectName("20261017T1420Z.bin.gz")).toEqual({ ok: true, value: CURRENT_SLOT_MS });
    expect(parseFrameObjectName("20261017T1425Z.bin.gz").ok).toBe(false);
    expect(parseFrameObjectName("20261332T1420Z.bin.gz").ok).toBe(false);
    expect(parseFrameObjectName(".emptyFolderPlaceholder").ok).toBe(false);
  });
});

describe("retention and index", () => {
  const stored = [
    { slotStartMs: CURRENT_SLOT_MS - 47 * HOUR_MS - SLOT_MS, bytes: 10 },
    { slotStartMs: CURRENT_SLOT_MS - 30 * HOUR_MS, bytes: 20 },
    { slotStartMs: CURRENT_SLOT_MS, bytes: 40 },
    { slotStartMs: CURRENT_SLOT_MS - 23 * HOUR_MS, bytes: 30 },
  ];

  test("expire frames older than the retention window", () => {
    expect(selectExpiredFrames(stored, NOW_MS)).toEqual([stored[0]]);
    expect(FRAME_RETENTION_MS).toBe(47 * HOUR_MS);
  });

  test("index every stored frame in slot order and show the last 24 hours", () => {
    const frameIndex = buildFrameIndex(stored, NOW_MS);
    expect(frameIndex.frames.map((entry) => entry.bytes)).toEqual([10, 20, 30, 40]);
    expect(selectLiveFrames(frameIndex).map((entry) => entry.bytes)).toEqual([30, 40]);
    expect(frameIndex.credits).toEqual(["aisstream.io", "Fintraffic / digitraffic.fi"]);
    expect(parseFrameIndex(JSON.parse(JSON.stringify(frameIndex)))).toEqual({ ok: true, value: frameIndex });
  });

  test("reject an index the browser cannot trust", () => {
    const frameIndex = buildFrameIndex(stored, NOW_MS);
    const reversed = { ...frameIndex, frames: [...frameIndex.frames].reverse() };
    const wrongPath = { ...frameIndex, frames: [{ ...frameIndex.frames[0], path: "../secret" }] };
    expect(parseFrameIndex(reversed)).toEqual({ ok: false, reason: "frame index is not in slot order" });
    expect(parseFrameIndex(wrongPath)).toEqual({ ok: false, reason: "frame index has a malformed entry" });
    expect(parseFrameIndex({ ...frameIndex, version: 2 })).toEqual({ ok: false, reason: "frame index version 2 is not supported" });
    expect(parseFrameIndex("<html>").ok).toBe(false);
  });
});
