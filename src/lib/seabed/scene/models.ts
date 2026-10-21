import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createSeededRandom } from "@/lib/seabed/math";

// The anchor and its chain, built in metres. A stockless anchor of the Hall type, as merchant ships carry: a cast crown
// (head) through which the shank's pin passes, two broad flukes cast with the crown that swing together about the pin
// toward the shank and dig in, tripping palms under the crown that tip the flukes down as the anchor drags, a forged
// shank of rounded section tapering toward its eye, and the anchor shackle. Proportions follow the type's usual
// drawings (fluke length about 0.45 of the shank, crown width about half the shank); the overall size follows the
// Finnish police description of the recovered Eagle S anchor: about 4 m by 2.5 m (poliisi.fi release, 9 January 2025).

// Fluke swing toward the shank when digging (stockless anchors open to roughly 40 degrees).
const FLUKE_SWING_RADIANS = 0.66;
// Flukes splay outward so the tips span about 2.5 m.
const FLUKE_SPLAY_RADIANS = 0.24;
const SHANK_LENGTH = 3.35;

/** One fluke: a broad blade tapering to a blunt point, thick at its root, with a rib down its back. */
function buildFlukeGeometry(): THREE.BufferGeometry {
  // Outline in the blade plane: x across, y along the blade from root (0) to tip (1.6 m).
  const outline = new THREE.Shape();
  outline.moveTo(-0.44, 0);
  outline.lineTo(0.44, 0);
  outline.quadraticCurveTo(0.46, 0.75, 0.2, 1.45);
  outline.quadraticCurveTo(0, 1.64, -0.2, 1.45);
  outline.quadraticCurveTo(-0.46, 0.75, -0.44, 0);
  const blade = new THREE.ExtrudeGeometry(outline, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 3, curveSegments: 14 });
  // The rib: a ridge down the blade's back, thick at the root and fading toward the tip.
  const rib = new THREE.CylinderGeometry(0.05, 0.12, 1.35, 8);
  rib.translate(0, 0.68, 0.16);
  const parts = [blade.toNonIndexed(), rib.toNonIndexed()];
  const merged = mergeGeometries(parts, false) ?? blade;
  [blade, rib, ...parts].forEach((part) => {
    if (part !== merged) part.dispose();
  });
  // Blade length along +z, thickness downward.
  merged.rotateX(Math.PI / 2);
  return merged;
}

/** The shank: a forged bar of rounded section, 0.3 by 0.26 m at the crown, 0.22 by 0.19 m at the eye. */
function buildShankGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.11, 0.15, SHANK_LENGTH, 12, 6);
  geometry.scale(1, 1, 0.86);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, 0.1 + SHANK_LENGTH / 2);
  return geometry;
}

export type AnchorModel = {
  group: THREE.Group;
  /** Where the chain attaches, in model metres (shank along +z, head at the origin). */
  shackleLocal: THREE.Vector3;
};

// Wear map: 128 px of dark steel with lighter scoured patches (the flukes and crown are scraped bright by the seabed)
// and darker corrosion, from a fixed seed.
const WEAR_TILE_PX = 128;
const WEAR_SEED = 20250109;
// Galvanised and scoured steel, the tone a dragged anchor's bare metal takes.
const GALVANISED_HEX = "#8E9294";

function createWornSteelTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = WEAR_TILE_PX;
  canvas.height = WEAR_TILE_PX;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const nextRandom = createSeededRandom(WEAR_SEED);
  context.fillStyle = "rgb(200,200,200)";
  context.fillRect(0, 0, WEAR_TILE_PX, WEAR_TILE_PX);
  for (let patch = 0; patch < 70; patch += 1) {
    const isScoured = nextRandom() < 0.55;
    const shade = isScoured ? 235 + Math.round(nextRandom() * 20) : 120 + Math.round(nextRandom() * 50);
    const radius = 2 + nextRandom() * 14;
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
    gradient.addColorStop(0, `rgba(${shade},${shade},${isScoured ? shade : shade - 25},0.6)`);
    gradient.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
    context.save();
    context.translate(nextRandom() * WEAR_TILE_PX, nextRandom() * WEAR_TILE_PX);
    context.fillStyle = gradient;
    context.fillRect(-radius, -radius, 2 * radius, 2 * radius);
    context.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Dark cast and forged steel, worn: a little metallic sheen, scoured bright where it drags, the sky's light in its
 * reflections when `sky` is given. `color` is the scene's anchor tone, lifted `galvanisedShare` of the way toward
 * galvanised grey: the close-up's lit seabed needs 0.45 (dark painted steel at full metalness reads as a black hole
 * there), the overview's anchor under 75 m of water stays darker so it stands out against the seabed.
 */
