import type { ScenePoint } from "@/lib/seabed/terrain";

// The Vessel view's follow camera stands off the ship's starboard quarter (viewer.ts). Next to high ground that spot
// can sit in or behind the land: Hai Hong Gong 66 is held in a bay of Dongyin, where the island, drawn 10 times higher
// (scene-scales.ts), rises 0.7 km within half a kilometre of the hull. This module picks where the camera stands
// instead: it tests the sight line from the camera to the ship's deck against the drawn terrain, keeps the usual spot
// when it is clear, and otherwise turns the offset about the vertical through the ship to the nearest clear bearing,
// raising the camera only when no bearing at its height is clear. Pure: plain numbers and a height sampler, no three.js.

/** A point of the drawn scene (km). */
export type ScenePoint3 = { x: number; y: number; z: number };

/** Where the follow camera stands relative to the ship, in the ship's frame (km): behind the hull, to starboard, above. */
export type FollowOffset = { behindKm: number; sideKm: number; aboveKm: number };

/**
 * The follow camera's turn about the vertical through the ship (radians; positive turns the offset from +x toward +z)
 * and how far it is raised over its usual height (km).
 */
export type FollowBearing = { azimuthRadians: number; liftKm: number };

/** The usual spot: no turn, no rise. */
export const PREFERRED_BEARING: FollowBearing = { azimuthRadians: 0, liftKm: 0 };

/** How the search runs, in scene km for the current hull (the viewer scales these by the drawn ship length). */
export type FollowSightTuning = {
  /** A sight line is clear when every sample passes at least this far over the terrain. */
  clearanceKm: number;
  /** While the held bearing is clear, a bearing nearer the usual spot must clear by this much more to replace it. */
  hysteresisKm: number;
  /** Bearings are tried this far apart, in both directions, out to half a turn. */
  azimuthStepRadians: number;
  /** When no bearing at a height is clear, the camera is raised this much and every bearing tried again. */
  liftStepKm: number;
  maxLiftSteps: number;
  /** Samples along each sight line, from the camera toward the deck. */
  sampleCount: number;
  /** The last stretch of the sight line, next to the deck, is not sampled: the hull lies there, moored to the shore. */
  nearDeckSkipKm: number;
};

export type FollowSightInput = {
  /** The hull's origin: the waterline amidships. */
  shipPosition: ScenePoint3;
  /** The deck point the camera must see, this far over the hull's origin (km). */
  deckHeightKm: number;
  /** The ship's heading, a unit vector in x and z. */
  heading: ScenePoint;
  offset: FollowOffset;
  /** The bearing the camera uses now; it is kept while clear, so a moving ship does not flip the camera back and forth. */
  heldBearing: FollowBearing;
  /** The drawn terrain's height (scene km) at a point; negative infinity outside the block, where nothing is drawn. */
  sampleTerrainY: (sceneX: number, sceneZ: number) => number;
  tuning: FollowSightTuning;
};

/** `clear`: the bearing to use and its sight line's clearance (km). `blocked`: no bearing tried was clear. */
export type FollowSightChoice = { kind: "clear"; bearing: FollowBearing; clearanceKm: number } | { kind: "blocked" };

// Bearings closer than this (radians, km) are the same bearing.
const SAME_BEARING_TOLERANCE = 1e-6;

/** The camera's offset from the ship's origin (km) for a heading, an offset in the ship's frame and a bearing. */
export function placeFollowOffset(heading: ScenePoint, offset: FollowOffset, bearing: FollowBearing): ScenePoint3 {
  const offsetX = -heading.x * offset.behindKm - heading.z * offset.sideKm;
  const offsetZ = -heading.z * offset.behindKm + heading.x * offset.sideKm;
  const cosine = Math.cos(bearing.azimuthRadians);
  const sine = Math.sin(bearing.azimuthRadians);
  // At the usual bearing the cosine is exactly 1 and the sine 0, so the offset is the one the camera always had.
  return { x: offsetX * cosine - offsetZ * sine, y: offset.aboveKm + bearing.liftKm, z: offsetZ * cosine + offsetX * sine };
}

/**
 * The least height (km) the segment from `from` toward `to` keeps over the terrain, sampled `sampleCount` times from
 * `from` up to `nearEndSkipKm` short of `to`. Negative where the terrain rises through it.
 */
export function measureSightClearance(from: ScenePoint3, to: ScenePoint3, sampleTerrainY: FollowSightInput["sampleTerrainY"], sampleCount: number, nearEndSkipKm: number): number {
  const lengthKm = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const endShare = lengthKm > 0 ? Math.max(0, 1 - nearEndSkipKm / lengthKm) : 0;
  const lastSample = Math.max(1, sampleCount - 1);
  let clearanceKm = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample < Math.max(1, sampleCount); sample += 1) {
    const share = (endShare * sample) / lastSample;
    const sightX = from.x + (to.x - from.x) * share;
    const sightY = from.y + (to.y - from.y) * share;
    const sightZ = from.z + (to.z - from.z) * share;
    clearanceKm = Math.min(clearanceKm, sightY - sampleTerrainY(sightX, sightZ));
  }
  return clearanceKm;
}

