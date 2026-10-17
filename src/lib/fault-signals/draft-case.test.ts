import { describe, expect, test } from "bun:test";
import type { ShipTrack } from "@/lib/detection/detection-inputs";
import type { CableLine, ShipSize, TrackPoint } from "@/lib/detection/detection-types";
import { sailLegs, steadySpeed, type Leg } from "@/lib/detection/synthetic-tracks";
import { DRAFT_MAX_SHIPS, buildDraftCase, draftWindowFor, isNarrowerFaultSpan, splitShipsForDraft, type DraftCaseInput } from "./draft-case";

// A north-south cable at 25.5 E; ships sail east across it at 59.9 N (the detector tests' layout).
const CABLE: CableLine[] = [{ name: "Test cable", kind: "power", coordinates: [[25.5, 59.7], [25.5, 60.1]] }];
const START_MS = Date.parse("2026-10-01T06:00:00Z");
const MS_PER_MINUTE = 60_000;
const BULK_CARRIER: ShipSize = { lengthMetres: 224, beamMetres: 32, draughtMetres: 14.5, shipType: 70, antennaFromBowMetres: 189 };

function leg(minutes: number, knots: number, navigationStatus: number | null = 0): Leg {
  return { minutes, speedKnots: steadySpeed(knots), courseDegrees: 90, headingOffsetDegrees: 0, navigationStatus };
}

function ship(mmsi: number, startLongitude: number, legs: Leg[], size: ShipSize = BULK_CARRIER): ShipTrack {
  return { mmsi, ship: size, track: sailLegs({ longitude: startLongitude, latitude: 59.9 }, START_MS, legs) };
}

/** Builds the draft for a fault span the way the edge function does, from whole tracks. */
function draftFor(span: { faultNotBeforeMs: number; faultNotAfterMs: number }, tracks: ShipTrack[]) {
  const window = draftWindowFor(span);
  const split = splitShipsForDraft({ tracks, cable: CABLE, window, nearMetres: 3000 });
  const input: DraftCaseInput = { signal: span, cableName: "Test cable", cable: CABLE, window, nearMetres: 3000, ...split, names: new Map([[1, "DRAGGER"]]), depthAt: () => -45 };
  return buildDraftCase(input);
}

describe("draftWindowFor", () => {
  test("6 hours before the earliest fault time to 15 minutes after the latest, cut to 96 hours", () => {
    expect(draftWindowFor({ faultNotBeforeMs: START_MS, faultNotAfterMs: START_MS })).toEqual({ fromMs: START_MS - 360 * MS_PER_MINUTE, toMs: START_MS + 15 * MS_PER_MINUTE });
    const wide = draftWindowFor({ faultNotBeforeMs: START_MS - 30 * 24 * 60 * MS_PER_MINUTE, faultNotAfterMs: START_MS });
    expect(wide.toMs - wide.fromMs).toBe(96 * 60 * MS_PER_MINUTE);
  });

  test("a minute-exact span is narrower than an afternoon", () => {
    expect(isNarrowerFaultSpan({ faultNotBeforeMs: 5, faultNotAfterMs: 5 }, { faultNotBeforeMs: 0, faultNotAfterMs: 10 })).toBe(true);
    expect(isNarrowerFaultSpan({ faultNotBeforeMs: 0, faultNotAfterMs: 10 }, { faultNotBeforeMs: 0, faultNotAfterMs: 10 })).toBe(false);
  });
});

