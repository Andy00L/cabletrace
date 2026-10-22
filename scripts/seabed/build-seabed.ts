// Builds the seabed files the 3D view loads for one area of SEABED_AREAS:
//   <out>/<area>-terrain.bin  little-endian int16 elevations in decimetres, row 0 = north
//   <out>/<area>-seabed.json  region, grid, elevation range, cable and pipeline lines, place names, sources
// Water depth comes from the EMODnet DTM where it covers the area (European seas) and from the GEBCO grid
// elsewhere; each area's JSON names the grid in `sources.depth`, with its citation and licence. Land height and the
// coastline come from the Copernicus GLO-30 DEM everywhere (sea pixels are exactly 0 in that product, and a 1 degree
// tile with no land is not published at all).
// Inputs (not committed; download them into any local folder), file names per area below:
//   <map-downloads>/<depth file>     EMODnet areas: WCS 2.0.1 GetCoverage, coverageId emodnet__mean, subset Long and
//                                    Lat to the area's region, format text/plain.
//                                    GEBCO areas: the GEBCO_2026 grid (data source "Bathymetry") as GeoTIFF from the
//                                    subsetting app at https://download.gebco.net (no account; POST the box to
//                                    /api/queue, poll /api/queue/status/<id>, fetch /api/queue/download/<id>, unzip),
//                                    for a box at least as large as the region.
//   <map-downloads>/<cablesFile>     Overpass: telecom=line, communication=line and power=cable ways in the box, `out tags geom`
//   <map-downloads>/<pipelines file> EMODnet areas only: EMODnet Human Activities WFS 2.0.0, typeNames
//                                    emodnet:pipelines, the box, application/json
//   (cables no open dataset maps are traced or placed in scripts/seabed/traced-routes.ts)
//   <dem-downloads>/<tile>.tif       every tile in demTiles, from
//     https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_<tile>_DEM/Copernicus_DSM_COG_10_<tile>_DEM.tif
// Usage: bun scripts/seabed/build-seabed.ts <area> <map-downloads dir> <dem-downloads dir> public/seabed
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fromFile, type GeoTIFFImage } from "geotiff";
import { measureSeabedFileVersions, SEABED_FILE_VERSIONS_PATH, writeSeabedFileVersionsModule } from "./seabed-file-versions";
import {
  AAE1_RED_SEA_TRACED,
  EE_S1_TRACED,
  EIG_RED_SEA_TRACED,
  SEACOM_RED_SEA_TRACED,
  TDM2_PLACED,
  TM3_DONGYIN_PLACED,
  TP3_PLACED,
  type Coordinate,
  type TracedLine,
} from "./traced-routes";

type Region = { west: number; east: number; south: number; north: number };
type Place = { name: string; longitude: number; latitude: number };

/** The grid the water depths come from, and the local file holding it (see the header for how to fetch it). */
type DepthSource = { kind: "emodnet"; file: string } | { kind: "gebco"; file: string };

/** EMODnet Human Activities pipelines, for areas inside its coverage (European seas). */
type PipelineSource = {
  file: string;
  /** EMODnet pipeline name to the name the scene shows; other pipelines are left out. */
  displayNames: Record<string, string>;
};

type SeabedArea = {
  /** The block covers exactly this box; the depth download must contain it. */
  region: Region;
  /** Vertex spacing, in cells of the depth grid (EMODnet 1/960 degree, GEBCO 1/240 degree). */
  cellsPerVertex: { longitude: number; latitude: number };
  depth: DepthSource;
  cablesFile: string;
  /** Null outside EMODnet's coverage: no open pipeline layer is used there, and none is drawn. */
  pipelines: PipelineSource | null;
  /** Copernicus tiles that exist for the box; all-sea tiles are not published. */
  demTiles: string[];
  places: Place[];
  /** Cables no open dataset maps (scripts/seabed/traced-routes.ts); each says where its points come from. */
  tracedLines: TracedLine[];
  /** The credit line for cable routes: OpenStreetMap, plus the source of each traced or placed line. */
  cablesCredit: string;
};

const OSM_CABLES_CREDIT = "OpenStreetMap contributors";

