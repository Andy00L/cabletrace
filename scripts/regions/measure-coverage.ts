// Measures, from stored /live ship frames, how many positions each candidate region would store a minute within its
// near-cable distance, so regions are picked and the storage budget is written from numbers (docs/REGIONS.md).
//
// Inputs (not committed; download into .scratch):
//   <frames dir>  frames/<slot>.bin.gz files listed by https://cabletrace.vercel.app/api/ship-frames/index.json
//   <lines dir>   <region-id>.json per region: an Overpass `out tags geom` reply, or the ACMA GeoJSON layer
//                 (the queries are in docs/REGIONS.md)
// Usage: bun scripts/regions/measure-coverage.ts <frames dir> <lines dir> [near-cable metres, default each region's own]
//
// A frame holds each ship's latest report of its 10-minute slot (src/lib/live/frame-layout.ts), so per frame:
//   moving near-cable ships    reported in the 2 minutes before the frame (heard in that run), 0.5 knots or faster;
//                              the recorder stores one position a minute for each of them
//   stationary near-cable ships reported in the 10 minutes before the frame, slower or without speed; thinning keeps
//                              one position per 10 minutes for each (stationaryRepeatMinutes)
//   rows a minute               moving + stationary / 10
// Exit codes: 0 measured, 2 could not measure (missing or unreadable inputs).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { REGIONS } from "@/data/regions";
import { gunzipBytes } from "@/lib/live/frame-compression";
import { decodeShipFrame, readShipRecords, type ShipRecord } from "@/lib/live/snapshot-codec";
import { buildSeedLines, countSeedPoints, parseAcmaCableLines, parseOverpassLines, type RawLine, type SeedLine } from "@/lib/regions/line-network";
import { createNearLineIndex } from "@/lib/regions/near-line-index";
import { isInsideBox, type BoundingBox, type RecordingThresholds } from "@/lib/regions/region";
import type { Result } from "@/lib/result";
import { DEFAULT_RECORDING } from "@/data/regions/recording-defaults";
import { SEED_OPTIONS } from "@/data/regions/seed-options";

// Regions measured for slots 7 and 8 besides the registry (ambition-pass 6.4 names the Red Sea, the Danish straits
// and the Irish Sea; the box counts of 17 Oct 2026 added the English Channel and the southern North Sea).
const CANDIDATE_REGIONS: readonly { id: string; box: BoundingBox }[] = [
  { id: "danish-straits-kattegat", box: { west: 9.5, east: 13.0, south: 54.3, north: 58.0 } },
  { id: "irish-sea", box: { west: -6.5, east: -2.8, south: 51.5, north: 55.0 } },
  { id: "english-channel", box: { west: -2.0, east: 2.0, south: 49.5, north: 51.5 } },
  { id: "southern-north-sea", box: { west: 2.0, east: 9.0, south: 51.0, north: 55.5 } },
  { id: "red-sea", box: { west: 32.0, east: 44.0, south: 12.0, north: 30.0 } },
];
// Heard in the run that wrote the frame: the collector listens 105 s and stamps the frame just after.
const HEARD_IN_RUN_MS = 2 * 60_000;
const STATIONARY_WINDOW_MS = 10 * 60_000;

type MeasuredRegion = { id: string; box: BoundingBox; recording: RecordingThresholds };
type FrameCount = { inBox: number; heard: number; moving: number; stationary: number; aisstreamNear: number; rowsPerMinute: number };

