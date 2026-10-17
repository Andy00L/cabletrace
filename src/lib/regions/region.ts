// The watched-region registry's types and the pure functions every reader shares: the recorder (supabase/functions/
// record-vessel-positions), the cable seed builder (scripts/regions), the cross-source check, and later the globe, the
// case list and the seabed builder. Readers take a region's values from its data (src/data/regions); none of them may
// branch on a region id.
//
// Runtime imports between src files use the "@/" alias: tsc resolves it through tsconfig paths and the edge runtime
// through the recorder's deno.json import map (checked by src/lib/regions/module-boundaries.test.ts).
import type { Result } from "@/lib/result";

/** Degrees, west and south inclusive. No region crosses the antimeridian, so west is always below east. */
export type BoundingBox = { west: number; east: number; south: number; north: number };

/** The live AIS feeds a region can be recorded from (src/data/regions/live-sources.ts). */
export type LiveSourceId = "digitraffic" | "aisstream";

export type LiveSource = {
  id: LiveSourceId;
  name: string;
  url: string;
  licence: string;
  /** The line every page that draws these positions must show. */
  credit: string;
  /**
   * Longest time a position from this source may be kept anywhere (database, archive files), in hours; null when the
   * licence sets no limit. aisstream publishes no terms, so its data is kept at most 2 days (project rule, 2026-10-17,
   * supabase/migrations/20261018400000_ship_frames.sql).
   */
  maxRetentionHours: number | null;
};

/** Cable and pipeline kinds, the values public.cables.kind accepts (supabase/migrations/20261017020000_live_recorder.sql). */
export type LineKind = "power" | "telecom" | "pipeline";

export type LineSourceId = "openstreetmap" | "emodnet-human-activities" | "acma-cable-locations-2021";

/** Where a region's cable and pipeline routes come from, and the terms they come under. */
export type LineSource = {
  id: LineSourceId;
  name: string;
  url: string;
  licence: string;
  credit: string;
};

/**
 * How the recorder treats positions in a region. The database applies these values (public.watched_regions, written
 * from this registry by scripts/regions/build-regions-sql.ts), so a change here takes a migration.
 */
export type RecordingThresholds = {
  /** A position is stored only this close to a cable or pipeline, in metres. */
  nearCableMetres: number;
  /**
   * A ship's stored track reaches the detector (public.detection_inputs) only after one of its reports in the drag
   * speed band came this close to a cable, in metres; at most nearCableMetres. Widening nearCableMetres alone then
   * lengthens the tracks of the same ships instead of adding ships to every detector call.
   */
  candidateCableMetres: number;
  /** A report under this speed, or without one, counts as stationary, in knots. */
  stationaryKnots: number;
  /** A stationary report is skipped when the ship has a stored position this recent (minutes) and this close (metres). */
  stationaryRepeatMinutes: number;
  stationaryRepeatMetres: number;
  /** Positions stay in the database this long, in hours; the source's maxRetentionHours caps it. */
  hotRetentionHours: number;
};

/** A cable incident in or near the region that makes it worth watching; `caseSlug` when CableTrace replays it. */
export type RegionIncident = { name: string; year: number; caseSlug: string | null };

export type Region = {
  /** Lowercase words joined by hyphens; also the region_id in public.cables and public.watched_regions. */
  id: string;
  name: string;
  box: BoundingBox;
  /** IANA time zone of the waters, for local times in cards and case timelines. */
  timeZone: string;
  /** Feeds the recorder stores positions from, inside `box`. */
  liveSources: readonly LiveSourceId[];
  /** Where the seeded cable and pipeline routes come from. */
  lineSources: readonly LineSourceId[];
  recording: RecordingThresholds;
  /** Seabed blocks built for this region (scripts/seabed/build-seabed.ts, public/seabed); empty where none exists yet. */
  seabedAreaIds: readonly string[];
  incidents: readonly RegionIncident[];
  /** One or two sentences: why the region is watched, with the measured numbers behind the choice (docs/REGIONS.md). */
  reason: string;
};

const REGION_ID_PATTERN = /^[a-z]+(?:-[a-z]+)*$/u;

