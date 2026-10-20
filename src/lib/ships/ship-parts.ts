import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { readDeckHeight, readHalfBreadth, type HullForm } from "@/lib/ships/hull-form";
import type { Superstructure } from "@/lib/ships/ship-specs";

// Primitives placed on a hull and kept per material for merging, so each material of a ship is one draw call, and
// the superstructure every type builds from them. Coordinates are the hull's: metres, waterline at y = 0.

export type PartList = THREE.BufferGeometry[];

/** The parts of one ship, by the material each is drawn in (ship-paint.ts). */
export type ShipParts = {
  /** Deck gear: cranes, winches, hatch coamings, masts (grey steel). */
  equipment: PartList;
  /** Accommodation and light-painted covers (off-white). */
  structure: PartList;
  glass: PartList;
  /** Funnels and dark fittings such as rubber fenders. */
  funnel: PartList;
  band: PartList;
  lifeboat: PartList;
  /** Pipework on tanker decks (the dull green of deck pipes). */
  pipes: PartList;
  /** Boxes that carry a colour per vertex (containers). */
  painted: PartList;
};

export function createShipParts(): ShipParts {
  return { equipment: [], structure: [], glass: [], funnel: [], band: [], lifeboat: [], pipes: [], painted: [] };
}

export function addBox(parts: PartList, size: [number, number, number], center: [number, number, number], rotation?: THREE.Euler) {
  const geometry = new THREE.BoxGeometry(...size);
  if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation));
  geometry.translate(...center);
  parts.push(geometry.toNonIndexed());
  geometry.dispose();
}

/** A box with rounded edges (radius in metres): funnels, deckhouses, lifeboat canopies. */
export function addRoundedBox(parts: PartList, size: [number, number, number], center: [number, number, number], radius: number, rotation?: THREE.Euler) {
  const geometry = new RoundedBoxGeometry(size[0], size[1], size[2], 2, Math.min(radius, Math.min(...size) / 2 - 0.01));
  if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation));
  geometry.translate(...center);
  parts.push(geometry.index ? geometry.toNonIndexed() : geometry);
  if (geometry.index) geometry.dispose();
}

export function addCylinder(parts: PartList, radius: number, length: number, center: [number, number, number], axis: "x" | "y" | "z", radialSegments = 10, topRadius = radius) {
  const geometry = new THREE.CylinderGeometry(topRadius, radius, length, radialSegments);
  if (axis === "x") geometry.rotateZ(-Math.PI / 2);
  if (axis === "z") geometry.rotateX(Math.PI / 2);
  geometry.translate(...center);
  parts.push(geometry.toNonIndexed());
  geometry.dispose();
}

/** A pipe along a polyline of points (m), `radius` thick: exhaust goosenecks, hose crane jibs, rails. */
export function addPipe(parts: PartList, points: THREE.Vector3[], radius: number, radialSegments = 6) {
  if (points.length < 2) return;
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const geometry = new THREE.TubeGeometry(curve, Math.max(2, points.length * 4), radius, radialSegments, false);
  parts.push(geometry.toNonIndexed());
  geometry.dispose();
}

/** A beam of the given length from a pivot, sloping down toward +x or -x by `slope` radians. */
export function addSlopedBeam(parts: PartList, pivot: [number, number, number], length: number, slope: number, direction: 1 | -1, size: number) {
  const beam = new THREE.BoxGeometry(length, size, size);
  beam.rotateZ(-direction * slope);
  beam.translate(pivot[0] + direction * (length / 2) * Math.cos(slope), pivot[1] - (length / 2) * Math.sin(slope), pivot[2]);
  parts.push(beam.toNonIndexed());
  beam.dispose();
}

export function mergeParts(parts: PartList): THREE.BufferGeometry {
  const merged = parts.length > 0 ? (mergeGeometries(parts, false) ?? new THREE.BufferGeometry()) : new THREE.BufferGeometry();
  parts.forEach((part) => part.dispose());
  return merged;
}

