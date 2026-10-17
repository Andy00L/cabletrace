// Builds the Gulf of Finland seabed files for the 3D view:
//   <out>/gulf-of-finland-terrain.bin  little-endian int16 elevations in decimetres, row 0 = north
//   <out>/gulf-of-finland-seabed.json  region, grid, cable and pipeline lines, place names, sources
// Water depth comes from the EMODnet DTM (gof-depth.txt, WCS text/plain). Land height and the coastline come
// from the Copernicus GLO-30 DEM (sea pixels are exactly 0 in that product).
// Inputs (not committed; download them into any local folder):
//   <map-downloads>/gof-depth.txt          EMODnet WCS GetCoverage, emodnet__mean, 24.0-26.6 E, 59.35-60.35 N, text/plain
//   <map-downloads>/osm-cables-gulf.json   Overpass: power=cable and telecom/communication=line ways in the box, with geometry
//   <map-downloads>/pipelines-gulf.json    EMODnet Human Activities pipelines WFS, GeoJSON
//   <dem-downloads>/N59_00_E024_00.tif ... the six tiles in DEM_TILES, from
//     https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_<tile>_DEM/Copernicus_DSM_COG_10_<tile>_DEM.tif
// Usage: bun scripts/seabed/build-gulf-seabed.ts <map-downloads dir> <dem-downloads dir> public/seabed
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fromFile, type GeoTIFFImage } from "geotiff";

// The whole EMODnet download box: both shores, Porkkala in the west to Kunda in the east.
const REGION = { west: 24.0, east: 26.6, south: 59.35, north: 60.35 };
// EMODnet cell 1/960 degree; vertices every 4 cells in longitude and 2 in latitude, about 232 m either way.
const EMODNET_CELL_DEG = 1 / 960;
const LONGITUDE_STEP_DEG = EMODNET_CELL_DEG * 4;
const LATITUDE_STEP_DEG = EMODNET_CELL_DEG * 2;
// EMODnet grid affine (gof-depth.txt header, "Grid to world"): centre of the north-west cell.
const EMODNET_ORIGIN_LON = 24.00052083333334;
const EMODNET_ORIGIN_LAT = 60.34947916666666;
// A vertex is land when at least this share of the DEM pixels under it is land.
const LAND_SHARE_THRESHOLD = 0.45;
// Coastal water the DTM calls dry still gets this depth (m) so the shoreline reads.
const SHALLOW_WATER_METRES = -1.5;
// Lines keep points this far outside the region (degrees) so tubes reach the block edge.
const CLIP_MARGIN_DEG = 0.03;
// Douglas-Peucker tolerance for cable and pipeline lines (degrees, about 20 m).
const SIMPLIFY_TOLERANCE_DEG = 0.0002;
const DEM_TILES = ["N59_00_E024_00", "N59_00_E025_00", "N59_00_E026_00", "N60_00_E024_00", "N60_00_E025_00", "N60_00_E026_00"];
// OpenStreetMap Nominatim lookups, 17 Oct 2026 (Porkkala is the Porkkalanniemi peninsula node).
const PLACES = [
  { name: "Helsinki", longitude: 24.94354, latitude: 60.16662 },
  { name: "Espoo", longitude: 24.65598, latitude: 60.20497 },
  { name: "Porkkala", longitude: 24.47793, latitude: 60.01524 },
  { name: "Tallinn", longitude: 24.75727, latitude: 59.43724 },
  { name: "Loksa", longitude: 25.71733, latitude: 59.57846 },
  { name: "Kunda", longitude: 26.52922, latitude: 59.50554 },
];
const PIPELINE_NAMES: Record<string, string> = { Balticconnector: "Balticconnector", "NORD STREAM 1": "Nord Stream 1", "NORD STREAM 2": "Nord Stream 2" };
const EXCLUDED_LOCATIONS = new Set(["underground", "overhead", "indoor", "ceiling", "overground"]);

