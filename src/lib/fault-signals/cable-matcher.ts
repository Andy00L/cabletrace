import type { CableKind } from "@/lib/detection/detection-types";
import { createLocalFrame, distanceToSegment, intersectSegments, type LocalPoint } from "@/lib/detection/geodesy";
import type { FaultSignal, LonLatPair, RegistryCable, SignalGeometry } from "@/lib/fault-signals/fault-signal-types";

// Which cables of the registry a signal concerns. Three ways, strongest first:
// - geometry: a warning's trackline, area or position lies within SIGNAL_NEAR_CABLE_METRES of a cable route;
// - asset name: a power-link notice names the link ("Estlink 2" is "HVDC Estlink 2" in the registry);
// - border or country: the notice withholds the asset (allowed by Transparency Regulation article 10.4) and gives only
//   the two countries it joins, or an internet outage gives only a country.
// Only the first two open a draft case by themselves: a country holds many cables, and IODA saw no national outage in
// Estonia when its cables were cut on 25 Dec 2024. A country match only joins a draft another signal opened.

// Warning positions come to 0.01 minute (about 20 m) and the registry routes are simplified to about 20 m, but the
// mapped route of a cable (OpenStreetMap, EMODnet) can sit a few kilometres off the laid one, and a repair ship works
// to either side of it. 5 km keeps a ship working on the cable inside and a parallel cable 10 km away outside.
export const SIGNAL_NEAR_CABLE_METRES = 5000;

export type MatchBasis = "geometry" | "asset-name" | "border" | "country";

export type CableMatch = {
  cableId: number;
  cableName: string;
  cableKind: CableKind;
  basis: MatchBasis;
  /** Closest distance between the signal's geometry and the route, for geometry matches; null otherwise. */
  distanceMetres: number | null;
  /** Whether this match is enough to open a draft case by itself. */
  opensDraft: boolean;
};

// Metres per degree of latitude on the IUGG mean sphere (radius 6,371,008.8 m, src/lib/detection/geodesy.ts).
const METRES_PER_DEGREE = 111_195;

type Segment = { start: LonLatPair; end: LonLatPair };
type Box = { west: number; east: number; south: number; north: number };

function toSegments(line: readonly LonLatPair[]): Segment[] {
  return line.slice(1).map((end, index) => ({ start: line[index] ?? end, end }));
}

function boxOf(points: readonly LonLatPair[], marginMetres: number): Box {
  const latitudes = points.map((point) => point[1]);
  const longitudes = points.map((point) => point[0]);
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  const marginLatitude = marginMetres / METRES_PER_DEGREE;
  const widestCos = Math.max(0.01, Math.cos((Math.max(Math.abs(south), Math.abs(north)) * Math.PI) / 180));
  const marginLongitude = marginMetres / (METRES_PER_DEGREE * widestCos);
  return { west: Math.min(...longitudes) - marginLongitude, east: Math.max(...longitudes) + marginLongitude, south: south - marginLatitude, north: north + marginLatitude };
}

function boxesOverlap(first: Box, second: Box): boolean {
  return first.west <= second.east && second.west <= first.east && first.south <= second.north && second.south <= first.north;
}

/** Distance in metres between two segments, measured in a flat frame centred on the first one. */
function segmentDistanceMetres(first: Segment, second: Segment): number {
  const frame = createLocalFrame({ longitude: (first.start[0] + first.end[0]) / 2, latitude: (first.start[1] + first.end[1]) / 2 });
  const toLocal = (pair: LonLatPair): LocalPoint => frame.toLocal({ longitude: pair[0], latitude: pair[1] });
  const [firstStart, firstEnd, secondStart, secondEnd] = [toLocal(first.start), toLocal(first.end), toLocal(second.start), toLocal(second.end)];
  if (intersectSegments(firstStart, firstEnd, secondStart, secondEnd)) return 0;
  return Math.min(
    distanceToSegment(firstStart, secondStart, secondEnd),
    distanceToSegment(firstEnd, secondStart, secondEnd),
    distanceToSegment(secondStart, firstStart, firstEnd),
    distanceToSegment(secondEnd, firstStart, firstEnd),
  );
}

/** Even-odd test in degrees; good for the small areas warnings give (no pole, no antimeridian). */
function isInsideRing(point: LonLatPair, ring: readonly LonLatPair[]): boolean {
  let isInside = false;
  ring.forEach((vertex, index) => {
    const previous = ring[(index + ring.length - 1) % ring.length] ?? vertex;
    const crossesRay = vertex[1] > point[1] !== previous[1] > point[1];
    if (crossesRay && point[0] < ((previous[0] - vertex[0]) * (point[1] - vertex[1])) / (previous[1] - vertex[1]) + vertex[0]) isInside = !isInside;
  });
  return isInside;
}