/** Main deck height above the waterline at a station. */
export function readDeckY(form: HullForm, positionX: number): number {
  return readDeckHeight(form, positionX) - form.draught;
}

/** Half the deck's width at a station, at the deck. */
export function readDeckHalfWidth(form: HullForm, positionX: number): number {
  return readHalfBreadth(form, positionX, readDeckHeight(form, positionX));
}

// The house's proportions, read off Eagle S's photograph and held for every type: the poop and the bridge as shares of
// a tier's height, the share of the house's length each tier above the first steps back from its aft end, the deck
// slabs' thickness and overhang (m, the shadow line between tiers), how far the bridge front rakes out at the roof (m),
// the radar mast's and the funnel's sizes as shares of the ship's length.
const POOP_HEIGHT_TIERS = 0.78;
// The open aft mooring deck behind the poop, as a share of the length from the stern (4.5% on Eagle S).
const POOP_AFT_TO_LENGTH = 0.045;
const BRIDGE_HEIGHT_TIERS = 0.88;
const TIER_STEP_BACK_SHARE = 0.06;
const SLAB_THICKNESS_METRES = 0.25;
const SLAB_OVERHANG_METRES = 0.45;
const BRIDGE_FRONT_RAKE_METRES = 0.7;
const MAST_HEIGHT_TO_LENGTH = 0.056;
const FUNNEL_LENGTH_TO_LENGTH = 0.034;

// Accommodation tiers (m): 2.9 on seagoing ships, 2.5 on small craft under 60 m.
export function readTierHeight(form: HullForm): number {
  return form.lengthMetres < 60 ? 2.5 : 2.9;
}

/** Where the bridge front stands for each placement (m, hull x). */
export function readBridgeFrontX(form: HullForm, superstructure: Superstructure): number {
  switch (superstructure.placement) {
    case "aft":
      return -form.halfLength + superstructure.frontFromSternShare * form.lengthMetres;
    case "forward":
      return 0.62 * form.halfLength;
    case "midship":
      return 0.28 * form.halfLength;
    case "full-length":
      return 0.72 * form.halfLength;
    default: {
      const unhandled: never = superstructure;
      return unhandled;
    }
  }
}

/** One deck level of a house: its front, its length along the ship, its width, and its floor and roof heights (m). */
export type HouseLevel = { frontX: number; lengthAlong: number; width: number; floorY: number; roofY: number };

/**
 * What the detail level needs to dress a house (windows, rails, wings, mast gear, lifeboats): every level, the
 * bridge with its wings, the mast and the funnel.
 */
export type HouseLayout = {
  levels: HouseLevel[];
  bridge: HouseLevel & { wingHalfSpan: number };
  mast: { x: number; baseY: number; topY: number };
  funnel: FunnelLayout | null;
  withLifeboats: boolean;
};

export type FunnelLayout = { x: number; baseY: number; topY: number; lengthAlong: number; width: number };

/** Where a funnel's band sits on its stack and how tall it is (shares of the stack's height from its foot). */
export type FunnelBand = { atShare: number; heightShare: number };

/** A light band near the top of the stack, as most lines paint it. */
export const DEFAULT_FUNNEL_BAND: FunnelBand = { atShare: 0.72, heightShare: 0.12 };

type BlockOptions = {
  frontX: number;
  lengthAlongShip: number;
  tiers: number;
  baseY: number;
  withLifeboat: boolean;
  /** The funnel's centre (m, hull x), how high it rises above the bridge roof and its band, or null for none. */
  funnel: { x: number; riseAboveBridge: number; band: FunnelBand } | null;
  /** An aft house stands on a poop: a raised deck from the house front to the stern, the full width of the hull. */
  hasPoop: boolean;
};

/**
 * Stepped accommodation tiers, the bridge with wings across the beam, a mast, and optionally a poop under them, a
 * funnel and lifeboats. Returns the layout the detail level dresses.
 */
