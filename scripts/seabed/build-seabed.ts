// Builds the seabed files the 3D view loads for one area of SEABED_AREAS:
//   <out>/<area>-terrain.bin  little-endian int16 elevations in decimetres, row 0 = north
//   <out>/<area>-seabed.json  region, grid, cable and pipeline lines, place names, sources
// Water depth comes from the EMODnet DTM. Land height and the coastline come from the Copernicus GLO-30 DEM (sea
// pixels are exactly 0 in that product, and a 1 degree tile with no land is not published at all).
// Inputs (not committed; download them into any local folder), file names per area below:
//   <map-downloads>/<depthFile>      EMODnet WCS 2.0.1 GetCoverage, coverageId emodnet__mean, subset Long and Lat to the
//                                    area's region, format text/plain
//   <map-downloads>/<cablesFile>     Overpass: telecom=line, communication=line and power=cable ways in the box, `out tags geom`
//   <map-downloads>/<pipelinesFile>  EMODnet Human Activities WFS 2.0.0, typeNames emodnet:pipelines, the box, application/json
//   (cables no open dataset maps are traced off a published map and kept in the area's tracedLines, below)
//   <dem-downloads>/<tile>.tif       every tile in demTiles, from
//     https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_<tile>_DEM/Copernicus_DSM_COG_10_<tile>_DEM.tif
// Usage: bun scripts/seabed/build-seabed.ts <area> <map-downloads dir> <dem-downloads dir> public/seabed
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fromFile, type GeoTIFFImage } from "geotiff";

type Region = { west: number; east: number; south: number; north: number };
type Place = { name: string; longitude: number; latitude: number };

type SeabedArea = {
  /** The EMODnet download box; the block covers exactly this. */
  region: Region;
  /** Vertex spacing, in EMODnet cells (1/960 degree each). */
  cellsPerVertex: { longitude: number; latitude: number };
  depthFile: string;
  cablesFile: string;
  pipelinesFile: string;
  /** Copernicus tiles that exist for the box; all-sea tiles are not published. */
  demTiles: string[];
  places: Place[];
  /** EMODnet pipeline name to the name the scene shows; other pipelines are left out. */
  pipelineNames: Record<string, string>;
  /** Cables no open dataset maps, traced off a published map; each says where in `source`. */
  tracedLines: TracedLine[];
  /** The credit line for cable routes: OpenStreetMap, plus the map behind each traced line. */
  cablesCredit: string;
};

/** A cable route read off a published map image: the points are the map's line, georeferenced. */
type TracedLine = { name: string; kind: "power" | "telecom"; source: string; points: Coordinate[] };

const OSM_CABLES_CREDIT = "OpenStreetMap contributors";

// EE-S1 (Arelion, Stavsnäs to Kärdla to Tallinn) is not in OpenStreetMap or any EMODnet cable layer. Its route
// is read off Yle's map of 20 Oct 2023 (https://yle.fi/a/74-20056160): the red line's centre, every 12 to 24
// pixels, in the Web Mercator frame fitted to the map's three landing dots (Stavsnäs, Kärdla, Tallinn on
// Nominatim; residuals 0.5 to 1.3 km). The map draws about 0.73 km per pixel, so the route is good to a few km.
const EE_S1_TRACED: TracedLine = {
  name: "EE-S1",
  kind: "telecom",
  source: "EE-S1 route read off a Yle map (yle.fi/a/74-20056160)",
  points: [
    [19.9498, 59.2639],
    [20.3444, 59.2605],
    [20.5811, 59.2437],
    [20.8179, 59.2134],
    [21.0546, 59.1966],
    [21.3703, 59.1595],
    [21.6859, 59.1427],
    [22.0016, 59.1055],
    [22.3173, 59.0549],
    [22.554, 59.021],
    [22.725, 58.9987],
    [22.8697, 59.0481],
    [23.0275, 59.1271],
    [23.1854, 59.2121],
    [23.3432, 59.274],
    [23.501, 59.321],
    [23.6589, 59.38],
    [23.8167, 59.4282],
    [23.9745, 59.4683],
    [24.1324, 59.4816],
    [24.2902, 59.4983],
    [24.448, 59.4917],
    [24.6059, 59.4616],
    [24.7729, 59.4329],
  ],
};