/** An angle wrapped into [-pi, pi). */
function wrapAngle(radians: number): number {
  const turn = 2 * Math.PI;
  return ((((radians + Math.PI) % turn) + turn) % turn) - Math.PI;
}

function isSameBearing(first: FollowBearing, second: FollowBearing): boolean {
  return Math.abs(wrapAngle(first.azimuthRadians - second.azimuthRadians)) < SAME_BEARING_TOLERANCE && Math.abs(first.liftKm - second.liftKm) < SAME_BEARING_TOLERANCE;
}

// An eased bearing this close to its target (radians, km) takes the target exactly, so the camera settles.
const SETTLED_BEARING_TOLERANCE = 1e-4;

/**
 * One step of the follow easing from `current` toward `target`: `amount` (0 to 1) of the remaining turn, the short way
 * round, and of the remaining rise. Within SETTLED_BEARING_TOLERANCE it returns `target` itself.
 */
export function easeFollowBearing(current: FollowBearing, target: FollowBearing, amount: number): FollowBearing {
  const remainingTurn = wrapAngle(target.azimuthRadians - current.azimuthRadians);
  const remainingLiftKm = target.liftKm - current.liftKm;
  if (Math.abs(remainingTurn) * (1 - amount) < SETTLED_BEARING_TOLERANCE && Math.abs(remainingLiftKm) * (1 - amount) < SETTLED_BEARING_TOLERANCE) return target;
  return { azimuthRadians: wrapAngle(current.azimuthRadians + remainingTurn * amount), liftKm: current.liftKm + remainingLiftKm * amount };
}

/**
 * The bearings to try, nearest the usual spot first: for each height from the usual one up, the usual direction, then
 * one step either way, two steps, and so on to half a turn. Each group holds the bearings equally far from the usual
 * spot; the one whose sight line clears most wins within its group.
 */
function listBearingGroups(tuning: FollowSightTuning): FollowBearing[][] {
  const ringCount = Math.max(1, Math.round(Math.PI / tuning.azimuthStepRadians));
  const groups: FollowBearing[][] = [];
  for (let liftStep = 0; liftStep <= tuning.maxLiftSteps; liftStep += 1) {
    const liftKm = liftStep * tuning.liftStepKm;
    for (let ring = 0; ring <= ringCount; ring += 1) {
      const azimuthRadians = Math.min(Math.PI, ring * tuning.azimuthStepRadians);
      const isSingle = ring === 0 || azimuthRadians >= Math.PI - SAME_BEARING_TOLERANCE;
      groups.push(isSingle ? [{ azimuthRadians, liftKm }] : [{ azimuthRadians, liftKm }, { azimuthRadians: -azimuthRadians, liftKm }]);
    }
  }
  return groups;
}

/**
 * Where the follow camera stands: the usual spot when its sight line to the deck is clear, else the nearest clear
 * bearing (turned either way, raised only when no turn at the usual height is clear). While the held bearing stays
 * clear it is kept, unless a bearing nearer the usual spot clears by `hysteresisKm` more: the camera neither flips
 * back and forth on a sight line that grazes a ridge nor stays swung away once the land is behind it.
 */
export function chooseFollowBearing(input: FollowSightInput): FollowSightChoice {
  const { shipPosition, deckHeightKm, heading, offset, heldBearing, sampleTerrainY, tuning } = input;
  const deck = { x: shipPosition.x, y: shipPosition.y + deckHeightKm, z: shipPosition.z };
  const measureBearing = (bearing: FollowBearing) => {
    const placed = placeFollowOffset(heading, offset, bearing);
    const camera = { x: shipPosition.x + placed.x, y: shipPosition.y + placed.y, z: shipPosition.z + placed.z };
    return measureSightClearance(camera, deck, sampleTerrainY, tuning.sampleCount, tuning.nearDeckSkipKm);
  };
  const heldClearanceKm = measureBearing(heldBearing);
  const isHeldClear = heldClearanceKm >= tuning.clearanceKm;
  const requiredKm = isHeldClear ? tuning.clearanceKm + tuning.hysteresisKm : tuning.clearanceKm;
  for (const group of listBearingGroups(tuning)) {
    // Every bearing nearer the usual spot than the held one had its chance: the held one stays.
    if (isHeldClear && group.some((bearing) => isSameBearing(bearing, heldBearing))) return { kind: "clear", bearing: heldBearing, clearanceKm: heldClearanceKm };
    let best: { bearing: FollowBearing; clearanceKm: number } | null = null;
    for (const bearing of group) {
      const clearanceKm = measureBearing(bearing);
      if (clearanceKm >= requiredKm && (best === null || clearanceKm > best.clearanceKm)) best = { bearing, clearanceKm };
    }
    if (best) return { kind: "clear", ...best };
  }
  // A held bearing off the search's grid (a tuning changed under it) is still kept while clear.
  return isHeldClear ? { kind: "clear", bearing: heldBearing, clearanceKm: heldClearanceKm } : { kind: "blocked" };
}
