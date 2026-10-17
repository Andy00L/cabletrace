import type { AnchorPoint, CableCrossing, CableKind, CableLine, DepthLookup, TrackPoint } from "@/lib/detection/detection-types";
import { computeLayback, type ChainState } from "@/lib/detection/anchor-model";
import { createLocalFrame, distanceToSegment, intersectSegments, roundTo, type LocalPoint } from "@/lib/detection/geodesy";
import { MAX_REPORT_GAP_MS } from "@/lib/detection/track-cleaning";

// The anchor is dragged behind the ship along the ground the ship has just covered, so its position at a report
// time is the point of the ship's own track one trail distance back (trail = layback minus the antenna's distance
// from the bow). Sideways offset of the hawse (a quarter of the beam, about 8 m) is ignored.

// The anchor counts as following a cable while its path stays within this many metres of the mapped route. Cable
// routes are OpenStreetMap lines simplified to about 20 m (supabase/migrations/20261017020100_seed_gulf_cables.sql);
// 500 m leaves room for the unmapped difference between the drawn route and the cable on the seabed.
const CABLE_FOLLOW_DISTANCE_METRES = 500;
// Five decimals of a degree is about 1 m.
const COORDINATE_DECIMALS = 5;

type LocalCable = { name: string; kind: CableKind; points: LocalPoint[]; minX: number; maxX: number; minY: number; maxY: number };
type TrackCrossing = { cableName: string; cableKind: CableKind; alongMetres: number; longitude: number; latitude: number };
type AnchorSample = { atMs: number; alongMetres: number };

export type AnchorPathResult = { anchorPath: AnchorPoint[]; cableCrossings: CableCrossing[]; followedKm: number };