// The depth credits the 3D view prints as "Depth: <credit>.", so each carries its licence. EMODnet's is CC BY 4.0
// (https://emodnet.ec.europa.eu/en/data-licence). GEBCO's citation is the form the GEBCO_2026 documentation asks for
// (section 6.0, "Data set attribution"), and its terms of use place the grid in the public domain; both PDFs come in
// every download zip.
const DEPTH_CREDITS: Record<DepthSource["kind"], string> = {
  emodnet: "EMODnet Bathymetry Consortium, EMODnet Digital Bathymetry (DTM 2024), CC BY 4.0",
  gebco: "GEBCO Compilation Group (2026) GEBCO 2026 Grid (doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa), public domain",
};
const EMODNET_PIPELINES_CREDIT = "EMODnet Human Activities";
const NO_PIPELINES_CREDIT = "none drawn in this area";

const SEABED_AREAS: Record<string, SeabedArea> = {
  // Both shores, Porkkala in the west to Kunda in the east. Vertices about 232 m apart either way.
  "gulf-of-finland": {
    region: { west: 24.0, east: 26.6, south: 59.35, north: 60.35 },
    cellsPerVertex: { longitude: 4, latitude: 2 },
    depth: { kind: "emodnet", file: "gof-depth.txt" },
    cablesFile: "osm-cables-gulf.json",
    pipelines: {
      file: "pipelines-gulf.json",
      displayNames: { Balticconnector: "Balticconnector", "NORD STREAM 1": "Nord Stream 1", "NORD STREAM 2": "Nord Stream 2" },
    },
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
    tracedLines: [],
    cablesCredit: OSM_CABLES_CREDIT,
  },
  // The Baltic Proper from Karlskrona to east of Gotland: Öland, southern Gotland and the BCS East-West Interlink
  // out to 20 E. Vertices about 513 m apart east to west and 463 m north to south.
  "baltic-proper": {
    region: { west: 15.2, east: 20.0, south: 55.35, north: 57.55 },
    cellsPerVertex: { longitude: 8, latitude: 4 },
    depth: { kind: "emodnet", file: "baltic-depth.txt" },
    cablesFile: "osm-cables-baltic.json",
    pipelines: { file: "pipelines-baltic.json", displayNames: { "NORD STREAM 1": "Nord Stream 1", "NORD STREAM 2": "Nord Stream 2" } },
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
    tracedLines: [],
    cablesCredit: OSM_CABLES_CREDIT,
  },
  // From west of Hiiumaa to the Russian border in the Gulf of Finland: the Hiiumaa crossing of EE-S1, the
  // Balticconnector and the Helsinki to Tallinn cables in one block, for tracks that leave gulf-of-finland
  // (west of 24 E). Vertices about 476 m apart east to west and 463 m north to south.
  "gulf-of-finland-and-hiiumaa": {
    region: { west: 20.7, east: 26.6, south: 58.7, north: 60.35 },
    cellsPerVertex: { longitude: 8, latitude: 4 },
    depth: { kind: "emodnet", file: "wide-depth.txt" },
    cablesFile: "osm-cables-wide.json",
    pipelines: {
      file: "pipelines-wide.json",
      displayNames: { Balticconnector: "Balticconnector", "NORD STREAM 1": "Nord Stream 1", "NORD STREAM 2": "Nord Stream 2" },
    },
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
    tracedLines: [EE_S1_TRACED],
    cablesCredit: `${OSM_CABLES_CREDIT}; ${EE_S1_TRACED.source}`,
  },
  // Karlskrona to east of Fårö: Öland, all of Gotland and the LVRTC Sweden-Latvia cable out to 20.25 E, about
  // 300 by 245 km. Same vertex spacing as baltic-proper (about 510 m east to west, 463 m north to south).
  "gotland-latvia": {
    region: { west: 15.35, east: 20.25, south: 55.75, north: 57.95 },
    cellsPerVertex: { longitude: 8, latitude: 4 },
    depth: { kind: "emodnet", file: "gotland-latvia-depth.txt" },
    cablesFile: "osm-cables-gotland-latvia.json",
    pipelines: { file: "pipelines-gotland-latvia.json", displayNames: { "NORD STREAM 1": "Nord Stream 1", "NORD STREAM 2": "Nord Stream 2" } },
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
    tracedLines: [],
    cablesCredit: OSM_CABLES_CREDIT,
  },
  // West Spitsbergen from Longyearbyen out through Isfjorden to the Fram Strait: both Svalbard cables from their
  // landing to where they turn south at 2,400 m, about 220 by 111 km. At 78 N an EMODnet cell is about 24 m east
  // to west and 116 m north to south, so vertices are about 386 m apart east to west and 463 m north to south.
  // Sea-only Copernicus tiles (west of 12 E in N77, west of 10 E in N78) are not published. The EMODnet pipelines
  // layer has none in the box.
  svalbard: {
    region: { west: 6.8, east: 16.2, south: 77.5, north: 78.5 },
    cellsPerVertex: { longitude: 16, latitude: 4 },
    depth: { kind: "emodnet", file: "svalbard-depth.txt" },
    cablesFile: "osm-cables-svalbard.json",
    pipelines: { file: "pipelines-svalbard.json", displayNames: {} },
    demTiles: [
      "N77_00_E012_00",
      "N77_00_E013_00",
      "N77_00_E014_00",
      "N77_00_E015_00",
      "N77_00_E016_00",
      "N78_00_E010_00",
      "N78_00_E011_00",
      "N78_00_E012_00",
      "N78_00_E013_00",
      "N78_00_E014_00",
      "N78_00_E015_00",
      "N78_00_E016_00",
    ],
    // OpenStreetMap Nominatim lookups, 17 Oct 2026 (Kapp Linné is the cape node beside Isfjord Radio).
    places: [
      { name: "Longyearbyen", longitude: 15.64637, latitude: 78.22316 },
      { name: "Barentsburg", longitude: 14.21724, latitude: 78.06536 },
      { name: "Kapp Linné", longitude: 13.60608, latitude: 78.06433 },
    ],
    tracedLines: [],
    cablesCredit: OSM_CABLES_CREDIT,
  },
  // The Taiwan Strait between Tainan and Penghu, about 107 by 94 km: the Taiwan-Penghu No. 3 break off Beimen
  // (Hong Tai 58, 25 Feb 2025), Anping harbour where the ship was taken, and Magong. GEBCO cells, one per vertex:
  // about 426 m east to west and 463 m north to south.
  "taiwan-penghu": {
    region: { west: 119.3, east: 120.35, south: 22.9, north: 23.75 },
    cellsPerVertex: { longitude: 1, latitude: 1 },
    depth: { kind: "gebco", file: "gebco-taiwan-penghu.tif" },
    cablesFile: "osm-cables-taiwan.json",
    pipelines: null,
    // N22_00_E119_00 is all sea and not published.
    demTiles: ["N22_00_E120_00", "N23_00_E119_00", "N23_00_E120_00"],
    // OpenStreetMap Nominatim lookups, 17 Oct 2026 (district and city relations; the harbours are their nodes).
    places: [
      { name: "Magong", longitude: 119.57849, latitude: 23.56638 },
      { name: "Beimen", longitude: 120.12572, latitude: 23.26792 },
      { name: "Jiangjun harbour", longitude: 120.08731, latitude: 23.21171 },
      { name: "Anping harbour", longitude: 120.16039, latitude: 22.98315 },
    ],
    tracedLines: [TP3_PLACED],
    cablesCredit: `${OSM_CABLES_CREDIT}; ${TP3_PLACED.source}`,
  },
  // Taiwan's north-east coast from Tamsui to Toucheng, about 121 by 100 km: Yehliu, where the Trans-Pacific Express
  // break of 3 Jan 2025 was reported, Keelung harbour and the Tamsui and Toucheng landings. GEBCO cells, one per
  // vertex: about 421 m east to west and 463 m north to south.
  "taiwan-keelung": {
    region: { west: 121.25, east: 122.45, south: 24.8, north: 25.7 },
    cellsPerVertex: { longitude: 1, latitude: 1 },
    depth: { kind: "gebco", file: "gebco-taiwan-keelung.tif" },
    cablesFile: "osm-cables-taiwan.json",
    pipelines: null,
    demTiles: ["N24_00_E121_00", "N24_00_E122_00", "N25_00_E121_00", "N25_00_E122_00"],
    // OpenStreetMap Nominatim lookups, 17 Oct 2026 (Yehliu is the village node; the others district relations
    // and the harbour water way).
    places: [
      { name: "Yehliu", longitude: 121.68865, latitude: 25.2039 },
      { name: "Keelung harbour", longitude: 121.75561, latitude: 25.14625 },
      { name: "Tamsui", longitude: 121.45315, latitude: 25.1813 },
      { name: "Toucheng", longitude: 121.82331, latitude: 24.85922 },
    ],
    tracedLines: [],
    cablesCredit: OSM_CABLES_CREDIT,
  },
  // The Matsu Islands from Nangan to east of Dongyin and south-east toward Taiwan, about 125 by 105 km: the
  // Taiwan-Matsu No. 2 break north-east of Dongyin (Minlianyu 60138, 7 Oct 2025), the No. 3 damage at Dongyin's Beiao
  // shore (Hai Hong Gong 66, 30 Mar 2026), and room for the Feb 2023 breaks between Matsu and Taiwan. GEBCO cells,
  // one per vertex: about 416 m east to west and 463 m north to south.
  matsu: {
    region: { west: 119.7, east: 120.95, south: 25.6, north: 26.55 },
    cellsPerVertex: { longitude: 1, latitude: 1 },
    depth: { kind: "gebco", file: "gebco-matsu.tif" },
    cablesFile: "osm-cables-taiwan.json",
    pipelines: null,
    // N25_00_E120_00 is all sea and not published.
    demTiles: ["N25_00_E119_00", "N26_00_E119_00", "N26_00_E120_00"],
    // OpenStreetMap Nominatim lookups, 17 Oct 2026 (township relations). Dongyin lighthouse, 2 km from the Dongyin
    // label, is left out because the two labels overlap.
    places: [
      { name: "Nangan", longitude: 119.93863, latitude: 26.15308 },
      { name: "Beigan", longitude: 119.99733, latitude: 26.22505 },
      { name: "Dongyin", longitude: 120.49042, latitude: 26.36682 },
    ],
    tracedLines: [TDM2_PLACED, TM3_DONGYIN_PLACED],
    cablesCredit: `${OSM_CABLES_CREDIT}; ${TDM2_PLACED.source}; ${TM3_DONGYIN_PLACED.source}`,
  },
  // The southern Red Sea from the Hanish Islands to Bab-el-Mandeb, about 163 by 200 km: Mokha, Assab and Perim, the
  // waters where the Rubymar drifted and sank (Feb to Mar 2024) and the AAE-1, Seacom and EIG faults were reported.
  // OpenStreetMap maps only FLAG Europe-Asia here (one vertex inside the box, so no line is drawn); the three cut
  // cables are read off the Meta engineers' slide maps (traced-routes.ts). GEBCO cells, one per vertex: about 451 m
  // east to west and 463 m north to south.
  "red-sea-south": {
    region: { west: 42.3, east: 43.8, south: 12.4, north: 14.2 },
    cellsPerVertex: { longitude: 1, latitude: 1 },
    depth: { kind: "gebco", file: "gebco-red-sea-south.tif" },
    cablesFile: "osm-cables-red-sea-south.json",
    pipelines: null,
    demTiles: ["N12_00_E042_00", "N12_00_E043_00", "N13_00_E042_00", "N13_00_E043_00", "N14_00_E042_00", "N14_00_E043_00"],
    // OpenStreetMap Nominatim lookups, 17 Oct 2026 (town and city nodes, the Perim island and Hanish archipelago
    // relations).
    places: [
      { name: "Mokha", longitude: 43.25011, latitude: 13.31792 },
      { name: "Assab", longitude: 42.74446, latitude: 13.00913 },
      { name: "Perim", longitude: 43.42775, latitude: 12.65183 },
      { name: "Hanish Islands", longitude: 42.74052, latitude: 13.98912 },
    ],
    tracedLines: [SEACOM_RED_SEA_TRACED, AAE1_RED_SEA_TRACED, EIG_RED_SEA_TRACED],
    // The three lines share one source text, so it is credited once.
    cablesCredit: `${OSM_CABLES_CREDIT}; ${SEACOM_RED_SEA_TRACED.source}`,
  },
};

