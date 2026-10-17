// Material colors of the 3D seabed that are not data colors: the seabed and land as seen in the overview, the
// block's cut faces, water, and the illustrated close-up (sand, mud, steel, copper). Data colors (cables, pipelines,
// the alarm) come from WEBGL_COLORS. sourceRef: the approved prototype, ui-design/prototypes/seabed-3d/index.html
// (plan ticket 13), and docs/UI_DESIGN_SYSTEM.md, Map, for the depth and land tokens.

/**
 * The seabed as seen through the water, by depth in metres: the map's depth tokens placed at the middle of each band
 * (depth-10 covers 0 to 10 m, so it sits at 5 m) and blended between, so the light the water absorbs with depth ends
 * in exactly the approved tones and the 3D view and the flat map agree. Deeper than 100 m stays `depth-deep`.
 */
export const DEPTH_TOKEN_RAMP: readonly [number, string][] = [
  [5, "#ECF0EF"],
  [15, "#E6EBEA"],
  [25, "#E0E7E6"],
  [35, "#DAE2E1"],
  [45, "#D4DDDC"],
  [62.5, "#CED8D7"],
  [87.5, "#C8D3D2"],
  [100, "#C2CECD"],
];

/** Land by height in metres: the `coast` token along the shore, the `land` token above it (relief shading does the rest). */
export const LAND_TOKEN_RAMP: readonly [number, string][] = [
  [0, "#E9EAE6"],
  [6, "#FAFAF8"],
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
  // The sky the water surface reflects (water-surface.ts): the studio's white, a breath of the sea's green.
  waterSky: "#F2F6F5",
  // The ships' contact shadow on the water: the shadow tint of the interface (docs/UI_DESIGN_SYSTEM.md, Depth).
  contactShadow: "#141412",
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