function readLines(linesDir: string, regionId: string): Result<RawLine[]> {
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(path.join(linesDir, `${regionId}.json`), "utf8"));
  } catch (error) {
    return { ok: false, reason: `${regionId}.json unreadable: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof payload === "object" && payload !== null && "features" in payload) return parseAcmaCableLines(payload);
  return parseOverpassLines(payload);
}

async function readFrames(framesDir: string): Promise<Result<{ frameTimeMs: number; ships: ShipRecord[] }[]>> {
  let names: string[];
  try {
    names = readdirSync(framesDir).filter((name) => name.endsWith(".bin.gz")).sort();
  } catch (error) {
    return { ok: false, reason: `frames folder unreadable: ${error instanceof Error ? error.message : String(error)}` };
  }
  const frames: { frameTimeMs: number; ships: ShipRecord[] }[] = [];
  for (const name of names) {
    const raw = await gunzipBytes(new Uint8Array(readFileSync(path.join(framesDir, name))));
    const decoded = raw.ok ? decodeShipFrame(raw.value) : raw;
    if (!decoded.ok) return { ok: false, reason: `${name}: ${decoded.reason}` };
    frames.push({ frameTimeMs: decoded.value.frameTimeMs, ships: readShipRecords(decoded.value) });
  }
  return frames.length === 0 ? { ok: false, reason: "no frames found" } : { ok: true, value: frames };
}

function countFrame(frame: { frameTimeMs: number; ships: ShipRecord[] }, region: MeasuredRegion, isNearLine: (ship: ShipRecord) => boolean): FrameCount {
  const count: FrameCount = { inBox: 0, heard: 0, moving: 0, stationary: 0, aisstreamNear: 0, rowsPerMinute: 0 };
  for (const ship of frame.ships) {
    if (!isInsideBox(region.box, ship.longitude, ship.latitude)) continue;
    count.inBox += 1;
    const ageMs = frame.frameTimeMs - ship.reportedAtMs;
    if (ageMs <= HEARD_IN_RUN_MS) count.heard += 1;
    const isMoving = ship.speedKnots !== null && ship.speedKnots >= region.recording.stationaryKnots;
    const isCounted = isMoving ? ageMs <= HEARD_IN_RUN_MS : ageMs <= STATIONARY_WINDOW_MS;
    if (!isCounted || !isNearLine(ship)) continue;
    if (isMoving) count.moving += 1;
    else count.stationary += 1;
    if (ship.source === "aisstream") count.aisstreamNear += 1;
  }
  count.rowsPerMinute = count.moving + count.stationary / region.recording.stationaryRepeatMinutes;
  return count;
}

function quantileOf(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
}

function measureRegion(region: MeasuredRegion, lines: readonly SeedLine[], frames: readonly { frameTimeMs: number; ships: ShipRecord[] }[]) {
  const index = createNearLineIndex(lines, region.recording.nearCableMetres);
  const isNearLine = (ship: ShipRecord) => index.findNearest([ship.longitude, ship.latitude]) !== null;
  const counts = frames.map((frame) => countFrame(frame, region, isNearLine));
  const column = (pick: (count: FrameCount) => number) => counts.map(pick);
  return {
    region: region.id,
    lines: lines.length,
    seedPoints: countSeedPoints(lines),
    shipsInBoxMedian: quantileOf(column((count) => count.inBox), 0.5),
    heardInRunMedian: quantileOf(column((count) => count.heard), 0.5),
    nearMovingMedian: quantileOf(column((count) => count.moving), 0.5),
    nearStationaryMedian: quantileOf(column((count) => count.stationary), 0.5),
    nearFromAisstreamMedian: quantileOf(column((count) => count.aisstreamNear), 0.5),
    rowsPerMinuteMedian: Math.round(quantileOf(column((count) => count.rowsPerMinute), 0.5) * 10) / 10,
    rowsPerMinuteP90: Math.round(quantileOf(column((count) => count.rowsPerMinute), 0.9) * 10) / 10,
    rowsPerMinuteMean: Math.round((column((count) => count.rowsPerMinute).reduce((sum, rows) => sum + rows, 0) / counts.length) * 10) / 10,
  };
}

async function main(): Promise<number> {
  const [framesDir, linesDir, nearMetresText] = process.argv.slice(2);
  const nearMetresOverride = nearMetresText === undefined ? null : Number(nearMetresText);
  if (!framesDir || !linesDir || (nearMetresOverride !== null && !(nearMetresOverride > 0))) {
    console.error("[measureCoverage] usage: bun scripts/regions/measure-coverage.ts <frames dir> <lines dir> [near-cable metres]");
    return 2;
  }
  const withDistance = (recording: RecordingThresholds): RecordingThresholds =>
    nearMetresOverride === null ? recording : { ...recording, nearCableMetres: nearMetresOverride };
  const frames = await readFrames(framesDir);
  if (!frames.ok) {
    console.error(`[measureCoverage] ${frames.reason}`);
    return 2;
  }
  const first = frames.value[0];
  const last = frames.value[frames.value.length - 1];
  console.log(`[measureCoverage] ${frames.value.length} frames, ${first ? new Date(first.frameTimeMs).toISOString() : "?"} to ${last ? new Date(last.frameTimeMs).toISOString() : "?"}`);
  const registered: MeasuredRegion[] = REGIONS.map((region) => ({ id: region.id, box: region.box, recording: withDistance(region.recording) }));
  const candidates: MeasuredRegion[] = CANDIDATE_REGIONS.filter((candidate) => !REGIONS.some((region) => region.id === candidate.id)).map((candidate) => ({
    ...candidate,
    recording: withDistance(DEFAULT_RECORDING),
  }));
  let hasFailure = false;
  for (const region of [...registered, ...candidates]) {
    const rawLines = readLines(linesDir, region.id);
    if (!rawLines.ok) {
      // A candidate without routes on disk (the Red Sea: aisstream hears no ship there) still gets its ship counts.
      console.log(`[measureCoverage] ${region.id}: no routes (${rawLines.reason}); ship counts only`);
      hasFailure = hasFailure || registered.includes(region);
    }
    const lines = rawLines.ok ? buildSeedLines(rawLines.value, { ...SEED_OPTIONS, box: region.box }) : [];
    console.log(`[measureCoverage] ${JSON.stringify(measureRegion(region, lines, frames.value))}`);
  }
  return hasFailure ? 2 : 0;
}

process.exit(await main());
