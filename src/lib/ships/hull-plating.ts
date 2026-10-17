import * as THREE from "three";

// Steel plating on the hull: faint weld seams between strakes (horizontal) and between plates (vertical), drawn once
// on a small canvas and repeated by the hull's UVs (one tile is one plate, PLATE_LENGTH_METRES by
// STRAKE_HEIGHT_METRES in hull-form.ts). The same canvas serves as a bump map on the GPU tier, so seams catch the sun.
// It needs a browser canvas; elsewhere (unit tests) the hull is drawn without it.

const TILE_PX = 64;
// Seam darkness as a share of the paint (the texture multiplies the vertex colour): faint, read rather than seen.
const SEAM_SHADE = 0.86;
const WELD_SHADE = 0.94;

/** The plating tile, or null where no 2D canvas exists (outside a browser; the hull is then drawn plain). */
export function createHullPlatingTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = TILE_PX;
  canvas.height = TILE_PX;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, TILE_PX, TILE_PX);
  const seam = Math.round(255 * SEAM_SHADE);
  const weld = Math.round(255 * WELD_SHADE);
  // Strake seam along the bottom edge of the tile, plate butt along its left edge, each with a softer weld bead beside it.
  context.fillStyle = `rgb(${seam},${seam},${seam})`;
  context.fillRect(0, TILE_PX - 2, TILE_PX, 2);
  context.fillRect(0, 0, 2, TILE_PX);
  context.fillStyle = `rgb(${weld},${weld},${weld})`;
  context.fillRect(0, TILE_PX - 4, TILE_PX, 2);
  context.fillRect(2, 0, 2, TILE_PX);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}
