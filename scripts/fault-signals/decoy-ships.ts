// Ordinary traffic around Estlink 2 on the morning of 25 Dec 2024, made up for the fault-signal replay: none of these
// ships existed. Each sails with one report a minute (the live recorder's cadence) and each tests one rule of the
// draft-case window or ranking. The crossing point is where the Eagle S case places the Estlink 2 cut
// (59.93228 N, 26.20532 E, src/data/cases/eagle-s-2024.ts).
import type { ShipTrack } from "@/lib/detection/detection-inputs";
import type { ShipSize, TrackPoint } from "@/lib/detection/detection-types";
import { createLocalFrame, type LonLat } from "@/lib/detection/geodesy";
import { sailLegs, steadySpeed } from "@/lib/detection/synthetic-tracks";

export const ESTLINK_2_CUT: LonLat = { longitude: 26.20532, latitude: 59.93228 };
// One knot covers 1852 m an hour.
const METRES_PER_KNOT_MINUTE = 1852 / 60;
const MS_PER_MINUTE = 60_000;

export type DecoyShip = ShipTrack & { name: string; expectation: string };

function cargo(lengthMetres: number, shipType: number): ShipSize {
  return { lengthMetres, beamMetres: null, draughtMetres: null, shipType, antennaFromBowMetres: null };
}

/**
 * A straight passage at one speed whose track passes `offsetMetres` to the right of the cut point at `crossingUtc`,
 * reported every minute from `minutesBefore` before that moment to `minutesAfter` after it.
 */
function passage(input: { crossingUtc: string; courseDegrees: number; speedKnots: (minute: number) => number; minutesBefore: number; minutesAfter: number; offsetMetres: number; navigationStatus: number }): TrackPoint[] {
  const radians = (input.courseDegrees * Math.PI) / 180;
  const frame = createLocalFrame(ESTLINK_2_CUT);
  const leadMetres = input.minutesBefore * input.speedKnots(0) * METRES_PER_KNOT_MINUTE;
  // Back along the course from the crossing, then sideways to the right of the course by the offset.
  const start = frame.toLonLat({
    x: -Math.sin(radians) * leadMetres + Math.cos(radians) * input.offsetMetres,
    y: -Math.cos(radians) * leadMetres - Math.sin(radians) * input.offsetMetres,
  });
  const startMs = Date.parse(input.crossingUtc) - input.minutesBefore * MS_PER_MINUTE;
  return sailLegs(start, startMs, [
    { minutes: input.minutesBefore + input.minutesAfter, speedKnots: input.speedKnots, courseDegrees: input.courseDegrees, headingOffsetDegrees: 1, navigationStatus: input.navigationStatus },
  ]);
}

/** A ship at anchor swinging on a 200 m circle, `eastMetres` east of the cut point, every minute of the span. */
function swingingAtAnchor(input: { fromUtc: string; minutes: number; eastMetres: number }): TrackPoint[] {
  const frame = createLocalFrame(ESTLINK_2_CUT);
  const fromMs = Date.parse(input.fromUtc);
  const swingRadiusMetres = 200;
  return Array.from({ length: input.minutes }, (_unused, minute) => {
    const bearing = ((210 + 35 * Math.sin((2 * Math.PI * minute) / 100)) * Math.PI) / 180;
    const position = frame.toLonLat({ x: input.eastMetres + Math.sin(bearing) * swingRadiusMetres, y: Math.cos(bearing) * swingRadiusMetres });
    return { atMs: fromMs + minute * MS_PER_MINUTE, longitude: position.longitude, latitude: position.latitude, speedKnots: 0.3, courseDegrees: null, headingDegrees: Math.round(((bearing * 180) / Math.PI + 180) % 360), navigationStatus: 1 };
  });
}

/** The decoys, each with what the replay expects of it. MMSIs 999000001 and up are not assigned to any ship. */
export function buildDecoyShips(): DecoyShip[] {
  return [
    {
      mmsi: 999000001,
      name: "DECOY WESTBOUND 12 KN",
      expectation: "crosses Estlink 2 at 10:20 UTC, 6 minutes before the trip, at 12 knots: in the draft, ranked below Eagle S as outside the drag band",
      ship: cargo(190, 70),
      track: passage({ crossingUtc: "2024-12-25T10:20:00Z", courseDegrees: 262, speedKnots: steadySpeed(12), minutesBefore: 120, minutesAfter: 120, offsetMetres: 0, navigationStatus: 0 }),
    },
    {
      mmsi: 999000002,
      name: "DECOY EASTBOUND TANKER",
      expectation: "crosses at 07:40 UTC at 10.5 knots: in the draft, outside the drag band",
      ship: cargo(245, 80),
      track: passage({ crossingUtc: "2024-12-25T07:40:00Z", courseDegrees: 82, speedKnots: steadySpeed(10.5), minutesBefore: 90, minutesAfter: 90, offsetMetres: 400, navigationStatus: 0 }),
    },
    {
      mmsi: 999000003,
      name: "DECOY SLOW COASTER",
      expectation: "6 knots on one course for 4 hours, across the cable at 09:30 UTC: judged by the detector, ranked below Eagle S",
      ship: cargo(110, 70),
      track: passage({ crossingUtc: "2024-12-25T09:30:00Z", courseDegrees: 258, speedKnots: (minute) => 6 + 0.2 * Math.sin(minute / 7), minutesBefore: 120, minutesAfter: 120, offsetMetres: 0, navigationStatus: 0 }),
    },
    {
      mmsi: 999000004,
      name: "DECOY TUG",
      expectation: "AIS type 52 towing at 4 knots across the cable at 10:05 UTC: not eligible, ranked last",
      ship: { lengthMetres: 32, beamMetres: 11, draughtMetres: 4.5, shipType: 52, antennaFromBowMetres: 12 },
      track: passage({ crossingUtc: "2024-12-25T10:05:00Z", courseDegrees: 300, speedKnots: steadySpeed(4), minutesBefore: 60, minutesAfter: 60, offsetMetres: 0, navigationStatus: 0 }),
    },
    {
      mmsi: 999000005,
      name: "DECOY AT ANCHOR",
      expectation: "status 'at anchor', swinging 900 m east of the cut from 05:00 to 12:00 UTC: in the draft, outside the drag band",
      ship: cargo(180, 80),
      track: swingingAtAnchor({ fromUtc: "2024-12-25T05:00:00Z", minutes: 420, eastMetres: 900 }),
    },
    {
      mmsi: 999000006,
      name: "DECOY FAR LANE",
      expectation: "8 km south of the cable at 10:26 UTC, parallel to it (the route runs about 105 degrees there): left out, beyond the recorder's 3 km",
      ship: cargo(150, 70),
      track: passage({ crossingUtc: "2024-12-25T10:26:00Z", courseDegrees: 105, speedKnots: steadySpeed(5), minutesBefore: 45, minutesAfter: 45, offsetMetres: 8000, navigationStatus: 0 }),
    },
    {
      mmsi: 999000007,
      name: "DECOY AFTERNOON CROSSING",
      expectation: "crosses at 14:30 UTC at 5 knots: outside the trip-time window of the market message, inside the notice's 'after noon' span",
      ship: cargo(140, 70),
      track: passage({ crossingUtc: "2024-12-25T14:30:00Z", courseDegrees: 265, speedKnots: steadySpeed(5), minutesBefore: 60, minutesAfter: 60, offsetMetres: 0, navigationStatus: 0 }),
    },
  ];
}
