// Prints a case file's recorded AIS fixes (src/data/cases/*-ais.ts) from a Danish Maritime Authority day file.
// Keeps one vessel's rows inside a time span, the first row of every sampling step, and always the last row
// of the span, so the list can be rebuilt from the same archive file.
// Input: an aisdk-YYYY-MM-DD.csv from https://s3.eu-central-1.amazonaws.com/aisdata.ais.dk/aisdk-YYYY-MM-DD.zip
// (the whole day file, or rows already filtered from it with the same columns).
// Usage: bun scripts/cases/extract-ais-fixes.ts <csv> <mmsi> <startUtc> <endUtc> <stepSeconds> > fixes.txt
import { readFile } from "node:fs/promises";

// Column order of the DMA CSV header: "# Timestamp,Type of mobile,MMSI,Latitude,Longitude,...,SOG,..."
const TIMESTAMP_COLUMN = 0;
const MMSI_COLUMN = 2;
const LATITUDE_COLUMN = 3;
const LONGITUDE_COLUMN = 4;
const SPEED_COLUMN = 7;

type Fix = { atMs: number; longitude: number; latitude: number; speedKnots: number };

/**
 * "18/11/2024 06:01:44" to milliseconds. The archive does not state a zone; the rows are read as UTC, which
 * the Yi Peng 3 case checks against Cinia's fault time (plan/research/yi-peng-3-reconstruction.md).
 */
function parseTimestamp(text: string): number {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!match) return Number.NaN;
  const [, day, month, year, hour, minute, second] = match;
  return Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
}

function parseRow(line: string, mmsi: string): Fix | null {
  const columns = line.split(",");
  if (columns[MMSI_COLUMN] !== mmsi) return null;
  const fix = {
    atMs: parseTimestamp(columns[TIMESTAMP_COLUMN] ?? ""),
    latitude: Number(columns[LATITUDE_COLUMN]),
    longitude: Number(columns[LONGITUDE_COLUMN]),
    speedKnots: Number(columns[SPEED_COLUMN]),
  };
  const isComplete = [fix.atMs, fix.latitude, fix.longitude, fix.speedKnots].every((value) => Number.isFinite(value)) && columns[SPEED_COLUMN] !== "";
  return isComplete ? fix : null;
}

function formatFix(fix: Fix): string {
  const atUtc = new Date(fix.atMs).toISOString().replace(".000Z", "Z");
  return `  { atUtc: "${atUtc}", longitude: ${fix.longitude.toFixed(5)}, latitude: ${fix.latitude.toFixed(5)}, speedKnots: ${fix.speedKnots} },`;
}

async function main() {
  const [csvPath = "", mmsi = "", startUtc = "", endUtc = "", stepText = ""] = process.argv.slice(2);
  const startMs = Date.parse(startUtc);
  const endMs = Date.parse(endUtc);
  const stepMs = Number(stepText) * 1000;
  if (!csvPath || !mmsi || !Number.isFinite(startMs) || !Number.isFinite(endMs) || !(stepMs > 0)) {
    console.error("[main] usage: extract-ais-fixes.ts <csv> <mmsi> <startUtc> <endUtc> <stepSeconds>");
    process.exit(1);
  }
  const lines = (await readFile(csvPath, "utf8")).split("\n");
  const fixes = lines
    .map((line) => parseRow(line, mmsi))
    .filter((fix): fix is Fix => fix !== null && fix.atMs >= startMs && fix.atMs <= endMs)
    .sort((first, second) => first.atMs - second.atMs);
  const kept: Fix[] = [];
  let nextStepMs = Number.NEGATIVE_INFINITY;
  for (const fix of fixes) {
    if (fix.atMs < nextStepMs) continue;
    kept.push(fix);
    nextStepMs = startMs + (Math.floor((fix.atMs - startMs) / stepMs) + 1) * stepMs;
  }
  const lastFix = fixes[fixes.length - 1];
  if (lastFix && kept[kept.length - 1] !== lastFix) kept.push(lastFix);
  console.error(`[main] ${fixes.length} rows for MMSI ${mmsi} in the span, ${kept.length} kept`);
  console.log(kept.map(formatFix).join("\n"));
}

await main();