type DemTile = { image: GeoTIFFImage; values: Float32Array; width: number; height: number; west: number; north: number; resolutionLon: number; resolutionLat: number };
type Coordinate = [number, number];
type Line = { name: string; kind: "power" | "telecom" | "pipeline"; points: Coordinate[] };

async function loadDemTiles(demDir: string): Promise<DemTile[]> {
  return Promise.all(
    DEM_TILES.map(async (tileName) => {
      const image = await (await fromFile(path.join(demDir, `${tileName}.tif`))).getImage();
      const [raster] = await image.readRasters({ samples: [0] });
      // A build-time CLI: a wrong tile format should stop the run with a message, not write a bad grid.
      if (!(raster instanceof Float32Array)) throw new Error(`[loadDemTiles] ${tileName} is not float32`);
      const [west = 0, north = 0] = image.getOrigin();
      const [resolutionLon = 0, resolutionLat = 0] = image.getResolution();
      return { image, values: raster, width: image.getWidth(), height: image.getHeight(), west, north, resolutionLon, resolutionLat: -resolutionLat };
    }),
  );
}

function readEmodnetRows(text: string): Float32Array[] {
  const lines = text.split("\n");
  const bandStart = lines.findIndex((line) => line.startsWith("Band 0:")) + 1;
  return lines
    .slice(bandStart)
    .filter((line) => line.trim().length > 0)
    .map((line) => Float32Array.from(line.trim().split(/\s+/), (token) => Number(token)));
}

/** Mean EMODnet depth over the cells whose centres fall in the footprint; NaN when none are valid. */
function sampleEmodnet(rows: Float32Array[], longitude: number, latitude: number): number {
  const firstColumn = Math.ceil((longitude - LONGITUDE_STEP_DEG / 2 - EMODNET_ORIGIN_LON) / EMODNET_CELL_DEG);
  const lastColumn = Math.floor((longitude + LONGITUDE_STEP_DEG / 2 - EMODNET_ORIGIN_LON) / EMODNET_CELL_DEG);
  const firstRow = Math.ceil((EMODNET_ORIGIN_LAT - latitude - LATITUDE_STEP_DEG / 2) / EMODNET_CELL_DEG);
  const lastRow = Math.floor((EMODNET_ORIGIN_LAT - latitude + LATITUDE_STEP_DEG / 2) / EMODNET_CELL_DEG);
  let sum = 0;
  let count = 0;
  for (let row = Math.max(0, firstRow); row <= Math.min(rows.length - 1, lastRow); row += 1) {
    const values = rows[row];
    if (!values) continue;
    for (let column = Math.max(0, firstColumn); column <= Math.min(values.length - 1, lastColumn); column += 1) {
      const value = values[column] ?? Number.NaN;
      if (Number.isNaN(value)) continue;
      sum += value;
      count += 1;
    }
  }
  return count > 0 ? sum / count : Number.NaN;
}

/** Share of land pixels and their mean height (m) under the footprint, across tile borders. */
function sampleDem(tiles: DemTile[], longitude: number, latitude: number): { landShare: number; landMean: number } {
  let pixelCount = 0;
  let landCount = 0;
  let landSum = 0;
  const footprint = { west: longitude - LONGITUDE_STEP_DEG / 2, east: longitude + LONGITUDE_STEP_DEG / 2, south: latitude - LATITUDE_STEP_DEG / 2, north: latitude + LATITUDE_STEP_DEG / 2 };
  for (const tile of tiles) {
    const tileEast = tile.west + tile.width * tile.resolutionLon;
    const tileSouth = tile.north - tile.height * tile.resolutionLat;
    if (footprint.east <= tile.west || footprint.west >= tileEast || footprint.north <= tileSouth || footprint.south >= tile.north) continue;
    const firstColumn = Math.max(0, Math.ceil((footprint.west - tile.west) / tile.resolutionLon - 0.5));
    const lastColumn = Math.min(tile.width - 1, Math.floor((footprint.east - tile.west) / tile.resolutionLon - 0.5));
    const firstRow = Math.max(0, Math.ceil((tile.north - footprint.north) / tile.resolutionLat - 0.5));
    const lastRow = Math.min(tile.height - 1, Math.floor((tile.north - footprint.south) / tile.resolutionLat - 0.5));
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const value = tile.values[row * tile.width + column] ?? 0;
        pixelCount += 1;
        if (value === 0) continue;
        landCount += 1;
        landSum += value;
      }
    }
  }
  return { landShare: pixelCount > 0 ? landCount / pixelCount : 0, landMean: landCount > 0 ? landSum / landCount : 0 };
}