export function createAnchorSteelMaterial(color: string, sky: THREE.Texture | null, galvanisedShare: number): THREE.MeshStandardMaterial {
  const wear = createWornSteelTexture();
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(GALVANISED_HEX), galvanisedShare), roughness: 0.48, metalness: 0.55, map: wear, roughnessMap: wear });
  if (sky) {
    material.envMap = sky;
    // Bright enough that the worn edges catch the sky as highlights, which carry the anchor's form under the water.
    material.envMapIntensity = 1.1;
  }
  return material;
}

/** Where the chain's shackle is on the anchor model (metres, the model's own frame): known before the model is built. */
export function readAnchorShackleLocal(): THREE.Vector3 {
  return new THREE.Vector3(0, 0, SHANK_LENGTH + 0.72);
}

export function buildAnchorModel(material: THREE.Material): AnchorModel {
  const parts: THREE.BufferGeometry[] = [];
  // The crown: the cast head, wider than deep, with the shank's pin bosses on both sides.
  const head = new RoundedBoxGeometry(1.5, 0.5, 0.8, 3, 0.16);
  parts.push(head);
  const pin = new THREE.CylinderGeometry(0.13, 0.13, 1.86, 14);
  pin.rotateZ(Math.PI / 2);
  parts.push(pin);
  for (const side of [-1, 1]) {
    const boss = new THREE.CylinderGeometry(0.2, 0.2, 0.14, 18);
    boss.rotateZ(Math.PI / 2);
    boss.translate(side * 0.82, 0, 0);
    parts.push(boss);
    // Tripping palm: a wedge under the back of the crown that tips the flukes into the seabed.
    const palm = new RoundedBoxGeometry(0.36, 0.2, 0.5, 2, 0.05);
    palm.rotateX(-0.55);
    palm.translate(side * 0.5, -0.27, -0.3);
    parts.push(palm);
    const fluke = buildFlukeGeometry();
    fluke.rotateX(FLUKE_SWING_RADIANS);
    fluke.rotateY(side * FLUKE_SPLAY_RADIANS);
    fluke.translate(side * 0.48, -0.08, 0.2);
    parts.push(fluke);
  }
  parts.push(buildShankGeometry());
  // The eye at the end of the shank, ring standing vertical.
  const eye = new THREE.TorusGeometry(0.19, 0.08, 12, 24);
  eye.rotateY(Math.PI / 2);
  eye.translate(0, 0, SHANK_LENGTH + 0.24);
  parts.push(eye);
  // The anchor shackle through the eye, its bow lying flat: the bow, two legs and the pin with its collar.
  const bow = new THREE.TorusGeometry(0.21, 0.065, 10, 20, Math.PI);
  bow.rotateX(-Math.PI / 2);
  bow.translate(0, 0, SHANK_LENGTH + 0.53);
  parts.push(bow);
  for (const side of [-1, 1]) {
    const leg = new THREE.CylinderGeometry(0.065, 0.065, 0.22, 10);
    leg.rotateX(Math.PI / 2);
    leg.translate(side * 0.21, 0, SHANK_LENGTH + 0.42);
    parts.push(leg);
  }
  const shacklePin = new THREE.CylinderGeometry(0.05, 0.05, 0.56, 10);
  shacklePin.rotateZ(Math.PI / 2);
  shacklePin.translate(0, 0, SHANK_LENGTH + 0.32);
  parts.push(shacklePin);

  const nonIndexed = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  const merged = mergeGeometries(nonIndexed, false) ?? new THREE.BufferGeometry();
  parts.forEach((part) => part.dispose());
  nonIndexed.forEach((part) => part.dispose());
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return { group, shackleLocal: readAnchorShackleLocal() };
}

/** One stud link (about 0.5 m long, the common link for an 11 t anchor's chain), for instancing. */
export function buildStudLinkGeometry(): THREE.BufferGeometry {
  const ring = new THREE.TorusGeometry(0.12, 0.045, 8, 18);
  ring.scale(1, 1.65, 1);
  const stud = new THREE.CylinderGeometry(0.028, 0.028, 0.2, 6);
  stud.rotateZ(Math.PI / 2);
  const nonIndexed = [ring.toNonIndexed(), stud.toNonIndexed()];
  const merged = mergeGeometries(nonIndexed, false) ?? new THREE.BufferGeometry();
  [ring, stud, ...nonIndexed].forEach((part) => part.dispose());
  return merged;
}
