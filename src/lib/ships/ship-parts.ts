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

type BlockOptions = {
  frontX: number;
  lengthAlongShip: number;
  tiers: number;
  baseY: number;
  withLifeboat: boolean;
  /** The funnel's centre (m, hull x) and how high it rises above the bridge roof, or null for none. */
  funnel: { x: number; riseAboveBridge: number } | null;
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
    // The poop: from 1 m inside the transom to the house front, inside the hull's side by 0.2 m.
    const sternX = -form.halfLength + 1;
    const poopHeight = tierHeight * 0.9;
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
  for (let tier = 0; tier < houseTiers; tier += 1) {
    // Upper tiers step back from the front a little and narrow by a frame, as house decks do.
    const lengthAlong = lengthAlongShip * (1 - tier * 0.05);
    const tierWidth = width * (1 - tier * 0.02);
    const tierFrontX = frontX - tier * 0.15;
    addBox(parts.structure, [lengthAlong, tierHeight - 0.12, tierWidth], [tierFrontX - lengthAlong / 2, floorY + (tierHeight - 0.12) / 2, 0]);
    // The deck slab of the level above overhangs by 0.3 m all round: the dark line between tiers.
    addBox(parts.structure, [lengthAlong + 0.5, 0.18, tierWidth + 0.5], [tierFrontX - lengthAlong / 2, floorY + tierHeight - 0.06, 0]);
    levels.push({ frontX: tierFrontX, lengthAlong, width: tierWidth, floorY, roofY: floorY + tierHeight - 0.12 });
    floorY += tierHeight;
  }
  // The bridge: a deep deck across the full beam (the wings reach the ship's sides), its front window band leaning out.
  const bridgeDepth = Math.max(4, 0.42 * lengthAlongShip);
  const bridgeHeight = tierHeight * 1.05;
  const bridgeWidth = Math.min(2 * form.halfBeam * 0.98, width * 1.04);
  const bridgeFrontX = frontX - houseTiers * 0.15;
  const bridgeCenterX = bridgeFrontX - bridgeDepth / 2;
  addBox(parts.structure, [bridgeDepth, bridgeHeight, bridgeWidth], [bridgeCenterX, floorY + bridgeHeight / 2, 0]);
  addBox(parts.structure, [bridgeDepth * 1.08, 0.35, bridgeWidth * 1.02], [bridgeCenterX - 0.1, floorY + bridgeHeight + 0.17, 0]);
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
  const mastHeight = Math.max(4, 0.04 * form.lengthMetres);
  const mastX = bridgeFrontX - 0.62 * bridgeDepth;
  const mastBaseY = bridge.roofY + 0.35;
  addCylinder(parts.equipment, 0.45, mastHeight, [mastX, mastBaseY + mastHeight / 2, 0], "y", 8, 0.22);
  addBox(parts.equipment, [1.6, 0.18, 2.4], [mastX, mastBaseY + mastHeight * 0.55, 0]);
  addBox(parts.equipment, [0.3, 0.3, Math.min(7, bridgeWidth * 0.3)], [mastX, mastBaseY + mastHeight * 0.85, 0]);
  const funnel = options.funnel ? addFunnel(form, parts, { x: options.funnel.x, baseY: options.baseY, topY: bridge.roofY + options.funnel.riseAboveBridge, width: width * 0.36 }) : null;
  return { levels, bridge, mast: { x: mastX, baseY: mastBaseY, topY: mastBaseY + mastHeight }, funnel, withLifeboats: options.withLifeboat };
}

/**
 * A funnel: the engine casing up from `baseY`, then a round-cornered stack raked a few degrees aft up to `topY`, with
 * a light band near its top and two exhaust uptakes turning aft over the rim (the goosenecks of Eagle S's funnel).
 */
export function addFunnel(form: HullForm, parts: ShipParts, options: { x: number; baseY: number; topY: number; width: number }): FunnelLayout {
  const { x, baseY, topY, width } = options;
  const scale = Math.min(1, form.lengthMetres / 228);
  const lengthAlong = Math.max(2.5, 0.028 * form.lengthMetres);
  const casingTopY = baseY + (topY - baseY) * 0.55;
  addBox(parts.structure, [lengthAlong * 1.5, casingTopY - baseY, width * 1.25], [x, (baseY + casingTopY) / 2, 0]);
  const stackHeight = topY - casingTopY;
  const rake = new THREE.Euler(0, 0, 0.06);
  addRoundedBox(parts.funnel, [lengthAlong, stackHeight, width], [x - 0.2, casingTopY + stackHeight / 2, 0], Math.min(1.2, width * 0.2), rake);
  addRoundedBox(parts.band, [lengthAlong + 0.08, 0.12 * stackHeight, width + 0.08], [x - 0.2 - 0.06 * stackHeight * 0.7, casingTopY + 0.72 * stackHeight, 0], Math.min(1.2, width * 0.2), rake);
  // Two uptakes rise out of the top and bend aft.
  for (const side of [-1, 1]) {
    const pipeRadius = 0.55 * scale + 0.15;
    const startX = x - 0.1 * lengthAlong;
    const pipeZ = side * width * 0.2;
    addPipe(
      parts.funnel,
      [new THREE.Vector3(startX, topY - 0.5, pipeZ), new THREE.Vector3(startX, topY + 1.6 * scale + 0.4, pipeZ), new THREE.Vector3(startX - 0.8 * scale - 0.3, topY + 2.3 * scale + 0.5, pipeZ), new THREE.Vector3(startX - 1.6 * scale - 0.6, topY + 2.2 * scale + 0.45, pipeZ)],
      pipeRadius,
      8,
    );
  }
  return { x, baseY, topY, lengthAlong, width };
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
  const foremastX = form.halfLength - 0.045 * form.lengthMetres;
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
