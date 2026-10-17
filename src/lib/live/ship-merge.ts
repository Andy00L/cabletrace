// Merge rules for the live frames: one report per ship, the best source per area, and ships carried
// forward for a while after they go quiet. Pure functions, shared by the collector and the browser.
// Type-only import: see the import rule at the top of snapshot-codec.ts.
import type { ShipClass, ShipRecord } from "./snapshot-codec.ts";

// Area where Fintraffic Digitraffic receives AIS (17.0-32.5 E, 57.2-65.8 N, measured 2026-10-17 from
// https://meri.digitraffic.fi/api/ais/v1/locations): it sees about 7 times more ships there than aisstream.
export const DIGITRAFFIC_BOX = { west: 17.0, east: 32.5, south: 57.2, north: 65.8 } as const;
// Inside the box a Digitraffic report wins over a newer aisstream one unless it is this much older:
// both relay the same transponders, so a gap this large means Digitraffic lost the ship.
export const DIGITRAFFIC_PRIORITY_MS = 5 * 60_000;
// A ship stays on the globe this long after its last report, with its age, so slow reporters
// (class A at anchor every 3 minutes, class B every 3 minutes when slow, ITU-R M.1371-5 Table 1)
// and coverage gaps do not make ships blink between frames.
export const CARRY_FORWARD_MS = 30 * 60_000;
// Reports stamped further ahead of the frame than this come from a bad clock and are dropped;
// smaller leads are clamped to the frame time.
export const FUTURE_TOLERANCE_MS = 60_000;

export function isInsideDigitrafficBox(longitude: number, latitude: number): boolean {
  return (
    longitude >= DIGITRAFFIC_BOX.west &&
    longitude <= DIGITRAFFIC_BOX.east &&
    latitude >= DIGITRAFFIC_BOX.south &&
    latitude <= DIGITRAFFIC_BOX.north
  );
}

/** True when `challenger` should replace `incumbent` as the ship's report. */
export function prefersReport(challenger: ShipRecord, incumbent: ShipRecord): boolean {
  if (challenger.source !== incumbent.source) {
    const digitrafficReport = challenger.source === "digitraffic" ? challenger : incumbent;
    const otherReport = digitrafficReport === challenger ? incumbent : challenger;
    const isDigitrafficArea = isInsideDigitrafficBox(digitrafficReport.longitude, digitrafficReport.latitude);
    if (isDigitrafficArea && digitrafficReport.reportedAtMs >= otherReport.reportedAtMs - DIGITRAFFIC_PRIORITY_MS) {
      return digitrafficReport === challenger;
    }
  }
  return challenger.reportedAtMs > incumbent.reportedAtMs;
}

/**
 * Picks the report to keep for one ship. The class is a property of the ship, not of the report:
 * position reports carry no type, so a winner without a class inherits the one the loser knew.
 */
export function pickPreferredReport(incumbent: ShipRecord | undefined, challenger: ShipRecord): ShipRecord {
  if (incumbent === undefined) return challenger;
  const winner = prefersReport(challenger, incumbent) ? challenger : incumbent;
  const loser = winner === challenger ? incumbent : challenger;
  if (winner.shipClass === "unknown" && loser.shipClass !== "unknown") return { ...winner, shipClass: loser.shipClass };
  return winner;
}

type MergeInput = {
  frameTimeMs: number;
  // The previous frame's ships (already carried forward once) and this run's new reports.
  previous: Iterable<ShipRecord>;
  incoming: Iterable<ShipRecord>;
};

/**
 * Builds a frame's ships: the preferred report per MMSI among the previous frame and the new reports,
 * without reports older than CARRY_FORWARD_MS or stamped in the future. Order of the result is by MMSI.
 */
export function mergeShipRecords({ frameTimeMs, previous, incoming }: MergeInput): ShipRecord[] {
  const latestByMmsi = new Map<number, ShipRecord>();
  const considerReport = (report: ShipRecord) => {
    if (report.reportedAtMs > frameTimeMs + FUTURE_TOLERANCE_MS) return;
    if (frameTimeMs - report.reportedAtMs > CARRY_FORWARD_MS) return;
    const clamped = report.reportedAtMs > frameTimeMs ? { ...report, reportedAtMs: frameTimeMs } : report;
    latestByMmsi.set(report.mmsi, pickPreferredReport(latestByMmsi.get(report.mmsi), clamped));
  };
  for (const report of previous) considerReport(report);
  for (const report of incoming) considerReport(report);
  return [...latestByMmsi.values()].sort((first, second) => first.mmsi - second.mmsi);
}

/** Sets each ship's class from fresh static data; ships missing from the map keep the class they had. */
export function assignShipClasses(ships: readonly ShipRecord[], classByMmsi: ReadonlyMap<number, ShipClass>): ShipRecord[] {
  return ships.map((ship) => {
    const knownClass = classByMmsi.get(ship.mmsi);
    return knownClass === undefined || knownClass === "unknown" || knownClass === ship.shipClass ? ship : { ...ship, shipClass: knownClass };
  });
}
