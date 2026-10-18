import { DEPTH_TOKEN_RAMP, LAND_TOKEN_RAMP, SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";

// Exploration only (branch explore/natural-look, round-2 design board): the 3D replay's environment colours in four
// looks, chosen per page load without a code edit, so the same engine draws every candidate Andy compares.
//   - current: the approved look (depth and land tokens, a transparent sky over the page).
//   - natural-a "measured": every value sampled from imagery of the place (the median, in linear sRGB, of a stated
//     area; the table and the method are in .scratch/round2-renders/palettes.md of the main checkout).
//   - natural-b "calm natural": natural-a's hues, lighter and less saturated by one fixed transform (calmNaturalHex).
//   - natural-c "reference mid-tone": natural-a's hues at the lightness and chroma of the FireTrace reference's terrain
//     (ui-design/references/round-2/3-firetrace-incident-colors-depth.webp), its sky and haze as sampled there.
// Data colours (cables, pipelines, the track, the alarm) are never part of a look: they stay exact
// (src/lib/render/data-colors.ts).

export type SceneLookName = "current" | "natural-a" | "natural-b" | "natural-c";

const SCENE_LOOK_NAMES: readonly SceneLookName[] = ["current", "natural-a", "natural-b", "natural-c"];

/** The sky a natural look draws around the scene, and the haze distant ground fades into (sRGB hex). */
export type SceneSky = { upperHex: string; horizonHex: string; hazeHex: string };

export type ScenePalette = {
  look: SceneLookName;
  /** Seabed seen through the water, by depth in metres (overview.ts samples it per terrain vertex). */
  depthRamp: readonly [number, string][];
  /** Land by height in metres. */
  landRamp: readonly [number, string][];
  // Not drawn on this branch: both live in water-surface.ts, which the parallel branch explore/aaa-ships-sea-cables
  // owns; the lead wires them at merge (palettes.md lists them). Every look draws SCENE_COLORS.waterSky and .water.
  /** What the water surface reflects. */
  waterSkyHex: string;
  /** The water column seen through the block's sides. */
  waterColumnHex: string;
  /** The hemisphere light: sky and ground. */
  skyLightHex: string;
  groundLightHex: string;
  /** The block's cut faces, at the seabed and at the base. */
  blockTopHex: string;
  blockBaseHex: string;
  /** Null: no sky, the canvas stays transparent over the page (the approved look). */
  sky: SceneSky | null;
};

/** Imagery-measured values for one region (natural-a). */
type MeasuredRegion = {
  depthRamp: readonly [number, string][];
  /** Land bands of the block: the shore (0 to 3 m), low land (3 to 30 m), high ground (over 30 m). */
  shoreBandHex: string;
  lowLandHex: string;
  highLandHex: string;
  /** Bare ground of the coast (granite or sand) at 10 m: the block's cut faces show it in section. */
  bareGroundHex: string;
  upperSkyHex: string;
  horizonHex: string;
  seaSurfaceHex: string;
};

// Land stops (metres): the shore band at the waterline, low land from 3 m, high ground (forest) from 30 m.
const LAND_STOPS = { shore: 0, lowLand: 3, highLand: 30 } as const;

// Gulf of Finland, Porkkala to Loviisa. Seabed and land: Copernicus Sentinel-2 (s2cloudless-2024 by EOX, the block's
// region at 1,250 x 962 px) against the block's own depth grid, one median per depth or height band. Bare ground: the
// granite rims of the Porkkala skerries (Sentinel-2, 10 m). Sky, horizon, sea surface: "Porkkalanniemi sea wiev.JPG"
// (Wikimedia Commons, public domain, 10 July 2010).
const BALTIC: MeasuredRegion = {
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
  upperSkyHex: "#749EE0",
  horizonHex: "#BDC7D6",
  seaSurfaceHex: "#2E435D",
};

// Taiwan Strait, Penghu to the Tainan coast. Same method; bare ground: the Tainan sand barriers (Sentinel-2, 10 m).
// Sky, horizon, sea surface: "從島上眺望跨海大橋1.jpg" (Wikimedia Commons, CC BY 3.0, Penghu, 7 September 2008).
const TAIWAN: MeasuredRegion = {
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
  upperSkyHex: "#8FB5E2",
  horizonHex: "#8BB1DC",
  seaSurfaceHex: "#699BB8",
};

// The FireTrace reference's terrain, sky and haze (natural-c), medians in linear sRGB. Open ground: the tan grass of
// the lower-left hills (box 100,680 to 400,800 px; pixels with red at least green and luma 90 and up, so the tree dots
// are left out); sunlit and shaded slope: the brightest and the darkest quarter of those pixels; forest: the vegetated
// pixels (green over red) of box 1300,560 to 1560,700; sky: box 200,48 to 1500,110; haze: the far ridges, box 300,160
// to 1400,220.
const REFERENCE = {
  openGroundHex: "#7F6E54",
  sunlitSlopeHex: "#B9A27E",
  shadedSlopeHex: "#6D5E48",
  forestHex: "#2C2E1D",
  skyHex: "#B1B5B9",
  hazeHex: "#A1A4A6",
} as const;

// Seabed areas off Taiwan use the Taiwan values; every other area (the Baltic ones, and for now Svalbard and the Red
// Sea, which were not sampled) uses the Gulf of Finland values.
const TAIWAN_AREAS: readonly string[] = ["taiwan-penghu", "taiwan-keelung", "matsu"];

// natural-b's transform in OKLCH: lightness pulled into the house style's light range (0.84 to 1.00, where the data
// colours keep their contrast), chroma at 60%.
const CALM_LIGHTNESS_FLOOR = 0.84;
const CALM_LIGHTNESS_SPAN = 0.16;
const CALM_CHROMA_SHARE = 0.6;

/** Reads the look for this page load: `?look=` in the URL, else `<html data-scene-look>`, else the current look. */
export function readSceneLook(): SceneLookName {
  const requested = new URLSearchParams(window.location.search).get("look") ?? document.documentElement.dataset.sceneLook ?? "current";
  return SCENE_LOOK_NAMES.find((name) => name === requested) ?? "current";
}

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

/** natural-b from natural-a: same hue, lightness mapped from 0..1 to 0.84..1.00 (order kept), chroma at 60%. */
export function calmNaturalHex(hex: string): string {
  const measured = hexToOklch(hex);
  return oklchToHex({ lightness: CALM_LIGHTNESS_FLOOR + CALM_LIGHTNESS_SPAN * measured.lightness, chroma: measured.chroma * CALM_CHROMA_SHARE, hue: measured.hue });
}

/** natural-c: a measured hue at a reference role's lightness and chroma. */
export function referenceMidToneHex(measuredHex: string, referenceHex: string): string {
  const reference = hexToOklch(referenceHex);
  return oklchToHex({ lightness: reference.lightness, chroma: reference.chroma, hue: hexToOklch(measuredHex).hue });
}

/** The base of the block's faces keeps the approved faces' darkening from top to base, channel by channel in linear light. */
function deriveBlockBase(topHex: string): string {
  const approvedTop = parseHex(SCENE_COLORS.blockTop).map(toLinearChannel);
  const approvedBase = parseHex(SCENE_COLORS.blockBase).map(toLinearChannel);
  const top = parseHex(topHex).map(toLinearChannel);
  const base = top.map((channel, index) => channel * ((approvedBase[index] ?? 1) / (approvedTop[index] ?? 1)));
  return `#${base.map((channel) => Math.round(toEncodedChannel(Math.min(1, channel)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function buildMeasuredPalette(region: MeasuredRegion): ScenePalette {
  return {
    look: "natural-a",
    depthRamp: region.depthRamp,
    landRamp: [
      [LAND_STOPS.shore, region.shoreBandHex],
      [LAND_STOPS.lowLand, region.lowLandHex],
      [LAND_STOPS.highLand, region.highLandHex],
    ],
    // Looking along the water the surface mirrors the sky near the horizon; the haze is the horizon's own colour.
    waterSkyHex: region.horizonHex,
    waterColumnHex: region.seaSurfaceHex,
    skyLightHex: region.upperSkyHex,
    groundLightHex: region.seaSurfaceHex,
    blockTopHex: region.bareGroundHex,
    blockBaseHex: deriveBlockBase(region.bareGroundHex),
    sky: { upperHex: region.upperSkyHex, horizonHex: region.horizonHex, hazeHex: region.horizonHex },
  };
}

function buildCalmPalette(region: MeasuredRegion): ScenePalette {
  const measured = buildMeasuredPalette(region);
  const calmRamp = (ramp: readonly [number, string][]) => ramp.map(([stop, hex]): [number, string] => [stop, calmNaturalHex(hex)]);
  const blockTopHex = calmNaturalHex(measured.blockTopHex);
  return {
    look: "natural-b",
    depthRamp: calmRamp(measured.depthRamp),
    landRamp: calmRamp(measured.landRamp),
    waterSkyHex: calmNaturalHex(measured.waterSkyHex),
    waterColumnHex: calmNaturalHex(measured.waterColumnHex),
    skyLightHex: calmNaturalHex(measured.skyLightHex),
    groundLightHex: calmNaturalHex(measured.groundLightHex),
    blockTopHex,
    blockBaseHex: deriveBlockBase(blockTopHex),
    sky: { upperHex: calmNaturalHex(region.upperSkyHex), horizonHex: calmNaturalHex(region.horizonHex), hazeHex: calmNaturalHex(region.horizonHex) },
  };
}

/**
 * natural-c: natural-a's hues at the reference's lightness and chroma. Land: the shore band at the sunlit slope, low
 * land at the open ground, high ground at the forest. Water: the measured seabed hue of each depth stop, its lightness
 * running from the sunlit slope at 5 m to the shaded slope at the deepest stop (shallow clearly lighter than deep), its
 * chroma the open ground's. Sky and haze: the reference's own.
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
  const waterColumnHex = oklchToHex({ lightness: openGround.lightness, chroma: openGround.chroma, hue: hexToOklch(region.seaSurfaceHex).hue });
  const blockTopHex = referenceMidToneHex(region.bareGroundHex, REFERENCE.sunlitSlopeHex);
  return {
    look: "natural-c",
    depthRamp,
    landRamp: [
      [LAND_STOPS.shore, referenceMidToneHex(region.shoreBandHex, REFERENCE.sunlitSlopeHex)],
      [LAND_STOPS.lowLand, referenceMidToneHex(region.lowLandHex, REFERENCE.openGroundHex)],
      [LAND_STOPS.highLand, referenceMidToneHex(region.highLandHex, REFERENCE.forestHex)],
    ],
    waterSkyHex: REFERENCE.hazeHex,
    waterColumnHex,
    skyLightHex: REFERENCE.skyHex,
    groundLightHex: waterColumnHex,
    blockTopHex,
    blockBaseHex: deriveBlockBase(blockTopHex),
    sky: { upperHex: REFERENCE.skyHex, horizonHex: REFERENCE.hazeHex, hazeHex: REFERENCE.hazeHex },
  };
}

const CURRENT_PALETTE: ScenePalette = {
  look: "current",
  depthRamp: DEPTH_TOKEN_RAMP,
  landRamp: LAND_TOKEN_RAMP,
  waterSkyHex: SCENE_COLORS.waterSky,
  waterColumnHex: SCENE_COLORS.water,
  skyLightHex: SCENE_COLORS.skyLight,
  groundLightHex: SCENE_COLORS.groundLight,
  blockTopHex: SCENE_COLORS.blockTop,
  blockBaseHex: SCENE_COLORS.blockBase,
  sky: null,
};

/** The palette a look draws for a seabed area (`ReplaySceneInput.seabedArea`). */
export function chooseScenePalette(look: SceneLookName, seabedArea: string): ScenePalette {
  const region = TAIWAN_AREAS.includes(seabedArea) ? TAIWAN : BALTIC;
  switch (look) {
    case "current":
      return CURRENT_PALETTE;
    case "natural-a":
      return buildMeasuredPalette(region);
    case "natural-b":
      return buildCalmPalette(region);
    case "natural-c":
      return buildReferencePalette(region);
    default: {
      const unhandledLook: never = look;
      return unhandledLook;
    }
  }
}
