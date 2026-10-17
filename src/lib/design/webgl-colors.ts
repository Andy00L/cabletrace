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
} as const;
