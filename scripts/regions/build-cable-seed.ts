// Writes one region's cable and pipeline seed migration from downloaded route data.
//
// Inputs (not committed; download into .scratch, queries in docs/REGIONS.md):
//   OpenStreetMap: an Overpass `out tags geom` reply for the region box plus 0.2 degrees
//   ACMA (Perth): the GeoJSON of WFS layer becrc:becrc_wp2_acma_submarine_cable_locations_2021
// Usage: bun scripts/regions/build-cable-seed.ts <region-id> <routes.json> <migration.sql>
// Exit codes: 0 written, 2 bad arguments or unreadable input.
import { readFileSync, writeFileSync } from "node:fs";
import { REGIONS } from "@/data/regions";
import { LINE_SOURCES } from "@/data/regions/sources";
import { SEED_OPTIONS } from "@/data/regions/seed-options";
import { buildSeedLines, countSeedPoints, parseAcmaCableLines, parseOverpassLines } from "@/lib/regions/line-network";
import { findRegion } from "@/lib/regions/region";
import { buildCableSeedSql } from "@/lib/regions/region-sql";

function main(): number {
  const [regionId, routesPath, migrationPath] = process.argv.slice(2);
  if (!regionId || !routesPath || !migrationPath) {
    console.error("[buildCableSeed] usage: bun scripts/regions/build-cable-seed.ts <region-id> <routes.json> <migration.sql>");
    return 2;
  }
  const region = findRegion(REGIONS, regionId);
  if (!region.ok) {
    console.error(`[buildCableSeed] ${region.reason}`);
    return 2;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(routesPath, "utf8"));
  } catch (error) {
    console.error(`[buildCableSeed] ${routesPath} unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const isGeoJson = typeof payload === "object" && payload !== null && "features" in payload;
  const rawLines = isGeoJson ? parseAcmaCableLines(payload) : parseOverpassLines(payload);
  if (!rawLines.ok) {
    console.error(`[buildCableSeed] ${rawLines.reason}`);
    return 2;
  }
  const unexpected = rawLines.value.find((line) => !region.value.lineSources.includes(line.sourceId));
  if (unexpected) {
    console.error(`[buildCableSeed] ${regionId} does not list ${unexpected.sourceId} among its line sources`);
    return 2;
  }
  const lines = buildSeedLines(rawLines.value, { ...SEED_OPTIONS, box: region.value.box });
  const sql = buildCableSeedSql(region.value, lines, LINE_SOURCES);
  writeFileSync(migrationPath, sql);
  console.log(`[buildCableSeed] ${regionId}: ${rawLines.value.length} raw lines, ${lines.length} seeded, ${countSeedPoints(lines)} points, ${Buffer.byteLength(sql)} bytes to ${migrationPath}`);
  return 0;
}

process.exit(main());
