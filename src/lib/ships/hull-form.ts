import * as THREE from "three";
import { clampValue, smoothStep } from "@/lib/seabed/math";
import type { ShipSpec } from "@/lib/ships/ship-specs";

// The hull of any ship type, lofted from its spec at a real length. Built in metres with the waterline at y = 0, bow
// toward +x and starboard toward +z; the stern sits at x = -halfLength and the stem's foremost point (raked stem or
// bulb) at the length overall minus that, so the hull measures exactly `lengthMetres` from end to end.

// Lofting resolution: stations along the length, points down each side from deck edge to keel.
const STATION_COUNT = 120;
const SIDE_POINT_COUNT = 22;
// Plating: plates about 12 m long in strakes about 2.6 m high, the usual shipyard sizes for steel plate.
export const PLATE_LENGTH_METRES = 12;
export const STRAKE_HEIGHT_METRES = 2.6;

export type HullForm = {
  lengthMetres: number;
  halfLength: number;
  halfBeam: number;
  depth: number;
  draught: number;
  forecastleRise: number;
  stemRake: number;
  bilgeRadius: number;
  bowStartX: number;
  sternStartX: number;
  bulb: { centerX: number; centerY: number; radius: number; halfLength: number } | null;
  /** The stem's foremost x (bulb nose or the rake at the forecastle top). */
  bowX: number;
};

/** The hull dimensions of one ship of a type and length. */
export function createHullForm(spec: ShipSpec, lengthMetres: number): HullForm {
  const halfBeam = (spec.beamToLength * lengthMetres) / 2;
  const depth = spec.depthToLength * lengthMetres;
  const draught = spec.draughtToLength * lengthMetres;
  const forecastleRise = spec.forecastleRiseToDepth * depth;
  const stemRake = spec.stemRakeToDepth * depth;
  const bulbRadius = spec.bulbToBeam * halfBeam * 2;
  const bulbHalfLength = 2.4 * bulbRadius;
  // The stem rakes up to the forecastle top; the bulb noses out ahead of the stem's foot.
  const rakeOverhang = stemRake * ((depth + forecastleRise) / depth);
  const bulbOverhang = bulbRadius > 0 ? 0.6 * bulbHalfLength : 0;
  const forwardOverhang = Math.max(rakeOverhang, bulbOverhang);
  const halfLength = (lengthMetres - forwardOverhang) / 2;
  return {
    lengthMetres,
    halfLength,
    halfBeam,
    depth,
    draught,
    forecastleRise,
    stemRake,
    bilgeRadius: Math.min(0.15 * halfBeam, 0.2 * draught),
    bowStartX: spec.bowEntranceShare * halfLength,
    sternStartX: -spec.sternRunShare * halfLength,
    bulb: bulbRadius > 0 ? { centerX: halfLength + bulbOverhang - bulbHalfLength, centerY: 0.42 * draught, radius: bulbRadius, halfLength: bulbHalfLength } : null,
    bowX: halfLength + forwardOverhang,
  };
}

/** Main deck height above the keel at a station, rising to the forecastle near the bow. */
export function readDeckHeight(form: HullForm, positionX: number): number {
  return form.depth + form.forecastleRise * smoothStep(0.8 * form.halfLength, 0.86 * form.halfLength, positionX);
}

/** Half-breadth of the hull at a station and a height above the keel (both metres). */
export function readHalfBreadth(form: HullForm, positionX: number, heightAboveKeel: number): number {
  const { depth, draught, halfLength, bowStartX, sternStartX, bilgeRadius, bulb } = form;
  const heightFraction = clampValue(heightAboveKeel / depth, 0, 1.4);
  let fullness = 1;
  if (positionX > bowStartX) {
    const stemX = halfLength + form.stemRake * heightFraction;
    const amount = clampValue((positionX - bowStartX) / (stemX - bowStartX), 0, 1);
    // Flared above the waterline, finer below it.
    const exponent = 2 + 0.8 * clampValue((heightAboveKeel - draught) / Math.max(depth - draught, 1), -1, 1);
    fullness = Math.sqrt(Math.max(0, 1 - Math.pow(amount, exponent)));
    fullness *= 1 - 0.12 * clampValue((draught - heightAboveKeel) / draught, 0, 1) * amount;
  }
  if (positionX < sternStartX) {
    const amount = clampValue((sternStartX - positionX) / (halfLength + sternStartX), 0, 1);
    const transomFullness = 1 - 0.28 * amount * amount;
    const runFullness = Math.pow(Math.max(0, 1 - Math.pow(amount, 1.3)), 0.75);
    const runWeight = clampValue((0.8 * draught - heightAboveKeel) / (0.8 * draught), 0, 1);
    fullness = transomFullness * (1 - runWeight) + runFullness * runWeight;
  }
  let halfBreadth = form.halfBeam * fullness;
  if (heightAboveKeel < bilgeRadius) {
    const bilge = Math.sqrt(Math.max(0, bilgeRadius ** 2 - (bilgeRadius - heightAboveKeel) ** 2));
    halfBreadth = Math.min(halfBreadth, Math.max(0, halfBreadth - bilgeRadius + bilge));
  }
  if (bulb) {
    const bulbTerm = 1 - ((positionX - bulb.centerX) / bulb.halfLength) ** 2 - ((heightAboveKeel - bulb.centerY) / bulb.radius) ** 2;
    if (bulbTerm > 0) halfBreadth = Math.max(halfBreadth, bulb.radius * 0.95 * Math.sqrt(bulbTerm));
  }
  return halfBreadth;
}

