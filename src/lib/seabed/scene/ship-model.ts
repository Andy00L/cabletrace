import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { clampValue, createSeededRandom, smoothStep } from "@/lib/seabed/math";
import type { ShipKind } from "@/lib/replay/replay-scene";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";

// A procedural cargo ship, built in metres with the waterline at y = 0, bow toward +x and starboard toward
// +z. One hull with the proportions of a 228 m ship (the Eagle S product tanker; the Yi Peng 3 bulk carrier is
// 224 by 32 m), and four decks: a tanker's pipe rack, manifold cranes and tank domes, a bulk carrier's hatch
// covers, a general cargo ship's three holds with side cranes, or a container ship's stacks in bays. The
// general cargo ship and the container ship of the cases are shorter (132 m and 169 m) but share this hull.
// The details are the ones visible on any such ship, not a survey of one hull. Monochrome on purpose: the
// scene's only colors are data colors.

const HALF_LENGTH = 114;
const HALF_BEAM = 16.1;
const DRAFT = 12.5;
const DEPTH = 20.5;
const FORECASTLE_RISE = 2.6;
const BILGE_RADIUS = 2.4;
// Hull lofting resolution: stations along the length, points down each side.
const STATION_COUNT = 120;
const SIDE_POINT_COUNT = 22;
// Where the parallel midbody ends toward the bow and toward the stern (fractions of half length).
const BOW_START = 0.45 * HALF_LENGTH;
const STERN_START = -0.55 * HALF_LENGTH;
// The bulb: an ellipsoid ahead of the stem, below the waterline.
const BULB_CENTER_X = HALF_LENGTH - 2;
const BULB_CENTER_Y = 0.42 * DRAFT;
const BULB_RADIUS = 3.1;
const BULB_HALF_LENGTH = 7.5;
// The stem rakes forward 3.4 m from keel to deck.
const STEM_RAKE = 3.4;
const ACCOMMODATION_FRONT_X = -HALF_LENGTH + 34;
// Bulk carrier: seven holds between the accommodation and the forecastle (a Panamax layout), each hatch
// about 15 m square under a cover that overhangs its coaming.
const HATCH_COUNT = 7;
const HATCH_LENGTH = 15.2;
const HATCH_WIDTH = 15;
const COAMING_HEIGHT = 1.9;
// General cargo ship: three long holds under low folding covers, two cranes on the side deck between them
// (port aft, starboard forward), each jib stowed fore and aft on a rest post.
const GENERAL_CARGO_HATCHES: readonly { aftX: number; foreX: number }[] = [
  { aftX: -75, foreX: -37 },
  { aftX: -27, foreX: 21 },
  { aftX: 31, foreX: 74 },
];
const CRANE_SIDE_OFFSET = 12.6;
const CRANE_PEDESTAL_HEIGHT = 9;
const CRANE_JIB_LENGTH = 26;
// Container ship: 40 ft bays (12.2 m) with a 1.4 m lashing gap, rows of 2.44 m boxes across, stacks two to
// four tiers of 2.59 m (ISO 668 container sizes), lower toward the bow so the bridge sees over them.
const CONTAINER_BAY_LENGTH = 12.2;
const CONTAINER_BAY_GAP = 1.4;
const CONTAINER_ROW_PITCH = 2.5;
const CONTAINER_WIDTH = 2.44;
const CONTAINER_TIER_HEIGHT = 2.59;
// Fixed seed so the stack skyline is identical on every load (the Balticconnector damage date).
const CONTAINER_LAYOUT_SEED = 20231008;

function deckHeightAt(positionX: number): number {
  return DEPTH + FORECASTLE_RISE * smoothStep(0.8 * HALF_LENGTH, 0.86 * HALF_LENGTH, positionX);
}

