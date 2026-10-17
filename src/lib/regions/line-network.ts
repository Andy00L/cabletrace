// Turns downloaded cable and pipeline data into the lines a region seeds into public.cables: submarine lines only,
// joined where OpenStreetMap splits one cable into many ways, clipped to the region box with a margin, simplified to
// what the near-cable test needs, and short harbour crossings left out. Pure functions, used by
// scripts/regions/build-cable-seed.ts and scripts/regions/measure-coverage.ts.
import type { Result } from "@/lib/result";
import type { BoundingBox, LineKind, LineSourceId } from "@/lib/regions/region";
import { distanceMetres } from "@/lib/detection/geodesy";

export type Coordinate = [number, number];

/** One seeded route: a cable or pipeline, as one or more line parts inside the region box (plus margin). */
export type SeedLine = {
  name: string;
  kind: LineKind;
  sourceId: LineSourceId;
  sourceRef: string;
  parts: Coordinate[][];
  /** The unclipped ends of every source way, where its landings are (src/lib/regions/landing-countries.ts). */
  ends: Coordinate[];
};

/** A raw line before joining: one OpenStreetMap way or one feature of a GeoJSON layer. */
export type RawLine = { name: string | null; kind: LineKind; sourceId: LineSourceId; sourceRef: string; points: Coordinate[] };

export type SeedOptions = {
  box: BoundingBox;
  /** Kept outside the box so a position at the box edge still finds a cable a few km away. */
  marginDegrees: number;
  /** Douglas-Peucker tolerance in metres. */
  simplifyMetres: number;
  /** Joined lines shorter than this inside the box are left out, in metres. */
  minimumLengthMetres: number;
};

