import { describe, expect, test } from "bun:test";
import { assessTrack } from "./detect-anchor-drag";
import type { CableLine, Detection, DetectorInput, Evidence, ShipSize, TrackAssessment } from "./detection-types";
import { sailLegs, steadySpeed, type Leg } from "./synthetic-tracks";

// A north-south cable at 25.5 E; every ship sails east across it at 59.9 N.
const CABLE: CableLine = { name: "Test cable", kind: "power", coordinates: [[25.5, 59.7], [25.5, 60.1]] };
const START_MS = Date.parse("2026-10-01T06:00:00Z");
const MS_PER_MINUTE = 60_000;
const BULK_CARRIER: ShipSize = { lengthMetres: 224, beamMetres: 32, draughtMetres: 14.5, shipType: 70, antennaFromBowMetres: 189 };

function leg(minutes: number, knots: number, navigationStatus: number | null = 0): Leg {
  return { minutes, speedKnots: steadySpeed(knots), courseDegrees: 90, headingOffsetDegrees: 0, navigationStatus };
}

function assess(startLongitude: number, legs: Leg[], ship: ShipSize | null = BULK_CARRIER): TrackAssessment {
  const input: DetectorInput = { track: sailLegs({ longitude: startLongitude, latitude: 59.9 }, START_MS, legs), cables: [CABLE], depthAt: () => -45, ship };
  return assessTrack(input);
}

function strongest(assessment: TrackAssessment): Detection | null {
  return assessment.kind === "fits" ? assessment.detections[0] : null;
}

function findEvidence<Rule extends Evidence["rule"]>(detection: Detection | null, rule: Rule): Extract<Evidence, { rule: Rule }> | null {
  const found = detection?.evidence.find((item): item is Extract<Evidence, { rule: Rule }> => item.rule === rule);
  return found ?? null;
}

describe("assessTrack", () => {
  test("slow, then stopped, then faster than before: an alert from the speed after the stop, with the anchor's cable crossing", () => {
    const detection = strongest(assess(25.3, [leg(150, 7.5), leg(40, 0.3), leg(90, 10.5)]));
    expect(detection?.level).toBe("alert");
    const deficit = findEvidence(detection, "speed-deficit");
    expect(deficit?.measured.referenceSide).toBe("after");
    expect(deficit?.measured.stopMinutesBeforeResuming ?? 0).toBeGreaterThanOrEqual(30);
    expect(detection?.cableCrossings.map((crossing) => crossing.cableName)).toEqual(["Test cable"]);
    expect(detection?.startMs).toBe(START_MS);
    expect(detection?.endMs ?? 0).toBeGreaterThanOrEqual(START_MS + 148 * MS_PER_MINUTE);
  });

  test("a sustained slowdown across a cable alerts in real time and dates the drag from the speed step", () => {
    const detection = strongest(assess(25.0, [leg(60, 11), leg(90, 8)]));
    expect(detection?.level).toBe("alert");
    expect(findEvidence(detection, "speed-deficit")?.measured.referenceSide).toBe("before");
    const changePoint = findEvidence(detection, "speed-change-point");
    expect(Math.abs((changePoint?.measured.atMs ?? 0) - (START_MS + 60 * MS_PER_MINUTE))).toBeLessThanOrEqual(2 * MS_PER_MINUTE);
    expect(Math.abs((detection?.startMs ?? 0) - (START_MS + 60 * MS_PER_MINUTE))).toBeLessThanOrEqual(2 * MS_PER_MINUTE);
  });

  test("a 30-minute slowdown across a cable is only a watch: ships slow that long for pilots and anchorages", () => {
    const detection = strongest(assess(25.1, [leg(60, 11), leg(30, 7), leg(60, 11)]));
    expect(detection?.level).toBe("watch");
  });

  test("a ship that only speeds up after a slow stretch, without stopping, is not ranked", () => {
    expect(assess(25.3, [leg(120, 7), leg(90, 11)]).kind).toBe("no-fit");
  });

  test("drifting with status 'not under command' is not judged", () => {
    expect(assess(25.0, [leg(60, 11), leg(120, 3, 2), leg(60, 11)]).kind).toBe("no-fit");
  });

  test("tugs and small craft are not eligible", () => {
    const tug: ShipSize = { lengthMetres: 32, beamMetres: 11, draughtMetres: 4.5, shipType: 52, antennaFromBowMetres: 12 };
    expect(assess(25.3, [leg(150, 4), leg(30, 0.3), leg(60, 10)], tug).kind).toBe("not-eligible");
    const smallBoat: ShipSize = { lengthMetres: 30, beamMetres: null, draughtMetres: null, shipType: null, antennaFromBowMetres: null };
    expect(assess(25.3, [leg(150, 4)], smallBoat).kind).toBe("not-eligible");
  });

  test("three reports are insufficient data, never a verdict", () => {
    const assessment = assess(25.3, [leg(3, 7.5)]);
    expect(assessment.kind).toBe("insufficient-data");
  });

  test("evidence sentences rank and never accuse", () => {
    const detections = [assess(25.3, [leg(150, 7.5), leg(40, 0.3), leg(90, 10.5)]), assess(25.0, [leg(60, 11), leg(90, 8)])].flatMap((assessment) =>
      assessment.kind === "fits" ? assessment.detections : [],
    );
    const sentences = detections.flatMap((detection) => detection.evidence.map((item) => item.sentence));
    expect(sentences.length).toBeGreaterThan(8);
    expect(sentences.filter((sentence) => /\bcut/i.test(sentence))).toEqual([]);
    expect(sentences.some((sentence) => sentence.includes("fits an anchor drag"))).toBe(true);
  });
});
