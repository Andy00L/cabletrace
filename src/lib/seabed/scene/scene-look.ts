import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import type { SeabedRegion } from "@/lib/seabed/terrain";

// The 3D replay's environment colours: natural look C, "reference mid-tone", approved by Andy on 19 Oct 2026
// (plan/next-reset.md, choice 5). Each sampled region's hues, measured from imagery of the place, at the lightness and
// chroma of the FireTrace reference's terrain (ui-design/references/round-2/3-firetrace-incident-colors-depth.webp); its
// sky and haze are the reference's own pixels. The water is water B (choice 7, water-surface.ts). An area that was not
// sampled takes the nearest sampled region's values. The method and every source are in the round-2 board notes
// (.scratch/round2-renders/palettes.md of the main checkout).
// Data colours (cables, pipelines, the track, the alarm) are never part of the look: they stay exact
// (src/lib/render/data-colors.ts).

/** The sky drawn around the scene, and the haze distant ground fades into (sRGB hex). */
export type SceneSky = { upperHex: string; horizonHex: string; hazeHex: string };

export type ScenePalette = {
  /** Seabed seen through the water, by depth in metres (overview.ts samples it per terrain vertex). */
  depthRamp: readonly [number, string][];
  /** Land by height in metres. */
  landRamp: readonly [number, string][];
  /** The hemisphere light: sky and ground. */
  skyLightHex: string;
  groundLightHex: string;
  /** The block's cut faces, at the seabed and at the base. */
  blockTopHex: string;
  blockBaseHex: string;
  sky: SceneSky;
};

/** Imagery-measured values for one region, and the centre of the area they were measured over. */
type MeasuredRegion = {
  centre: { longitude: number; latitude: number };
  depthRamp: readonly [number, string][];
  /** Land bands of the block: the shore (0 to 3 m), low land (3 to 30 m), high ground (over 30 m). */
  shoreBandHex: string;
  lowLandHex: string;
  highLandHex: string;
  /** Bare ground of the coast (granite or sand): the block's cut faces show it in section. */
  bareGroundHex: string;
  seaSurfaceHex: string;
};

// Land stops (metres): the shore band at the waterline, low land from 3 m, high ground (forest) from 30 m.
const LAND_STOPS = { shore: 0, lowLand: 3, highLand: 30 } as const;

// Gulf of Finland, Porkkala to Loviisa (24.0 to 26.6 E, 59.35 to 60.35 N). Seabed and land: Copernicus Sentinel-2
// (s2cloudless-2024 by EOX) against the block's own depth grid, one median per depth or height band, in linear sRGB.
// Bare ground: the granite rims of the Porkkala skerries. Sea surface: "Porkkalanniemi sea wiev.JPG" (Wikimedia
// Commons, public domain).
const BALTIC: MeasuredRegion = {
  centre: { longitude: 25.3, latitude: 59.85 },
  depthRamp: [
    [5, "#060F0A"],
    [15, "#050E0A"],
    [25, "#040E0A"],
    [35, "#040D09"],
    [45, "#030C09"],
    [62.5, "#030C08"],
    [87.5, "#020B07"],
    [100, "#030B07"],
  ],
  shoreBandHex: "#1E2B1B",
  lowLandHex: "#1E2A19",
  highLandHex: "#172314",
  bareGroundHex: "#545143",
  seaSurfaceHex: "#2E435D",
};

// Taiwan Strait, Penghu to the Tainan coast (119.30 to 120.35 E, 22.90 to 23.75 N). Same method; bare ground: the
// Tainan sand barriers. Sea surface: "從島上眺望跨海大橋1.jpg" (Wikimedia Commons, CC BY 3.0).
const TAIWAN: MeasuredRegion = {
  centre: { longitude: 119.825, latitude: 23.325 },
  depthRamp: [
    [5, "#132F32"],
    [15, "#0F292F"],
    [25, "#0B232B"],
    [35, "#0B2129"],
    [45, "#0B2029"],
    [62.5, "#091825"],
    [87.5, "#071420"],
    [100, "#050C16"],
  ],
  shoreBandHex: "#3E4C3A",
  lowLandHex: "#4C5841",
  highLandHex: "#36432B",
  bareGroundHex: "#8E8D77",
  seaSurfaceHex: "#699BB8",
};

