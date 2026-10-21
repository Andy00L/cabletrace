import { positionAtTime, type TimedPosition } from "@/lib/replay/replay-scene";
import { measureDistanceToPolyline } from "@/lib/seabed/scene/overview";
import type { ScenePoint } from "@/lib/seabed/terrain";

// The stage's hover readout (ui-console-2, 3.4): under the pointer, the sea's depth, the nearest mapped cable and the
// moment the ship passed nearest. Pure: the viewer finds the scene point under the pointer and hands it here.

const METRES_PER_KM = 1000;
/** The ship's track is sampled at this step (replay ms) for its nearest pass: a minute is under 0.4 km at 12 knots. */
export const TRACK_SAMPLE_STEP_MS = 60_000;

export type TrackSample = { atMs: number; point: ScenePoint };
export type CableRun = { name: string; points: readonly ScenePoint[] };

/** The track's positions every `stepMs` from its first to its last, in scene km. */
export function sampleTrack(track: readonly TimedPosition[], toScene: (longitude: number, latitude: number) => ScenePoint, stepMs = TRACK_SAMPLE_STEP_MS): TrackSample[] {
  const first = track[0];
  const last = track[track.length - 1];
  if (!first || !last) return [];
  const samples: TrackSample[] = [];
  for (let atMs = first.atMs; atMs <= last.atMs; atMs += stepMs) {
    const position = positionAtTime(track, atMs);
    if (position) samples.push({ atMs, point: toScene(position.longitude, position.latitude) });
  }
  // The last position itself, so the track's end is never skipped by the step.
  if (samples[samples.length - 1]?.atMs !== last.atMs) samples.push({ atMs: last.atMs, point: toScene(last.longitude, last.latitude) });
  return samples;
}

/** The sample of the track nearest a point, and how far it is (metres); null without samples. */
export function findNearestPass(samples: readonly TrackSample[], point: ScenePoint): { atMs: number; distanceMetres: number } | null {
  let nearest: { atMs: number; distanceMetres: number } | null = null;
  for (const sample of samples) {
    const distanceMetres = Math.hypot(sample.point.x - point.x, sample.point.z - point.z) * METRES_PER_KM;
    if (nearest === null || distanceMetres < nearest.distanceMetres) nearest = { atMs: sample.atMs, distanceMetres };
  }
  return nearest;
}

/** The cable nearest a point, and how far it is (metres); null without cables. */
export function findNearestCable(runs: readonly CableRun[], point: ScenePoint): { name: string; distanceMetres: number } | null {
  let nearest: { name: string; distanceMetres: number } | null = null;
  for (const run of runs) {
    const distanceMetres = measureDistanceToPolyline(point, run.points) * METRES_PER_KM;
    if (nearest === null || distanceMetres < nearest.distanceMetres) nearest = { name: run.name, distanceMetres };
  }
  return nearest;
}
