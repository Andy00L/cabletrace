import * as THREE from "three";
import { clampValue, smoothStep } from "@/lib/seabed/math";
import type { ShipSpec } from "@/lib/ships/ship-specs";

// The hull of any ship type, lofted from its spec at a real length, as a naval architect draws one: a parallel
// midbody, a fine entrance to a raked stem over a bulbous bow, a run that narrows under a counter stern ending in a
// flat transom, the keel rising aft (the buttock lines) to the counter, a sheer line rising to both ends and a
// forecastle. Built in metres with the waterline at y = 0, bow toward +x and starboard toward +z; the transom sits at
// x = -halfLength and the stem's foremost point (raked stem or bulb) at the length overall minus that, so the hull
// measures exactly `lengthMetres` from end to end.

// Lofting resolution: stations along the length, points down each side from deck edge to keel.
const STATION_COUNT = 140;
const SIDE_POINT_COUNT = 26;
// Plating: plates about 12 m long in strakes about 2.6 m high, the usual shipyard sizes for steel plate.
export const PLATE_LENGTH_METRES = 12;
export const STRAKE_HEIGHT_METRES = 2.6;
// The boot top: the band of hull the waterline moves over between ballast and full load (m below and above it).
const BOOT_TOP_BELOW_METRES = 0.3;
const BOOT_TOP_ABOVE_SHARE_OF_DEPTH = 0.05;
// The counter's underside sits this far above the waterline (m) at the transom: dry in still water.
const TRANSOM_CLEARANCE_METRES = 0.8;
// The keel starts rising toward the counter this far forward of the transom (share of the half length).
const KEEL_RISE_SHARE = 0.17;
// The forecastle deck spans the foremost share of the half length.
const FORECASTLE_START_SHARE = 0.82;

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
  sheerForward: number;
  sheerAft: number;
  /** Where the counter overhangs from: the rudder post (m, hull x). */
  rudderPostX: number;
  /** Height above the keel of the transom's lower edge. */
  transomBottomHeight: number;
  /** Where the forecastle deck begins (m, hull x). */
  forecastleStartX: number;
  bulwarkMetres: number;
};

/** The hull dimensions of one ship of a type and length; `draughtMetres` floats it at a loading condition other than the type's. */
export function createHullForm(spec: ShipSpec, lengthMetres: number, draughtMetres?: number): HullForm {
  const halfBeam = (spec.beamToLength * lengthMetres) / 2;
  const depth = spec.depthToLength * lengthMetres;
  const draught = draughtMetres ?? spec.draughtToLength * lengthMetres;
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
    sheerForward: spec.sheerForwardToDepth * depth,
    sheerAft: spec.sheerAftToDepth * depth,
    rudderPostX: -halfLength + spec.counterToLength * lengthMetres,
    transomBottomHeight: Math.min(depth * 0.8, draught + TRANSOM_CLEARANCE_METRES),
    forecastleStartX: FORECASTLE_START_SHARE * halfLength,
    bulwarkMetres: spec.bulwarkMetres,
  };
}

/** Main deck height above the keel at a station: the sheer line, rising to the forecastle near the bow. */
export function readDeckHeight(form: HullForm, positionX: number): number {
  const along = clampValue(positionX / form.halfLength, -1, 1.2);
  // A parabolic sheer, flat over the midbody's middle half.
  const forwardSheer = form.sheerForward * Math.max(0, (along - 0.4) / 0.6) ** 2;
  const aftSheer = form.sheerAft * Math.max(0, (-along - 0.4) / 0.6) ** 2;
  return form.depth + forwardSheer + aftSheer + form.forecastleRise * smoothStep(form.forecastleStartX - 0.03 * form.halfLength, form.forecastleStartX, positionX);
}

/**
 * Height of the keel line above the moulded base at a station: 0 along the flat bottom, rising aft under the run to the
 * transom's lower edge above the waterline (the counter), so the stern reads as a stern and not as a box's end.
 */