const SEABED_AREAS: Record<string, SeabedArea> = {
  // Both shores, Porkkala in the west to Kunda in the east. Vertices about 232 m apart either way.
  "gulf-of-finland": {
    region: { west: 24.0, east: 26.6, south: 59.35, north: 60.35 },
    cellsPerVertex: { longitude: 4, latitude: 2 },
    depthFile: "gof-depth.txt",
    cablesFile: "osm-cables-gulf.json",
    pipelinesFile: "pipelines-gulf.json",
    demTiles: ["N59_00_E024_00", "N59_00_E025_00", "N59_00_E026_00", "N60_00_E024_00", "N60_00_E025_00", "N60_00_E026_00"],
    // OpenStreetMap Nominatim lookups, 17 Oct 2026 (Porkkala is the Porkkalanniemi peninsula node).
    places: [
      { name: "Helsinki", longitude: 24.94354, latitude: 60.16662 },
      { name: "Espoo", longitude: 24.65598, latitude: 60.20497 },
      { name: "Porkkala", longitude: 24.47793, latitude: 60.01524 },
      { name: "Tallinn", longitude: 24.75727, latitude: 59.43724 },
      { name: "Loksa", longitude: 25.71733, latitude: 59.57846 },
      { name: "Kunda", longitude: 26.52922, latitude: 59.50554 },
    ],
    pipelineNames: { Balticconnector: "Balticconnector", "NORD STREAM 1": "Nord Stream 1", "NORD STREAM 2": "Nord Stream 2" },
    tracedLines: [],
    cablesCredit: OSM_CABLES_CREDIT,
  },
  // The Baltic Proper from Karlskrona to east of Gotland: Öland, southern Gotland and the BCS East-West Interlink
  // out to 20 E. Vertices about 513 m apart east to west and 463 m north to south.
  "baltic-proper": {
    region: { west: 15.2, east: 20.0, south: 55.35, north: 57.55 },
    cellsPerVertex: { longitude: 8, latitude: 4 },
    depthFile: "baltic-depth.txt",
    cablesFile: "osm-cables-baltic.json",
    pipelinesFile: "pipelines-baltic.json",
    demTiles: [
      "N55_00_E015_00",
      "N56_00_E015_00",
      "N56_00_E016_00",
      "N56_00_E018_00",
      "N57_00_E015_00",
      "N57_00_E016_00",
      "N57_00_E017_00",
      "N57_00_E018_00",
      "N57_00_E019_00",
    ],
    // OpenStreetMap Nominatim lookups, 17 Oct 2026 (the cape is the Långe Jan lighthouse way).
    places: [
      { name: "Kalmar", longitude: 16.36624, latitude: 56.66288 },
      { name: "Karlskrona", longitude: 15.58664, latitude: 56.16211 },
      { name: "Ölands södra udde", longitude: 16.39853, latitude: 56.19606 },
      { name: "Katthammarsvik", longitude: 18.84461, latitude: 57.43319 },
    ],
    pipelineNames: { "NORD STREAM 1": "Nord Stream 1", "NORD STREAM 2": "Nord Stream 2" },
    tracedLines: [],
    cablesCredit: OSM_CABLES_CREDIT,
  },
  // From west of Hiiumaa to the Russian border in the Gulf of Finland: the Hiiumaa crossing of EE-S1, the
  // Balticconnector and the Helsinki to Tallinn cables in one block, for tracks that leave gulf-of-finland
  // (west of 24 E). Vertices about 476 m apart east to west and 463 m north to south.
  "gulf-of-finland-and-hiiumaa": {
    region: { west: 20.7, east: 26.6, south: 58.7, north: 60.35 },
    cellsPerVertex: { longitude: 8, latitude: 4 },
    depthFile: "wide-depth.txt",
    cablesFile: "osm-cables-wide.json",
    pipelinesFile: "pipelines-wide.json",
    // N58_00_E020_00 is all sea and not published.
    demTiles: [
      "N58_00_E021_00",
      "N58_00_E022_00",
      "N58_00_E023_00",
      "N58_00_E024_00",
      "N58_00_E025_00",
      "N58_00_E026_00",
      "N59_00_E020_00",
      "N59_00_E021_00",
      "N59_00_E022_00",
      "N59_00_E023_00",
      "N59_00_E024_00",
      "N59_00_E025_00",
      "N59_00_E026_00",
      "N60_00_E020_00",
      "N60_00_E021_00",
      "N60_00_E022_00",
      "N60_00_E023_00",
      "N60_00_E024_00",
      "N60_00_E025_00",
      "N60_00_E026_00",
    ],
    // OpenStreetMap Nominatim lookups, 17 Oct 2026 (administrative labels; Kärdla is the town).
    places: [
      { name: "Helsinki", longitude: 24.94354, latitude: 60.16662 },
      { name: "Tallinn", longitude: 24.75727, latitude: 59.43724 },
      { name: "Hanko", longitude: 22.96789, latitude: 59.82478 },
      { name: "Inkoo", longitude: 24.00421, latitude: 60.04611 },
      { name: "Paldiski", longitude: 24.08017, latitude: 59.34909 },
      { name: "Kärdla", longitude: 22.74781, latitude: 58.99884 },
      { name: "Kunda", longitude: 26.52922, latitude: 59.50554 },
    ],
    pipelineNames: { Balticconnector: "Balticconnector", "NORD STREAM 1": "Nord Stream 1", "NORD STREAM 2": "Nord Stream 2" },
    tracedLines: [EE_S1_TRACED],
    cablesCredit: `${OSM_CABLES_CREDIT}; ${EE_S1_TRACED.source}`,
  },
  // Karlskrona to east of Fårö: Öland, all of Gotland and the LVRTC Sweden-Latvia cable out to 20.25 E, about
  // 300 by 245 km. Same vertex spacing as baltic-proper (about 510 m east to west, 463 m north to south).
  "gotland-latvia": {
    region: { west: 15.35, east: 20.25, south: 55.75, north: 57.95 },
    cellsPerVertex: { longitude: 8, latitude: 4 },
    depthFile: "gotland-latvia-depth.txt",
    cablesFile: "osm-cables-gotland-latvia.json",
    pipelinesFile: "pipelines-gotland-latvia.json",
    demTiles: [
      "N55_00_E015_00",
      "N55_00_E020_00",
      "N56_00_E015_00",
      "N56_00_E016_00",
      "N56_00_E018_00",
      "N56_00_E020_00",
      "N57_00_E015_00",
      "N57_00_E016_00",
      "N57_00_E017_00",
      "N57_00_E018_00",
      "N57_00_E019_00",
    ],
    // OpenStreetMap Nominatim lookups, 17 Oct 2026 (the capes are the Långe Jan and Hoburg lighthouse ways).
    places: [
      { name: "Karlskrona", longitude: 15.58664, latitude: 56.16211 },
      { name: "Ölands södra udde", longitude: 16.39853, latitude: 56.19606 },
      { name: "Visby", longitude: 18.29798, latitude: 57.63794 },
      { name: "Hoburg fyr", longitude: 18.15104, latitude: 56.92173 },
    ],
    pipelineNames: { "NORD STREAM 1": "Nord Stream 1", "NORD STREAM 2": "Nord Stream 2" },
  },
};

