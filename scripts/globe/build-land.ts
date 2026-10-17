// Builds public/globe/land.json, the land outline the /live globe paints, from Natural Earth.
// Usage: bun scripts/globe/build-land.ts <path to ne_50m_land.geojson>
// Source: Natural Earth 1:50m land, v5.1.2 (public domain, https://www.naturalearthdata.com/about/terms-of-use/),
// https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_land.geojson
// The outline is simplified (Douglas-Peucker) and rounded, which keeps coasts readable from orbit at a tenth of the size.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { Result } from "../../src/lib/result";

// 0.05 degrees is about 5.5 km at the equator: under one pixel of the 4,096 px wide texture the globe draws land into
// (360 / 4096 = 0.088 degrees a pixel).
const SIMPLIFY_TOLERANCE_DEGREES = 0.05;
// Two decimals, about 1 km: below the tolerance, so rounding adds no visible error.
const COORDINATE_DECIMALS = 2;
// Rings left with fewer points than this after simplification are islands smaller than a pixel.
const MIN_RING_POINTS = 4;
const OUTPUT_PATH = "public/globe/land.json";

type Point = [number, number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPoint(value: unknown): Point | null {
  if (!Array.isArray(value)) return null;
  const [longitude, latitude] = value;
  return typeof longitude === "number" && typeof latitude === "number" ? [longitude, latitude] : null;
}

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const deltaLongitude = lineEnd[0] - lineStart[0];
  const deltaLatitude = lineEnd[1] - lineStart[1];
  const lengthSquared = deltaLongitude * deltaLongitude + deltaLatitude * deltaLatitude;
  if (lengthSquared === 0) return Math.hypot(point[0] - lineStart[0], point[1] - lineStart[1]);
  const share = Math.max(0, Math.min(1, ((point[0] - lineStart[0]) * deltaLongitude + (point[1] - lineStart[1]) * deltaLatitude) / lengthSquared));
  return Math.hypot(point[0] - (lineStart[0] + share * deltaLongitude), point[1] - (lineStart[1] + share * deltaLatitude));
}

/** Douglas-Peucker with an explicit stack, so a long coastline cannot overflow the call stack. */
function simplifyRing(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const span = stack.pop();
    if (!span) break;
    const [firstIndex, lastIndex] = span;
    const firstPoint = points[firstIndex];
    const lastPoint = points[lastIndex];
    if (!firstPoint || !lastPoint) continue;
    let farthestIndex = -1;
    let farthestDistance = tolerance;
    for (let index = firstIndex + 1; index < lastIndex; index += 1) {
      const point = points[index];
      if (!point) continue;
      const distance = perpendicularDistance(point, firstPoint, lastPoint);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    }
    if (farthestIndex !== -1) {
      keep[farthestIndex] = 1;
      stack.push([firstIndex, farthestIndex], [farthestIndex, lastIndex]);
    }
  }
  return points.filter((_point, index) => keep[index] === 1);
}

function roundCoordinate(value: number): number {
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** One polygon's rings as flat [longitude, latitude, ...] arrays, simplified and rounded; null when malformed. */
function buildPolygon(rings: unknown): number[][] | null {
  if (!Array.isArray(rings)) return null;
  const built: number[][] = [];
  for (const ring of rings) {
    if (!Array.isArray(ring)) return null;
    const points = ring.map(toPoint);
    const validPoints = points.filter((point): point is Point => point !== null);
    if (validPoints.length !== points.length) return null;
    const simplified = simplifyRing(validPoints, SIMPLIFY_TOLERANCE_DEGREES);
    if (simplified.length < MIN_RING_POINTS) continue;
    built.push(simplified.flatMap(([longitude, latitude]) => [roundCoordinate(longitude), roundCoordinate(latitude)]));
  }
  return built;
}

function buildLand(geojson: unknown): Result<number[][][]> {
  if (!isRecord(geojson) || !Array.isArray(geojson.features)) return { ok: false, reason: "not a GeoJSON feature collection" };
  const polygons: number[][][] = [];
  for (const feature of geojson.features) {
    if (!isRecord(feature) || !isRecord(feature.geometry)) return { ok: false, reason: "a feature has no geometry" };
    const { type, coordinates } = feature.geometry;
    const polygonList: unknown[] = type === "Polygon" ? [coordinates] : type === "MultiPolygon" && Array.isArray(coordinates) ? coordinates : [];
    for (const rings of polygonList) {
      const polygon = buildPolygon(rings);
      if (!polygon) return { ok: false, reason: `a ${String(type)} has malformed coordinates` };
      if (polygon.length > 0) polygons.push(polygon);
    }
  }
  return { ok: true, value: polygons };
}

async function main(): Promise<number> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("[buildLand] pass the path to ne_50m_land.geojson");
    return 2;
  }
  let geojson: unknown;
  try {
    geojson = JSON.parse(await readFile(inputPath, "utf8"));
  } catch (error) {
    console.error(`[buildLand] could not read ${inputPath}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const land = buildLand(geojson);
  if (!land.ok) {
    console.error(`[buildLand] ${land.reason}`);
    return 1;
  }
  const pointCount = land.value.reduce((sum, polygon) => sum + polygon.reduce((ringSum, ring) => ringSum + ring.length / 2, 0), 0);
  const output = JSON.stringify({
    source: "Natural Earth 1:50m land, v5.1.2, public domain",
    simplifiedDegrees: SIMPLIFY_TOLERANCE_DEGREES,
    polygons: land.value,
  });
  await mkdir("public/globe", { recursive: true });
  await writeFile(OUTPUT_PATH, output);
  console.log(`[buildLand] ${land.value.length} polygons, ${pointCount} points, ${(output.length / 1024).toFixed(0)} KB to ${OUTPUT_PATH}`);
  return 0;
}

process.exit(await main());
