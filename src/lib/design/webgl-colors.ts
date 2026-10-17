// Palette values for WebGL code (MapLibre styles, three.js materials), which cannot read CSS variables.
// sourceRef: docs/UI_DESIGN_SYSTEM.md (Palette) and the @theme block in src/app/globals.css.
export const WEBGL_COLORS = {
  cable: "#2F6BD8",
  casing: "#FFFFFF",
  land: "#FAFAF8",
  depth30: "#E0E7E6",
  depth50: "#D4DDDC",
  depthDeep: "#C2CECD",
} as const;