/** Half-breadth of the hull at a station and a height above the keel (both metres). */
function hullHalfBreadth(positionX: number, heightAboveKeel: number): number {
  const heightFraction = clampValue(heightAboveKeel / DEPTH, 0, 1.2);
  let fullness = 1;
  if (positionX > BOW_START) {
    const stemX = HALF_LENGTH + STEM_RAKE * heightFraction;
    const amount = clampValue((positionX - BOW_START) / (stemX - BOW_START), 0, 1);
    // Flared above the waterline, finer below it.
    const exponent = 2 + 0.8 * clampValue((heightAboveKeel - DRAFT) / (DEPTH - DRAFT), -1, 1);
    fullness = Math.sqrt(Math.max(0, 1 - Math.pow(amount, exponent)));
    fullness *= 1 - 0.12 * clampValue((DRAFT - heightAboveKeel) / DRAFT, 0, 1) * amount;
  }
  if (positionX < STERN_START) {
    const amount = clampValue((STERN_START - positionX) / (HALF_LENGTH + STERN_START), 0, 1);
    const transomFullness = 1 - 0.28 * amount * amount;
    const runFullness = Math.pow(Math.max(0, 1 - Math.pow(amount, 1.3)), 0.75);
    const runWeight = clampValue((0.8 * DRAFT - heightAboveKeel) / (0.8 * DRAFT), 0, 1);
    fullness = transomFullness * (1 - runWeight) + runFullness * runWeight;
  }
  let halfBreadth = HALF_BEAM * fullness;
  if (heightAboveKeel < BILGE_RADIUS) {
    const bilge = Math.sqrt(Math.max(0, BILGE_RADIUS ** 2 - (BILGE_RADIUS - heightAboveKeel) ** 2));
    halfBreadth = Math.min(halfBreadth, Math.max(0, halfBreadth - BILGE_RADIUS + bilge));
  }
  const bulbTerm = 1 - ((positionX - BULB_CENTER_X) / BULB_HALF_LENGTH) ** 2 - ((heightAboveKeel - BULB_CENTER_Y) / BULB_RADIUS) ** 2;
  if (bulbTerm > 0) halfBreadth = Math.max(halfBreadth, BULB_RADIUS * 0.95 * Math.sqrt(bulbTerm));
  return halfBreadth;
}

// Stations cluster toward both ends, where the hull curves.
function stationPositions(): number[] {
  const sternX = -HALF_LENGTH;
  const bowX = HALF_LENGTH + STEM_RAKE + 1.2;
  return Array.from({ length: STATION_COUNT }, (_slot, index) => {
    const amount = index / (STATION_COUNT - 1);
    const clustered = 0.5 - 0.5 * Math.cos(amount * Math.PI);
    return sternX + (bowX - sternX) * (0.35 * amount + 0.65 * clustered);
  });
}

type HullPalette = { bottom: THREE.Color; bootTop: THREE.Color; topside: THREE.Color; water: THREE.Color };

// Below the waterline the bottom paint fades toward the water's color with depth, so the hull reads as
// submerged under the clear water surface instead of floating above a second hull.
function hullColorAt(heightAboveKeel: number, palette: HullPalette, target: THREE.Color): THREE.Color {
  if (heightAboveKeel < DRAFT - 0.4) return target.copy(palette.bottom).lerp(palette.water, 0.4 + 0.45 * (1 - heightAboveKeel / DRAFT));
  if (heightAboveKeel < DRAFT + 1.4) return target.copy(palette.bootTop);
  return target.copy(palette.topside);
}

