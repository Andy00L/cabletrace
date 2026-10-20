import * as THREE from "three";
import { smoothStep } from "@/lib/seabed/math";
import type { HullForm } from "@/lib/ships/hull-form";
import { readDeckY, type HouseLayout } from "@/lib/ships/ship-parts";

// Soft ambient occlusion baked into a ship's vertex colours, cheap enough for every tier: light is shut out where a
// wall meets the floor it stands on (the deck, the poop, each house level) and under every overhang. Each vertex is
// darkened by its height over the nearest floor below it, and faces turned down (slab undersides, the jib's belly) are
// darkened again. The materials that carry it multiply their colour by it (ship-paint.ts, vertexColors).

// The shade at a floor (multiplier at height 0) and the height (m) over which it lifts to none.
const FLOOR_SHADE = 0.62;
const FLOOR_SHADE_HEIGHT_METRES = 1.8;
// Faces whose normal points down by more than this (its y below minus this) take this extra shade.
const DOWNWARD_NORMAL_Y = -0.5;
const DOWNWARD_SHADE = 0.72;

/** The height (m, hull coordinates) of the nearest floor under a point: the deck, or a house level standing over it. */
export type FloorReader = (positionX: number, positionY: number) => number;

/** Floors for a ship: its main deck along the length and, inside the house's span, each level's floor and the bridge's. */
export function createFloorReader(form: HullForm, house: HouseLayout | null): FloorReader {
  const levels = house ? [...house.levels, house.bridge] : [];
  return (positionX, positionY) => {
    let floorY = readDeckY(form, positionX);
    for (const level of levels) {
      const isOver = positionX <= level.frontX + 0.6 && positionX >= level.frontX - level.lengthAlong - 0.6;
      if (isOver && level.floorY <= positionY + 0.01 && level.floorY > floorY) floorY = level.floorY;
    }
    return floorY;
  };
}

/** Writes the contact shade of every vertex of a non-indexed geometry into its colour attribute (grey levels). */
export function bakeContactShade(geometry: THREE.BufferGeometry, readFloorBelow: FloorReader): void {
  const positions = geometry.getAttribute("position");
  if (!positions) return;
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const normals = geometry.getAttribute("normal");
  const shades = new Float32Array(positions.count * 3);
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    const positionX = positions.getX(vertex);
    const positionY = positions.getY(vertex);
    const heightOverFloor = Math.max(0, positionY - readFloorBelow(positionX, positionY));
    let shade = FLOOR_SHADE + (1 - FLOOR_SHADE) * smoothStep(0, FLOOR_SHADE_HEIGHT_METRES, heightOverFloor);
    if (normals.getY(vertex) < DOWNWARD_NORMAL_Y) shade *= DOWNWARD_SHADE;
    shades.fill(shade, vertex * 3, vertex * 3 + 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(shades, 3));
}