function toLocalCable(cable: CableLine, toLocal: (point: { longitude: number; latitude: number }) => LocalPoint): LocalCable {
  const points = cable.coordinates.map(([longitude, latitude]) => toLocal({ longitude, latitude }));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { name: cable.name, kind: cable.kind, points, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function isNear(cable: LocalCable, point: LocalPoint, marginMetres: number): boolean {
  return point.x >= cable.minX - marginMetres && point.x <= cable.maxX + marginMetres && point.y >= cable.minY - marginMetres && point.y <= cable.maxY + marginMetres;
}

/** Position at a distance along the polyline; clamped to its ends. */
function pointAlong(localTrack: readonly LocalPoint[], cumulative: readonly number[], alongMetres: number): LocalPoint | null {
  const first = localTrack[0];
  if (!first) return null;
  for (let index = 1; index < localTrack.length; index += 1) {
    const start = localTrack[index - 1];
    const end = localTrack[index];
    const startAlong = cumulative[index - 1];
    const endAlong = cumulative[index];
    if (!start || !end || startAlong === undefined || endAlong === undefined) continue;
    if (alongMetres <= endAlong) {
      const amount = endAlong > startAlong ? Math.max(0, (alongMetres - startAlong) / (endAlong - startAlong)) : 0;
      return { x: start.x + (end.x - start.x) * amount, y: start.y + (end.y - start.y) * amount };
    }
  }
  return localTrack[localTrack.length - 1] ?? first;
}

/** First time the anchor's along-track position reaches `targetMetres`, interpolated between samples; null if never. */
function timeAnchorReaches(samples: readonly AnchorSample[], targetMetres: number): number | null {
  for (let index = 1; index < samples.length; index += 1) {
    const before = samples[index - 1];
    const after = samples[index];
    if (!before || !after) continue;
    if (before.alongMetres <= targetMetres && after.alongMetres >= targetMetres && after.alongMetres > before.alongMetres) {
      return before.atMs + ((targetMetres - before.alongMetres) / (after.alongMetres - before.alongMetres)) * (after.atMs - before.atMs);
    }
  }
  return null;
}

/**
 * Reconstructs where the anchor was between `startMs` and `endMs`, which cables its path crosses and when, and how far
 * it runs along a cable. `track` is the ship's cleaned track (it may extend beyond the window, which places the anchor
 * at the start of the window on ground covered before it). Steps longer than MAX_REPORT_GAP_MS are silences: no
 * crossing or following is claimed across them.
 */
export function reconstructAnchorPath(input: {
  track: readonly TrackPoint[];
  startMs: number;
  endMs: number;
  model: ChainState;
  depthAt: DepthLookup | null;
  cables: readonly CableLine[];
}): AnchorPathResult {
  const { track, startMs, endMs, model, depthAt, cables } = input;
  const origin = track[0];
  if (!origin) return { anchorPath: [], cableCrossings: [], followedKm: 0 };
  const frame = createLocalFrame(origin);
  const localTrack = track.map((point) => frame.toLocal(point));
  const cumulative: number[] = [0];
  for (let index = 1; index < localTrack.length; index += 1) {
    const previous = localTrack[index - 1];
    const current = localTrack[index];
    cumulative.push((cumulative[index - 1] ?? 0) + (previous && current ? Math.hypot(current.x - previous.x, current.y - previous.y) : 0));
  }
  const xs = localTrack.map((point) => point.x);
  const ys = localTrack.map((point) => point.y);
  const trackBox = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const nearbyCables = cables
    .filter((cable) => cable.coordinates.length >= 2)
    .map((cable) => toLocalCable(cable, frame.toLocal))
    .filter(
      (cable) =>
        cable.maxX >= trackBox.minX - CABLE_FOLLOW_DISTANCE_METRES &&
        cable.minX <= trackBox.maxX + CABLE_FOLLOW_DISTANCE_METRES &&
        cable.maxY >= trackBox.minY - CABLE_FOLLOW_DISTANCE_METRES &&
        cable.minY <= trackBox.maxY + CABLE_FOLLOW_DISTANCE_METRES,
    );

  const anchorPath: AnchorPoint[] = [];
  const nominalSamples: AnchorSample[] = [];
  const earliestSamples: AnchorSample[] = [];
  const latestSamples: AnchorSample[] = [];
  const lastAlong = cumulative[cumulative.length - 1] ?? 0;
  track.forEach((point, index) => {
    if (point.atMs < startMs || point.atMs > endMs) return;
    const layback = computeLayback(model, depthAt ? depthAt(point.longitude, point.latitude) : null);
    const shipAlong = cumulative[index];
    if (!layback || shipAlong === undefined) return;
    const toAnchorAlong = (laybackMetres: number) => shipAlong - (laybackMetres - model.antennaFromBowMetres);
    const nominalAlong = toAnchorAlong(layback.nominalMetres);
    // Behind the first report the ground the anchor is on was never recorded: no position is invented for it.
    if (nominalAlong < 0) return;
    const anchorLocal = pointAlong(localTrack, cumulative, Math.min(nominalAlong, lastAlong));
    if (!anchorLocal) return;
    const anchorPosition = frame.toLonLat(anchorLocal);
    // Rounded to about 1 m and 1 decimetre: the model is nowhere near that precise, and every detection is stored.
    anchorPath.push({
      atMs: point.atMs,
      longitude: roundTo(anchorPosition.longitude, COORDINATE_DECIMALS),
      latitude: roundTo(anchorPosition.latitude, COORDINATE_DECIMALS),
      laybackMetres: roundTo(layback.nominalMetres, 1),
      laybackMinMetres: roundTo(layback.minMetres, 1),
      laybackMaxMetres: roundTo(layback.maxMetres, 1),
      depthMetres: layback.depthMetres === null ? null : roundTo(layback.depthMetres, 1),
    });
    nominalSamples.push({ atMs: point.atMs, alongMetres: nominalAlong });
    earliestSamples.push({ atMs: point.atMs, alongMetres: toAnchorAlong(layback.minMetres) });
    latestSamples.push({ atMs: point.atMs, alongMetres: toAnchorAlong(layback.maxMetres) });
  });

  // Where the ship's own track crosses each cable, on steps with no silence.
  const trackCrossings: TrackCrossing[] = [];
  for (let index = 1; index < track.length; index += 1) {
    const before = track[index - 1];
    const after = track[index];
    const start = localTrack[index - 1];
    const end = localTrack[index];
    const startAlong = cumulative[index - 1];
    const endAlong = cumulative[index];
    if (!before || !after || !start || !end || startAlong === undefined || endAlong === undefined) continue;
    if (after.atMs - before.atMs > MAX_REPORT_GAP_MS) continue;
    for (const cable of nearbyCables) {
      if (!isNear(cable, start, endAlong - startAlong) && !isNear(cable, end, endAlong - startAlong)) continue;
      for (let vertex = 1; vertex < cable.points.length; vertex += 1) {
        const cableStart = cable.points[vertex - 1];
        const cableEnd = cable.points[vertex];
        if (!cableStart || !cableEnd) continue;
        const hit = intersectSegments(start, end, cableStart, cableEnd);
        if (!hit) continue;
        const position = frame.toLonLat({ x: start.x + (end.x - start.x) * hit.alongA, y: start.y + (end.y - start.y) * hit.alongA });
        trackCrossings.push({ cableName: cable.name, cableKind: cable.kind, alongMetres: startAlong + (endAlong - startAlong) * hit.alongA, ...position });
      }
    }
  }

  const cableCrossings: CableCrossing[] = [];
  for (const crossing of trackCrossings) {
    const atMs = timeAnchorReaches(nominalSamples, crossing.alongMetres);
    if (atMs === null || atMs < startMs || atMs > endMs) continue;
    const earliestMs = timeAnchorReaches(earliestSamples, crossing.alongMetres) ?? atMs;
    const latestMs = timeAnchorReaches(latestSamples, crossing.alongMetres) ?? endMs;
    cableCrossings.push({
      cableName: crossing.cableName,
      cableKind: crossing.cableKind,
      atMs: Math.round(atMs),
      earliestMs: Math.round(Math.min(earliestMs, atMs)),
      latestMs: Math.round(Math.max(latestMs, atMs)),
      longitude: roundTo(crossing.longitude, COORDINATE_DECIMALS),
      latitude: roundTo(crossing.latitude, COORDINATE_DECIMALS),
    });
  }
  cableCrossings.sort((first, second) => first.atMs - second.atMs);

  // Distance the nominal anchor path runs within CABLE_FOLLOW_DISTANCE_METRES of any cable.
  const isNearCable = (local: LocalPoint) =>
    nearbyCables.some(
      (cable) =>
        isNear(cable, local, CABLE_FOLLOW_DISTANCE_METRES) &&
        cable.points.some((cablePoint, vertex) => {
          const nextPoint = cable.points[vertex + 1];
          return nextPoint !== undefined && distanceToSegment(local, cablePoint, nextPoint) <= CABLE_FOLLOW_DISTANCE_METRES;
        }),
    );
  let followedMetres = 0;
  const localAnchors = anchorPath.map((anchor) => frame.toLocal(anchor));
  const anchorNearFlags = localAnchors.map(isNearCable);
  for (let index = 1; index < anchorPath.length; index += 1) {
    const before = anchorPath[index - 1];
    const after = anchorPath[index];
    const start = localAnchors[index - 1];
    const end = localAnchors[index];
    if (!before || !after || !start || !end || after.atMs - before.atMs > MAX_REPORT_GAP_MS) continue;
    if (anchorNearFlags[index - 1] && anchorNearFlags[index]) followedMetres += Math.hypot(end.x - start.x, end.y - start.y);
  }
  return { anchorPath, cableCrossings, followedKm: followedMetres / 1000 };
}
