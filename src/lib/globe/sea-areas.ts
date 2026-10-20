import { COORDINATE_UNITS_PER_DEGREE, type ShipFrameColumns } from "@/lib/live/snapshot-codec";
import { isInsideBox, type BoundingBox } from "@/lib/regions/region";
import type { Result } from "@/lib/result";

// The named seas of the Planet and Sea tiers: a grid of quarter-degree cells, each holding the sea it belongs to,
// built from Natural Earth's marine areas by scripts/globe/build-seas.ts (public/globe/seas.json). One array read finds a
// ship's sea, so counting the 10,000 ships of a frame costs well under a millisecond.

/** The columns of a frame that place its ships. */
type FramePositions = Pick<ShipFrameColumns, "shipCount" | "longitudeUnits" | "latitudeUnits">;

/** A named sea and the open-water cell its label sits on. */
export type SeaArea = { name: string; longitude: number; latitude: number; cellCount: number };

export type SeaAreas = {
  seas: readonly SeaArea[];
  cellDegrees: number;
  width: number;
  height: number;
  /** Row after row from the north pole, west to east from -180: 0 for no sea, else the sea's index plus one. */
  grid: Uint8Array;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSea(value: unknown): SeaArea | null {
  if (!isRecord(value)) return null;
  const { name, longitude, latitude, cellCount } = value;
  if (typeof name !== "string" || typeof longitude !== "number" || typeof latitude !== "number" || typeof cellCount !== "number") return null;
  return { name, longitude, latitude, cellCount };
}

/** Reads seas.json; the run lengths must fill the grid exactly and every id must name a sea. Never throws. */
export function parseSeaAreas(json: unknown): Result<SeaAreas> {
  if (!isRecord(json)) return { ok: false, reason: "seas.json is not an object" };
  const { cellDegrees, width, height, seas, runs } = json;
  if (typeof cellDegrees !== "number" || typeof width !== "number" || typeof height !== "number" || !Array.isArray(seas) || !Array.isArray(runs)) {
    return { ok: false, reason: "seas.json lacks its grid size, seas or runs" };
  }
  const parsedSeas = seas.map(readSea);
  if (parsedSeas.some((sea) => sea === null)) return { ok: false, reason: "seas.json holds a malformed sea" };
  const grid = new Uint8Array(width * height);
  let cell = 0;
  for (let index = 0; index + 1 < runs.length; index += 2) {
    const runLength = runs[index];
    const seaId = runs[index + 1];
    if (typeof runLength !== "number" || typeof seaId !== "number" || seaId < 0 || seaId > parsedSeas.length || cell + runLength > grid.length) {
      return { ok: false, reason: `seas.json has a bad run at ${index}` };
    }
    grid.fill(seaId, cell, cell + runLength);
    cell += runLength;
  }
  if (cell !== grid.length) return { ok: false, reason: `seas.json fills ${cell} of ${grid.length} cells` };
  return { ok: true, value: { seas: parsedSeas.filter((sea): sea is SeaArea => sea !== null), cellDegrees, width, height, grid } };
}

/** Index in `areas.seas` of the sea at a point, or -1 on land or in water no sea claims. */
export function findSeaIndex(areas: SeaAreas, longitude: number, latitude: number): number {
  const column = Math.min(areas.width - 1, Math.max(0, Math.floor((longitude + 180) / areas.cellDegrees)));
  const row = Math.min(areas.height - 1, Math.max(0, Math.floor((90 - latitude) / areas.cellDegrees)));
  return (areas.grid[row * areas.width + column] ?? 0) - 1;
}

/** How many of a frame's ships each sea holds, indexed as `areas.seas`. */
export function countShipsBySea(areas: SeaAreas, frame: FramePositions): Uint32Array {
  const counts = new Uint32Array(areas.seas.length);
  for (let shipIndex = 0; shipIndex < frame.shipCount; shipIndex += 1) {
    const seaIndex = findSeaIndex(areas, (frame.longitudeUnits[shipIndex] ?? 0) / COORDINATE_UNITS_PER_DEGREE, (frame.latitudeUnits[shipIndex] ?? 0) / COORDINATE_UNITS_PER_DEGREE);
    if (seaIndex >= 0) counts[seaIndex] = (counts[seaIndex] ?? 0) + 1;
  }
  return counts;
}

export type SeaCount = { seaIndex: number; sea: SeaArea; shipCount: number };

/** The seas holding ships, busiest first. */
export function rankSeasByShips(areas: SeaAreas, counts: Uint32Array): SeaCount[] {
  return areas.seas
    .map((sea, seaIndex) => ({ seaIndex, sea, shipCount: counts[seaIndex] ?? 0 }))
    .filter((entry) => entry.shipCount > 0)
    .sort((first, second) => second.shipCount - first.shipCount);
}

/** How many of a frame's ships each box holds (a watched region's ships at the Sea tier), keyed as given. */
export function countShipsInBoxes(frame: FramePositions, boxes: readonly { id: string; box: BoundingBox }[]): Map<string, number> {
  const counts = new Map(boxes.map((entry) => [entry.id, 0]));
  for (let shipIndex = 0; shipIndex < frame.shipCount; shipIndex += 1) {
    const longitude = (frame.longitudeUnits[shipIndex] ?? 0) / COORDINATE_UNITS_PER_DEGREE;
    const latitude = (frame.latitudeUnits[shipIndex] ?? 0) / COORDINATE_UNITS_PER_DEGREE;
    const holder = boxes.find((entry) => isInsideBox(entry.box, longitude, latitude));
    if (holder) counts.set(holder.id, (counts.get(holder.id) ?? 0) + 1);
  }
  return counts;
}

// A box is sampled on a 7 by 7 grid of points to measure how much of it lies in a sea.
const BOX_SAMPLES_PER_SIDE = 7;

/** The share of a box (0 to 1) that lies in a sea: a watched region counts for every sea that holds a fair part of it. */
export function measureSeaShare(areas: SeaAreas, box: BoundingBox, seaIndex: number): number {
  let insideCount = 0;
  for (let row = 0; row < BOX_SAMPLES_PER_SIDE; row += 1) {
    for (let column = 0; column < BOX_SAMPLES_PER_SIDE; column += 1) {
      const longitude = box.west + ((column + 0.5) / BOX_SAMPLES_PER_SIDE) * (box.east - box.west);
      const latitude = box.south + ((row + 0.5) / BOX_SAMPLES_PER_SIDE) * (box.north - box.south);
      if (findSeaIndex(areas, longitude, latitude) === seaIndex) insideCount += 1;
    }
  }
  return insideCount / (BOX_SAMPLES_PER_SIDE * BOX_SAMPLES_PER_SIDE);
}