function buildTerrain(rows: Float32Array[], tiles: DemTile[]) {
  const width = Math.round((REGION.east - REGION.west) / LONGITUDE_STEP_DEG) + 1;
  const height = Math.round((REGION.north - REGION.south) / LATITUDE_STEP_DEG) + 1;
  const decimetres = new Int16Array(width * height);
  let landVertices = 0;
  for (let row = 0; row < height; row += 1) {
    const latitude = REGION.north - (row / (height - 1)) * (REGION.north - REGION.south);
    for (let column = 0; column < width; column += 1) {
      const longitude = REGION.west + (column / (width - 1)) * (REGION.east - REGION.west);
      const { landShare, landMean } = sampleDem(tiles, longitude, latitude);
      let elevation: number;
      if (landShare >= LAND_SHARE_THRESHOLD) {
        elevation = Math.max(0.5, landMean);
        landVertices += 1;
      } else {
        const depth = sampleEmodnet(rows, longitude, latitude);
        elevation = Number.isNaN(depth) ? SHALLOW_WATER_METRES : Math.min(depth, SHALLOW_WATER_METRES);
      }
      decimetres[row * width + column] = Math.max(-32000, Math.min(32000, Math.round(elevation * 10)));
    }
  }
  return { width, height, decimetres, landShare: landVertices / (width * height) };
}

function isNearRegion([longitude, latitude]: Coordinate): boolean {
  return longitude >= REGION.west - CLIP_MARGIN_DEG && longitude <= REGION.east + CLIP_MARGIN_DEG && latitude >= REGION.south - CLIP_MARGIN_DEG && latitude <= REGION.north + CLIP_MARGIN_DEG;
}

function splitIntoRuns(coordinates: Coordinate[]): Coordinate[][] {
  const runs: Coordinate[][] = [];
  let currentRun: Coordinate[] = [];
  for (const coordinate of coordinates) {
    if (isNearRegion(coordinate)) {
      currentRun.push(coordinate);
    } else if (currentRun.length > 0) {
      runs.push(currentRun);
      currentRun = [];
    }
  }
  if (currentRun.length > 0) runs.push(currentRun);
  return runs.filter((run) => run.length >= 2);
}

function distanceToSegment(point: Coordinate, start: Coordinate, end: Coordinate): number {
  // Longitude shrinks by cos(latitude) at 60 N, so distances are measured in a locally square frame.
  const scale = 0.5;
  const [pointX, pointY] = [point[0] * scale, point[1]];
  const [startX, startY] = [start[0] * scale, start[1]];
  const [endX, endY] = [end[0] * scale, end[1]];
  const lengthSquared = (endX - startX) ** 2 + (endY - startY) ** 2;
  const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((pointX - startX) * (endX - startX) + (pointY - startY) * (endY - startY)) / lengthSquared));
  return Math.hypot(pointX - (startX + amount * (endX - startX)), pointY - (startY + amount * (endY - startY)));
}

function simplifyLine(points: Coordinate[]): Coordinate[] {
  if (points.length <= 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return points;
  let farthestIndex = 0;
  let farthestDistance = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    if (!point) continue;
    const distance = distanceToSegment(point, first, last);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  }
  if (farthestDistance <= SIMPLIFY_TOLERANCE_DEG) return [first, last];
  return [...simplifyLine(points.slice(0, farthestIndex + 1)).slice(0, -1), ...simplifyLine(points.slice(farthestIndex))];
}

