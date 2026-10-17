import { describe, expect, test } from "bun:test";
import { blendAmount, pairShipFrames } from "./frame-pairing";
import { decodeShipFrame, encodeShipFrame, type ShipFrameColumns, type ShipRecord } from "@/lib/live/snapshot-codec";

const FRAME_TIME_MS = Date.parse("2026-10-17T09:12:00Z");
const TEN_MINUTES_MS = 10 * 60 * 1000;

function ship(mmsi: number, longitude: number, latitude: number): ShipRecord {
  return { mmsi, longitude, latitude, speedKnots: 10, courseDegrees: 90, headingDegrees: 90, shipClass: "cargo", reportedAtMs: FRAME_TIME_MS, source: "aisstream" };
}

function frame(frameTimeMs: number, ships: ShipRecord[]): ShipFrameColumns {
  const encoded = encodeShipFrame({ frameTimeMs, ships: ships.map((record) => ({ ...record, reportedAtMs: frameTimeMs })) });
  if (!encoded.ok) throw new Error(encoded.reason);
  const decoded = decodeShipFrame(encoded.value);
  if (!decoded.ok) throw new Error(decoded.reason);
  return decoded.value;
}

describe("pairShipFrames", () => {
  test("matches ships by MMSI and fades out the one that left and in the one that arrived", () => {
    const earlier = frame(FRAME_TIME_MS, [ship(100, 25, 60), ship(200, 10, 55)]);
    const later = frame(FRAME_TIME_MS + TEN_MINUTES_MS, [ship(200, 10.02, 55), ship(300, -5, 50)]);
    const pair = pairShipFrames(earlier, later);
    expect([...pair.mmsi]).toEqual([100, 200, 300]);
    expect([...pair.fromPresence]).toEqual([1, 1, 0]);
    expect([...pair.toPresence]).toEqual([0, 1, 1]);
    expect([...pair.fromIndex]).toEqual([0, 1, -1]);
    expect([...pair.toIndex]).toEqual([-1, 0, 1]);
    // The departing ship stays put while it fades; the arriving one appears where it is.
    expect([...pair.toPositions.subarray(0, 3)]).toEqual([...pair.fromPositions.subarray(0, 3)]);
    expect([...pair.fromPositions.subarray(6, 9)]).toEqual([...pair.toPositions.subarray(6, 9)]);
    // The ship in both frames moves.
    expect(pair.toPositions[3]).not.toBe(pair.fromPositions[3]);
  });

  test("draws an implausible move as a jump to the later position instead of a streak", () => {
    // 2 degrees of longitude at 55 N is about 128 km in 10 minutes: 690 knots.
    const earlier = frame(FRAME_TIME_MS, [ship(400, 10, 55)]);
    const later = frame(FRAME_TIME_MS + TEN_MINUTES_MS, [ship(400, 12, 55)]);
    const pair = pairShipFrames(earlier, later);
    expect([...pair.fromPositions]).toEqual([...pair.toPositions]);
  });

  test("holds every ship still without a later frame", () => {
    const earlier = frame(FRAME_TIME_MS, [ship(500, 0, 0)]);
    const pair = pairShipFrames(earlier, null);
    expect(pair.toTimeMs).toBe(pair.fromTimeMs);
    expect([...pair.toPositions]).toEqual([...pair.fromPositions]);
    expect([...pair.toPresence]).toEqual([1]);
    // Longitude 0, latitude 0 sits on +x.
    expect(pair.fromPositions[0]).toBeCloseTo(1, 6);
  });
});

describe("blendAmount", () => {
  test("runs from 0 at the earlier frame to 1 at the later and clamps outside", () => {
    const span = { fromTimeMs: 1_000, toTimeMs: 3_000 };
    expect(blendAmount(span, 2_000)).toBe(0.5);
    expect(blendAmount(span, 0)).toBe(0);
    expect(blendAmount(span, 9_000)).toBe(1);
    expect(blendAmount({ fromTimeMs: 1_000, toTimeMs: 1_000 }, 5_000)).toBe(0);
  });
});