/** Stations from stern to stem, clustered toward both ends where the hull curves. */
export function readStations(form: HullForm): number[] {
  const sternX = -form.halfLength;
  return Array.from({ length: STATION_COUNT }, (_slot, index) => {
    const amount = index / (STATION_COUNT - 1);
    const clustered = 0.5 - 0.5 * Math.cos(amount * Math.PI);
    return sternX + (form.bowX - sternX) * (0.35 * amount + 0.65 * clustered);
  });
}

/** Paint bands: antifouling below the waterline, a dark boot top at it, topsides above. */
export type HullPalette = { bottom: THREE.Color; bootTop: THREE.Color; topside: THREE.Color; water: THREE.Color };

// Below the waterline the bottom paint fades toward the water's colour with depth, so the hull reads as submerged
// under the clear water surface instead of floating above a second hull.
function writeHullColor(form: HullForm, heightAboveKeel: number, palette: HullPalette, target: THREE.Color): THREE.Color {
  const bootTopHeight = Math.max(0.6, 0.06 * form.depth);
  if (heightAboveKeel < form.draught - 0.4) return target.copy(palette.bottom).lerp(palette.water, 0.4 + 0.45 * (1 - heightAboveKeel / form.draught));
  if (heightAboveKeel < form.draught + bootTopHeight) return target.copy(palette.bootTop);
  return target.copy(palette.topside);
}

/** The shell from one deck edge, under the keel, to the other; smooth normals, painted by band, UVs in plates. */
export function buildHullShell(form: HullForm, palette: HullPalette): THREE.BufferGeometry {
  const vertexColor = new THREE.Color();
  const stations = readStations(form);
  const ringSize = SIDE_POINT_COUNT * 2 + 1;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  for (const positionX of stations) {
    const deckHeight = readDeckHeight(form, positionX);
    const starboard: [number, number][] = Array.from({ length: SIDE_POINT_COUNT }, (_slot, index) => {
      const height = deckHeight * (1 - index / SIDE_POINT_COUNT);
      return [readHalfBreadth(form, positionX, height), height];
    });
    const ring: [number, number][] = [...starboard, [0, 0], ...[...starboard].reverse().map(([halfBreadth, height]): [number, number] => [-halfBreadth, height])];
    for (const [sideOffset, height] of ring) {
      positions.push(positionX, height - form.draught, sideOffset);
      writeHullColor(form, height, palette, vertexColor).toArray(colors, colors.length);
      // u runs along the hull in plate lengths, v up the side in strakes (the bottom shares the keel strake).
      uvs.push((positionX + form.halfLength) / PLATE_LENGTH_METRES, height / STRAKE_HEIGHT_METRES);
    }
  }
  const indices: number[] = [];
  for (let station = 0; station < stations.length - 1; station += 1) {
    for (let point = 0; point < ringSize - 1; point += 1) {
      const current = station * ringSize + point;
      const next = (station + 1) * ringSize + point;
      // Counter-clockwise seen from outside, so normals face out of the hull.
      indices.push(current, current + 1, next, current + 1, next + 1, next);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** The flat transom closing the stern above the run, with its own vertices so its normal stays flat. */
export function buildTransom(form: HullForm): THREE.BufferGeometry {
  const sternX = readStations(form)[0] ?? -form.halfLength;
  const deckHeight = readDeckHeight(form, sternX);
  const bottomHeight = 0.72 * form.draught;
  const steps = 10;
  const heights = Array.from({ length: steps + 1 }, (_slot, index) => deckHeight - ((deckHeight - bottomHeight) * index) / steps);
  const outline = new THREE.Shape();
  outline.moveTo(-readHalfBreadth(form, sternX, deckHeight), deckHeight);
  heights.forEach((height) => outline.lineTo(readHalfBreadth(form, sternX, height), height));
  [...heights].reverse().forEach((height) => outline.lineTo(-readHalfBreadth(form, sternX, height), height));
  const geometry = new THREE.ShapeGeometry(outline);
  // Shape plane (side, height) turned to face aft (-x).
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(sternX, -form.draught, 0);
  return geometry;
}

/** A handrail along both deck edges, between `fromX` and `toX`. */
export function buildRailings(form: HullForm, fromX: number, toX: number): THREE.BufferGeometry[] {
  const stations = readStations(form).filter((positionX) => positionX > fromX && positionX < toX);
  if (stations.length < 2) return [];
  const railHeight = Math.min(1.05, 0.06 * form.depth);
  return [-1, 1].map((side) => {
    const points = stations.map((positionX) => {
      const deckHeight = readDeckHeight(form, positionX);
      return new THREE.Vector3(positionX, deckHeight - form.draught + railHeight, side * (readHalfBreadth(form, positionX, deckHeight) - 0.15));
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), stations.length * 2, 0.09, 5, false).toNonIndexed();
  });
}

/** The weather deck: a strip across the beam at every station, following the forecastle rise. */
export function buildDeck(form: HullForm): THREE.BufferGeometry {
  const stations = readStations(form);
  const acrossCount = 5;
  const positions: number[] = [];
  for (const positionX of stations) {
    const deckHeight = readDeckHeight(form, positionX);
    const halfBreadth = readHalfBreadth(form, positionX, deckHeight);
    for (let across = 0; across < acrossCount; across += 1) {
      positions.push(positionX, deckHeight - form.draught + 0.02, -halfBreadth + (2 * halfBreadth * across) / (acrossCount - 1));
    }
  }
  const indices: number[] = [];
  for (let station = 0; station < stations.length - 1; station += 1) {
    for (let across = 0; across < acrossCount - 1; across += 1) {
      const current = station * acrossCount + across;
      const next = (station + 1) * acrossCount + across;
      indices.push(current, current + 1, next, current + 1, next + 1, next);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