// OpenStreetMap tags (wiki: Key:location, Tag:power=cable, Tag:communication=line, Tag:man_made=pipeline,
// Seamarks/Cables and Pipelines) that mark a line as lying on or under the seabed.
const SUBMARINE_LOCATIONS = new Set(["underwater", "submarine", "underwater_cable"]);
// Seamark categories with a kind of their own; chart-only cables without a category are left out, their kind unknown.
const SEAMARK_CABLE_KINDS: Readonly<Record<string, LineKind>> = { power: "power", transmission: "power", telephone: "telecom", telegraph: "telecom" };
const SEAMARK_PIPELINE_CATEGORIES = new Set(["gas", "oil", "supply", "chemical"]);
// Pipelines carrying these run from a shore plant a few km out (outfalls, intakes): not what a dragged anchor threatens
// at sea, and they would fill the table with harbour traffic.
const SHORE_PIPELINE_SUBSTANCES = new Set(["water", "sewage", "wastewater", "sewer", "drain", "outfall", "intake", "rainwater", "heat"]);
// Endpoints closer than this (degrees, about 1 m) are the same node of two OpenStreetMap ways.
const NODE_KEY_DECIMALS = 5;
// One degree of latitude on the sphere distanceMetres uses.
const METRES_PER_DEGREE_LATITUDE = distanceMetres({ longitude: 0, latitude: 0 }, { longitude: 0, latitude: 1 });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTag(tags: Record<string, unknown>, key: string): string | null {
  const value = tags[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** The kind of a submarine line from its OpenStreetMap tags, or null when it is not one this registry seeds. */
export function classifyOsmTags(tags: Record<string, unknown>): LineKind | null {
  const location = readTag(tags, "location");
  const isSubmarine = (location !== null && location.split(";").some((part) => SUBMARINE_LOCATIONS.has(part.trim()))) || readTag(tags, "submarine") === "yes";
  const seamarkType = readTag(tags, "seamark:type");
  const substance = readTag(tags, "substance") ?? readTag(tags, "seamark:pipeline_submarine:product") ?? readTag(tags, "seamark:pipeline_submarine:category");
  if (readTag(tags, "power") === "cable" && (isSubmarine || seamarkType === "cable_submarine")) return "power";
  if ((readTag(tags, "communication") === "line" || readTag(tags, "telecom") === "line") && (isSubmarine || seamarkType === "cable_submarine")) return "telecom";
  if (readTag(tags, "man_made") === "pipeline" && (isSubmarine || seamarkType === "pipeline_submarine")) {
    return substance !== null && SHORE_PIPELINE_SUBSTANCES.has(substance) ? null : "pipeline";
  }
  if (seamarkType === "cable_submarine") return SEAMARK_CABLE_KINDS[readTag(tags, "seamark:cable_submarine:category") ?? ""] ?? null;
  if (seamarkType === "pipeline_submarine") {
    const category = readTag(tags, "seamark:pipeline_submarine:category");
    return category !== null && SEAMARK_PIPELINE_CATEGORIES.has(category) ? "pipeline" : null;
  }
  return null;
}

function readOsmName(tags: Record<string, unknown>): string | null {
  return readTag(tags, "name") ?? readTag(tags, "name:en") ?? readTag(tags, "seamark:name") ?? readTag(tags, "cables:name");
}

/** Parses an Overpass `out tags geom` reply into raw lines; ways that are not submarine cables or pipelines are skipped. */
export function parseOverpassLines(payload: unknown): Result<RawLine[]> {
  if (!isRecord(payload) || !Array.isArray(payload.elements)) return { ok: false, reason: "Overpass reply has no elements array" };
  const lines: RawLine[] = [];
  for (const element of payload.elements) {
    if (!isRecord(element) || element.type !== "way" || typeof element.id !== "number" || !isRecord(element.tags) || !Array.isArray(element.geometry)) continue;
    const kind = classifyOsmTags(element.tags);
    if (kind === null) continue;
    const points: Coordinate[] = [];
    for (const node of element.geometry) {
      if (isRecord(node) && typeof node.lon === "number" && typeof node.lat === "number") points.push([node.lon, node.lat]);
    }
    if (points.length >= 2) lines.push({ name: readOsmName(element.tags), kind, sourceId: "openstreetmap", sourceRef: `way/${element.id}`, points });
  }
  return { ok: true, value: lines };
}

/**
 * Parses the ACMA submarine cable locations layer (GeoJSON from the AODN WFS, layer
 * becrc:becrc_wp2_acma_submarine_cable_locations_2021): every feature is a telecom cable, its name in `cable`.
 */
export function parseAcmaCableLines(payload: unknown): Result<RawLine[]> {
  if (!isRecord(payload) || !Array.isArray(payload.features)) return { ok: false, reason: "ACMA layer has no features array" };
  const lines: RawLine[] = [];
  for (const feature of payload.features) {
    if (!isRecord(feature) || !isRecord(feature.geometry) || !isRecord(feature.properties)) continue;
    const name = readTag(feature.properties, "cable");
    const objectId = feature.properties.objectid;
    const { type, coordinates } = feature.geometry;
    if (name === null || typeof objectId !== "number" || !Array.isArray(coordinates)) continue;
    const parts: unknown[] = type === "MultiLineString" ? coordinates : type === "LineString" ? [coordinates] : [];
    for (const part of parts) {
      if (!Array.isArray(part)) continue;
      const points = part.flatMap((pair): Coordinate[] =>
        Array.isArray(pair) && typeof pair[0] === "number" && typeof pair[1] === "number" ? [[pair[0], pair[1]]] : [],
      );
      if (points.length >= 2) lines.push({ name, kind: "telecom", sourceId: "acma-cable-locations-2021", sourceRef: `objectid/${objectId}`, points });
    }
  }
  return { ok: true, value: lines };
}

function nodeKey(point: Coordinate): string {
  return `${point[0].toFixed(NODE_KEY_DECIMALS)},${point[1].toFixed(NODE_KEY_DECIMALS)}`;
}

/** Groups raw lines that share an endpoint, a kind and a name (one cable split into ways), with union-find over line indexes. */
export function groupConnectedLines(lines: readonly RawLine[]): RawLine[][] {
  const parent = lines.map((_line, lineIndex) => lineIndex);
  const findRoot = (lineIndex: number): number => {
    let root = lineIndex;
    while (parent[root] !== root) root = parent[root] ?? root;
    parent[lineIndex] = root;
    return root;
  };
  const firstLineAtNode = new Map<string, number>();
  lines.forEach((line, lineIndex) => {
    const ends = [line.points[0], line.points[line.points.length - 1]].filter((point): point is Coordinate => point !== undefined);
    for (const end of ends) {
      // Same name too: cables of one landing station share its node and must stay separate lines.
      const key = `${line.kind}|${line.name ?? ""}|${nodeKey(end)}`;
      const other = firstLineAtNode.get(key);
      if (other === undefined) firstLineAtNode.set(key, lineIndex);
      else parent[findRoot(lineIndex)] = findRoot(other);
    }
  });
  const groups = new Map<number, RawLine[]>();
  lines.forEach((line, lineIndex) => {
    const root = findRoot(lineIndex);
    groups.set(root, [...(groups.get(root) ?? []), line]);
  });
  return [...groups.values()];
}

/** Liang-Barsky clip of one segment to a box; null when the segment misses it. */
function clipSegment(start: Coordinate, end: Coordinate, box: BoundingBox): [Coordinate, Coordinate] | null {
  const deltaLongitude = end[0] - start[0];
  const deltaLatitude = end[1] - start[1];
  let enter = 0;
  let leave = 1;
  const edges: [number, number][] = [
    [-deltaLongitude, start[0] - box.west],
    [deltaLongitude, box.east - start[0]],
    [-deltaLatitude, start[1] - box.south],
    [deltaLatitude, box.north - start[1]],
  ];
  for (const [direction, distance] of edges) {
    if (direction === 0) {
      if (distance < 0) return null;
      continue;
    }
    const along = distance / direction;
    if (direction < 0) enter = Math.max(enter, along);
    else leave = Math.min(leave, along);
    if (enter > leave) return null;
  }
  const pointAt = (along: number): Coordinate => [start[0] + along * deltaLongitude, start[1] + along * deltaLatitude];
  return [enter === 0 ? start : pointAt(enter), leave === 1 ? end : pointAt(leave)];
}

/** The parts of a polyline inside a box. A line leaving and re-entering the box becomes two parts. */
export function clipLineToBox(points: readonly Coordinate[], box: BoundingBox): Coordinate[][] {
  const parts: Coordinate[][] = [];
  let current: Coordinate[] = [];
  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const start = points[pointIndex - 1];
    const end = points[pointIndex];
    if (start === undefined || end === undefined) continue;
    const clipped = clipSegment(start, end, box);
    if (clipped === null) {
      if (current.length >= 2) parts.push(current);
      current = [];
      continue;
    }
    const [clippedStart, clippedEnd] = clipped;
    const last = current[current.length - 1];
    if (last === undefined || last[0] !== clippedStart[0] || last[1] !== clippedStart[1]) {
      if (current.length >= 2) parts.push(current);
      current = [clippedStart];
    }
    current.push(clippedEnd);
    // The segment left the box: the next one starts a new part.
    if (clippedEnd !== end) {
      parts.push(current);
      current = [];
    }
  }
  if (current.length >= 2) parts.push(current);
  return parts;
}

function toLonLat(point: Coordinate) {
  return { longitude: point[0], latitude: point[1] };
}

/** Distance from a point to a segment in metres, in a flat frame around the point (exact enough below 100 km). */
export function pointToSegmentMetres(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const metresPerDegreeLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos((point[1] * Math.PI) / 180);
  const startX = (start[0] - point[0]) * metresPerDegreeLongitude;
  const startY = (start[1] - point[1]) * METRES_PER_DEGREE_LATITUDE;
  const endX = (end[0] - point[0]) * metresPerDegreeLongitude;
  const endY = (end[1] - point[1]) * METRES_PER_DEGREE_LATITUDE;
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(startX * segmentX + startY * segmentY) / lengthSquared));
  return Math.hypot(startX + along * segmentX, startY + along * segmentY);
}

