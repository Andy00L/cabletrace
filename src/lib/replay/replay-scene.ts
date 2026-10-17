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
 * The note under the vessel's name at a moment: the recorded speed while it sails between two AIS positions,
 * "reconstructed position" whenever either end of its current stretch was placed from statements.
 */
export function describeVesselPosition(track: readonly TimedPosition[], atMs: number): string {
  const laterIndex = track.findIndex((position) => position.atMs > atMs);
  const nextIndex = laterIndex === -1 ? track.length : laterIndex;
  const previous = track[nextIndex - 1] ?? track[0];
  const next = track[nextIndex] ?? previous;
  const previousSpeed = previous?.recordedSpeedKnots ?? null;
  const nextSpeed = next?.recordedSpeedKnots ?? null;
  if (previousSpeed === null || nextSpeed === null) return "reconstructed position";
  return `AIS position, ${previousSpeed.toFixed(1)} knots`;
}