export function isInsideBox(box: BoundingBox, longitude: number, latitude: number): boolean {
  return longitude >= box.west && longitude <= box.east && latitude >= box.south && latitude <= box.north;
}

/** The region whose box holds the point, or null. Boxes never overlap (findRegistryProblems), so at most one does. */
export function findRegionAt(regions: readonly Region[], longitude: number, latitude: number): Region | null {
  return regions.find((region) => isInsideBox(region.box, longitude, latitude)) ?? null;
}

/** Regions recorded from the given feed. */
export function selectRegionsBySource(regions: readonly Region[], sourceId: LiveSourceId): Region[] {
  return regions.filter((region) => region.liveSources.includes(sourceId));
}

/** aisstream's subscription format: one [[south, west], [north, east]] corner pair per box (aisstream.io/documentation). */
export function toAisstreamBoundingBoxes(boxes: readonly BoundingBox[]): [[number, number], [number, number]][] {
  return boxes.map((box) => [
    [box.south, box.west],
    [box.north, box.east],
  ]);
}

/** Hours a region's positions may stay in the database: its own setting, capped by its strictest source. */
export function effectiveRetentionHours(region: Region, sources: Readonly<Record<LiveSourceId, LiveSource>>): number {
  return region.liveSources.reduce((hours, sourceId) => {
    const cap = sources[sourceId].maxRetentionHours;
    return cap === null ? hours : Math.min(hours, cap);
  }, region.recording.hotRetentionHours);
}

function boxesOverlap(first: BoundingBox, second: BoundingBox): boolean {
  return first.west < second.east && second.west < first.east && first.south < second.north && second.south < first.north;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function findRegionProblems(region: Region): string[] {
  const problems: string[] = [];
  const { box, recording } = region;
  if (!REGION_ID_PATTERN.test(region.id)) problems.push(`${region.id}: id must be lowercase words joined by hyphens`);
  if (!(box.west >= -180 && box.east <= 180 && box.west < box.east)) problems.push(`${region.id}: west must be below east inside -180 to 180`);
  if (!(box.south >= -90 && box.north <= 90 && box.south < box.north)) problems.push(`${region.id}: south must be below north inside -90 to 90`);
  if (!isValidTimeZone(region.timeZone)) problems.push(`${region.id}: ${region.timeZone} is not an IANA time zone`);
  if (region.liveSources.length === 0) problems.push(`${region.id}: no live source`);
  if (region.lineSources.length === 0) problems.push(`${region.id}: no cable or pipeline source`);
  const isPositive = [
    recording.nearCableMetres,
    recording.candidateCableMetres,
    recording.stationaryRepeatMinutes,
    recording.stationaryRepeatMetres,
    recording.hotRetentionHours,
  ].every((value) => Number.isFinite(value) && value > 0);
  if (!isPositive || !(recording.stationaryKnots >= 0)) problems.push(`${region.id}: recording thresholds must be positive`);
  if (recording.candidateCableMetres > recording.nearCableMetres) problems.push(`${region.id}: candidateCableMetres is wider than nearCableMetres`);
  if (region.reason.trim() === "") problems.push(`${region.id}: no reason given`);
  return problems;
}

/** Every problem in the registry: malformed regions, repeated ids, overlapping boxes. Empty when it is sound. */
export function findRegistryProblems(regions: readonly Region[]): string[] {
  const problems = regions.flatMap(findRegionProblems);
  regions.forEach((region, regionIndex) => {
    regions.slice(regionIndex + 1).forEach((other) => {
      if (other.id === region.id) problems.push(`${region.id}: id used twice`);
      // A position must belong to one region only, or the recorder would store it under two retention rules.
      else if (boxesOverlap(region.box, other.box)) problems.push(`${region.id} and ${other.id}: boxes overlap`);
    });
  });
  return problems;
}

/** Looks a region up by id, for scripts that take one on the command line. */
export function findRegion(regions: readonly Region[], regionId: string): Result<Region> {
  const region = regions.find((candidate) => candidate.id === regionId);
  return region ? { ok: true, value: region } : { ok: false, reason: `unknown region "${regionId}"; known: ${regions.map((known) => known.id).join(", ")}` };
}
