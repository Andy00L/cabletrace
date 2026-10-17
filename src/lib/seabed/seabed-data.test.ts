import { describe, expect, test } from "bun:test";
import { parseSeabedFeatures } from "./seabed-data";

const VALID_FEATURES = {
  version: 1,
  region: { west: 25.45, east: 26.45, south: 59.75, north: 60.3 },
  grid: { width: 321, height: 177 },
  elevationRange: { lowestMetres: -118.3, highestMetres: 118.8 },
  lines: [{ name: "HVDC Estlink 2", kind: "power", points: [[25.5, 60.2], [25.9, 59.9]] }],
  places: [{ name: "Finland", longitude: 25.62, latitude: 60.27 }],
  sources: { depth: "EMODnet Bathymetry", land: "Copernicus DEM GLO-30", cables: "OpenStreetMap contributors", pipelines: "EMODnet Human Activities" },
};

describe("parseSeabedFeatures", () => {
  test("accepts the shipped file shape", () => {
    const parsed = parseSeabedFeatures(VALID_FEATURES);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.lines[0]?.points).toHaveLength(2);
  });

  test("rejects an inverted region, a tiny grid, an unknown line kind and a broken point", () => {
    expect(parseSeabedFeatures({ ...VALID_FEATURES, region: { ...VALID_FEATURES.region, west: 27 } }).ok).toBe(false);
    expect(parseSeabedFeatures({ ...VALID_FEATURES, grid: { width: 1, height: 177 } }).ok).toBe(false);
    expect(parseSeabedFeatures({ ...VALID_FEATURES, elevationRange: undefined }).ok).toBe(false);
    expect(parseSeabedFeatures({ ...VALID_FEATURES, elevationRange: { lowestMetres: 12, highestMetres: 80 } }).ok).toBe(false);
    expect(parseSeabedFeatures({ ...VALID_FEATURES, lines: [{ ...VALID_FEATURES.lines[0], kind: "fibre" }] }).ok).toBe(false);
    expect(parseSeabedFeatures({ ...VALID_FEATURES, lines: [{ ...VALID_FEATURES.lines[0], points: [[25.5, 60.2], [25.9]] }] }).ok).toBe(false);
  });

  test("rejects a file without source credits", () => {
    expect(parseSeabedFeatures({ ...VALID_FEATURES, sources: undefined }).ok).toBe(false);
  });

  test("treats places as optional but rejects a malformed one", () => {
    expect(parseSeabedFeatures({ ...VALID_FEATURES, places: undefined }).ok).toBe(true);
    expect(parseSeabedFeatures({ ...VALID_FEATURES, places: [{ name: "Finland" }] }).ok).toBe(false);
  });
});