export function addAccommodationBlock(form: HullForm, parts: ShipParts, options: BlockOptions): HouseLayout {
  const { frontX, lengthAlongShip, tiers, hasPoop } = options;
  const tierHeight = readTierHeight(form);
  const halfWidthAtFront = readDeckHalfWidth(form, frontX - lengthAlongShip / 2);
  const width = Math.max(4, 2 * halfWidthAtFront * 0.84);
  const levels: HouseLevel[] = [];
  let floorY = options.baseY;
  if (hasPoop) {
    // The poop: from the aft mooring deck (left open on the main deck at the stern) to the house front, inside the
    // hull's side by 0.2 m.
    const sternX = -form.halfLength + POOP_AFT_TO_LENGTH * form.lengthMetres;
    const poopHeight = tierHeight * POOP_HEIGHT_TIERS;
    const steps = 8;
    for (let step = 0; step < steps; step += 1) {
      const fromX = sternX + ((frontX - sternX) * step) / steps;
      const toX = sternX + ((frontX - sternX) * (step + 1)) / steps;
      const halfWidth = Math.min(readDeckHalfWidth(form, fromX), readDeckHalfWidth(form, toX)) - 0.2;
      addBox(parts.structure, [toX - fromX + 0.02, poopHeight, 2 * halfWidth], [(fromX + toX) / 2, floorY + poopHeight / 2, 0]);
    }
    levels.push({ frontX, lengthAlong: frontX - sternX, width: 2 * (readDeckHalfWidth(form, frontX) - 0.2), floorY, roofY: floorY + poopHeight });
    floorY += poopHeight;
  }
  const houseTiers = hasPoop ? Math.max(1, tiers - 1) : tiers;
  // The top tier stops at the funnel's aft side, as on Eagle S's photograph (addFunnel sizes the funnel the same way).
  const funnelAftX = options.funnel ? options.funnel.x - (Math.max(2.5, FUNNEL_LENGTH_TO_LENGTH * form.lengthMetres) / 2) : null;
  for (let tier = 0; tier < houseTiers; tier += 1) {
    // Upper tiers step back from the aft end (the funnel casing and boat decks stand behind them) and from the front by
    // a little, and narrow by a frame, as house decks do.
    const steppedLength = lengthAlongShip * (1 - tier * TIER_STEP_BACK_SHARE);
    const isTopTier = tier === houseTiers - 1 && houseTiers > 1;
    const lengthAlong = isTopTier && funnelAftX !== null ? Math.min(steppedLength, frontX - tier * 0.15 - funnelAftX) : steppedLength;
    const tierWidth = width * (1 - tier * 0.02);
    const tierFrontX = frontX - tier * 0.15;
    addBox(parts.structure, [lengthAlong, tierHeight - SLAB_THICKNESS_METRES, tierWidth], [tierFrontX - lengthAlong / 2, floorY + (tierHeight - SLAB_THICKNESS_METRES) / 2, 0]);
    // The deck slab of the level above overhangs all round: the shadow line between tiers.
    addBox(parts.structure, [lengthAlong + 2 * SLAB_OVERHANG_METRES, SLAB_THICKNESS_METRES, tierWidth + 2 * SLAB_OVERHANG_METRES], [tierFrontX - lengthAlong / 2, floorY + tierHeight - SLAB_THICKNESS_METRES / 2, 0]);
    levels.push({ frontX: tierFrontX, lengthAlong, width: tierWidth, floorY, roofY: floorY + tierHeight - SLAB_THICKNESS_METRES });
    floorY += tierHeight;
  }
  // The bridge: a deep deck across the full beam (the wings reach the ship's sides), its front raked out at the top.
  const bridgeDepth = Math.max(4, 0.42 * lengthAlongShip);
  const bridgeHeight = tierHeight * BRIDGE_HEIGHT_TIERS;
  const bridgeWidth = Math.min(2 * form.halfBeam * 0.98, width * 1.04);
  const bridgeFrontX = frontX - houseTiers * 0.15;
  const bridgeCenterX = bridgeFrontX - bridgeDepth / 2;
  addBox(parts.structure, [bridgeDepth, bridgeHeight, bridgeWidth], [bridgeCenterX, floorY + bridgeHeight / 2, 0]);
  addRakedFront(parts, { frontX: bridgeFrontX, floorY, roofY: floorY + bridgeHeight, width: bridgeWidth });
  addBox(parts.structure, [bridgeDepth * 1.08 + BRIDGE_FRONT_RAKE_METRES, 0.35, bridgeWidth * 1.02], [bridgeCenterX - 0.1 + BRIDGE_FRONT_RAKE_METRES / 2, floorY + bridgeHeight + 0.17, 0]);
  const wingHalfSpan = Math.max(bridgeWidth / 2, readDeckHalfWidth(form, bridgeFrontX) + 0.4);
  // The wings: a deck and a plated front reaching out to the ship's sides on both sides.
  for (const side of [-1, 1]) {
    const wingLength = wingHalfSpan - bridgeWidth / 2;
    if (wingLength <= 0.2) continue;
    const wingZ = side * (bridgeWidth / 2 + wingLength / 2);
    addBox(parts.structure, [3.2, 0.3, wingLength], [bridgeFrontX - 1.6, floorY + 0.15, wingZ]);
    addBox(parts.structure, [0.25, 1.15, wingLength], [bridgeFrontX - 0.15, floorY + 0.85, wingZ]);
    // The wing cab at the end: a small enclosed box with its own window band.
    addBox(parts.structure, [2.6, bridgeHeight * 0.9, 2.2], [bridgeFrontX - 1.4, floorY + bridgeHeight * 0.45, side * (wingHalfSpan - 1.1)]);
  }
  const bridge = { frontX: bridgeFrontX, lengthAlong: bridgeDepth, width: bridgeWidth, floorY, roofY: floorY + bridgeHeight, wingHalfSpan };
  // The radar mast on the bridge roof: a tapered post, its platform and yard.
  const mastHeight = Math.max(4, MAST_HEIGHT_TO_LENGTH * form.lengthMetres);
  const mastX = bridgeFrontX - 0.89 * bridgeDepth;
  const mastBaseY = bridge.roofY + 0.35;
  // A tapered tower, wide at the foot, with a platform for each scanner (Eagle S's photograph shows a tower about 3 m
  // across at the foot carrying two platforms, the lower one reaching forward under the radar scanner).
  const mastFootRadius = Math.max(0.45, 0.0065 * form.lengthMetres);
  // The tower to 60% of the height, then a pole set back toward the stern by half the tower's foot to the top.
  const towerHeight = 0.6 * mastHeight;
  addCylinder(parts.equipment, mastFootRadius, towerHeight, [mastX, mastBaseY + towerHeight / 2, 0], "y", 8, mastFootRadius * 0.55);
  const poleX = mastX - mastFootRadius * 0.5;
  addCylinder(parts.equipment, mastFootRadius * 0.4, mastHeight - towerHeight + 0.4, [poleX, mastBaseY + (towerHeight + mastHeight) / 2 - 0.2, 0], "y", 6, mastFootRadius * 0.2);
  addBox(parts.equipment, [mastFootRadius * 3.2, 0.25, mastFootRadius * 4], [mastX, mastBaseY + mastHeight * 0.38, 0]);
  // The radar scanner's housing, reaching forward off the tower's top platform.
  addBox(parts.equipment, [mastFootRadius * 1.7, 1.4, mastFootRadius * 0.8], [mastX + mastFootRadius * 0.85, mastBaseY + towerHeight - 0.5, 0]);
  addBox(parts.equipment, [mastFootRadius * 2.4, 0.2, mastFootRadius * 3], [mastX, mastBaseY + towerHeight, 0]);
  addBox(parts.equipment, [0.3, 0.3, Math.min(7, bridgeWidth * 0.3)], [poleX, mastBaseY + mastHeight * 0.85, 0]);
  const funnel = options.funnel ? addFunnel(form, parts, { x: options.funnel.x, baseY: options.baseY, topY: bridge.roofY + options.funnel.riseAboveBridge, width: width * 0.36, band: options.funnel.band }) : null;
  return { levels, bridge, mast: { x: mastX, baseY: mastBaseY, topY: mastBaseY + mastHeight }, funnel, withLifeboats: options.withLifeboat };
}