/** Douglas-Peucker simplification with a tolerance in metres; the first and last points always stay. */
export function simplifyLine(points: readonly Coordinate[], toleranceMetres: number): Coordinate[] {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const pending: [number, number][] = [[0, points.length - 1]];
  while (pending.length > 0) {
    const span = pending.pop();
    if (span === undefined) break;
    const [firstIndex, lastIndex] = span;
    const first = points[firstIndex];
    const last = points[lastIndex];
    if (first === undefined || last === undefined) continue;
    let farthestIndex = -1;
    let farthestMetres = toleranceMetres;
    for (let pointIndex = firstIndex + 1; pointIndex < lastIndex; pointIndex += 1) {
      const point = points[pointIndex];
      if (point === undefined) continue;
      const offset = pointToSegmentMetres(point, first, last);
      if (offset > farthestMetres) {
        farthestMetres = offset;
        farthestIndex = pointIndex;
      }
    }
    if (farthestIndex > 0) {
      keep[farthestIndex] = true;
      pending.push([firstIndex, farthestIndex], [farthestIndex, lastIndex]);
    }
  }
  return points.filter((_point, pointIndex) => keep[pointIndex]);
}

export function lineLengthMetres(points: readonly Coordinate[]): number {
  let total = 0;
  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const start = points[pointIndex - 1];
    const end = points[pointIndex];
    if (start !== undefined && end !== undefined) total += distanceMetres(toLonLat(start), toLonLat(end));
  }
  return total;
}

