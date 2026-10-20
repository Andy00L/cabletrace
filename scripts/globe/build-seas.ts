// Builds public/globe/seas.json, the named seas of the /live globe's Planet and Sea tiers, from Natural Earth.
// Usage: bun scripts/globe/build-seas.ts <path to ne_50m_geography_marine_polys.geojson>
// Source: Natural Earth 1:50m marine areas, v5.1.2 (public domain, https://www.naturalearthdata.com/about/terms-of-use/),
// https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_geography_marine_polys.geojson
// The polygons are drawn into a grid of quarter-degree cells, so the page finds a ship's sea with one array read instead
// of testing 118 polygons. Natural Earth's areas leave gaps along coasts and in ports; each sea grows into the gaps next
// to it, so a ship moored in a harbour still counts for the sea outside it.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Result } from "../../src/lib/result";

// 0.25 degrees is about 28 km at the equator: finer than any sea's label needs, coarse enough to stay under 100 KB.
const CELL_DEGREES = 0.25;
const GRID_WIDTH = 360 / CELL_DEGREES;
const GRID_HEIGHT = 180 / CELL_DEGREES;
// Cells a sea may grow into the gaps around it (8 cells, 2 degrees, about 220 km): enough to reach every port along a
// coast, not enough to claim open water another sea lies closer to.
const GAP_FILL_CELLS = 8;
const OUTPUT_PATH = "public/globe/seas.json";
const NO_SEA = 0;

// Natural Earth splits some seas into their arms; a reader of the Planet tier thinks of the whole sea. The arms count
// for the sea they belong to (IHO's own "Limits of Oceans and Seas" nests them the same way).
const PARENT_SEA: Readonly<Record<string, string>> = {
  "Gulf of Finland": "Baltic Sea",
  "Gulf of Bothnia": "Baltic Sea",
  "Tyrrhenian Sea": "Mediterranean Sea",
  "Adriatic Sea": "Mediterranean Sea",
  "Ionian Sea": "Mediterranean Sea",
  "Aegean Sea": "Mediterranean Sea",
  "Balearic Sea": "Mediterranean Sea",
  "Golfe du Lion": "Mediterranean Sea",
  "Strait of Gibraltar": "Mediterranean Sea",
  "Great Barrier Reef": "Coral Sea",
};
// Natural Earth writes a few names in capitals; the globe shows them in the case every other name uses.
const NAME_FIXES: Readonly<Record<string, string>> = { "SOUTHERN OCEAN": "Southern Ocean", "INDIAN OCEAN": "Indian Ocean" };

type Point = [number, number];
type SeaPolygon = { name: string; rings: Point[][] };
type SeaEntry = { name: string; longitude: number; latitude: number; cellCount: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPoint(value: unknown): Point | null {
  if (!Array.isArray(value)) return null;
  const [longitude, latitude] = value;
  return typeof longitude === "number" && typeof latitude === "number" ? [longitude, latitude] : null;
}

function toRings(value: unknown): Point[][] | null {
  if (!Array.isArray(value)) return null;
  const rings: Point[][] = [];
  for (const ring of value) {
    if (!Array.isArray(ring)) return null;
    const points = ring.map(toPoint);
    if (points.some((point) => point === null)) return null;
    rings.push(points.filter((point): point is Point => point !== null));
  }
  return rings;
}

/** Every polygon of the marine areas with the name of the sea it counts for. */
function readSeaPolygons(geojson: unknown): Result<SeaPolygon[]> {
  if (!isRecord(geojson) || !Array.isArray(geojson.features)) return { ok: false, reason: "not a GeoJSON feature collection" };
  const polygons: SeaPolygon[] = [];
  for (const feature of geojson.features) {
    if (!isRecord(feature) || !isRecord(feature.geometry) || !isRecord(feature.properties)) return { ok: false, reason: "a feature has no geometry or properties" };
    const rawName = feature.properties.name;
    if (typeof rawName !== "string" || rawName.length === 0) return { ok: false, reason: "a feature has no name" };
    const fixedName = NAME_FIXES[rawName] ?? rawName;
    const name = PARENT_SEA[fixedName] ?? fixedName;
    const { type, coordinates } = feature.geometry;
    const polygonList: unknown[] = type === "Polygon" ? [coordinates] : type === "MultiPolygon" && Array.isArray(coordinates) ? coordinates : [];
    for (const rawRings of polygonList) {
      const rings = toRings(rawRings);
      if (!rings) return { ok: false, reason: `${name} has malformed coordinates` };
      polygons.push({ name, rings });
    }
  }
  return { ok: true, value: polygons };
}

/**
 * Fills every cell whose centre lies inside the polygon (even-odd rule over all its rings, so holes stay empty).
 * One scanline per row of cells: the longitudes where the row's latitude crosses an edge, sorted, filled in pairs.
 */
function fillPolygon(grid: Uint8Array, polygon: SeaPolygon, seaId: number): void {
  for (let row = 0; row < GRID_HEIGHT; row += 1) {
    const latitude = 90 - (row + 0.5) * CELL_DEGREES;
    const crossings: number[] = [];
    for (const ring of polygon.rings) {
      for (let index = 0; index < ring.length; index += 1) {
        const start = ring[index];
        const end = ring[(index + 1) % ring.length];
        if (!start || !end) continue;
        if (start[1] > latitude === end[1] > latitude) continue;
        crossings.push(start[0] + ((latitude - start[1]) / (end[1] - start[1])) * (end[0] - start[0]));
      }
    }
    crossings.sort((first, second) => first - second);
    for (let pairIndex = 0; pairIndex + 1 < crossings.length; pairIndex += 2) {
      const firstColumn = Math.max(0, Math.ceil(((crossings[pairIndex] ?? 0) + 180) / CELL_DEGREES - 0.5));
      const lastColumn = Math.min(GRID_WIDTH - 1, Math.floor(((crossings[pairIndex + 1] ?? 0) + 180) / CELL_DEGREES - 0.5));
      for (let column = firstColumn; column <= lastColumn; column += 1) grid[row * GRID_WIDTH + column] = seaId;
    }
  }
}

/** Area of the outer ring in square degrees (shoelace formula); only compared between polygons. */
function measureOuterArea(polygon: SeaPolygon): number {
  const ring = polygon.rings[0] ?? [];
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    if (start && end) twiceArea += start[0] * end[1] - end[0] * start[1];
  }
  return Math.abs(twiceArea) / 2;
}

