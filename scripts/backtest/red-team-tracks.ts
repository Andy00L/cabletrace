// Synthetic tracks that must NOT raise an alert: ordinary or deceptive behaviour next to a real cable, Estlink 2 in
// the Gulf of Finland (its mapped route meets 59.93228 N, 26.20532 E, src/data/cases/eagle-s-2024.ts). One report a
// minute, the live recorder's cadence for a moving ship.
import type { ShipSize, TrackPoint } from "@/lib/detection/detection-types";
import { createLocalFrame, type LonLat } from "@/lib/detection/geodesy";
import { sailLegs, steadySpeed, type Leg } from "@/lib/detection/synthetic-tracks";

export type RedTeamCase = { name: string; why: string; ship: ShipSize; track: TrackPoint[] };

const ESTLINK_2_POINT: LonLat = { longitude: 26.20532, latitude: 59.93228 };
const START_MS = Date.parse("2026-10-01T06:00:00Z");
const MS_PER_MINUTE = 60_000;
// One knot covers 1852 m an hour.
const METRES_PER_KNOT_MINUTE = 1852 / 60;

function cargoShip(lengthMetres: number): ShipSize {
  return { lengthMetres, beamMetres: null, draughtMetres: null, shipType: 70, antennaFromBowMetres: null };
}

/** Every red-team passage starts at the same time; only the route and the legs differ. */
function sail(start: LonLat, legs: readonly Leg[]): TrackPoint[] {
  return sailLegs(start, START_MS, legs);
}

/** A ship swinging round its anchor on a 250 m circle 800 m east of the cable, for 6 hours. */
function swingAtAnchor(navigationStatus: number): TrackPoint[] {
  const frame = createLocalFrame(ESTLINK_2_POINT);
  const anchor = { x: 800, y: 0 };
  const swingRadiusMetres = 250;
  return Array.from({ length: 360 }, (_unused, minute) => {
    const bearing = ((200 + 40 * Math.sin((2 * Math.PI * minute) / 90)) * Math.PI) / 180;
    const nextBearing = ((200 + 40 * Math.sin((2 * Math.PI * (minute + 1)) / 90)) * Math.PI) / 180;
    const position = frame.toLonLat({ x: anchor.x + Math.sin(bearing) * swingRadiusMetres, y: anchor.y + Math.cos(bearing) * swingRadiusMetres });
    const speedKnots = (Math.abs(nextBearing - bearing) * swingRadiusMetres) / METRES_PER_KNOT_MINUTE;
    return {
      atMs: START_MS + minute * MS_PER_MINUTE,
      longitude: position.longitude,
      latitude: position.latitude,
      speedKnots: Math.round(speedKnots * 10) / 10,
      courseDegrees: null,
      headingDegrees: Math.round(((bearing * 180) / Math.PI + 180) % 360),
      navigationStatus,
    };
  });
}

