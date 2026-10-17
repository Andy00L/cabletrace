// Material colors of the 3D seabed that are not data colors: the shaded seabed and land ramps, the block's
// cut faces, water, and the illustrated close-up (sand, mud, steel, copper). Data colors (cables, pipelines,
// the alarm) come from WEBGL_COLORS. sourceRef: the approved prototype, ui-design/prototypes/seabed-3d/index.html
// (plan ticket 13); values are darker than the 2D depth bands because the 3D surface is lit.

/** Seabed color by depth in metres. */
export const SEABED_RAMP: readonly [number, string][] = [
  [0, "#E7EEED"],
  [10, "#DFE8E7"],
  [20, "#D6E1E0"],
  [30, "#CDDAD9"],
  [50, "#C1D0CF"],
  [75, "#B5C6C5"],
  [100, "#A9BCBB"],
  [130, "#9EB3B2"],
];

/** Land color by height in metres. */
export const LAND_RAMP: readonly [number, string][] = [
  [0, "#F2F0E9"],
  [25, "#ECE9E0"],
  [60, "#E4E0D5"],
];

export const SCENE_COLORS = {
  blockTop: "#E7E3D9",
  // Contour lines and the shoreline drawn on the overview terrain (terrain-material.ts).
  seabedContour: "#8CA4A3",
  landContour: "#BDB6A5",
  shoreline: "#5F7574",
  blockBase: "#CBC6BA",
  water: "#AFCBCA",
  waterRim: "#FFFFFF",
  skyLight: "#FFFFFF",
  groundLight: "#CDD5D2",
  hull: "#141414",
  wheelhouse: "#FFFFFF",
  anchor: "#3A3A37",
  plume: "#D2C6AE",
  signalCore: "#EAF1FF",
  signalGlow: "#8FB4FF",
  cutCore: "#FFE1DB",
  cutGlow: "#FF9C8C",
  closeUpFog: "#9DB8B5",
  closeUpSky: "#EAF5F3",
  closeUpGround: "#56635E",
  sand: "#CAC1AD",
  mud: "#ABA28D",
  trenchFloor: "#8A826D",
  berm: "#BEB39B",
  measuredSeabed: "#C3D1D0",
  armour: "#2A55A8",
  armourStripe: "#4C7FD9",
  armourShade: "rgba(10,20,40,0.35)",
  copper: "#B87333",
  copperGlow: "#5A2A10",
  steel: "#8C9196",
  closeUpAnchor: "#55575A",
  closeUpPlume: "#CFC4AC",
  lightShaft: "#F4FBFA",
  // The suspect tanker: ink topsides (the suspect's data color), lighter bottom, white superstructure.
  tankerTopside: "#262725",
  tankerBootTop: "#0E0E0D",
  tankerBottom: "#3E3D39",
  tankerDeck: "#6C706A",
  tankerSuperstructure: "#F1F0EB",
  tankerEquipment: "#8F928D",
  tankerGlass: "#1F2528",
  tankerFunnel: "#2A2A28",
  tankerFunnelBand: "#D8D5CC",
  tankerLifeboat: "#E6E1D6",
  wake: "#FFFFFF",
} as const;