/** The shell from one deck edge, under the keel, to the other deck edge; smooth normals, colored by band. */
function buildHullShell(): THREE.BufferGeometry {
  const palette: HullPalette = {
    bottom: new THREE.Color(SCENE_COLORS.tankerBottom),
    bootTop: new THREE.Color(SCENE_COLORS.tankerBootTop),
    topside: new THREE.Color(SCENE_COLORS.tankerTopside),
    water: new THREE.Color(SCENE_COLORS.water),
  };
  const vertexColor = new THREE.Color();
  const stations = stationPositions();
  const ringSize = SIDE_POINT_COUNT * 2 + 1;
  const positions: number[] = [];
  const colors: number[] = [];
  for (const positionX of stations) {
    const deckHeight = deckHeightAt(positionX);
    const starboard: [number, number][] = Array.from({ length: SIDE_POINT_COUNT }, (_slot, index) => {
      const height = deckHeight * (1 - index / SIDE_POINT_COUNT);
      return [hullHalfBreadth(positionX, height), height];
    });
    const ring: [number, number][] = [...starboard, [0, 0], ...[...starboard].reverse().map(([halfBreadth, height]): [number, number] => [-halfBreadth, height])];
    for (const [sideOffset, height] of ring) {
      positions.push(positionX, height - DRAFT, sideOffset);
      hullColorAt(height, palette, vertexColor).toArray(colors, colors.length);
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
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** The flat transom closing the stern above the run, with its own vertices so its normal stays flat. */
function buildTransom(): THREE.BufferGeometry {
  const sternX = stationPositions()[0] ?? -HALF_LENGTH;
  const deckHeight = deckHeightAt(sternX);
  const bottomHeight = 0.72 * DRAFT;
  const steps = 10;
  const heights = Array.from({ length: steps + 1 }, (_slot, index) => deckHeight - ((deckHeight - bottomHeight) * index) / steps);
  const outline = new THREE.Shape();
  outline.moveTo(-hullHalfBreadth(sternX, deckHeight), deckHeight);
  heights.forEach((height) => outline.lineTo(hullHalfBreadth(sternX, height), height));
  [...heights].reverse().forEach((height) => outline.lineTo(-hullHalfBreadth(sternX, height), height));
  const geometry = new THREE.ShapeGeometry(outline);
  // Shape plane (side, height) turned to face aft (-x).
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(sternX, -DRAFT, 0);
  return geometry;
}

/** A handrail along both deck edges, from the poop to the forecastle. */
function buildRailings(): THREE.BufferGeometry[] {
  const stations = stationPositions().filter((positionX) => positionX > -HALF_LENGTH + 2 && positionX < HALF_LENGTH - 2);
  return [-1, 1].map((side) => {
    const points = stations.map((positionX) => {
      const deckHeight = deckHeightAt(positionX);
      return new THREE.Vector3(positionX, deckHeight - DRAFT + 1.05, side * (hullHalfBreadth(positionX, deckHeight) - 0.15));
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), stations.length * 2, 0.09, 5, false).toNonIndexed();
  });
}

/** The weather deck: a strip across the beam at every station, following the forecastle rise. */
function buildDeck(): THREE.BufferGeometry {
  const stations = stationPositions();
  const acrossCount = 5;
  const positions: number[] = [];
  for (const positionX of stations) {
    const deckHeight = deckHeightAt(positionX);
    const halfBreadth = hullHalfBreadth(positionX, deckHeight);
    for (let across = 0; across < acrossCount; across += 1) {
      positions.push(positionX, deckHeight - DRAFT + 0.02, -halfBreadth + (2 * halfBreadth * across) / (acrossCount - 1));
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

// Helpers that place a primitive and keep it for merging, so each material is one draw call.
type PartList = THREE.BufferGeometry[];

function addBox(parts: PartList, size: [number, number, number], center: [number, number, number], rotation?: THREE.Euler) {
  const geometry = new THREE.BoxGeometry(...size);
  if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation));
  geometry.translate(...center);
  parts.push(geometry.toNonIndexed());
}

function addCylinder(parts: PartList, radius: number, length: number, center: [number, number, number], axis: "x" | "y" | "z", radialSegments = 10) {
  const geometry = new THREE.CylinderGeometry(radius, radius, length, radialSegments);
  if (axis === "x") geometry.rotateZ(Math.PI / 2);
  if (axis === "z") geometry.rotateX(Math.PI / 2);
  geometry.translate(...center);
  parts.push(geometry.toNonIndexed());
}

function mergeParts(parts: PartList): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
  parts.forEach((part) => part.dispose());
  return merged;
}

/** Accommodation tiers, bridge with wings, funnel, mast and the stern freefall lifeboat. */
function buildSuperstructure(): { structure: PartList; glass: PartList; funnel: PartList; band: PartList; lifeboat: PartList } {
  const structure: PartList = [];
  const glass: PartList = [];
  const funnel: PartList = [];
  const band: PartList = [];
  const lifeboat: PartList = [];
  const deckY = DEPTH - DRAFT;
  const tierHeight = 2.9;
  const tiers = 5;
  for (let tier = 0; tier < tiers; tier += 1) {
    const depthAlongShip = 17 - tier * 1.2;
    const width = 27 - tier * 0.6;
    const centerX = ACCOMMODATION_FRONT_X - depthAlongShip / 2;
    const centerY = deckY + tier * tierHeight + tierHeight / 2;
    addBox(structure, [depthAlongShip, tierHeight - 0.15, width], [centerX, centerY, 0]);
    // A window band on the front face of each tier.
    addBox(glass, [0.12, 0.9, width * 0.84], [ACCOMMODATION_FRONT_X + 0.07, centerY + 0.25, 0]);
  }
  const bridgeY = deckY + tiers * tierHeight + 1.5;
  addBox(structure, [9, 3, 31.6], [ACCOMMODATION_FRONT_X - 5, bridgeY, 0]);
  addBox(glass, [0.14, 1.3, 30.4], [ACCOMMODATION_FRONT_X - 0.45, bridgeY + 0.35, 0]);
  addBox(structure, [10, 0.35, 32.4], [ACCOMMODATION_FRONT_X - 5, bridgeY + 1.68, 0]);
  // Mast with a radar yard on the bridge roof.
  addCylinder(structure, 0.35, 9, [ACCOMMODATION_FRONT_X - 6, bridgeY + 6.2, 0], "y", 8);
  addBox(structure, [0.4, 0.4, 7], [ACCOMMODATION_FRONT_X - 6, bridgeY + 8.2, 0]);
  addBox(structure, [0.25, 0.25, 4.2], [ACCOMMODATION_FRONT_X - 5.4, bridgeY + 5.4, 0]);
  // Funnel on the engine casing just aft of the accommodation, raked aft, with a light band.
  const funnelX = ACCOMMODATION_FRONT_X - 21;
  const casingHeight = 12;
  const funnelRake = new THREE.Euler(0, 0, 0.08);
  addBox(structure, [8, casingHeight, 11], [funnelX, deckY + casingHeight / 2, 0]);
  addBox(funnel, [7, 10, 6], [funnelX - 0.4, deckY + casingHeight + 5, 0], funnelRake);
  addBox(band, [7.08, 1.6, 6.08], [funnelX - 0.75, deckY + casingHeight + 7.6, 0], funnelRake);
  addCylinder(funnel, 0.7, 2.4, [funnelX - 1.6, deckY + casingHeight + 10.9, 1.2], "y", 8);
  addCylinder(funnel, 0.55, 2.2, [funnelX - 1.6, deckY + casingHeight + 10.8, -1.3], "y", 8);
  // Freefall lifeboat on its stern ramp, nose down toward the water.
  const lifeboatGeometry = new THREE.CapsuleGeometry(1.5, 6.5, 4, 10);
  lifeboatGeometry.rotateZ(Math.PI / 2 - 0.6);
  lifeboatGeometry.translate(-HALF_LENGTH + 4, deckY + 7.5, 0);
  lifeboat.push(lifeboatGeometry.toNonIndexed());
  lifeboatGeometry.dispose();
  addBox(structure, [8, 0.4, 3.6], [-HALF_LENGTH + 4.6, deckY + 6.1, 0], new THREE.Euler(0, 0, -0.6));
  return { structure, glass, funnel, band, lifeboat };
}

/** Pipe rack and catwalk down the centreline, cargo manifold with hose cranes, tank domes. */
function buildTankerDeck(parts: PartList) {
  const deckY = DEPTH - DRAFT;
  const rackStart = ACCOMMODATION_FRONT_X + 2;
  const rackEnd = 0.8 * HALF_LENGTH;
  const rackLength = rackEnd - rackStart;
  const rackCenter = (rackStart + rackEnd) / 2;
  for (const sideOffset of [-0.9, 0, 0.9]) addCylinder(parts, 0.32, rackLength, [rackCenter, deckY + 1.4, sideOffset], "x", 8);
  addBox(parts, [rackLength, 0.12, 1.2], [rackCenter, deckY + 2.6, 2.2]);
  for (let positionX = rackStart + 4; positionX < rackEnd; positionX += 12) {
    addBox(parts, [0.3, 2.6, 0.3], [positionX, deckY + 1.3, 2.2]);
    addBox(parts, [0.3, 1.4, 3.2], [positionX, deckY + 0.7, 0]);
  }
  // Manifold amidships: transverse pipes to both sides, a hose crane on each side.
  for (const manifoldX of [-2.5, 0, 2.5]) addCylinder(parts, 0.28, HALF_BEAM * 1.7, [manifoldX, deckY + 1.1, 0], "z", 8);
  for (const side of [-1, 1]) {
    addCylinder(parts, 0.55, 8, [4.5, deckY + 4, side * 9.5], "y", 10);
    // Boom stowed aft from the pedestal top, sloping down to its cradle.
    const boomLength = 15;
    const boomSlope = 0.32;
    const boom = new THREE.BoxGeometry(boomLength, 0.45, 0.45);
    boom.rotateZ(boomSlope);
    boom.translate(4.5 - (boomLength / 2) * Math.cos(boomSlope), deckY + 8 - (boomLength / 2) * Math.sin(boomSlope), side * 9.5);
    parts.push(boom.toNonIndexed());
    boom.dispose();
    addBox(parts, [0.4, 3.4, 0.4], [4.5 - boomLength * Math.cos(boomSlope) + 0.6, deckY + 1.7, side * 9.5]);
  }
  // Tank domes and vent risers in two rows.
  for (let positionX = ACCOMMODATION_FRONT_X + 10; positionX < rackEnd - 6; positionX += 17) {
    for (const side of [-1, 1]) {
      addCylinder(parts, 0.9, 0.8, [positionX, deckY + 0.4, side * 8.5], "y", 12);
      addCylinder(parts, 0.18, 3.2, [positionX + 3, deckY + 1.6, side * 6.2], "y", 6);
    }
  }
}

/** Hatch coamings in the equipment tone, and the covers on top of them in the light superstructure tone. */
function buildBulkCarrierDeck(parts: PartList, covers: PartList) {
  const deckY = DEPTH - DRAFT;
  const cargoStart = ACCOMMODATION_FRONT_X + 4;
  const cargoEnd = 0.8 * HALF_LENGTH - 3;
  const holdLength = (cargoEnd - cargoStart) / HATCH_COUNT;
  for (let hold = 0; hold < HATCH_COUNT; hold += 1) {
    const centerX = cargoStart + holdLength * (hold + 0.5);
    addBox(parts, [HATCH_LENGTH, COAMING_HEIGHT, HATCH_WIDTH], [centerX, deckY + COAMING_HEIGHT / 2, 0]);
    // Folding cover panels: a flat lid that overhangs the coaming, crowned along the centreline.
    addBox(covers, [HATCH_LENGTH + 0.8, 0.7, HATCH_WIDTH + 0.8], [centerX, deckY + COAMING_HEIGHT + 0.35, 0]);
    addBox(covers, [HATCH_LENGTH + 0.8, 0.3, HATCH_WIDTH * 0.45], [centerX, deckY + COAMING_HEIGHT + 0.85, 0]);
    // Cover rails run out past both sides of the coaming, where the panels roll when the hatch opens.
    for (const side of [-1, 1]) addBox(parts, [0.4, 0.5, 5.5], [centerX + side * (HATCH_LENGTH / 2 - 1), deckY + 0.25, 0.5 * side * (HATCH_WIDTH + 5.5)]);
  }
}

/** A jib of the given length from a pivot, sloping down toward +x or -x by `slope` radians. */
function addSlopedBeam(parts: PartList, pivot: [number, number, number], length: number, slope: number, direction: 1 | -1, size: number) {
  const beam = new THREE.BoxGeometry(length, size, size);
  beam.rotateZ(-direction * slope);
  beam.translate(pivot[0] + direction * (length / 2) * Math.cos(slope), pivot[1] - (length / 2) * Math.sin(slope), pivot[2]);
  parts.push(beam.toNonIndexed());
  beam.dispose();
}

/**
 * Three holds under low folding covers (light tone) on their coamings, panel joints across each cover, and two
 * cranes on the side deck between the holds: pedestal, cab, and a jib stowed along the side deck on a rest post.
 */
function buildGeneralCargoDeck(parts: PartList, covers: PartList) {
  const deckY = DEPTH - DRAFT;
  const coamingHeight = 1.5;
  const panelLength = 9;
  for (const { aftX, foreX } of GENERAL_CARGO_HATCHES) {
    const length = foreX - aftX;
    const centerX = (aftX + foreX) / 2;
    // The forward hold narrows with the bow: keep 4 m of side deck at its forward end.
    const width = Math.min(20, 2 * (hullHalfBreadth(foreX, DEPTH) - 4));
    addBox(parts, [length, coamingHeight, width], [centerX, deckY + coamingHeight / 2, 0]);
    addBox(covers, [length + 0.6, 0.8, width + 0.6], [centerX, deckY + coamingHeight + 0.4, 0]);
    const panelCount = Math.max(2, Math.round(length / panelLength));
    for (let joint = 1; joint < panelCount; joint += 1) {
      addBox(parts, [0.35, 0.25, width + 0.6], [aftX + (length * joint) / panelCount, deckY + coamingHeight + 0.9, 0]);
    }
  }
  const cranePositions: { positionX: number; side: 1 | -1; direction: 1 | -1 }[] = [
    { positionX: -32, side: -1, direction: 1 },
    { positionX: 26, side: 1, direction: -1 },
  ];
  for (const { positionX, side, direction } of cranePositions) {
    const sideZ = side * CRANE_SIDE_OFFSET;
    addCylinder(parts, 1.7, CRANE_PEDESTAL_HEIGHT, [positionX, deckY + CRANE_PEDESTAL_HEIGHT / 2, sideZ], "y", 14);
    addBox(covers, [5, 4, 4.4], [positionX, deckY + CRANE_PEDESTAL_HEIGHT + 2, sideZ]);
    const pivot: [number, number, number] = [positionX + direction * 1.8, deckY + CRANE_PEDESTAL_HEIGHT + 1.2, sideZ];
    const slope = 0.16;
    addSlopedBeam(parts, pivot, CRANE_JIB_LENGTH, slope, direction, 1.1);
    // The rest post under the jib's head, and the hook block hanging just inside it.
    const headX = pivot[0] + direction * CRANE_JIB_LENGTH * Math.cos(slope);
    const headY = pivot[1] - CRANE_JIB_LENGTH * Math.sin(slope);
    addBox(parts, [0.5, headY - deckY, 0.5], [headX - direction * 1.2, deckY + (headY - deckY) / 2, sideZ]);
    addBox(parts, [0.8, 1.1, 0.8], [headX - direction * 0.4, headY - 1.2, sideZ]);
  }
}

/**
 * Container stacks in 40 ft bays, two tones mixed so single boxes read, on hatch covers between lashing
 * bridges. Rows fill the beam the hull allows at each bay; tiers drop toward the bow.
 */
function buildContainerShipDeck(parts: PartList, lightBoxes: PartList) {
  const deckY = DEPTH - DRAFT;
  const coamingHeight = 1.2;
  const nextRandom = createSeededRandom(CONTAINER_LAYOUT_SEED);
  const cargoStart = ACCOMMODATION_FRONT_X + 3;
  const cargoEnd = 0.8 * HALF_LENGTH - 4;
  const bayPitch = CONTAINER_BAY_LENGTH + CONTAINER_BAY_GAP;
  const bayCount = Math.floor((cargoEnd - cargoStart) / bayPitch);
  for (let bay = 0; bay < bayCount; bay += 1) {
    const aftX = cargoStart + bay * bayPitch;
    const centerX = aftX + CONTAINER_BAY_LENGTH / 2;
    // The narrowest point of the bay sets how many rows fit, with 1.5 m of side deck left on each side.
    const usableHalfWidth = Math.min(hullHalfBreadth(aftX, DEPTH), hullHalfBreadth(aftX + CONTAINER_BAY_LENGTH, DEPTH)) - 1.5;
    const rowCount = Math.max(2, Math.floor((2 * usableHalfWidth) / CONTAINER_ROW_PITCH));
    const stackWidth = rowCount * CONTAINER_ROW_PITCH;
    addBox(parts, [CONTAINER_BAY_LENGTH, coamingHeight, stackWidth], [centerX, deckY + coamingHeight / 2, 0]);
    // Lashing bridge aft of each bay: a walkway frame two tiers high across the stacks.
    addBox(parts, [0.5, 2 * CONTAINER_TIER_HEIGHT, stackWidth + 0.6], [aftX - CONTAINER_BAY_GAP / 2, deckY + coamingHeight + CONTAINER_TIER_HEIGHT, 0]);
    const bowAmount = clampValue((centerX - 30) / (cargoEnd - 30), 0, 1);
    const tallestTiers = bowAmount > 0.55 ? 2 : bowAmount > 0 ? 3 : 4;
    for (let row = 0; row < rowCount; row += 1) {
      const rowZ = -stackWidth / 2 + CONTAINER_ROW_PITCH * (row + 0.5);
      const tiers = Math.max(1, tallestTiers - (nextRandom() < 0.3 ? 1 : 0));
      for (let tier = 0; tier < tiers; tier += 1) {
        const target = nextRandom() < 0.4 ? lightBoxes : parts;
        const tierY = deckY + coamingHeight + CONTAINER_TIER_HEIGHT * (tier + 0.5);
        // 5 cm shorter than the tier pitch so each box shows a seam above it.
        addBox(target, [CONTAINER_BAY_LENGTH - 0.2, CONTAINER_TIER_HEIGHT - 0.05, CONTAINER_WIDTH], [centerX, tierY, rowZ]);
      }
    }
  }
}

/** Every ship kind's deck; the record type makes a new kind fail to compile until it has one. */
const DECK_BUILDERS: Record<ShipKind, (equipment: PartList, lightParts: PartList) => void> = {
  tanker: (equipment) => buildTankerDeck(equipment),
  "bulk-carrier": buildBulkCarrierDeck,
  "general-cargo": buildGeneralCargoDeck,
  "container-ship": buildContainerShipDeck,
};

/** Forecastle gear every ship carries: windlasses, mooring bitts and the foremast. */
function buildForecastleGear(parts: PartList) {
  const forecastleY = DEPTH + FORECASTLE_RISE - DRAFT;
  for (const side of [-1, 1]) {
    addCylinder(parts, 1.1, 2.2, [HALF_LENGTH - 15, forecastleY + 1.1, side * 4.2], "z", 12);
    addCylinder(parts, 0.45, 1.4, [HALF_LENGTH - 22, forecastleY + 0.7, side * 9], "y", 8);
    addCylinder(parts, 0.45, 1.4, [HALF_LENGTH - 23.6, forecastleY + 0.7, side * 9], "y", 8);
  }
  addCylinder(parts, 0.4, 10, [HALF_LENGTH - 7, forecastleY + 5, 0], "y", 8);
  addBox(parts, [0.3, 0.3, 3], [HALF_LENGTH - 7, forecastleY + 8.6, 0]);
}

export type ShipModel = {
  group: THREE.Group;
  /** Stern point at the waterline, in model metres, where the wake starts. */
  sternLocal: THREE.Vector3;
  /** Port hawse pipe at the bow, in model metres, where the anchor chain leaves the hull. */
  hawseLocal: THREE.Vector3;
};

/** Builds the ship once; callers scale the group (the overview draws it larger than life to read). The viewer frees its GPU memory with the rest of the scene. */
export function buildShipModel(kind: ShipKind): ShipModel {
  // A little sheen so the hull's curves catch the light instead of reading as a flat silhouette.
  const hullMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.18 });
  const transomMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.tankerTopside, roughness: 0.42, metalness: 0.18 });
  const deckMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.tankerDeck, roughness: 0.88, metalness: 0.02, side: THREE.DoubleSide });
  const structureMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.tankerSuperstructure, roughness: 0.7, metalness: 0.02 });
  const equipmentMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.tankerEquipment, roughness: 0.5, metalness: 0.35 });
  const glassMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.tankerGlass, roughness: 0.18, metalness: 0.55 });
  const funnelMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.tankerFunnel, roughness: 0.6, metalness: 0.05 });
  const bandMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.tankerFunnelBand, roughness: 0.6 });
  const lifeboatMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.tankerLifeboat, roughness: 0.55 });

  const superstructure = buildSuperstructure();
  const deckEquipment: PartList = [...buildRailings()];
  DECK_BUILDERS[kind](deckEquipment, superstructure.structure);
  buildForecastleGear(deckEquipment);
  const meshes = [
    new THREE.Mesh(buildHullShell(), hullMaterial),
    new THREE.Mesh(buildTransom(), transomMaterial),
    new THREE.Mesh(buildDeck(), deckMaterial),
    new THREE.Mesh(mergeParts(deckEquipment), equipmentMaterial),
    new THREE.Mesh(mergeParts(superstructure.structure), structureMaterial),
    new THREE.Mesh(mergeParts(superstructure.glass), glassMaterial),
    new THREE.Mesh(mergeParts(superstructure.funnel), funnelMaterial),
    new THREE.Mesh(mergeParts(superstructure.band), bandMaterial),
    new THREE.Mesh(mergeParts(superstructure.lifeboat), lifeboatMaterial),
  ];
  const group = new THREE.Group();
  meshes.forEach((mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
  return {
    group,
    sternLocal: new THREE.Vector3(-HALF_LENGTH, 0, 0),
    hawseLocal: new THREE.Vector3(HALF_LENGTH - 9, DEPTH + FORECASTLE_RISE - DRAFT - 2.5, -11),
  };
}