/**
 * A funnel: the engine casing up from `baseY`, then a round-cornered stack raked a few degrees aft up to `topY`, with
 * a light band near its top and two exhaust uptakes turning aft over the rim (the goosenecks of Eagle S's funnel).
 */
export function addFunnel(form: HullForm, parts: ShipParts, options: { x: number; baseY: number; topY: number; width: number; band: FunnelBand }): FunnelLayout {
  const { x, baseY, topY, width, band } = options;
  const scale = Math.min(1, form.lengthMetres / 228);
  const lengthAlong = Math.max(2.5, FUNNEL_LENGTH_TO_LENGTH * form.lengthMetres);
  const casingTopY = baseY + (topY - baseY) * 0.55;
  addBox(parts.structure, [lengthAlong * 1.1, casingTopY - baseY, width * 1.25], [x, (baseY + casingTopY) / 2, 0]);
  const stackHeight = topY - casingTopY;
  const rake = new THREE.Euler(0, 0, 0.06);
  addRoundedBox(parts.funnel, [lengthAlong, stackHeight, width], [x - 0.2, casingTopY + stackHeight / 2, 0], Math.min(1.2, width * 0.2), rake);
  const bandCentreShare = band.atShare + band.heightShare / 2;
  addRoundedBox(parts.band, [lengthAlong + 0.08, band.heightShare * stackHeight, width + 0.08], [x - 0.2 - 0.06 * stackHeight * (bandCentreShare - 0.5), casingTopY + bandCentreShare * stackHeight, 0], Math.min(1.2, width * 0.2), rake);
  // Two uptakes rise just clear of the top over its forward half and bend aft (Eagle S's photograph: about 1 m over
  // the rim).
  for (const side of [-1, 1]) {
    const pipeRadius = 0.55 * scale + 0.15;
    const startX = x + 0.15 * lengthAlong;
    const pipeZ = side * width * 0.2;
    addPipe(
      parts.funnel,
      [new THREE.Vector3(startX, topY - 0.5, pipeZ), new THREE.Vector3(startX, topY + 1.0 * scale + 0.3, pipeZ), new THREE.Vector3(startX - 0.8 * scale - 0.3, topY + 1.5 * scale + 0.35, pipeZ), new THREE.Vector3(startX - 1.6 * scale - 0.6, topY + 1.4 * scale + 0.3, pipeZ)],
      pipeRadius,
      8,
    );
  }
  return { x, baseY, topY, lengthAlong, width };
}

