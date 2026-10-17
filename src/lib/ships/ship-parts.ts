import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { readDeckHeight, readHalfBreadth, type HullForm } from "@/lib/ships/hull-form";
import type { SuperstructurePlacement } from "@/lib/ships/ship-specs";

// Primitives placed on a hull and kept per material for merging, so each material of a ship is one draw call, and
// the superstructure every type builds from them. Coordinates are the hull's: metres, waterline at y = 0.

export type PartList = THREE.BufferGeometry[];

/** The parts of one ship, by the material each is drawn in. */
export type ShipParts = {
  /** Deck gear: cranes, pipes, winches, hatch coamings (steel grey). */
  equipment: PartList;
  /** Accommodation and light-painted covers (off-white). */
  structure: PartList;
  glass: PartList;
  /** Funnels and dark fittings such as rubber fenders. */
  funnel: PartList;
  band: PartList;
  lifeboat: PartList;
};

export function createShipParts(): ShipParts {
  return { equipment: [], structure: [], glass: [], funnel: [], band: [], lifeboat: [] };
}

export function addBox(parts: PartList, size: [number, number, number], center: [number, number, number], rotation?: THREE.Euler) {
  const geometry = new THREE.BoxGeometry(...size);
  if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation));
  geometry.translate(...center);
  parts.push(geometry.toNonIndexed());
  geometry.dispose();
}

