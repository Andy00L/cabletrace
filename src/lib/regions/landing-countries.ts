// Landing countries of seeded lines, for public.cable_landing_countries (the fault-signal matcher matches outages and
// notices by country): a line lands in a country when an end of one of its source ways lies on that country's land or
// within LANDING_REACH_METRES of it. Countries come from Natural Earth admin-0 at 1:10m (public domain), whose
// ISO_A2_EH field carries the ISO 3166-1 alpha-2 code also for France and Norway, where ISO_A2 reads -99.
// Used offline by scripts/regions/build-cable-seed.ts.
import type { Result } from "@/lib/result";
import type { Coordinate } from "@/lib/regions/line-network";
import { createLocalFrame } from "@/lib/detection/geodesy";

// Natural Earth's 1:10m coastline sits within a few hundred metres of the true one, and a landing station stands at
// most a few hundred metres inland: 2 km catches both without reaching across a strait (Øresund narrows to 4 km).
export const LANDING_REACH_METRES = 2000;
// Points probed around an end at the reach: every 45 degrees.
const PROBE_BEARINGS_DEGREES = [0, 45, 90, 135, 180, 225, 270, 315];
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/u;

type Ring = Coordinate[];
export type CountryShape = { code: string; polygons: Ring[][]; west: number; east: number; south: number; north: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRing(value: unknown): Ring | null {
  if (!Array.isArray(value)) return null;
  const ring = value.flatMap((pair): Coordinate[] => (Array.isArray(pair) && typeof pair[0] === "number" && typeof pair[1] === "number" ? [[pair[0], pair[1]]] : []));
  return ring.length >= 4 && ring.length === value.length ? ring : null;
}

function readPolygon(value: unknown): Ring[] | null {
  if (!Array.isArray(value)) return null;
  const rings = value.map(readRing);
  return rings.every((ring): ring is Ring => ring !== null) && rings.length > 0 ? rings : null;
}

/** Parses Natural Earth admin-0 GeoJSON; features without a two-letter ISO_A2_EH code are skipped. */
export function parseCountryShapes(payload: unknown): Result<CountryShape[]> {
  if (!isRecord(payload) || !Array.isArray(payload.features)) return { ok: false, reason: "country file has no features array" };
  const shapes: CountryShape[] = [];
  for (const feature of payload.features) {
    if (!isRecord(feature) || !isRecord(feature.properties) || !isRecord(feature.geometry)) continue;
    const code = feature.properties.ISO_A2_EH;
    if (typeof code !== "string" || !COUNTRY_CODE_PATTERN.test(code)) continue;
    const { type, coordinates } = feature.geometry;
    const rawPolygons: unknown[] = type === "MultiPolygon" && Array.isArray(coordinates) ? coordinates : type === "Polygon" ? [coordinates] : [];
    const polygons = rawPolygons.map(readPolygon).filter((polygon): polygon is Ring[] => polygon !== null);
    if (polygons.length === 0) continue;
    // A loop, not Math.min(...points): Russia's outline alone has more points than a call takes arguments.
    const bounds = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
    for (const polygon of polygons) {
      for (const [longitude, latitude] of polygon[0] ?? []) {
        bounds.west = Math.min(bounds.west, longitude);
        bounds.east = Math.max(bounds.east, longitude);
        bounds.south = Math.min(bounds.south, latitude);
        bounds.north = Math.max(bounds.north, latitude);
      }
    }
    shapes.push({ code, polygons, ...bounds });
  }
  return { ok: true, value: shapes };
}

/** Even-odd ray casting; a point exactly on an edge may land on either side, which the reach makes irrelevant. */
function isInsideRing(point: Coordinate, ring: Ring): boolean {
  let isInside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index];
    const before = ring[previous];
    if (current === undefined || before === undefined) continue;
    const crossesLatitude = current[1] > point[1] !== before[1] > point[1];
    if (crossesLatitude && point[0] < ((before[0] - current[0]) * (point[1] - current[1])) / (before[1] - current[1]) + current[0]) isInside = !isInside;
  }
  return isInside;
}

function isOnLand(point: Coordinate, shape: CountryShape): boolean {
  if (point[0] < shape.west || point[0] > shape.east || point[1] < shape.south || point[1] > shape.north) return false;
  // Outer ring in, every hole out.
  return shape.polygons.some((polygon) => polygon[0] !== undefined && isInsideRing(point, polygon[0]) && polygon.slice(1).every((hole) => !isInsideRing(point, hole)));
}

/** The point itself and eight points LANDING_REACH_METRES around it. */
function probePoints(end: Coordinate): Coordinate[] {
  const frame = createLocalFrame({ longitude: end[0], latitude: end[1] });
  return [
    end,
    ...PROBE_BEARINGS_DEGREES.map((bearing): Coordinate => {
      const radians = (bearing * Math.PI) / 180;
      const probe = frame.toLonLat({ x: LANDING_REACH_METRES * Math.sin(radians), y: LANDING_REACH_METRES * Math.cos(radians) });
      return [probe.longitude, probe.latitude];
    }),
  ];
}

/** Sorted ISO codes of the countries the ends land in; empty for a line that ends at sea at both ends (a platform). */
export function findLandingCountries(ends: readonly Coordinate[], shapes: readonly CountryShape[]): string[] {
  const codes = new Set<string>();
  for (const end of ends) {
    const probes = probePoints(end);
    for (const shape of shapes) {
      if (probes.some((probe) => isOnLand(probe, shape))) codes.add(shape.code);
    }
  }
  return [...codes].sort();
}