// A vertex is land when at least this share of the DEM pixels under it is land.
const LAND_SHARE_THRESHOLD = 0.45;
// Coastal water the depth grid calls dry still gets this depth (m) so the shoreline reads.
const SHALLOW_WATER_METRES = -1.5;
// A depth cell whose centre lies this close to a vertex footprint's edge (in cells) counts as inside it: floating-point
// error is about 1e-12 cells, real offsets are whole or half cells (sampleDepth).
const FOOTPRINT_EDGE_TOLERANCE_CELLS = 1e-6;
// Lines keep points this far outside the region (degrees) so tubes reach the block edge.
const CLIP_MARGIN_DEG = 0.03;
// Douglas-Peucker tolerance for cable and pipeline lines (degrees, about 20 m).
const SIMPLIFY_TOLERANCE_DEG = 0.0002;
const EXCLUDED_LOCATIONS = new Set(["underground", "overhead", "indoor", "ceiling", "overground"]);

/** The vertex lattice: the area's region and the spacing between vertices, in degrees. */
type Lattice = { region: Region; longitudeStep: number; latitudeStep: number };
/** A depth grid of square cells: rows north to south, and the centre of the north-west cell. */
type DepthGrid = { rows: Float32Array[]; originLongitude: number; originLatitude: number; cellDeg: number };
type DemTile = { image: GeoTIFFImage; values: Float32Array; width: number; height: number; west: number; north: number; resolutionLon: number; resolutionLat: number };
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
function readEmodnetGrid(text: string): DepthGrid {
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

/**
 * Reads a GEBCO GeoTIFF subset: int16 metres, rows north to south. GeoTIFF origins are cell corners (GEBCO grids
 * are pixel-is-area), so the north-west cell centre sits half a cell in from the origin.
 */
async function readGebcoGrid(filePath: string): Promise<DepthGrid> {
  const image = await (await fromFile(filePath)).getImage();
  const [raster] = await image.readRasters({ samples: [0] });
  // A build-time CLI: anything but GEBCO's int16 layout means a different download, so stop with a message.
  if (!(raster instanceof Int16Array)) throw new Error(`[readGebcoGrid] ${filePath} is not int16`);
  const [west = 0, north = 0] = image.getOrigin();
  const [resolutionLon = 0, resolutionLat = 0] = image.getResolution();
  if (Math.abs(resolutionLon + resolutionLat) > 1e-9) throw new Error(`[readGebcoGrid] ${filePath} cells are not square`);
  const width = image.getWidth();
  const rows = Array.from({ length: image.getHeight() }, (_unused, row) => Float32Array.from(raster.subarray(row * width, (row + 1) * width)));
  return { rows, originLongitude: west + resolutionLon / 2, originLatitude: north - resolutionLon / 2, cellDeg: resolutionLon };
}

async function readDepthGrid(downloadsDir: string, depth: DepthSource): Promise<DepthGrid> {
  const filePath = path.join(downloadsDir, depth.file);
  switch (depth.kind) {
    case "emodnet":
      return readEmodnetGrid(await readFile(filePath, "utf8"));
    case "gebco":
      return readGebcoGrid(filePath);
    default: {
      const unknownKind: never = depth;
      throw new Error(`[readDepthGrid] unknown depth source ${JSON.stringify(unknownKind)}`);
    }
  }
}

/**
 * Mean depth over the grid cells whose centres fall in the vertex footprint, edges included; NaN when none are valid.
 * On a GEBCO block with one cell per vertex the vertices sit on cell corners, so the footprint's edges fall exactly on
 * cell centres. Without the tolerance, rounding decided each edge on its own: about one sea vertex in five of
 * red-sea-south got no cell at all and was written as SHALLOW_WATER_METRES, a stripe every second column.
 */
function sampleDepth(grid: DepthGrid, lattice: Lattice, longitude: number, latitude: number): number {
  const firstColumn = Math.ceil((longitude - lattice.longitudeStep / 2 - grid.originLongitude) / grid.cellDeg - FOOTPRINT_EDGE_TOLERANCE_CELLS);
  const lastColumn = Math.floor((longitude + lattice.longitudeStep / 2 - grid.originLongitude) / grid.cellDeg + FOOTPRINT_EDGE_TOLERANCE_CELLS);
  const firstRow = Math.ceil((grid.originLatitude - latitude - lattice.latitudeStep / 2) / grid.cellDeg - FOOTPRINT_EDGE_TOLERANCE_CELLS);
  const lastRow = Math.floor((grid.originLatitude - latitude + lattice.latitudeStep / 2) / grid.cellDeg + FOOTPRINT_EDGE_TOLERANCE_CELLS);
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

function buildTerrain(grid: DepthGrid, tiles: DemTile[], lattice: Lattice) {
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
        const depth = sampleDepth(grid, lattice, longitude, latitude);
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
  // there. The tolerance is only a simplification threshold, so the same frame serves the other areas too: at
  // 13 to 26 N it keeps east-west detail down to about 40 m instead of 20 m.
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
  // Traced and placed lines are written vertex by vertex already, so they are not simplified again: that would drop a
  // vertex snapped onto a published fault when it sits within the tolerance of its neighbours' line.
  for (const traced of area.tracedLines) {
    for (const run of splitIntoRuns(area.region, traced.points)) {
      const rounded = run.map(roundCoordinate);
      if (rounded.length >= 2) lines.push({ name: traced.name, kind: traced.kind, points: rounded });
    }
  }
  if (!area.pipelines) return lines;
  const { file, displayNames } = area.pipelines;
  const pipelines: { features: PipelineFeature[] } = JSON.parse(await readFile(path.join(downloadsDir, file), "utf8"));
  for (const feature of pipelines.features) {
    const displayName = displayNames[feature.properties.name ?? ""];
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
  const [grid, tiles, lines] = await Promise.all([readDepthGrid(downloadsDir, area.depth), loadDemTiles(demDir, area.demTiles), collectLines(downloadsDir, area)]);
  const lattice = { region: area.region, longitudeStep: grid.cellDeg * area.cellsPerVertex.longitude, latitudeStep: grid.cellDeg * area.cellsPerVertex.latitude };
  const terrain = buildTerrain(grid, tiles, lattice);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${areaName}-terrain.bin`), new Uint8Array(terrain.decimetres.buffer));
  let deepest = 0;
  let highest = 0;
  for (const value of terrain.decimetres) {
    deepest = Math.min(deepest, value);
    highest = Math.max(highest, value);
  }
  const features = {
    region: area.region,
    grid: { width: terrain.width, height: terrain.height, unit: "decimetres", rowOrder: "north to south" },
    // The replay picks its vertical exaggeration from this range (src/lib/seabed/scene-scales.ts).
    elevationRange: { lowestMetres: deepest / 10, highestMetres: highest / 10 },
    lines,
    places: area.places,
    sources: {
      depth: DEPTH_CREDITS[area.depth.kind],
      land: "Copernicus DEM GLO-30, produced using Copernicus WorldDEM-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA",
      cables: area.cablesCredit,
      pipelines: area.pipelines ? EMODNET_PIPELINES_CREDIT : NO_PIPELINES_CREDIT,
    },
  };
  await writeFile(path.join(outDir, `${areaName}-seabed.json`), JSON.stringify(features));
  // The browser fetches both files at content-versioned URLs (src/lib/seabed/seabed-urls.ts): new contents, new versions.
  await writeFile(SEABED_FILE_VERSIONS_PATH, writeSeabedFileVersionsModule(measureSeabedFileVersions()));
  console.log(`[main] ${areaName} terrain ${terrain.width}x${terrain.height}, ${deepest / 10} m to ${highest / 10} m, land share ${terrain.landShare.toFixed(3)}`);
  console.log(`[main] ${lines.length} line runs: ${[...new Set(lines.map((line) => line.name))].join(", ")}`);
  console.log(`[main] done in ${Math.round(performance.now() - startedAt)} ms`);
}

await main();