/** The signal geometry as segments (a point is a zero-length segment; an area is its closed outline). */
function geometrySegments(geometry: SignalGeometry): Segment[] {
  switch (geometry.kind) {
    case "tracklines":
      return geometry.lines.flatMap(toSegments);
    case "area": {
      const [first] = geometry.ring;
      return first ? toSegments([...geometry.ring, first]) : [];
    }
    case "points":
      return geometry.points.map((point) => ({ start: point, end: point }));
    default: {
      const unhandled: never = geometry;
      return unhandled;
    }
  }
}

/** Closest distance in metres from the signal geometry to a cable route, or null when farther than `limitMetres`. */
export function distanceToCableMetres(geometry: SignalGeometry, cableLines: readonly LonLatPair[][], limitMetres: number): number | null {
  if (geometry.kind === "area" && cableLines.some((line) => line.some((vertex) => isInsideRing(vertex, geometry.ring)))) return 0;
  const signalSegments = geometrySegments(geometry);
  let closest = Number.POSITIVE_INFINITY;
  for (const line of cableLines) {
    if (line.length < 2) continue;
    const lineBox = boxOf(line, 0);
    for (const signalSegment of signalSegments) {
      const signalBox = boxOf([signalSegment.start, signalSegment.end], limitMetres);
      if (!boxesOverlap(signalBox, lineBox)) continue;
      for (const cableSegment of toSegments(line)) {
        if (!boxesOverlap(signalBox, boxOf([cableSegment.start, cableSegment.end], 0))) continue;
        closest = Math.min(closest, segmentDistanceMetres(signalSegment, cableSegment));
      }
    }
  }
  return closest <= limitMetres ? Math.round(closest) : null;
}

/** "HVDC Estlink 2" and "EstLink 2" both as "estlink2": lower case, no "HVDC", no punctuation or brackets. */
export function normaliseAssetName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/gu, " ")
    .replace(/\bhvdc\b/gu, " ")
    .replace(/[^a-z0-9]/gu, "");
}

// Shorter normalised names ("fec", "estlink") are too generic to match by containment; they must match exactly.
const MIN_CONTAINED_NAME_LENGTH = 6;

function isSameAsset(assetName: string, cableName: string): boolean {
  const asset = normaliseAssetName(assetName);
  const cable = normaliseAssetName(cableName);
  if (asset === "" || cable === "") return false;
  if (asset === cable) return true;
  const [shorter, longer] = asset.length <= cable.length ? [asset, cable] : [cable, asset];
  // "estlink2" must not match "estlink21": the contained name must end on a word, not run into more digits.
  const position = longer.indexOf(shorter);
  const nextCharacter = position >= 0 ? longer.charAt(position + shorter.length) : "";
  return shorter.length >= MIN_CONTAINED_NAME_LENGTH && position >= 0 && !(/\d$/u.test(shorter) && /\d/u.test(nextCharacter));
}

function toMatch(cable: RegistryCable, basis: MatchBasis, distanceMetres: number | null): CableMatch {
  return { cableId: cable.id, cableName: cable.name, cableKind: cable.kind, basis, distanceMetres, opensDraft: basis !== "country" };
}

/** Every registry cable the signal concerns, closest first for geometry matches. */
export function matchSignalToCables(signal: FaultSignal, cables: readonly RegistryCable[]): CableMatch[] {
  const { locator } = signal;
  switch (locator.kind) {
    case "geometry":
      // A cable warning concerns cables, not pipelines.
      return cables
        .filter((cable) => cable.kind !== "pipeline")
        .flatMap((cable) => {
          const distanceMetres = distanceToCableMetres(locator.geometry, cable.lines, SIGNAL_NEAR_CABLE_METRES);
          return distanceMetres === null ? [] : [toMatch(cable, "geometry", distanceMetres)];
        })
        .sort((first, second) => (first.distanceMetres ?? 0) - (second.distanceMetres ?? 0));
    case "asset": {
      const powerCables = cables.filter((cable) => cable.kind === "power");
      const byName = powerCables.filter((cable) => locator.assetNames.some((assetName) => isSameAsset(assetName, cable.name)));
      if (byName.length > 0) return byName.map((cable) => toMatch(cable, "asset-name", null));
      // A named asset that is not in the registry is not one of its cables; only an undisclosed one falls back to the border.
      const border = locator.countries;
      if (locator.assetNames.length > 0 || border === null) return [];
      return powerCables.filter((cable) => border.every((country) => cable.countries.includes(country))).map((cable) => toMatch(cable, "border", null));
    }
    case "country":
      // An internet outage concerns the telecom cables that land in the country.
      return cables.filter((cable) => cable.kind === "telecom" && cable.countries.includes(locator.country)).map((cable) => toMatch(cable, "country", null));
    default: {
      const unhandled: never = locator;
      return unhandled;
    }
  }
}
