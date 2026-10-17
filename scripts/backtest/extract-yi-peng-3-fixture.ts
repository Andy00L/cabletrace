// Prints scripts/backtest/yi-peng-3-track.ts from the Danish Maritime Authority day file, so the backtest runs
// offline on the same rows. Keeps Yi Peng 3 (MMSI 414270000) from 06:00 to 12:00 UTC on 18 Nov 2024, the first row
// of every minute (the cadence the live recorder stores for a moving ship), with course, heading and status.
// Input: aisdk-2024-11-18.csv from https://s3.eu-central-1.amazonaws.com/aisdata.ais.dk/2024/aisdk-2024-11-18.zip,
// or the rows already filtered from it with the same columns (unzip -p ... | awk -F, 'NR==1 || $3=="414270000"').
// Usage: bun scripts/backtest/extract-yi-peng-3-fixture.ts <csv> > scripts/backtest/yi-peng-3-track.ts
import { readFile } from "node:fs/promises";

// Column order of the DMA CSV header:
// "# Timestamp,Type of mobile,MMSI,Latitude,Longitude,Navigational status,ROT,SOG,COG,Heading,..."
const TIMESTAMP_COLUMN = 0;
const MMSI_COLUMN = 2;
const LATITUDE_COLUMN = 3;
const LONGITUDE_COLUMN = 4;
const STATUS_COLUMN = 5;
const SPEED_COLUMN = 7;
const COURSE_COLUMN = 8;
const HEADING_COLUMN = 9;
const YI_PENG_3_MMSI = "414270000";
const SPAN_START_MS = Date.parse("2024-11-18T06:00:00Z");
const SPAN_END_MS = Date.parse("2024-11-18T12:00:00Z");
const STEP_MS = 60_000;
// The DMA archive spells the navigational status out; these are the ITU-R M.1371 codes for the values it uses.
const STATUS_CODES: Record<string, number> = {
  "Under way using engine": 0,
  "At anchor": 1,
  "Not under command": 2,
  "Restricted manoeuverability": 3,
  "Constrained by her draught": 4,
  Moored: 5,
  Aground: 6,
  "Engaged in fishing": 7,
  "Under way sailing": 8,
};

type Row = { atMs: number; longitude: number; latitude: number; speedKnots: number | null; courseDegrees: number | null; headingDegrees: number | null; navigationStatus: number | null };

/** "18/11/2024 06:01:44" read as UTC, as scripts/cases/extract-ais-fixes.ts does. */
function parseTimestamp(text: string): number {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!match) return Number.NaN;
  const [, day, month, year, hour, minute, second] = match;
  return Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
}

function readOptionalNumber(text: string | undefined): number | null {
  if (text === undefined || text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function parseRow(line: string): Row | null {
  const columns = line.split(",");
  if (columns[MMSI_COLUMN] !== YI_PENG_3_MMSI) return null;
  const atMs = parseTimestamp(columns[TIMESTAMP_COLUMN] ?? "");
  const latitude = Number(columns[LATITUDE_COLUMN]);
  const longitude = Number(columns[LONGITUDE_COLUMN]);
  if (![atMs, latitude, longitude].every((value) => Number.isFinite(value))) return null;
  return {
    atMs,
    longitude,
    latitude,
    speedKnots: readOptionalNumber(columns[SPEED_COLUMN]),
    courseDegrees: readOptionalNumber(columns[COURSE_COLUMN]),
    headingDegrees: readOptionalNumber(columns[HEADING_COLUMN]),
    navigationStatus: STATUS_CODES[columns[STATUS_COLUMN] ?? ""] ?? null,
  };
}

function formatRow(row: Row): string {
  const atUtc = new Date(row.atMs).toISOString().replace(".000Z", "Z");
  return `  { atUtc: "${atUtc}", longitude: ${row.longitude.toFixed(5)}, latitude: ${row.latitude.toFixed(5)}, speedKnots: ${row.speedKnots}, courseDegrees: ${row.courseDegrees}, headingDegrees: ${row.headingDegrees}, navigationStatus: ${row.navigationStatus} },`;
}

async function main() {
  const [csvPath = ""] = process.argv.slice(2);
  if (!csvPath) {
    console.error("[main] usage: extract-yi-peng-3-fixture.ts <csv>");
    process.exit(1);
  }
  const rows = (await readFile(csvPath, "utf8"))
    .split("\n")
    .map(parseRow)
    .filter((row): row is Row => row !== null && row.atMs >= SPAN_START_MS && row.atMs < SPAN_END_MS)
    .sort((first, second) => first.atMs - second.atMs);
  const kept = rows.filter((row, index) => {
    const previous = rows[index - 1];
    return previous === undefined || Math.floor(previous.atMs / STEP_MS) !== Math.floor(row.atMs / STEP_MS);
  });
  console.error(`[main] ${rows.length} rows for MMSI ${YI_PENG_3_MMSI} from 06:00 to 12:00 UTC, ${kept.length} kept`);
  // The generated file is the script's output, written to stdout as data.
  process.stdout.write(`// Generated, do not edit by hand. Yi Peng 3 (MMSI 414270000) in the Danish Maritime Authority archive file
// aisdk-2024-11-18.zip, 06:00 to 12:00 UTC, the first row of every minute, ${kept.length} rows:
//   bun scripts/backtest/extract-yi-peng-3-fixture.ts aisdk-2024-11-18.csv > scripts/backtest/yi-peng-3-track.ts
// Navigational status as ITU-R M.1371 codes (0 under way using engine).
export type ArchiveRow = {
  atUtc: string;
  longitude: number;
  latitude: number;
  speedKnots: number | null;
  courseDegrees: number | null;
  headingDegrees: number | null;
  navigationStatus: number | null;
};

export const YI_PENG_3_ARCHIVE_ROWS: ArchiveRow[] = [
${kept.map(formatRow).join("\n")}
];
`);
}

await main();