/**
 * A bridge front raked out at the top, as bridge windows are to keep the glare off them: a wedge across the bridge
 * from 35% of its height up to the roof, leaning BRIDGE_FRONT_RAKE_METRES forward, glazed on its sloping face.
 */
function addRakedFront(parts: ShipParts, bridge: { frontX: number; floorY: number; roofY: number; width: number }) {
  const footY = bridge.floorY + 0.35 * (bridge.roofY - bridge.floorY);
  const profile = new THREE.Shape([new THREE.Vector2(0, footY), new THREE.Vector2(BRIDGE_FRONT_RAKE_METRES, bridge.roofY), new THREE.Vector2(0, bridge.roofY)]);
  const wedge = new THREE.ExtrudeGeometry(profile, { depth: bridge.width, bevelEnabled: false });
  wedge.translate(bridge.frontX, 0, -bridge.width / 2);
  parts.structure.push(wedge.toNonIndexed());
  wedge.dispose();
  // The glazing on the sloping face, set just proud of it, with a frame band left above and below.
  const slopeLength = Math.hypot(BRIDGE_FRONT_RAKE_METRES, bridge.roofY - footY);
  const lean = Math.atan2(BRIDGE_FRONT_RAKE_METRES, bridge.roofY - footY);
  const centreShare = 0.55;
  addBox(parts.glass, [0.08, slopeLength * 0.62, bridge.width * 0.96], [bridge.frontX + BRIDGE_FRONT_RAKE_METRES * centreShare + 0.05, footY + (bridge.roofY - footY) * centreShare, 0], new THREE.Euler(0, 0, -lean));
}

