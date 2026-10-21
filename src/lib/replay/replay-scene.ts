// What the 3D replay needs from a case: a time window, the vessel's timed positions, when its anchor
// dragged, and where and when each cable was cut. Built from a case file (src/lib/cases); the viewer
// never sees sources or quotes, only these numbers.

/** `recordedSpeedKnots` is the speed the vessel broadcast with an AIS position; null for a position placed from statements. */
export type TimedPosition = { atMs: number; longitude: number; latitude: number; recordedSpeedKnots: number | null };
/** Which 3D ship draws the vessel: each kind has its own hull form and deck (src/lib/ships/ship-specs.ts). */
export type ShipKind = "tanker" | "bulk-carrier" | "general-cargo" | "container-ship" | "fishing" | "tug" | "ro-ro" | "passenger" | "cable-layer";
/** `cableName` matches a line name in the seabed file; `label` is what the scene shows. */
export type ReplayCut = { cableName: string; label: string; atMs: number; longitude: number; latitude: number };

export type ReplaySceneInput = {
  /** Base name of the seabed files under public/seabed/. */
  seabedArea: string;
  windowStartMs: number;
  windowEndMs: number;
  /** Sorted by time. */
  track: TimedPosition[];
  /** The positions placed from statements, in case order (the Evidence rail lists them in the same order). */
  placements: { longitude: number; latitude: number }[];
  dragWindow: { startMs: number; endMs: number } | null;
  /** The first cut is the one the camera frames. */
  cuts: [ReplayCut, ...ReplayCut[]];
  vessel: { name: string; kind: ShipKind; lengthMetres: number };
};

export function progressToTimeMs(scene: Pick<ReplaySceneInput, "windowStartMs" | "windowEndMs">, progress: number): number {
  return scene.windowStartMs + (scene.windowEndMs - scene.windowStartMs) * progress;
}

export function timeMsToProgress(scene: Pick<ReplaySceneInput, "windowStartMs" | "windowEndMs">, atMs: number): number {
  const span = scene.windowEndMs - scene.windowStartMs;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (atMs - scene.windowStartMs) / span));
}

/**
 * Position at a moment, by straight-line interpolation between the two published positions around it.
 * Null before the first position (the vessel is not shown); the last position holds after the track ends.
 */
export function positionAtTime(track: readonly TimedPosition[], atMs: number): { longitude: number; latitude: number } | null {
  const first = track[0];
  if (!first || atMs < first.atMs) return null;
  for (let index = 1; index < track.length; index += 1) {
    const previous = track[index - 1];
    const next = track[index];
    if (!previous || !next || atMs > next.atMs) continue;
    const span = next.atMs - previous.atMs;
    const amount = span <= 0 ? 1 : (atMs - previous.atMs) / span;
    return {
      longitude: previous.longitude + (next.longitude - previous.longitude) * amount,
      latitude: previous.latitude + (next.latitude - previous.latitude) * amount,
    };
  }
  const last = track[track.length - 1] ?? first;
  return { longitude: last.longitude, latitude: last.latitude };
}

/**
 * A run of the track whose positions all sit on one point (Hai Hong Gong 66 at the wreck, 11:00 to 18:00 UTC). The
 * replay holds the ship still there, and the status and the vessel's labels say so, so a still ship never reads as a
 * frozen replay. `firstIndex` and `lastIndex` are the run's first and last positions in the track.
 */
export type HeldStretch = { fromMs: number; toMs: number; firstIndex: number; lastIndex: number };

function isSamePoint(first: TimedPosition, second: TimedPosition): boolean {
  return first.longitude === second.longitude && first.latitude === second.latitude;
}

/** The held run around a moment; null outside one, and before the first or after the last position, where no two positions bound it. */
export function findHeldStretch(track: readonly TimedPosition[], atMs: number): HeldStretch | null {
  const startIndex = track.findIndex((position, index) => {
    const next = track[index + 1];
    return next !== undefined && position.atMs <= atMs && atMs <= next.atMs && isSamePoint(position, next);
  });
  const start = track[startIndex];
  if (!start) return null;
  let firstIndex = startIndex;
  let lastIndex = startIndex + 1;
  while (firstIndex > 0 && isSamePoint(track[firstIndex - 1] ?? start, start)) firstIndex -= 1;
  while (lastIndex < track.length - 1 && isSamePoint(track[lastIndex + 1] ?? start, start)) lastIndex += 1;
  return { fromMs: track[firstIndex]?.atMs ?? start.atMs, toMs: track[lastIndex]?.atMs ?? start.atMs, firstIndex, lastIndex };
}

/**
 * The note under the vessel's name at a moment: the recorded speed while it sails between two AIS positions,
 * "reconstructed position" whenever either end of its current stretch was placed from statements, and
 * "reconstructed, held at one point" when the placed positions around the moment sit on one point.
 */
export function describeVesselPosition(track: readonly TimedPosition[], atMs: number): string {
  const laterIndex = track.findIndex((position) => position.atMs > atMs);
  const nextIndex = laterIndex === -1 ? track.length : laterIndex;
  const previous = track[nextIndex - 1] ?? track[0];
  const next = track[nextIndex] ?? previous;
  const previousSpeed = previous?.recordedSpeedKnots ?? null;
  const nextSpeed = next?.recordedSpeedKnots ?? null;
  if (previousSpeed === null || nextSpeed === null) return findHeldStretch(track, atMs) ? "reconstructed, held at one point" : "reconstructed position";
  return `AIS position, ${previousSpeed.toFixed(1)} knots`;
}
