// What the 3D replay needs from a case: a time window, the vessel's timed positions, when its anchor
// dragged, and where and when each cable was cut. Built from a case file (src/lib/cases); the viewer
// never sees sources or quotes, only these numbers.

export type TimedPosition = { atMs: number; longitude: number; latitude: number };
/** `cableName` matches a line name in the seabed file; `label` is what the scene shows. */
export type ReplayCut = { cableName: string; label: string; atMs: number; longitude: number; latitude: number };

export type ReplaySceneInput = {
  /** Base name of the seabed files under public/seabed/. */
  seabedArea: string;
  windowStartMs: number;
  windowEndMs: number;
  /** Sorted by time. */
  track: TimedPosition[];
  dragWindow: { startMs: number; endMs: number } | null;
  /** The first cut is the one the camera frames. */
  cuts: [ReplayCut, ...ReplayCut[]];
  vessel: { name: string; note: string };
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