// A vertex is land when at least this share of the DEM pixels under it is land.
const LAND_SHARE_THRESHOLD = 0.45;
// Coastal water the DTM calls dry still gets this depth (m) so the shoreline reads.
const SHALLOW_WATER_METRES = -1.5;
// Lines keep points this far outside the region (degrees) so tubes reach the block edge.
const CLIP_MARGIN_DEG = 0.03;
// Douglas-Peucker tolerance for cable and pipeline lines (degrees, about 20 m).
const SIMPLIFY_TOLERANCE_DEG = 0.0002;
const EXCLUDED_LOCATIONS = new Set(["underground", "overhead", "indoor", "ceiling", "overground"]);

/** The vertex lattice: the area's region and the spacing between vertices, in degrees. */
type Lattice = { region: Region; longitudeStep: number; latitudeStep: number };
/** The EMODnet grid: rows north to south, and the centre of the north-west cell. */
type EmodnetGrid = { rows: Float32Array[]; originLongitude: number; originLatitude: number; cellDeg: number };
type DemTile = { image: GeoTIFFImage; values: Float32Array; width: number; height: number; west: number; north: number; resolutionLon: number; resolutionLat: number };
type Coordinate = [number, number];
type Line = { name: string; kind: "power" | "telecom" | "pipeline"; points: Coordinate[] };

