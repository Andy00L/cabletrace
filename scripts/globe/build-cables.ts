// Builds public/globe/cables.json, the world's submarine cables and pipelines the /live globe draws, from OpenStreetMap.
// Usage:
//   bun scripts/globe/build-cables.ts --query            prints the Overpass query
//   curl -s -H "User-Agent: <who you are>" --data-urlencode "data=$(bun scripts/globe/build-cables.ts --query)" \
//     https://overpass-api.de/api/interpreter > .scratch/osm-lines.json
//   bun scripts/globe/build-cables.ts .scratch/osm-lines.json
// Source: OpenStreetMap contributors, Open Database License 1.0 (https://www.openstreetmap.org/copyright). The globe
// credits OpenStreetMap on screen and this file states the licence, as the ODbL asks of a produced work.
// Each way is simplified (Douglas-Peucker), rounded and delta-encoded; ways sharing a kind and a name become one line.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import type { Result } from "../../src/lib/result";
import type { SeabedLineKind } from "../../src/lib/seabed/seabed-data";

// The four tag pairs the ambition pass names (plan/prompts/ambition-pass.md, 3.1 and 6.4), each on the sea floor.
const OVERPASS_QUERY =
  '[out:json][timeout:500];(way["communication"="line"]["location"="underwater"];way["telecom"="line"]["location"="underwater"];' +
  'way["power"="cable"]["location"="underwater"];way["man_made"="pipeline"]["location"="underwater"];);out tags geom;';
// 0.002 degrees is about 220 m: one pixel when the globe is zoomed in all the way (about 250 m a pixel at the closest
// camera distance), so simplification never shows.
const SIMPLIFY_TOLERANCE_DEGREES = 0.002;
// Coordinates are stored as integers in thousandths of a degree (about 110 m), under the simplification tolerance.
const UNITS_PER_DEGREE = 1000;
// Ways shorter than this are mostly river and harbour crossings, a pixel long even from a regional view.
const MIN_WAY_LENGTH_KM = 1;
const EARTH_RADIUS_KM = 6371.0088;
const OUTPUT_PATH = "public/globe/cables.json";

type Point = [number, number];
type OverpassWay = { id: number; tags: Record<string, string>; points: Point[] };
type BuiltLine = { name: string | null; kind: SeabedLineKind; substance: string | null; operator: string | null; parts: number[][] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTags(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const tags: Record<string, string> = {};
  for (const [key, tagValue] of Object.entries(value)) if (typeof tagValue === "string") tags[key] = tagValue;
  return tags;
}

function readWay(element: unknown): OverpassWay | null {
  if (!isRecord(element) || element.type !== "way" || typeof element.id !== "number" || !Array.isArray(element.geometry)) return null;
  const points: Point[] = [];
  for (const node of element.geometry) {
    if (!isRecord(node) || typeof node.lon !== "number" || typeof node.lat !== "number") return null;
    points.push([node.lon, node.lat]);
  }
  return { id: element.id, tags: readTags(element.tags), points };
}

/** Pipeline wins over power, power over telecom: a power cable carrying fibre is drawn as the power cable. */
function classifyWay(tags: Record<string, string>): SeabedLineKind | null {
  if (tags.man_made === "pipeline") return "pipeline";
  if (tags.power === "cable") return "power";
  if (tags.communication === "line" || tags.telecom === "line") return "telecom";
  return null;
}

function wayLengthKm(points: readonly Point[]): number {
  let lengthKm = 0;
  for (let index = 1; index < points.length; index += 1) {
    const [fromLongitude, fromLatitude] = points[index - 1] ?? [0, 0];
    const [toLongitude, toLatitude] = points[index] ?? [0, 0];
    const meanLatitude = ((fromLatitude + toLatitude) / 2) * (Math.PI / 180);
    let deltaLongitude = toLongitude - fromLongitude;
    if (deltaLongitude > 180) deltaLongitude -= 360;
    if (deltaLongitude < -180) deltaLongitude += 360;
    lengthKm += Math.hypot(deltaLongitude * Math.cos(meanLatitude), toLatitude - fromLatitude) * (Math.PI / 180) * EARTH_RADIUS_KM;
  }
  return lengthKm;
}

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const deltaLongitude = lineEnd[0] - lineStart[0];
  const deltaLatitude = lineEnd[1] - lineStart[1];
  const lengthSquared = deltaLongitude * deltaLongitude + deltaLatitude * deltaLatitude;
  if (lengthSquared === 0) return Math.hypot(point[0] - lineStart[0], point[1] - lineStart[1]);
  const share = Math.max(0, Math.min(1, ((point[0] - lineStart[0]) * deltaLongitude + (point[1] - lineStart[1]) * deltaLatitude) / lengthSquared));
  return Math.hypot(point[0] - (lineStart[0] + share * deltaLongitude), point[1] - (lineStart[1] + share * deltaLatitude));
}

