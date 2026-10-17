import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { REGIONS } from "@/data/regions";
import { LINE_SOURCES, LIVE_SOURCES } from "@/data/regions/sources";
import { buildCableSeedSql, buildWatchedRegionsSql, quoteSqlText, toMultiLineStringWkt } from "@/lib/regions/region-sql";

const MIGRATIONS_DIR = path.resolve(import.meta.dir, "../../../supabase/migrations");
const migrationNames = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();

function readMigration(name: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
}

describe("the database copy of the registry", () => {
  test("the newest migration that writes public.watched_regions writes exactly the registry", () => {
    const writers = migrationNames.filter((name) => readMigration(name).includes("insert into public.watched_regions ("));
    const newest = writers.at(-1);
    expect(newest).toBeDefined();
    if (!newest) return;
    // Fails after a registry change until scripts/regions/build-regions-sql.ts output lands in a new migration.
    expect(readMigration(newest)).toContain(buildWatchedRegionsSql(REGIONS, LIVE_SOURCES));
  });

  test("every region but the Gulf of Finland, seeded in 20261017020100, has its own seed migration naming only itself", () => {
    const seeded = REGIONS.filter((region) => region.id !== "gulf-of-finland").map((region) => {
      const fileName = migrationNames.find((name) => name.endsWith(`_seed_${region.id.replaceAll("-", "_")}_cables.sql`));
      const regionIds = fileName ? [...readMigration(fileName).matchAll(/values \('([a-z-]+)', /gu)].map((match) => match[1]) : [];
      return { region: region.id, hasFile: fileName !== undefined, onlyItself: regionIds.length > 0 && regionIds.every((regionId) => regionId === region.id) };
    });
    expect(seeded.filter((entry) => !entry.hasFile || !entry.onlyItself)).toEqual([]);
  });
});

describe("SQL text", () => {
  test("quotes text and writes WKT at five decimals", () => {
    expect(quoteSqlText("Ölands södra udde's cable")).toBe("'Ölands södra udde''s cable'");
    expect(
      toMultiLineStringWkt([
        [
          [24.1234567, 59.5],
          [24.2, 59.6],
        ],
      ]),
    ).toBe("MULTILINESTRING((24.12346 59.50000, 24.20000 59.60000))");
  });

  test("builds an idempotent seed with the source's credit, licence and the line's own link", () => {
    const perth = REGIONS.find((region) => region.id === "perth");
    expect(perth).toBeDefined();
    if (!perth) return;
    const sql = buildCableSeedSql(
      { ...perth, lineSources: ["openstreetmap"] },
      [
        {
          name: "Test cable",
          kind: "telecom",
          sourceId: "openstreetmap",
          sourceRef: "way/42",
          parts: [
            [
              [115.1, -31.9],
              [115.2, -31.95],
            ],
          ],
          ends: [],
          landingCountries: ["AU"],
        },
      ],
      LINE_SOURCES,
    );
    expect(sql).toContain(
      "values ('perth', 'Test cable', 'telecom', 'OpenStreetMap contributors (ODbL 1.0)', 'ODbL 1.0', 'https://www.openstreetmap.org/way/42', extensions.st_geogfromtext('SRID=4326;MULTILINESTRING((115.10000 -31.90000, 115.20000 -31.95000))'))",
    );
    expect(sql).toContain("on conflict (region_id, name, kind) do update set");
    expect(sql).toContain("  ('Test cable', 'telecom', 'AU')\n) as landing (cable_name, cable_kind, country_code) on cables.region_id = 'perth'");
  });
});