/** Forecastle gear every ship carries: two windlasses, mooring bitts, a breakwater and a foremast. */
export function addForecastleGear(form: HullForm, parts: ShipParts) {
  const scale = Math.max(0.35, Math.min(1, form.lengthMetres / 228));
  const windlassX = form.halfLength - 15 * scale;
  const forecastleY = readDeckY(form, windlassX);
  const sideOffset = Math.min(4.2 * scale + 0.6, readDeckHalfWidth(form, windlassX) * 0.45);
  for (const side of [-1, 1]) {
    addCylinder(parts.equipment, 1.1 * scale, 2.2 * scale, [windlassX, forecastleY + 1.1 * scale, side * sideOffset], "z", 12);
    addBox(parts.equipment, [2.2 * scale, 1.0 * scale, 1.4 * scale], [windlassX - 1.6 * scale, forecastleY + 0.5 * scale, side * sideOffset]);
    const bittX = form.halfLength - 22 * scale;
    const bittZ = side * readDeckHalfWidth(form, bittX) * 0.6;
    addCylinder(parts.equipment, 0.45 * scale, 1.4 * scale, [bittX, readDeckY(form, bittX) + 0.7 * scale, bittZ], "y", 8);
    addCylinder(parts.equipment, 0.45 * scale, 1.4 * scale, [bittX - 1.6 * scale, readDeckY(form, bittX) + 0.7 * scale, bittZ], "y", 8);
  }
  // A V-shaped breakwater across the deck just aft of the forecastle, its point forward.
  if (form.lengthMetres > 90) {
    const apexX = form.forecastleStartX - 0.04 * form.halfLength;
    const halfWidth = readDeckHalfWidth(form, apexX) * 0.9;
    const breakwaterHeight = 1.6 * scale + 0.4;
    for (const side of [-1, 1]) {
      // Each leg runs from the apex aft and out to the side; a box's length lies along x, turned about y onto the leg.
      const legAlong = -0.25 * halfWidth;
      const legAcross = side * halfWidth;
      addBox(parts.structure, [Math.hypot(legAlong, legAcross), breakwaterHeight, 0.2], [apexX + legAlong / 2, readDeckY(form, apexX) + breakwaterHeight / 2, legAcross / 2], new THREE.Euler(0, Math.atan2(-legAcross, legAlong), 0));
    }
  }
  // The foremast: a tall post on the forecastle with a yard and the masthead light.
  // On Eagle S it stands 5.5% of the length aft of the stem's top.
  const foremastX = form.bowX - 0.055 * form.lengthMetres;
  const foremastHeight = Math.max(4, 0.052 * form.lengthMetres);
  addCylinder(parts.equipment, 0.42 * scale + 0.08, foremastHeight, [foremastX, readDeckY(form, foremastX) + foremastHeight / 2, 0], "y", 8, 0.2 * scale + 0.06);
  addBox(parts.equipment, [0.25, 0.25, 3.2 * scale], [foremastX, readDeckY(form, foremastX) + foremastHeight * 0.8, 0]);
  addBox(parts.equipment, [1.4 * scale, 0.15, 1.4 * scale], [foremastX, readDeckY(form, foremastX) + foremastHeight * 0.55, 0]);
}

/** Where the port hawse pipe leaves the bow (hull metres): where the anchor chain runs out. */
export function readHawsePoint(form: HullForm): THREE.Vector3 {
  const scale = Math.max(0.35, Math.min(1, form.lengthMetres / 228));
  const hawseX = form.halfLength - 9 * scale;
  const hawseY = readDeckY(form, hawseX) - 2.5 * scale;
  return new THREE.Vector3(hawseX, hawseY, -readHalfBreadth(form, hawseX, hawseY + form.draught) * 0.92);
}