const SAMPLED_REGIONS: readonly MeasuredRegion[] = [BALTIC, TAIWAN];

// The FireTrace reference's terrain, sky and haze, medians in linear sRGB. Open ground: the tan grass of the lower-left
// hills (box 100,680 to 400,800 px; red at least green, luma 90 and up); sunlit and shaded slope: the brightest and the
// darkest quarter of those pixels; forest: the vegetated pixels of box 1300,560 to 1560,700; sky: box 200,48 to
// 1500,110; haze: the far ridges, box 300,160 to 1400,220.
const REFERENCE = {
  openGroundHex: "#7F6E54",
  sunlitSlopeHex: "#B9A27E",
  shadedSlopeHex: "#6D5E48",
  forestHex: "#2C2E1D",
  skyHex: "#B1B5B9",
  hazeHex: "#A1A4A6",
} as const;

const EARTH_RADIUS_KM = 6371;
const RADIANS_PER_DEGREE = Math.PI / 180;

function toLinearChannel(encoded: number): number {
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

function toEncodedChannel(linear: number): number {
  return linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
}

/** OKLCH (Bjorn Ottosson's OKLab, 2020, in polar form): lightness 0 to 1, chroma, hue in radians. */
export type Oklch = { lightness: number; chroma: number; hue: number };

function parseHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export function hexToOklch(hex: string): Oklch {
  const [red, green, blue] = parseHex(hex).map(toLinearChannel);
  const long = Math.cbrt(0.4122214708 * (red ?? 0) + 0.5363325363 * (green ?? 0) + 0.0514459929 * (blue ?? 0));
  const medium = Math.cbrt(0.2119034982 * (red ?? 0) + 0.6806995451 * (green ?? 0) + 0.1073969566 * (blue ?? 0));
  const short = Math.cbrt(0.0883024619 * (red ?? 0) + 0.2817188376 * (green ?? 0) + 0.6299787005 * (blue ?? 0));
  const greenRed = 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short;
  const blueYellow = 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short;
  return { lightness: 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short, chroma: Math.hypot(greenRed, blueYellow), hue: Math.atan2(blueYellow, greenRed) };
}

function oklchToLinear({ lightness, chroma, hue }: Oklch): [number, number, number] {
  const greenRed = chroma * Math.cos(hue);
  const blueYellow = chroma * Math.sin(hue);
  const long = (lightness + 0.3963377774 * greenRed + 0.2158037573 * blueYellow) ** 3;
  const medium = (lightness - 0.1055613458 * greenRed - 0.0638541728 * blueYellow) ** 3;
  const short = (lightness - 0.0894841775 * greenRed - 1.291485548 * blueYellow) ** 3;
  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];
}