async function loadDemTiles(demDir: string, tileNames: string[]): Promise<DemTile[]> {
  return Promise.all(
    tileNames.map(async (tileName) => {
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

/** Reads the WCS text/plain answer: the "Grid to world" affine in the header, then one row of values per line. */
function readEmodnetGrid(text: string): EmodnetGrid {
  const readParameter = (name: string) => {
    const match = text.match(new RegExp(`PARAMETER\\["${name}", (-?[\\d.]+)\\]`));
    // A build-time CLI: a header without the affine is not a WCS grid, so stop instead of guessing.
    if (!match?.[1]) throw new Error(`[readEmodnetGrid] header has no ${name}`);
    return Number(match[1]);
  };
  const lines = text.split("\n");
  const bandStart = lines.findIndex((line) => line.startsWith("Band 0:")) + 1;
  const rows = lines
    .slice(bandStart)
    .filter((line) => line.trim().length > 0)
    .map((line) => Float32Array.from(line.trim().split(/\s+/), (token) => Number(token)));
  return { rows, originLongitude: readParameter("elt_0_2"), originLatitude: readParameter("elt_1_2"), cellDeg: readParameter("elt_0_0") };
}

/** Mean EMODnet depth over the cells whose centres fall in the vertex footprint; NaN when none are valid. */
function sampleEmodnet(grid: EmodnetGrid, lattice: Lattice, longitude: number, latitude: number): number {
  const firstColumn = Math.ceil((longitude - lattice.longitudeStep / 2 - grid.originLongitude) / grid.cellDeg);
  const lastColumn = Math.floor((longitude + lattice.longitudeStep / 2 - grid.originLongitude) / grid.cellDeg);
  const firstRow = Math.ceil((grid.originLatitude - latitude - lattice.latitudeStep / 2) / grid.cellDeg);
  const lastRow = Math.floor((grid.originLatitude - latitude + lattice.latitudeStep / 2) / grid.cellDeg);
  let sum = 0;
  let count = 0;
  for (let row = Math.max(0, firstRow); row <= Math.min(grid.rows.length - 1, lastRow); row += 1) {
    const values = grid.rows[row];
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

/** Share of land pixels and their mean height (m) under the vertex footprint, across tile borders. */
function sampleDem(tiles: DemTile[], lattice: Lattice, longitude: number, latitude: number): { landShare: number; landMean: number } {
  let pixelCount = 0;
  let landCount = 0;
  let landSum = 0;
  const footprint = {
    west: longitude - lattice.longitudeStep / 2,
    east: longitude + lattice.longitudeStep / 2,
    south: latitude - lattice.latitudeStep / 2,
    north: latitude + lattice.latitudeStep / 2,
  };
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

function buildTerrain(grid: EmodnetGrid, tiles: DemTile[], lattice: Lattice) {
  const { region } = lattice;
  const width = Math.round((region.east - region.west) / lattice.longitudeStep) + 1;
  const height = Math.round((region.north - region.south) / lattice.latitudeStep) + 1;
  const decimetres = new Int16Array(width * height);
  let landVertices = 0;
  for (let row = 0; row < height; row += 1) {
    const latitude = region.north - (row / (height - 1)) * (region.north - region.south);
    for (let column = 0; column < width; column += 1) {
      const longitude = region.west + (column / (width - 1)) * (region.east - region.west);
      const { landShare, landMean } = sampleDem(tiles, lattice, longitude, latitude);
      let elevation: number;
      if (landShare >= LAND_SHARE_THRESHOLD) {
        elevation = Math.max(0.5, landMean);
        landVertices += 1;
      } else {
        const depth = sampleEmodnet(grid, lattice, longitude, latitude);
        elevation = Number.isNaN(depth) ? SHALLOW_WATER_METRES : Math.min(depth, SHALLOW_WATER_METRES);
      }
      decimetres[row * width + column] = Math.max(-32000, Math.min(32000, Math.round(elevation * 10)));
    }
  }
  return { width, height, decimetres, landShare: landVertices / (width * height) };
}

function isNearRegion(region: Region, [longitude, latitude]: Coordinate): boolean {
  return longitude >= region.west - CLIP_MARGIN_DEG && longitude <= region.east + CLIP_MARGIN_DEG && latitude >= region.south - CLIP_MARGIN_DEG && latitude <= region.north + CLIP_MARGIN_DEG;
}

function splitIntoRuns(region: Region, coordinates: Coordinate[]): Coordinate[][] {
  const runs: Coordinate[][] = [];
  let currentRun: Coordinate[] = [];
  for (const coordinate of coordinates) {
    if (isNearRegion(region, coordinate)) {
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
  // Longitude shrinks by cos(latitude), half at 60 N, so distances are measured in a frame that is square
  // there. The tolerance is only a simplification threshold, so the same frame serves the Baltic Proper too.
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

async function collectLines(downloadsDir: string, area: SeabedArea): Promise<Line[]> {
  const lines: Line[] = [];
  const osm: { elements: OsmElement[] } = JSON.parse(await readFile(path.join(downloadsDir, area.cablesFile), "utf8"));
  for (const element of osm.elements) {
    const tags = element.tags ?? {};
    const name = tags.name;
    const isPower = tags.power === "cable";
    const isTelecom = tags.telecom === "line" || tags.communication === "line";
    if (!name || !(isPower || isTelecom) || EXCLUDED_LOCATIONS.has(tags.location ?? "")) continue;
    // Short harbour crossings are not part of the subsea picture.
    if (isPower && tags.location !== "underwater") continue;
    const coordinates: Coordinate[] = (element.geometry ?? []).map((node) => [node.lon, node.lat]);
    for (const run of splitIntoRuns(area.region, coordinates)) {
      const simplified = simplifyLine(run).map(roundCoordinate);
      if (simplified.length >= 2) lines.push({ name, kind: isPower ? "power" : "telecom", points: simplified });
    }
  }
  for (const traced of area.tracedLines) {
    for (const run of splitIntoRuns(area.region, traced.points)) {
      const simplified = simplifyLine(run).map(roundCoordinate);
      if (simplified.length >= 2) lines.push({ name: traced.name, kind: traced.kind, points: simplified });
    }
  }
  const pipelines: { features: PipelineFeature[] } = JSON.parse(await readFile(path.join(downloadsDir, area.pipelinesFile), "utf8"));
  for (const feature of pipelines.features) {
    const displayName = area.pipelineNames[feature.properties.name ?? ""];
    // Every pipeline in the EMODnet layer is a MultiLineString.
    if (!displayName || feature.geometry.type !== "MultiLineString") continue;
    for (const part of feature.geometry.coordinates) {
      const coordinates: Coordinate[] = part.map((point) => [point[0] ?? 0, point[1] ?? 0]);
      for (const run of splitIntoRuns(area.region, coordinates)) {
        const simplified = simplifyLine(run).map(roundCoordinate);
        if (simplified.length >= 2) lines.push({ name: displayName, kind: "pipeline", points: simplified });
      }
    }
  }
  return lines;
}

async function main() {
  const [areaName = "", downloadsDir = "", demDir = "", outDir = ""] = process.argv.slice(2);
  const area = SEABED_AREAS[areaName];
  if (!area) {
    console.error(`[main] unknown area "${areaName}"; known: ${Object.keys(SEABED_AREAS).join(", ")}`);
    process.exit(1);
  }
  const startedAt = performance.now();
  const [grid, tiles, lines] = await Promise.all([
    readFile(path.join(downloadsDir, area.depthFile), "utf8").then(readEmodnetGrid),
    loadDemTiles(demDir, area.demTiles),
    collectLines(downloadsDir, area),
  ]);
  const lattice = { region: area.region, longitudeStep: grid.cellDeg * area.cellsPerVertex.longitude, latitudeStep: grid.cellDeg * area.cellsPerVertex.latitude };
  const terrain = buildTerrain(grid, tiles, lattice);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${areaName}-terrain.bin`), new Uint8Array(terrain.decimetres.buffer));
  const features = {
    region: area.region,
    grid: { width: terrain.width, height: terrain.height, unit: "decimetres", rowOrder: "north to south" },
    lines,
    places: area.places,
    sources: {
      depth: "EMODnet Bathymetry Consortium, EMODnet Digital Bathymetry (DTM 2024)",
      land: "Copernicus DEM GLO-30, produced using Copernicus WorldDEM-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA",
      cables: area.cablesCredit,
      pipelines: "EMODnet Human Activities",
    },
  };
  await writeFile(path.join(outDir, `${areaName}-seabed.json`), JSON.stringify(features));
  let deepest = 0;
  let highest = 0;
  for (const value of terrain.decimetres) {
    deepest = Math.min(deepest, value);
    highest = Math.max(highest, value);
  }
  console.log(`[main] ${areaName} terrain ${terrain.width}x${terrain.height}, ${deepest / 10} m to ${highest / 10} m, land share ${terrain.landShare.toFixed(3)}`);
  console.log(`[main] ${lines.length} line runs: ${[...new Set(lines.map((line) => line.name))].join(", ")}`);
  console.log(`[main] done in ${Math.round(performance.now() - startedAt)} ms`);
}

await main();