const roundCoordinate = ([longitude, latitude]: Coordinate): Coordinate => [Math.round(longitude * 1e5) / 1e5, Math.round(latitude * 1e5) / 1e5];

type OsmElement = { tags?: Record<string, string>; geometry?: { lon: number; lat: number }[] };
type PipelineFeature = { properties: { name?: string | null }; geometry: { type: string; coordinates: number[][][] } };

async function collectLines(downloadsDir: string): Promise<Line[]> {
  const lines: Line[] = [];
  const osm: { elements: OsmElement[] } = JSON.parse(await readFile(path.join(downloadsDir, "osm-cables-gulf.json"), "utf8"));
  for (const element of osm.elements) {
    const tags = element.tags ?? {};
    const name = tags.name;
    const isPower = tags.power === "cable";
    const isTelecom = tags.telecom === "line" || tags.communication === "line";
    if (!name || !(isPower || isTelecom) || EXCLUDED_LOCATIONS.has(tags.location ?? "")) continue;
    // Short harbour crossings are not part of the subsea picture.
    if (isPower && tags.location !== "underwater") continue;
    const coordinates: Coordinate[] = (element.geometry ?? []).map((node) => [node.lon, node.lat]);
    for (const run of splitIntoRuns(coordinates)) {
      const simplified = simplifyLine(run).map(roundCoordinate);
      if (simplified.length >= 2) lines.push({ name, kind: isPower ? "power" : "telecom", points: simplified });
    }
  }
  const pipelines: { features: PipelineFeature[] } = JSON.parse(await readFile(path.join(downloadsDir, "pipelines-gulf.json"), "utf8"));
  for (const feature of pipelines.features) {
    const displayName = PIPELINE_NAMES[feature.properties.name ?? ""];
    // Every pipeline in the EMODnet file is a MultiLineString.
    if (!displayName || feature.geometry.type !== "MultiLineString") continue;
    for (const part of feature.geometry.coordinates) {
      const coordinates: Coordinate[] = part.map((point) => [point[0] ?? 0, point[1] ?? 0]);
      for (const run of splitIntoRuns(coordinates)) {
        const simplified = simplifyLine(run).map(roundCoordinate);
        if (simplified.length >= 2) lines.push({ name: displayName, kind: "pipeline", points: simplified });
      }
    }
  }
  return lines;
}

async function main() {
  const [downloadsDir = "", demDir = "", outDir = ""] = process.argv.slice(2);
  const startedAt = performance.now();
  const [rows, tiles, lines] = await Promise.all([readFile(path.join(downloadsDir, "gof-depth.txt"), "utf8").then(readEmodnetRows), loadDemTiles(demDir), collectLines(downloadsDir)]);
  const terrain = buildTerrain(rows, tiles);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "gulf-of-finland-terrain.bin"), new Uint8Array(terrain.decimetres.buffer));
  const features = {
    region: REGION,
    grid: { width: terrain.width, height: terrain.height, unit: "decimetres", rowOrder: "north to south" },
    lines,
    places: PLACES,
    sources: {
      depth: "EMODnet Bathymetry Consortium, EMODnet Digital Bathymetry (DTM 2024)",
      land: "Copernicus DEM GLO-30, produced using Copernicus WorldDEM-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA",
      cables: "OpenStreetMap contributors",
      pipelines: "EMODnet Human Activities",
    },
  };
  await writeFile(path.join(outDir, "gulf-of-finland-seabed.json"), JSON.stringify(features));
  let deepest = 0;
  let highest = 0;
  for (const value of terrain.decimetres) {
    deepest = Math.min(deepest, value);
    highest = Math.max(highest, value);
  }
  console.log(`[main] terrain ${terrain.width}x${terrain.height}, ${deepest / 10} m to ${highest / 10} m, land share ${terrain.landShare.toFixed(3)}`);
  console.log(`[main] ${lines.length} line runs: ${[...new Set(lines.map((line) => line.name))].join(", ")}`);
  console.log(`[main] done in ${Math.round(performance.now() - startedAt)} ms`);
}

await main();