/** An OKLCH colour as sRGB hex, its chroma reduced only as far as the sRGB gamut requires. */
function oklchToHex(color: Oklch): string {
  let chroma = color.chroma;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const linear = oklchToLinear({ ...color, chroma });
    if (linear.every((channel) => channel >= 0 && channel <= 1)) {
      return `#${linear.map((channel) => Math.round(toEncodedChannel(channel) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    }
    chroma *= 0.9;
  }
  return oklchToHex({ ...color, chroma: 0 });
}

/** A measured hue at a reference role's lightness and chroma. */
export function referenceMidToneHex(measuredHex: string, referenceHex: string): string {
  const reference = hexToOklch(referenceHex);
  return oklchToHex({ lightness: reference.lightness, chroma: reference.chroma, hue: hexToOklch(measuredHex).hue });
}

/** The base of the block's faces keeps the first approved faces' darkening from top to base, channel by channel in linear light. */
function deriveBlockBase(topHex: string): string {
  const approvedTop = parseHex(SCENE_COLORS.blockTop).map(toLinearChannel);
  const approvedBase = parseHex(SCENE_COLORS.blockBase).map(toLinearChannel);
  const top = parseHex(topHex).map(toLinearChannel);
  const base = top.map((channel, index) => channel * ((approvedBase[index] ?? 1) / (approvedTop[index] ?? 1)));
  return `#${base.map((channel) => Math.round(toEncodedChannel(Math.min(1, channel)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/**
 * Look C for a region. Land: the shore band at the reference's sunlit slope, low land at its open ground, high ground
 * at its forest. Seabed: the measured hue of each depth stop, its lightness running from the sunlit slope at 5 m to the
 * shaded slope at the deepest stop (shallow clearly lighter than deep), at the open ground's chroma. Sky and haze: the
 * reference's own. The hemisphere's ground light is the measured sea surface's hue at the open ground's tone.
 */
function buildReferencePalette(region: MeasuredRegion): ScenePalette {
  const sunlit = hexToOklch(REFERENCE.sunlitSlopeHex);
  const shaded = hexToOklch(REFERENCE.shadedSlopeHex);
  const openGround = hexToOklch(REFERENCE.openGroundHex);
  const lastStopIndex = Math.max(1, region.depthRamp.length - 1);
  const depthRamp = region.depthRamp.map(([stop, hex], index): [number, string] => {
    const share = index / lastStopIndex;
    return [stop, oklchToHex({ lightness: sunlit.lightness + (shaded.lightness - sunlit.lightness) * share, chroma: openGround.chroma, hue: hexToOklch(hex).hue })];
  });
  const blockTopHex = referenceMidToneHex(region.bareGroundHex, REFERENCE.sunlitSlopeHex);
  return {
    depthRamp,
    landRamp: [
      [LAND_STOPS.shore, referenceMidToneHex(region.shoreBandHex, REFERENCE.sunlitSlopeHex)],
      [LAND_STOPS.lowLand, referenceMidToneHex(region.lowLandHex, REFERENCE.openGroundHex)],
      [LAND_STOPS.highLand, referenceMidToneHex(region.highLandHex, REFERENCE.forestHex)],
    ],
    skyLightHex: REFERENCE.skyHex,
    groundLightHex: oklchToHex({ lightness: openGround.lightness, chroma: openGround.chroma, hue: hexToOklch(region.seaSurfaceHex).hue }),
    blockTopHex,
    blockBaseHex: deriveBlockBase(blockTopHex),
    sky: { upperHex: REFERENCE.skyHex, horizonHex: REFERENCE.hazeHex, hazeHex: REFERENCE.hazeHex },
  };
}

/** Great-circle distance (km) between two points in degrees. */
function measureGreatCircleKm(from: { longitude: number; latitude: number }, to: { longitude: number; latitude: number }): number {
  const deltaLatitude = (to.latitude - from.latitude) * RADIANS_PER_DEGREE;
  const deltaLongitude = (to.longitude - from.longitude) * RADIANS_PER_DEGREE;
  const chord = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(from.latitude * RADIANS_PER_DEGREE) * Math.cos(to.latitude * RADIANS_PER_DEGREE) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(chord)));
}

/** The sampled region nearest a seabed area (by the distance between their centres). */
function findNearestSampledRegion(area: SeabedRegion): MeasuredRegion {
  const centre = { longitude: (area.west + area.east) / 2, latitude: (area.south + area.north) / 2 };
  return SAMPLED_REGIONS.reduce((nearest, region) => (measureGreatCircleKm(centre, region.centre) < measureGreatCircleKm(centre, nearest.centre) ? region : nearest));
}

/** The palette a seabed area draws in: look C with the nearest sampled region's values. */
export function chooseScenePalette(area: SeabedRegion): ScenePalette {
  return buildReferencePalette(findNearestSampledRegion(area));
}
