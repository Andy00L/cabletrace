// Palette values for WebGL code (MapLibre styles, three.js materials), which cannot read CSS variables.
// sourceRef: docs/UI_DESIGN_SYSTEM.md (Palette) and the @theme block in src/app/globals.css.
export const WEBGL_COLORS = {
  ink: "#141414",
  cable: "#2F6BD8",
  pipeline: "#B66E12",
  alarm: "#D93A26",
  casing: "#FFFFFF",
  depth30: "#E0E7E6",
  depth50: "#D4DDDC",
  depthDeep: "#C2CECD",
  depth40: "#DAE2E1",
  land: "#FAFAF8",
  // Parchment (--color-page): the live globe's land since the Dudley palette (22 Oct 2026), so the globe on its slate
  // field is not a white ball. The 3D seabed keeps `land`, which its lookdev baselines hold.
  page: "#F2EADA",
  ship: "#A8A8A2",
  live: "#2E9E5B",
  density: "#3F7E86",
} as const;