/** Douglas-Peucker with an explicit stack (the same method as build-land.ts, for open lines). */
function simplifyLine(points: readonly Point[], tolerance: number): Point[] {
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

/** [longitude, latitude] of the first point in units, then the difference to each next point. */
function encodePart(points: readonly Point[]): number[] {
  const encoded: number[] = [];
  let previousLongitude = 0;
  let previousLatitude = 0;
  points.forEach(([longitude, latitude]) => {
    const longitudeUnits = Math.round(longitude * UNITS_PER_DEGREE);
    const latitudeUnits = Math.round(latitude * UNITS_PER_DEGREE);
    // Rounding can make two neighbours equal; a zero step carries nothing.
    if (encoded.length > 0 && longitudeUnits === previousLongitude && latitudeUnits === previousLatitude) return;
    encoded.push(longitudeUnits - previousLongitude, latitudeUnits - previousLatitude);
    previousLongitude = longitudeUnits;
    previousLatitude = latitudeUnits;
  });
  return encoded;
}

function readName(tags: Record<string, string>): string | null {
  const name = tags.name ?? tags["name:en"] ?? null;
  return name === null || name.trim() === "" ? null : name.trim();
}

function buildLines(payload: unknown): Result<{ lines: BuiltLine[]; osmBase: string; wayCount: number; keptWayCount: number }> {
  if (!isRecord(payload) || !Array.isArray(payload.elements) || !isRecord(payload.osm3s)) return { ok: false, reason: "not an Overpass JSON answer" };
  const osmBase = typeof payload.osm3s.timestamp_osm_base === "string" ? payload.osm3s.timestamp_osm_base : "unknown";
  const byKey = new Map<string, BuiltLine>();
  const lines: BuiltLine[] = [];
  let keptWayCount = 0;
  for (const element of payload.elements) {
    const way = readWay(element);
    if (!way) return { ok: false, reason: "an element is not a way with geometry" };
    const kind = classifyWay(way.tags);
    if (!kind || way.points.length < 2 || wayLengthKm(way.points) < MIN_WAY_LENGTH_KM) continue;
    const part = encodePart(simplifyLine(way.points, SIMPLIFY_TOLERANCE_DEGREES));
    if (part.length < 4) continue;
    keptWayCount += 1;
    const name = readName(way.tags);
    const key = name === null ? null : `${kind}:${name}`;
    const existing = key === null ? undefined : byKey.get(key);
    if (existing) {
      existing.parts.push(part);
      continue;
    }
    const line: BuiltLine = {
      name,
      kind,
      substance: kind === "pipeline" ? (way.tags.substance ?? null) : null,
      operator: way.tags.operator ?? null,
      parts: [part],
    };
    lines.push(line);
    if (key !== null) byKey.set(key, line);
  }
  return { ok: true, value: { lines, osmBase, wayCount: payload.elements.length, keptWayCount } };
}

async function main(): Promise<number> {
  const argument = process.argv[2];
  if (argument === "--query") {
    console.log(OVERPASS_QUERY);
    return 0;
  }
  if (!argument) {
    console.error("[buildCables] pass the path to the Overpass answer, or --query to print the query");
    return 2;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(argument, "utf8"));
  } catch (error) {
    console.error(`[buildCables] could not read ${argument}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const built = buildLines(payload);
  if (!built.ok) {
    console.error(`[buildCables] ${built.reason}`);
    return 1;
  }
  const { lines, osmBase, wayCount, keptWayCount } = built.value;
  const output = JSON.stringify({
    source: "OpenStreetMap contributors",
    licence: "Open Database License 1.0 (ODbL), https://www.openstreetmap.org/copyright",
    osmBase,
    query: OVERPASS_QUERY,
    minWayLengthKm: MIN_WAY_LENGTH_KM,
    simplifiedDegrees: SIMPLIFY_TOLERANCE_DEGREES,
    unitsPerDegree: UNITS_PER_DEGREE,
    lines,
  });
  await mkdir("public/globe", { recursive: true });
  await writeFile(OUTPUT_PATH, output);
  const pointCount = lines.reduce((sum, line) => sum + line.parts.reduce((partSum, part) => partSum + part.length / 2, 0), 0);
  const countByKind = (kind: SeabedLineKind) => lines.filter((line) => line.kind === kind).length;
  console.log(
    `[buildCables] ${keptWayCount} of ${wayCount} ways (OSM ${osmBase}) as ${lines.length} lines ` +
      `(telecom ${countByKind("telecom")}, power ${countByKind("power")}, pipeline ${countByKind("pipeline")}), ${pointCount} points, ` +
      `${(output.length / 1024).toFixed(0)} KB, ${(gzipSync(output).length / 1024).toFixed(0)} KB gzip, to ${OUTPUT_PATH}`,
  );
  return 0;
}

process.exit(await main());