/** Every red-team case, each with the reason it must stay silent. */
export function buildRedTeamCases(): RedTeamCase[] {
  const eastOfCable = createLocalFrame(ESTLINK_2_POINT).toLonLat({ x: 25_000, y: 2_000 });
  const westOfCable = createLocalFrame(ESTLINK_2_POINT).toLonLat({ x: -12_000, y: -1_000 });
  return [
    {
      name: "Anchored beside a cable",
      why: "Status 'at anchor', swinging on its chain 800 m from Estlink 2 for 6 hours.",
      ship: cargoShip(180),
      track: swingAtAnchor(1),
    },
    {
      name: "Anchored, status left 'under way'",
      why: "The same swing with the crew's status still 'under way using engine'.",
      ship: cargoShip(180),
      track: swingAtAnchor(0),
    },
    {
      name: "Slow ship in a traffic lane",
      why: "6 knots on one course for 4 hours across Estlink 2: slow but never slowed down, never stopped.",
      ship: cargoShip(120),
      track: sail(eastOfCable, [{ minutes: 240, speedKnots: (minute) => 6 + 0.2 * Math.sin(minute / 7), courseDegrees: 265, headingOffsetDegrees: 1, navigationStatus: 0 }]),
    },
    {
      name: "Spoofed position jump",
      why: "A 12-knot passage whose positions jump 25 km north for 30 minutes of fake 4-knot creeping, then jump back.",
      ship: cargoShip(200),
      track: (() => {
        const passage = sail(eastOfCable, [{ minutes: 180, speedKnots: steadySpeed(12), courseDegrees: 265, headingOffsetDegrees: 0, navigationStatus: 0 }]);
        const spoofOrigin = createLocalFrame(ESTLINK_2_POINT).toLonLat({ x: 0, y: 25_000 });
        const spoof = sail(spoofOrigin, [{ minutes: 30, speedKnots: steadySpeed(4), courseDegrees: 265, headingOffsetDegrees: 0, navigationStatus: 0 }]);
        return passage.map((point, minute) => {
          const spoofed = minute >= 70 && minute < 100 ? spoof[minute - 70] : undefined;
          return spoofed ? { ...spoofed, atMs: point.atMs } : point;
        });
      })(),
    },
    {
      name: "Drifting, not under command",
      why: "Engine failure: 11 knots, then 3 hours drifting 2 to 3.5 knots across Estlink 2 with status 'not under command', a stop, and 11 knots again.",
      ship: cargoShip(190),
      track: sail(eastOfCable, [
        { minutes: 60, speedKnots: steadySpeed(11), courseDegrees: 265, headingOffsetDegrees: 0, navigationStatus: 0 },
        { minutes: 180, speedKnots: (minute) => 2.75 + 0.75 * Math.sin(minute / 11), courseDegrees: 250, headingOffsetDegrees: 85, navigationStatus: 2 },
        { minutes: 40, speedKnots: steadySpeed(0.3), courseDegrees: 250, headingOffsetDegrees: 85, navigationStatus: 2 },
        { minutes: 90, speedKnots: steadySpeed(11), courseDegrees: 265, headingOffsetDegrees: 0, navigationStatus: 0 },
      ]),
    },
    {
      name: "Pilot boat working a cable area",
      why: "AIS type 50, 18 m: runs out at 15 knots, holds 5 knots alongside a ship for 40 minutes over the cable, runs back.",
      ship: { lengthMetres: 18, beamMetres: 5, draughtMetres: 1.8, shipType: 50, antennaFromBowMetres: 6 },
      track: sail(westOfCable, [
        { minutes: 30, speedKnots: steadySpeed(15), courseDegrees: 80, headingOffsetDegrees: 0, navigationStatus: 0 },
        { minutes: 40, speedKnots: steadySpeed(5), courseDegrees: 85, headingOffsetDegrees: 0, navigationStatus: 0 },
        { minutes: 15, speedKnots: steadySpeed(0.5), courseDegrees: 85, headingOffsetDegrees: 0, navigationStatus: 0 },
        { minutes: 30, speedKnots: steadySpeed(15), courseDegrees: 260, headingOffsetDegrees: 0, navigationStatus: 0 },
      ]),
    },
    {
      name: "Tug towing slowly across a cable",
      why: "AIS type 52, 32 m: 10 knots, then 2 hours at 4 knots towing across Estlink 2, a 20-minute stop, and 10 knots again: the full drag signature from a boat that tows by trade.",
      ship: { lengthMetres: 32, beamMetres: 11, draughtMetres: 4.5, shipType: 52, antennaFromBowMetres: 12 },
      track: sail(westOfCable, [
        { minutes: 60, speedKnots: steadySpeed(10), courseDegrees: 80, headingOffsetDegrees: 0, navigationStatus: 0 },
        { minutes: 120, speedKnots: steadySpeed(4), courseDegrees: 80, headingOffsetDegrees: 3, navigationStatus: 0 },
        { minutes: 20, speedKnots: steadySpeed(0.2), courseDegrees: 80, headingOffsetDegrees: 0, navigationStatus: 0 },
        { minutes: 60, speedKnots: steadySpeed(10), courseDegrees: 80, headingOffsetDegrees: 0, navigationStatus: 0 },
      ]),
    },
  ];
}