/** The four neighbours of a cell, wrapping across the antimeridian. */
function forEachNeighbour(cell: number, visit: (neighbour: number) => void): void {
  const row = Math.floor(cell / GRID_WIDTH);
  const column = cell % GRID_WIDTH;
  visit(row * GRID_WIDTH + ((column + 1) % GRID_WIDTH));
  visit(row * GRID_WIDTH + ((column + GRID_WIDTH - 1) % GRID_WIDTH));
  if (row > 0) visit(cell - GRID_WIDTH);
  if (row < GRID_HEIGHT - 1) visit(cell + GRID_WIDTH);
}

/** Grows every sea into the empty cells around it, one ring of cells per pass, nearest sea first. */
function fillGaps(grid: Uint8Array): void {
  for (let pass = 0; pass < GAP_FILL_CELLS; pass += 1) {
    const claims: [number, number][] = [];
    for (let cell = 0; cell < grid.length; cell += 1) {
      if (grid[cell] !== NO_SEA) continue;
      let claimingSea = NO_SEA;
      forEachNeighbour(cell, (neighbour) => {
        const neighbourSea = grid[neighbour] ?? NO_SEA;
        if (claimingSea === NO_SEA && neighbourSea !== NO_SEA) claimingSea = neighbourSea;
      });
      if (claimingSea !== NO_SEA) claims.push([cell, claimingSea]);
    }
    for (const [cell, seaId] of claims) grid[cell] = seaId;
  }
}

/**
 * Where each sea's name goes: the cell of that sea farthest from any other (a breadth-first distance from every cell
 * at its edge), so the label sits in open water and never on a coast. Distances count cells, which is close enough for
 * placing a label.
 */
