// Writes one region's cable and pipeline seed migration from downloaded route data, with each line's landing countries.
//
// Inputs (not committed; download into .scratch, queries in docs/REGIONS.md):
//   OpenStreetMap: an Overpass `out tags geom` reply for the region box plus 0.2 degrees
//   ACMA (Perth): the GeoJSON of WFS layer becrc:becrc_wp2_acma_submarine_cable_locations_2021
//   Countries: Natural Earth ne_10m_admin_0_countries.geojson (v5.1.2, public domain)
// Usage: bun scripts/regions/build-cable-seed.ts <region-id> <routes.json> <countries.geojson> <migration.sql>
// Exit codes: 0 written, 2 bad arguments or unreadable input.
import { readFileSync, writeFileSync } from "node:fs";
import { REGIONS } from "@/data/regions";
import { LINE_SOURCES } from "@/data/regions/sources";
import { SEED_OPTIONS } from "@/data/regions/seed-options";
import { findLandingCountries, parseCountryShapes } from "@/lib/regions/landing-countries";
import { buildSeedLines, countSeedPoints, parseAcmaCableLines, parseOverpassLines } from "@/lib/regions/line-network";
import { findRegion } from "@/lib/regions/region";
import { buildCableSeedSql } from "@/lib/regions/region-sql";
import type { Result } from "@/lib/result";

function readJson(filePath: string): Result<unknown> {
  try {
    return { ok: true, value: JSON.parse(readFileSync(filePath, "utf8")) };
  } catch (error) {
    return { ok: false, reason: `${filePath} unreadable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function main(): number {
  const [regionId, routesPath, countriesPath, migrationPath] = process.argv.slice(2);
  if (!regionId || !routesPath || !countriesPath || !migrationPath) {
    console.error("[buildCableSeed] usage: bun scripts/regions/build-cable-seed.ts <region-id> <routes.json> <countries.geojson> <migration.sql>");
    return 2;
  }
  const region = findRegion(REGIONS, regionId);
  const payload = readJson(routesPath);
  const countriesPayload = readJson(countriesPath);
  const failure = [region, payload, countriesPayload].find((outcome) => !outcome.ok);
  if (failure && !failure.ok) {
    console.error(`[buildCableSeed] ${failure.reason}`);
    return 2;
  }
  if (!region.ok || !payload.ok || !countriesPayload.ok) return 2;
  const isGeoJson = typeof payload.value === "object" && payload.value !== null && "features" in payload.value;
  const rawLines = isGeoJson ? parseAcmaCableLines(payload.value) : parseOverpassLines(payload.value);
  const countries = parseCountryShapes(countriesPayload.value);
  if (!rawLines.ok || !countries.ok) {
    console.error(`[buildCableSeed] ${!rawLines.ok ? rawLines.reason : !countries.ok ? countries.reason : ""}`);
    return 2;
  }
  const unexpected = rawLines.value.find((line) => !region.value.lineSources.includes(line.sourceId));
  if (unexpected) {
    console.error(`[buildCableSeed] ${regionId} does not list ${unexpected.sourceId} among its line sources`);
    return 2;
  }
  const lines = buildSeedLines(rawLines.value, { ...SEED_OPTIONS, box: region.value.box }).map((line) => ({
    ...line,
    landingCountries: findLandingCountries(line.ends, countries.value),
  }));
  const sql = buildCableSeedSql(region.value, lines, LINE_SOURCES);
  writeFileSync(migrationPath, sql);
  const landed = lines.filter((line) => line.landingCountries.length > 0).length;
  const codes = [...new Set(lines.flatMap((line) => line.landingCountries))].sort().join(" ");
  console.log(
    `[buildCableSeed] ${regionId}: ${rawLines.value.length} raw lines, ${lines.length} seeded, ${countSeedPoints(lines)} points, ${landed} with landing countries (${codes || "none"}), ${Buffer.byteLength(sql)} bytes to ${migrationPath}`,
  );
  return 0;
}

process.exit(main());