function expandBox(box: BoundingBox, marginDegrees: number): BoundingBox {
  return { west: box.west - marginDegrees, east: box.east + marginDegrees, south: box.south - marginDegrees, north: box.north + marginDegrees };
}

function mostCommonName(group: readonly RawLine[]): string | null {
  const counts = new Map<string, number>();
  for (const line of group) if (line.name !== null) counts.set(line.name, (counts.get(line.name) ?? 0) + 1);
  return [...counts.entries()].sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))[0]?.[0] ?? null;
}

const KIND_LABELS: Readonly<Record<LineKind, string>> = { power: "power cable", telecom: "telecom cable", pipeline: "pipeline" };

/**
 * Builds a region's seed lines: groups connected ways, clips each group to the box plus margin, simplifies it, drops
 * groups shorter than the minimum, and names unnamed ones after their first source reference. Names are unique in the
 * result (public.cables is unique on region, name and kind), so a name shared by two separate groups gets its reference.
 */
export function buildSeedLines(rawLines: readonly RawLine[], options: SeedOptions): SeedLine[] {
  const clipBox = expandBox(options.box, options.marginDegrees);
  const candidates = groupConnectedLines(rawLines).flatMap((group): SeedLine[] => {
    const parts = group.flatMap((line) => clipLineToBox(line.points, clipBox)).map((part) => simplifyLine(part, options.simplifyMetres));
    const insideMetres = parts.reduce((total, part) => total + lineLengthMetres(part), 0);
    const first = group[0];
    if (first === undefined || parts.length === 0 || insideMetres < options.minimumLengthMetres) return [];
    const sourceRef = group.map((line) => line.sourceRef).sort()[0] ?? first.sourceRef;
    const name = mostCommonName(group) ?? `Unnamed submarine ${KIND_LABELS[first.kind]} (${sourceRef})`;
    const ends = group.flatMap((line) => [line.points[0], line.points[line.points.length - 1]].filter((point): point is Coordinate => point !== undefined));
    return [{ name, kind: first.kind, sourceId: first.sourceId, sourceRef, parts, ends }];
  });
  const nameCounts = new Map<string, number>();
  for (const line of candidates) nameCounts.set(`${line.kind}|${line.name}`, (nameCounts.get(`${line.kind}|${line.name}`) ?? 0) + 1);
  return candidates
    .map((line) => ((nameCounts.get(`${line.kind}|${line.name}`) ?? 0) > 1 ? { ...line, name: `${line.name} (${line.sourceRef})` } : line))
    .sort((first, second) => first.kind.localeCompare(second.kind) || first.name.localeCompare(second.name));
}

export function countSeedPoints(lines: readonly SeedLine[]): number {
  return lines.reduce((total, line) => total + line.parts.reduce((partTotal, part) => partTotal + part.length, 0), 0);
}