export function readKeelHeight(form: HullForm, positionX: number): number {
  const riseStartX = -form.halfLength + KEEL_RISE_SHARE * form.halfLength * 2;
  if (positionX >= riseStartX) return 0;
  // Under the run the keel rises to about half the draught at the rudder post (the propeller's aperture), then the
  // counter's underside sweeps up to the transom.
  const atRudderPost = 0.45 * form.draught;
  if (positionX >= form.rudderPostX) return atRudderPost * smoothStep(riseStartX, form.rudderPostX, positionX);
  return atRudderPost + (form.transomBottomHeight - atRudderPost) * smoothStep(form.rudderPostX, -form.halfLength, positionX) ** 0.7;
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

/** Paint bands: antifouling below the waterline, the boot top across it, topsides above. */
export type HullPalette = { bottom: THREE.Color; bootTop: THREE.Color; topside: THREE.Color; water: THREE.Color };

// Below the boot top the bottom paint fades toward the water's colour with depth, so the hull reads as submerged
// under the clear water surface instead of floating above a second hull.
function writeHullColor(form: HullForm, heightAboveKeel: number, palette: HullPalette, target: THREE.Color): THREE.Color {
  const bootTopTop = form.draught + Math.max(0.6, BOOT_TOP_ABOVE_SHARE_OF_DEPTH * form.depth);
  if (heightAboveKeel < form.draught - BOOT_TOP_BELOW_METRES) return target.copy(palette.bottom).lerp(palette.water, 0.35 + 0.45 * (1 - heightAboveKeel / form.draught));
  if (heightAboveKeel < bootTopTop) return target.copy(palette.bootTop);
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
    const keelHeight = readKeelHeight(form, positionX);
    const starboard: [number, number][] = Array.from({ length: SIDE_POINT_COUNT }, (_slot, index) => {
      // Points crowd toward the keel, where the bilge turns.
      const amount = index / SIDE_POINT_COUNT;
      const height = keelHeight + (deckHeight - keelHeight) * (1 - amount ** 1.25);
      return [readHalfBreadth(form, positionX, height), height];
    });
    const ring: [number, number][] = [...starboard, [0, keelHeight], ...[...starboard].reverse().map(([halfBreadth, height]): [number, number] => [-halfBreadth, height])];
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

/** The flat transom closing the stern above the counter, with its own vertices so its normal stays flat. */
export function buildTransom(form: HullForm): THREE.BufferGeometry {
  const sternX = readStations(form)[0] ?? -form.halfLength;
  const deckHeight = readDeckHeight(form, sternX);
  const bottomHeight = readKeelHeight(form, sternX);
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

/** A handrail along both deck edges, between `fromX` and `toX`, with stanchions every 1.5 m. */
export function buildRailings(form: HullForm, fromX: number, toX: number): THREE.BufferGeometry[] {
  const stations = readStations(form).filter((positionX) => positionX > fromX && positionX < toX);
  if (stations.length < 2) return [];
  const railHeight = Math.min(1.05, 0.06 * form.depth);
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const readRailPoint = (positionX: number, heightShare: number) => {
      const deckHeight = readDeckHeight(form, positionX);
      return new THREE.Vector3(positionX, deckHeight - form.draught + railHeight * heightShare, side * (readHalfBreadth(form, positionX, deckHeight) - 0.15));
    };
    for (const heightShare of [1, 0.5]) {
      const curve = new THREE.CatmullRomCurve3(stations.map((positionX) => readRailPoint(positionX, heightShare)));
      parts.push(new THREE.TubeGeometry(curve, stations.length * 2, heightShare === 1 ? 0.05 : 0.03, 4, false).toNonIndexed());
    }
    for (let positionX = fromX + 0.75; positionX < toX; positionX += 1.5) {
      const top = readRailPoint(positionX, 1);
      const stanchion = new THREE.BoxGeometry(0.05, railHeight, 0.05);
      stanchion.translate(top.x, top.y - railHeight / 2, top.z);
      parts.push(stanchion.toNonIndexed());
      stanchion.dispose();
    }
  }
  return parts;
}

/** The forecastle's bulwark: a plated wall around the bow from the forecastle's start to the stem, both sides. */
export function buildBulwark(form: HullForm): THREE.BufferGeometry | null {
  if (form.bulwarkMetres <= 0) return null;
  const stations = readStations(form).filter((positionX) => positionX >= form.forecastleStartX - 0.03 * form.halfLength);
  if (stations.length < 2) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  // Inner and outer faces 0.12 m apart, so the wall has thickness from every side.
  for (const side of [-1, 1]) {
    for (const inset of [0, 0.12]) {
      const first = positions.length / 3;
      for (const positionX of stations) {
        const deckHeight = readDeckHeight(form, positionX);
        const offset = side * Math.max(0, readHalfBreadth(form, positionX, deckHeight) - inset);
        positions.push(positionX, deckHeight - form.draught - 0.05, offset, positionX, deckHeight - form.draught + form.bulwarkMetres, offset);
      }
      for (let station = 0; station < stations.length - 1; station += 1) {
        const bottom = first + station * 2;
        // Faces outward on the outer skin, inward on the inner one.
        const isOutward = (side > 0) === (inset === 0);
        if (isOutward) indices.push(bottom, bottom + 2, bottom + 1, bottom + 1, bottom + 2, bottom + 3);
        else indices.push(bottom, bottom + 1, bottom + 2, bottom + 1, bottom + 3, bottom + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** The weather deck: a strip across the beam at every station, following the sheer and the forecastle rise. */
export function buildDeck(form: HullForm): THREE.BufferGeometry {
  const stations = readStations(form);
  const acrossCount = 7;
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const positionX of stations) {
    const deckHeight = readDeckHeight(form, positionX);
    const halfBreadth = readHalfBreadth(form, positionX, deckHeight);
    for (let across = 0; across < acrossCount; across += 1) {
      const offset = -halfBreadth + (2 * halfBreadth * across) / (acrossCount - 1);
      // A slight camber: the deck crowns 1% of the beam on the centreline so rain runs off to the scuppers.
      const camber = 0.01 * form.halfBeam * 2 * (1 - (offset / Math.max(halfBreadth, 0.01)) ** 2);
      positions.push(positionX, deckHeight - form.draught + 0.02 + camber, offset);
      uvs.push((positionX + form.halfLength) / PLATE_LENGTH_METRES, offset / PLATE_LENGTH_METRES);
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
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A patch of the hull's side between two stations and two heights above the keel, lifted `liftMetres` off the plating
 * along the side's outward direction, with UVs 0 to 1 across it (u from aft to fore, v from bottom to top): the canvas
 * for paint marks that follow the hull's curve (the name, draught marks, rust streaks).
 */
export function buildHullPatch(form: HullForm, options: { fromX: number; toX: number; fromHeight: number; toHeight: number; side: 1 | -1; liftMetres: number }): THREE.BufferGeometry {
  const { fromX, toX, fromHeight, toHeight, side, liftMetres } = options;
  const columns = 12;
  const rows = 6;
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const positionX = fromX + ((toX - fromX) * column) / columns;
      const height = fromHeight + ((toHeight - fromHeight) * row) / rows;
      positions.push(positionX, height - form.draught, side * (readHalfBreadth(form, positionX, height) + liftMetres));
      // Seen from its own side, u runs left to right: aft to fore on starboard, fore to aft on port.
      uvs.push(side > 0 ? column / columns : 1 - column / columns, row / rows);
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const current = row * (columns + 1) + column;
      const above = current + columns + 1;
      if (side > 0) indices.push(current, current + 1, above, current + 1, above + 1, above);
      else indices.push(current, above, current + 1, current + 1, above, above + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