describe("buildDraftCase", () => {
  // Slows from 11 to 8 knots across the cable for 90 minutes: the detector's sustained-slowdown alert.
  const dragger = ship(1, 25.0, [leg(60, 11), leg(90, 8)]);
  // A fast passage across the cable, never in the drag band.
  const passer = ship(2, 25.2, [leg(120, 12)]);
  // A tug towing slowly across: the detector does not judge working craft.
  const tug = ship(3, 25.3, [leg(120, 4)], { lengthMetres: 32, beamMetres: 11, draughtMetres: 4.5, shipType: 52, antennaFromBowMetres: 12 });
  // Two reports on the cable: too few to judge.
  const sparse: ShipTrack = { mmsi: 4, ship: BULK_CARRIER, track: [0, 30].map((minute): TrackPoint => ({ atMs: START_MS + (90 + minute) * MS_PER_MINUTE, longitude: 25.5, latitude: 59.9, speedKnots: null, courseDegrees: null, headingDegrees: null, navigationStatus: null })) };
  // 20 km east of the cable all morning.
  const farAway = ship(5, 25.85, [leg(60, 6)]);

  test("when the anchor path crosses the cable inside the fault span, the dragger ranks first and says when", () => {
    const draft = draftFor({ faultNotBeforeMs: START_MS, faultNotAfterMs: START_MS + 150 * MS_PER_MINUTE }, [passer, tug, sparse, dragger, farAway]);
    expect(draft.status).toBe("draft");
    expect(draft.ships.map((ranked) => [ranked.mmsi, ranked.basis])).toEqual([
      [1, "drag-at-fault"],
      [4, "unjudged-at-fault"],
      [2, "outside-drag-band"],
      [3, "not-eligible"],
    ]);
    const [first] = draft.ships;
    expect(first?.name).toBe("DRAGGER");
    expect(first?.level).toBe("alert");
    expect(first?.crossingAtMs).not.toBeNull();
    expect(first?.sentences[0]).toStartWith("Its reconstructed anchor path crosses this cable at ");
    expect(draft.shipCount).toBe(4);
  });

  test("a ship that sat on the cable at a minute-exact fault and cannot be judged outranks a drag that crossed hours before", () => {
    const faultMs = START_MS + 330 * MS_PER_MINUTE;
    const lateSparse: ShipTrack = { ...sparse, track: sparse.track.map((point, index) => ({ ...point, atMs: faultMs - (1 - index) * 5 * MS_PER_MINUTE })) };
    const draft = draftFor({ faultNotBeforeMs: faultMs, faultNotAfterMs: faultMs }, [dragger, lateSparse]);
    expect(draft.ships.map((ranked) => [ranked.mmsi, ranked.basis])).toEqual([
      [4, "unjudged-at-fault"],
      [1, "drag-elsewhere"],
    ]);
    expect(draft.ships[1]?.sentences[0]).toBe("Its anchor path does not cross this cable inside the time the signal gives for the fault.");
  });

  test("keeps at most DRAFT_MAX_SHIPS and counts the rest", () => {
    const many = Array.from({ length: DRAFT_MAX_SHIPS + 5 }, (_unused, index) => ship(100 + index, 25.2, [leg(120, 12)]));
    const draft = draftFor({ faultNotBeforeMs: START_MS + 60 * MS_PER_MINUTE, faultNotAfterMs: START_MS + 60 * MS_PER_MINUTE }, many);
    expect(draft.ships).toHaveLength(DRAFT_MAX_SHIPS);
    expect(draft.shipCount).toBe(DRAFT_MAX_SHIPS + 5);
    expect(draft.ships.map((ranked) => ranked.rank)).toEqual(Array.from({ length: DRAFT_MAX_SHIPS }, (_unused, index) => index + 1));
  });
});

describe("splitShipsForDraft", () => {
  test("ships beyond the distance or outside the window are left out; fast ships come as their closest report", () => {
    const window = { fromMs: START_MS, toMs: START_MS + 30 * MS_PER_MINUTE };
    const split = splitShipsForDraft({ tracks: [ship(2, 25.45, [leg(60, 12)]), ship(5, 25.85, [leg(60, 6)]), ship(6, 25.4, [leg(60, 6)])], cable: CABLE, window, nearMetres: 3000 });
    expect(split.candidates.map((candidate) => candidate.mmsi)).toEqual([6]);
    expect(split.candidates[0]?.track.every((point) => point.atMs <= window.toMs)).toBe(true);
    expect(split.passers.map((passer) => passer.mmsi)).toEqual([2]);
    // At 12 knots one report a minute lands every 370 m, so the closest one is within 185 m of the cable.
    expect(split.passers[0]?.distanceMetres ?? 9999).toBeLessThanOrEqual(185);
  });
});
