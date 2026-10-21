import type { Result } from "@/lib/result";
import { decodeElevations, type SeabedGrid, type SeabedRegion } from "@/lib/seabed/terrain";

export type SeabedLineKind = "power" | "telecom" | "pipeline";
export type SeabedLine = { name: string; kind: SeabedLineKind; points: [number, number][] };
export type SeabedPlace = { name: string; longitude: number; latitude: number };

/** The routes and grid shape served next to a terrain file (public/seabed/<area>-seabed.json). */
export type SeabedFeatures = {
  region: SeabedRegion;
  grid: SeabedGrid;
  /** The deepest and highest points of the terrain grid (metres), which set the overview's exaggeration. */
  elevationRange: { lowestMetres: number; highestMetres: number };
  lines: SeabedLine[];
  /** Land names drawn on the block. */
  places: SeabedPlace[];
  /** Credit lines for the depth grid, the land heights and the line routes. */
  sources: { depth: string; land: string; cables: string; pipelines: string };
};

export type SeabedData = { features: SeabedFeatures; elevations: Float32Array };

const LINE_KINDS: readonly SeabedLineKind[] = ["power", "telecom", "pipeline"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLineKind(value: unknown): value is SeabedLineKind {
  return LINE_KINDS.some((kind) => kind === value);
}

function parseRegion(value: unknown): SeabedRegion | null {
  if (!isRecord(value)) return null;
  const { west, east, south, north } = value;
  if (!isFiniteNumber(west) || !isFiniteNumber(east) || !isFiniteNumber(south) || !isFiniteNumber(north)) return null;
  return west < east && south < north ? { west, east, south, north } : null;
}

function parseGrid(value: unknown): SeabedGrid | null {
  if (!isRecord(value)) return null;
  const { width, height } = value;
  if (!Number.isInteger(width) || !Number.isInteger(height) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  return width >= 2 && height >= 2 ? { width, height } : null;
}

function parseElevationRange(value: unknown): SeabedFeatures["elevationRange"] | null {
  if (!isRecord(value)) return null;
  const { lowestMetres, highestMetres } = value;
  if (!isFiniteNumber(lowestMetres) || !isFiniteNumber(highestMetres)) return null;
  return lowestMetres <= 0 && highestMetres >= 0 ? { lowestMetres, highestMetres } : null;
}

function parsePoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [longitude, latitude] = value;
  return isFiniteNumber(longitude) && isFiniteNumber(latitude) ? [longitude, latitude] : null;
}

function parseLine(value: unknown): SeabedLine | null {
  if (!isRecord(value) || typeof value.name !== "string" || !isLineKind(value.kind) || !Array.isArray(value.points)) return null;
  const points = value.points.map(parsePoint);
  const validPoints = points.filter((point): point is [number, number] => point !== null);
  if (validPoints.length < 2 || validPoints.length !== points.length) return null;
  return { name: value.name, kind: value.kind, points: validPoints };
}

function parsePlace(value: unknown): SeabedPlace | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  const { longitude, latitude } = value;
  return isFiniteNumber(longitude) && isFiniteNumber(latitude) ? { name: value.name, longitude, latitude } : null;
}

/** Validates the features file once, where it enters the app. */
export function parseSeabedFeatures(payload: unknown): Result<SeabedFeatures> {
  if (!isRecord(payload)) return { ok: false, reason: "seabed features are not an object" };
  const region = parseRegion(payload.region);
  const grid = parseGrid(payload.grid);
  if (!region || !grid) return { ok: false, reason: "seabed features have a bad region or grid" };
  const elevationRange = parseElevationRange(payload.elevationRange);
  if (!elevationRange) return { ok: false, reason: "seabed features have no elevation range" };
  if (!Array.isArray(payload.lines)) return { ok: false, reason: "seabed features have no lines" };
  const lines = payload.lines.map(parseLine);
  const validLines = lines.filter((line): line is SeabedLine => line !== null);
  if (validLines.length !== lines.length) return { ok: false, reason: "seabed features have a malformed line" };
  const places = Array.isArray(payload.places) ? payload.places.map(parsePlace) : [];
  const validPlaces = places.filter((place): place is SeabedPlace => place !== null);
  if (validPlaces.length !== places.length) return { ok: false, reason: "seabed features have a malformed place" };
  const sourceCredits: Record<string, unknown> = isRecord(payload.sources) ? payload.sources : {};
  const { depth, land, cables, pipelines } = sourceCredits;
  if (typeof depth !== "string" || typeof land !== "string" || typeof cables !== "string" || typeof pipelines !== "string") {
    return { ok: false, reason: "seabed features have no source credits" };
  }
  return { ok: true, value: { region, grid, elevationRange, lines: validLines, places: validPlaces, sources: { depth, land, cables, pipelines } } };
}

/** Pairs a features file with its terrain file, checking the grid size matches. Shared by the browser and build-time loaders. */
export function toSeabedData(featuresPayload: unknown, terrain: ArrayBuffer): Result<SeabedData> {
  const features = parseSeabedFeatures(featuresPayload);
  if (!features.ok) return features;
  const expectedBytes = features.value.grid.width * features.value.grid.height * 2;
  if (terrain.byteLength !== expectedBytes) {
    return { ok: false, reason: `The depth grid has ${terrain.byteLength} bytes, expected ${expectedBytes}.` };
  }
  return { ok: true, value: { features: features.value, elevations: decodeElevations(terrain) } };
}

/** Where an area's two files are fetched from: its features (lines, places, credits) and its depth grid (seabed-urls.ts). */
export type SeabedFileUrls = { features: string; terrain: string };

/** Fetches an area's public/seabed/<area>-seabed.json and <area>-terrain.bin from `urls` and checks they belong together. */
export async function loadSeabedData(urls: SeabedFileUrls): Promise<Result<SeabedData>> {
  try {
    const [featuresResponse, terrainResponse] = await Promise.all([fetch(urls.features), fetch(urls.terrain)]);
    if (!featuresResponse.ok || !terrainResponse.ok) {
      return { ok: false, reason: `The seabed files answered ${featuresResponse.status} and ${terrainResponse.status}.` };
    }
    return toSeabedData(await featuresResponse.json(), await terrainResponse.arrayBuffer());
  } catch (error) {
    return { ok: false, reason: `The seabed files could not be reached: ${error instanceof Error ? error.message : String(error)}` };
  }
}
