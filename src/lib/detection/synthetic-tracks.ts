import type { TrackPoint } from "@/lib/detection/detection-types";
import { createLocalFrame, type LonLat } from "@/lib/detection/geodesy";

// Dead-reckoned tracks for the detector's unit tests and the backtest's red team: one report a minute, the live
// recorder's cadence for a moving ship. Not used by the detector itself.

// One knot covers 1852 m an hour.
const METRES_PER_KNOT_MINUTE = 1852 / 60;
const MS_PER_MINUTE = 60_000;

export type Leg = {
  minutes: number;
  speedKnots: (minute: number) => number;
  courseDegrees: number;
  /** Heading minus course; a drifting ship lies across its drift. */
  headingOffsetDegrees: number;
  navigationStatus: number | null;
};

/** A constant speed for a leg. */
export const steadySpeed = (knots: number) => () => knots;

/** Sails the legs one after the other from `start`, reporting every minute from `startMs`. */
export function sailLegs(start: LonLat, startMs: number, legs: readonly Leg[]): TrackPoint[] {
  const frame = createLocalFrame(start);
  let position = { x: 0, y: 0 };
  let minuteOfTrack = 0;
  const track: TrackPoint[] = [];
  for (const leg of legs) {
    for (let minute = 0; minute < leg.minutes; minute += 1) {
      const speedKnots = leg.speedKnots(minute);
      const radians = (leg.courseDegrees * Math.PI) / 180;
      position = { x: position.x + Math.sin(radians) * speedKnots * METRES_PER_KNOT_MINUTE, y: position.y + Math.cos(radians) * speedKnots * METRES_PER_KNOT_MINUTE };
      const lonLat = frame.toLonLat(position);
      track.push({
        atMs: startMs + minuteOfTrack * MS_PER_MINUTE,
        longitude: lonLat.longitude,
        latitude: lonLat.latitude,
        speedKnots: Math.round(speedKnots * 10) / 10,
        courseDegrees: leg.courseDegrees,
        headingDegrees: Math.round((leg.courseDegrees + leg.headingOffsetDegrees + 360) % 360),
        navigationStatus: leg.navigationStatus,
      });
      minuteOfTrack += 1;
    }
  }
  return track;
}
