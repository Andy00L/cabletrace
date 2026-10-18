import * as THREE from "three";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import { createSeededRandom } from "@/lib/seabed/math";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import { createHullPlatingTexture } from "@/lib/ships/hull-plating";

// The ships' paints as physically based materials: painted steel whose roughness varies across the plating (worn,
// salted, washed), dark glass that mirrors the sky, dull deck paint. Every texture here is drawn on a canvas from a
// fixed seed, so a ship costs no download and looks the same on every load; outside a browser (unit tests) the
// materials are made without them. Colours come from scene-colors.ts where it holds them (the case ship's ink
// topsides, the white house, the grey gear); the few a real ship adds are below, each dulled so it can never pass for
// a data colour (docs/UI_DESIGN_SYSTEM.md, Data).

/** Paints the scene palette does not hold: antifouling, deck pipework, lifeboats, rust. */
export const SHIP_PAINT = {
  // Antifouling red oxide below the waterline and on the boot top, as Eagle S's photographs show it, dulled toward
  // brown so it sits far from the alarm red (#D93A26).
  antifouling: "#6E3A30",
  // Tanker deck pipework: the dull green of Eagle S's cargo lines.
  pipes: "#4F5D52",
  // Enclosed lifeboats: SOLAS orange, dulled.
  lifeboat: "#C8693F",
  // Rust streaks: iron oxide washed down from scuppers and hawse pipes.
  rust: "#6B4632",
  // Draught marks and the ship's name: white paint.
  marking: "#ECEBE6",
} as const;

/** `suspect`: the case ship, ink topsides (the suspect's data colour). `context`: any other ship, in the `ship` grey. */
export type ShipTone = "suspect" | "context";

export const TONE_TOPSIDES: Record<ShipTone, { topside: string; bootTop: string; bottom: string }> = {
  suspect: { topside: SCENE_COLORS.tankerTopside, bootTop: SHIP_PAINT.antifouling, bottom: SHIP_PAINT.antifouling },
  context: { topside: WEBGL_COLORS.ship, bootTop: SCENE_COLORS.tankerTopside, bottom: SCENE_COLORS.tankerBottom },
};

// Roughness variation tile: 128 px, repeated every 12 m (one plate).
const ROUGHNESS_TILE_PX = 128;
const ROUGHNESS_SEED = 20061114;

/**
 * A roughness map for painted steel: mid grey (roughness about 0.55 once multiplied) with blotches of worn and
 * salted paint and vertical wash streaks, so the sky's reflection breaks up across the plating instead of sliding
 * over it like over plastic.
 */
function createPaintRoughnessTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = ROUGHNESS_TILE_PX;
  canvas.height = ROUGHNESS_TILE_PX;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const nextRandom = createSeededRandom(ROUGHNESS_SEED);
  context.fillStyle = "rgb(150,150,150)";
  context.fillRect(0, 0, ROUGHNESS_TILE_PX, ROUGHNESS_TILE_PX);
  for (let blotch = 0; blotch < 90; blotch += 1) {
    const shade = Math.round(120 + nextRandom() * 90);
    const radius = 3 + nextRandom() * 16;
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
    gradient.addColorStop(0, `rgba(${shade},${shade},${shade},0.5)`);
    gradient.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
    context.save();
    context.translate(nextRandom() * ROUGHNESS_TILE_PX, nextRandom() * ROUGHNESS_TILE_PX);
    context.fillStyle = gradient;
    context.fillRect(-radius, -radius, 2 * radius, 2 * radius);
    context.restore();
  }
  for (let streak = 0; streak < 26; streak += 1) {
    const shade = Math.round(170 + nextRandom() * 60);
    context.fillStyle = `rgba(${shade},${shade},${shade},0.35)`;
    context.fillRect(nextRandom() * ROUGHNESS_TILE_PX, nextRandom() * ROUGHNESS_TILE_PX * 0.5, 1 + nextRandom() * 2, 20 + nextRandom() * 60);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** One material per paint of a ship; `sky` is the image-based light for the GPU tiers' reflections, or null. */
export type ShipMaterials = {
  hull: THREE.MeshStandardMaterial;
  transom: THREE.MeshStandardMaterial;
  bulwark: THREE.MeshStandardMaterial;
  deck: THREE.MeshStandardMaterial;
  structure: THREE.MeshStandardMaterial;
  equipment: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  funnel: THREE.MeshStandardMaterial;
  band: THREE.MeshStandardMaterial;
  lifeboat: THREE.MeshStandardMaterial;
  pipes: THREE.MeshStandardMaterial;
  painted: THREE.MeshStandardMaterial;
};

/** The ship's materials. `isDetailed` adds the plating's bump relief and the paint's roughness variation (GPU tiers). */
export function createShipMaterials(tone: ShipTone, isDetailed: boolean, sky: THREE.Texture | null): ShipMaterials {
  const toneColors = TONE_TOPSIDES[tone];
  const plating = createHullPlatingTexture();
  const roughness = isDetailed ? createPaintRoughnessTexture() : null;
  // Steel paint: rough enough that the sky reads as a sheen, metal flakes in the paint lift it a little.
  const hull = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.2, map: plating, roughnessMap: roughness });
  if (plating && isDetailed) {
    hull.bumpMap = plating;
    hull.bumpScale = 0.6;
  }
  const standard = (color: string, parameters: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.05, ...parameters });
  const materials: ShipMaterials = {
    hull,
    transom: standard(toneColors.topside, { metalness: 0.2, roughnessMap: roughness }),
    bulwark: standard(toneColors.topside, { metalness: 0.2, side: THREE.DoubleSide }),
    deck: standard(SCENE_COLORS.tankerDeck, { roughness: 0.85, metalness: 0.02, side: THREE.DoubleSide }),
    structure: standard(SCENE_COLORS.tankerSuperstructure, { roughness: 0.55, roughnessMap: roughness }),
    equipment: standard(SCENE_COLORS.tankerEquipment, { roughness: 0.5, metalness: 0.35 }),
    // Bridge glass: smooth and dark, so it mirrors the sky like a window and not like paint.
    glass: standard(SCENE_COLORS.tankerGlass, { roughness: 0.08, metalness: 0.7 }),
    funnel: standard(SCENE_COLORS.tankerFunnel, { roughness: 0.6, roughnessMap: roughness }),
    band: standard(SCENE_COLORS.tankerFunnelBand, { roughness: 0.6 }),
    lifeboat: standard(SHIP_PAINT.lifeboat, { roughness: 0.45 }),
    pipes: standard(SHIP_PAINT.pipes, { roughness: 0.55, metalness: 0.2 }),
    painted: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.15 }),
  };
  if (sky) {
    Object.values(materials).forEach((material) => {
      material.envMap = sky;
      material.envMapIntensity = 0.55;
    });
  }
  return materials;
}