export function addCylinder(parts: PartList, radius: number, length: number, center: [number, number, number], axis: "x" | "y" | "z", radialSegments = 10) {
  const geometry = new THREE.CylinderGeometry(radius, radius, length, radialSegments);
  if (axis === "x") geometry.rotateZ(Math.PI / 2);
  if (axis === "z") geometry.rotateX(Math.PI / 2);
  geometry.translate(...center);
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
export function readBridgeFrontX(form: HullForm, placement: SuperstructurePlacement): number {
  switch (placement) {
    case "aft":
      return -form.halfLength + 0.149 * form.lengthMetres;
    case "forward":
      return 0.62 * form.halfLength;
    case "midship":
      return 0.28 * form.halfLength;
    case "full-length":
      return 0.72 * form.halfLength;
    default: {
      const unhandled: never = placement;
      return unhandled;
    }
  }
}

type BlockOptions = { frontX: number; lengthAlongShip: number; tiers: number; baseY: number; withLifeboat: boolean; funnelX: number | null };

/**
 * Stepped accommodation tiers with a window band on each front, the bridge with wings across the beam, a mast with a
 * radar yard, and optionally a funnel aft of it and a freefall lifeboat on a stern ramp.
 */
export function addAccommodationBlock(form: HullForm, parts: ShipParts, options: BlockOptions) {
  const { frontX, lengthAlongShip, tiers, baseY } = options;
  const tierHeight = readTierHeight(form);
  const halfWidthAtFront = readDeckHalfWidth(form, frontX - lengthAlongShip / 2);
  const width = Math.max(4, 2 * halfWidthAtFront * 0.84);
  for (let tier = 0; tier < tiers; tier += 1) {
    const depthAlongShip = lengthAlongShip * (1 - tier * 0.07);
    const tierWidth = width * (1 - tier * 0.022);
    const centerX = frontX - depthAlongShip / 2;
    const centerY = baseY + tier * tierHeight + tierHeight / 2;
    addBox(parts.structure, [depthAlongShip, tierHeight - 0.15, tierWidth], [centerX, centerY, 0]);
    addBox(parts.glass, [0.12, 0.31 * tierHeight, tierWidth * 0.84], [frontX + 0.07, centerY + 0.25, 0]);
  }
  const bridgeDepth = Math.max(4, 0.53 * lengthAlongShip);
  const bridgeHeight = tierHeight * 1.03;
  const bridgeY = baseY + tiers * tierHeight + bridgeHeight / 2;
  const bridgeWidth = Math.min(2 * form.halfBeam * 0.98, width * 1.17);
  addBox(parts.structure, [bridgeDepth, bridgeHeight, bridgeWidth], [frontX - bridgeDepth / 2 - 0.5, bridgeY, 0]);
  addBox(parts.glass, [0.14, 0.45 * bridgeHeight, bridgeWidth * 0.96], [frontX - 0.45, bridgeY + 0.35, 0]);
  addBox(parts.structure, [bridgeDepth * 1.1, 0.35, bridgeWidth * 1.02], [frontX - bridgeDepth / 2 - 0.5, bridgeY + bridgeHeight / 2 + 0.18, 0]);
  // Mast with a radar yard on the bridge roof.
  const mastHeight = Math.max(4, 0.04 * form.lengthMetres);
  const mastX = frontX - 0.6 * bridgeDepth;
  addCylinder(parts.equipment, 0.35, mastHeight, [mastX, bridgeY + bridgeHeight / 2 + mastHeight / 2, 0], "y", 8);
  addBox(parts.equipment, [0.4, 0.4, Math.min(7, bridgeWidth * 0.3)], [mastX, bridgeY + bridgeHeight / 2 + mastHeight * 0.85, 0]);
  if (options.funnelX !== null) addFunnel(form, parts, options.funnelX, baseY, width * 0.45);
  if (options.withLifeboat) {
    const lifeboatLength = Math.min(9.5, 0.04 * form.lengthMetres);
    const lifeboatGeometry = new THREE.CapsuleGeometry(lifeboatLength * 0.16, lifeboatLength * 0.68, 4, 10);
    lifeboatGeometry.rotateZ(Math.PI / 2 - 0.6);
    lifeboatGeometry.translate(-form.halfLength + lifeboatLength * 0.42, baseY + 7.5 * (tierHeight / 2.9), 0);
    parts.lifeboat.push(lifeboatGeometry.toNonIndexed());
    lifeboatGeometry.dispose();
    addBox(parts.equipment, [lifeboatLength * 0.84, 0.4, lifeboatLength * 0.38], [-form.halfLength + lifeboatLength * 0.48, baseY + 6.1 * (tierHeight / 2.9), 0], new THREE.Euler(0, 0, -0.6));
  }
}

/** A funnel raked aft on an engine casing, with a light band and two exhaust pipes. */
export function addFunnel(form: HullForm, parts: ShipParts, funnelX: number, baseY: number, funnelWidth: number) {
  const scale = Math.min(1, form.lengthMetres / 228);
  const casingHeight = 12 * scale;
  const funnelHeight = 10 * Math.max(scale, 0.45);
  const rake = new THREE.Euler(0, 0, 0.08);
  addBox(parts.structure, [8 * scale + 2, casingHeight, funnelWidth * 1.6], [funnelX, baseY + casingHeight / 2, 0]);
  addBox(parts.funnel, [7 * scale + 1.5, funnelHeight, funnelWidth], [funnelX - 0.4, baseY + casingHeight + funnelHeight / 2, 0], rake);
  addBox(parts.band, [7 * scale + 1.58, 0.16 * funnelHeight, funnelWidth + 0.08], [funnelX - 0.75, baseY + casingHeight + 0.76 * funnelHeight, 0], rake);
  addCylinder(parts.funnel, 0.7 * scale + 0.15, 2.4 * scale + 0.5, [funnelX - 1.6 * scale, baseY + casingHeight + funnelHeight + 0.9 * scale, funnelWidth * 0.2], "y", 8);
  addCylinder(parts.funnel, 0.55 * scale + 0.12, 2.2 * scale + 0.5, [funnelX - 1.6 * scale, baseY + casingHeight + funnelHeight + 0.8 * scale, -funnelWidth * 0.22], "y", 8);
}

/** Forecastle gear every ship carries: two windlasses, mooring bitts and a foremast. */
export function addForecastleGear(form: HullForm, parts: ShipParts) {
  const scale = Math.max(0.35, Math.min(1, form.lengthMetres / 228));
  const windlassX = form.halfLength - 15 * scale;
  const forecastleY = readDeckY(form, windlassX);
  const sideOffset = Math.min(4.2 * scale + 0.6, readDeckHalfWidth(form, windlassX) * 0.45);
  for (const side of [-1, 1]) {
    addCylinder(parts.equipment, 1.1 * scale, 2.2 * scale, [windlassX, forecastleY + 1.1 * scale, side * sideOffset], "z", 12);
    const bittX = form.halfLength - 22 * scale;
    const bittZ = side * readDeckHalfWidth(form, bittX) * 0.6;
    addCylinder(parts.equipment, 0.45 * scale, 1.4 * scale, [bittX, readDeckY(form, bittX) + 0.7 * scale, bittZ], "y", 8);
    addCylinder(parts.equipment, 0.45 * scale, 1.4 * scale, [bittX - 1.6 * scale, readDeckY(form, bittX) + 0.7 * scale, bittZ], "y", 8);
  }
  const foremastX = form.halfLength - 7 * scale;
  addCylinder(parts.equipment, 0.4 * scale, 10 * scale, [foremastX, readDeckY(form, foremastX) + 5 * scale, 0], "y", 8);
  addBox(parts.equipment, [0.3, 0.3, 3 * scale], [foremastX, readDeckY(form, foremastX) + 8.6 * scale, 0]);
}

/** Where the port hawse pipe leaves the bow (hull metres): where the anchor chain runs out. */
export function readHawsePoint(form: HullForm): THREE.Vector3 {
  const scale = Math.max(0.35, Math.min(1, form.lengthMetres / 228));
  const hawseX = form.halfLength - 9 * scale;
  const hawseY = readDeckY(form, hawseX) - 2.5 * scale;
  return new THREE.Vector3(hawseX, hawseY, -readHalfBreadth(form, hawseX, hawseY + form.draught) * 0.92);
}