function placeLabels(grid: Uint8Array, names: readonly string[]): SeaEntry[] {
  const distance = new Int32Array(grid.length).fill(-1);
  const queue = new Int32Array(grid.length);
  let queueEnd = 0;
  for (let cell = 0; cell < grid.length; cell += 1) {
    const seaId = grid[cell] ?? NO_SEA;
    if (seaId === NO_SEA) continue;
    let isEdge = false;
    forEachNeighbour(cell, (neighbour) => {
      if ((grid[neighbour] ?? NO_SEA) !== seaId) isEdge = true;
    });
    if (isEdge) {
      distance[cell] = 0;
      queue[queueEnd] = cell;
      queueEnd += 1;
    }
  }
  for (let queueStart = 0; queueStart < queueEnd; queueStart += 1) {
    const cell = queue[queueStart] ?? 0;
    forEachNeighbour(cell, (neighbour) => {
      if (distance[neighbour] !== -1 || grid[neighbour] !== grid[cell]) return;
      distance[neighbour] = (distance[cell] ?? 0) + 1;
      queue[queueEnd] = neighbour;
      queueEnd += 1;
    });
  }
  const best = names.map(() => ({ cell: -1, distance: -1, cellCount: 0 }));
  for (let cell = 0; cell < grid.length; cell += 1) {
    const entry = best[(grid[cell] ?? NO_SEA) - 1];
    if (!entry) continue;
    entry.cellCount += 1;
    if ((distance[cell] ?? -1) > entry.distance) {
      entry.distance = distance[cell] ?? -1;
      entry.cell = cell;
    }
  }
  return names.map((name, index) => {
    const entry = best[index] ?? { cell: 0, cellCount: 0 };
    const row = Math.floor(entry.cell / GRID_WIDTH);
    const column = entry.cell % GRID_WIDTH;
    return { name, longitude: -180 + (column + 0.5) * CELL_DEGREES, latitude: 90 - (row + 0.5) * CELL_DEGREES, cellCount: entry.cellCount };
  });
}

/**
 * Drops the seas no cell centre fell in (Natural Earth's label-only slivers, such as Luzon Strait), renumbering the
 * grid so ids stay 1 to n. Returns the names left, in id order.
 */
function dropUncoveredSeas(grid: Uint8Array, names: readonly string[]): string[] {
  const isCovered = new Uint8Array(names.length + 1);
  for (const seaId of grid) isCovered[seaId] = 1;
  const newIds = new Uint8Array(names.length + 1);
  const keptNames: string[] = [];
  names.forEach((name, index) => {
    if (isCovered[index + 1] !== 1) return;
    keptNames.push(name);
    newIds[index + 1] = keptNames.length;
  });
  for (let cell = 0; cell < grid.length; cell += 1) grid[cell] = newIds[grid[cell] ?? NO_SEA] ?? NO_SEA;
  return keptNames;
}

/** The grid as run lengths, row after row: [length, seaId, length, seaId, ...]. */
function encodeRuns(grid: Uint8Array): number[] {
  const runs: number[] = [];
  let runSea = grid[0] ?? NO_SEA;
  let runLength = 0;
  for (const seaId of grid) {
    if (seaId === runSea) {
      runLength += 1;
      continue;
    }
    runs.push(runLength, runSea);
    runSea = seaId;
    runLength = 1;
  }
  runs.push(runLength, runSea);
  return runs;
}

async function main(): Promise<number> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("[buildSeas] pass the path to ne_50m_geography_marine_polys.geojson");
    return 2;
  }
  let geojson: unknown;
  try {
    geojson = JSON.parse(await readFile(inputPath, "utf8"));
  } catch (error) {
    console.error(`[buildSeas] could not read ${inputPath}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const polygons = readSeaPolygons(geojson);
  if (!polygons.ok) {
    console.error(`[buildSeas] ${polygons.reason}`);
    return 1;
  }
  const names = [...new Set(polygons.value.map((polygon) => polygon.name))].sort((first, second) => first.localeCompare(second));
  // Sea ids are bytes with 0 for "no sea".
  if (names.length > 255) {
    console.error(`[buildSeas] ${names.length} seas do not fit in a byte`);
    return 1;
  }
  const grid = new Uint8Array(GRID_WIDTH * GRID_HEIGHT);
  // Largest first, so a strait or a gulf drawn inside an ocean's polygon keeps its own cells.
  const largestFirst = [...polygons.value].sort((first, second) => measureOuterArea(second) - measureOuterArea(first));
  for (const polygon of largestFirst) fillPolygon(grid, polygon, names.indexOf(polygon.name) + 1);
  fillGaps(grid);
  const keptNames = dropUncoveredSeas(grid, names);
  const seas = placeLabels(grid, keptNames);
  const runs = encodeRuns(grid);
  const output = JSON.stringify({
    source: "Natural Earth 1:50m marine areas, v5.1.2, public domain",
    cellDegrees: CELL_DEGREES,
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    seas,
    runs,
  });
  await mkdir("public/globe", { recursive: true });
  await writeFile(OUTPUT_PATH, output);
  const droppedNames = names.filter((name) => !keptNames.includes(name));
  console.log(`[buildSeas] ${seas.length} seas, ${runs.length / 2} runs, ${(output.length / 1024).toFixed(0)} KB to ${OUTPUT_PATH}`);
  if (droppedNames.length > 0) console.log(`[buildSeas] dropped, smaller than a cell: ${droppedNames.join(", ")}`);
  return 0;
}

process.exit(await main());
