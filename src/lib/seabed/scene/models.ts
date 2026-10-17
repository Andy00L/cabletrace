import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// The anchor and its chain, built in metres. A stockless (Spek-type) anchor as carried by tankers: a head
// that holds the pivot, two broad flukes that swing toward the shank and dig in, tripping palms that tip
// the flukes down, a tapered shank, its eye and a D-shackle. Overall size follows the Finnish police
// description of the recovered Eagle S anchor: about 4 m by 2.5 m (poliisi.fi release, 9 January 2025).

// Fluke swing toward the shank when digging (stockless anchors open to roughly 40 degrees).
const FLUKE_SWING_RADIANS = 0.66;
// Flukes splay outward so the tips span about 2.5 m.
const FLUKE_SPLAY_RADIANS = 0.26;

function buildFlukeGeometry(): THREE.BufferGeometry {
  // Outline in the blade plane: x across, y along the blade from root (0) to tip (1.55 m).
  const outline = new THREE.Shape();
  outline.moveTo(-0.37, 0);
  outline.lineTo(0.37, 0);
  outline.quadraticCurveTo(0.4, 0.8, 0.16, 1.42);
  outline.quadraticCurveTo(0, 1.6, -0.16, 1.42);
  outline.quadraticCurveTo(-0.4, 0.8, -0.37, 0);
  const geometry = new THREE.ExtrudeGeometry(outline, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2, curveSegments: 10 });
  // Blade length along +z, thickness downward.
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function buildShankGeometry(): THREE.BufferGeometry {
  const length = 3.35;
  const geometry = new THREE.BoxGeometry(0.28, 0.24, length, 1, 1, 6);
  const positions = geometry.getAttribute("position");
  // Taper toward the eye: 0.28 x 0.24 at the head to 0.2 x 0.18 at the far end.
  for (let index = 0; index < positions.count; index += 1) {
    const along = positions.getZ(index) / length + 0.5;
    const taper = 1 - 0.28 * along;
    positions.setX(index, positions.getX(index) * taper);
    positions.setY(index, positions.getY(index) * (1 - 0.25 * along));
  }
  geometry.computeVertexNormals();
  geometry.translate(0, 0, 0.1 + length / 2);
  return geometry;
}

export type AnchorModel = {
  group: THREE.Group;
  /** Where the chain attaches, in model metres (shank along +z, head at the origin). */
  shackleLocal: THREE.Vector3;
};

export function buildAnchorModel(material: THREE.Material): AnchorModel {
  const parts: THREE.BufferGeometry[] = [];
  const head = new RoundedBoxGeometry(1.6, 0.44, 0.66, 3, 0.12);
  parts.push(head);
  // Pivot bosses on both sides of the head.
  for (const side of [-1, 1]) {
    const boss = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 16);
    boss.rotateZ(Math.PI / 2);
    boss.translate(side * 0.85, 0, 0);
    parts.push(boss);
    // Tripping palm: a wedge under the back of the head that tips the flukes into the seabed.
    const palm = new THREE.BoxGeometry(0.34, 0.16, 0.42);
    palm.rotateX(-0.5);
    palm.translate(side * 0.52, -0.24, -0.28);
    parts.push(palm);
    const fluke = buildFlukeGeometry();
    fluke.rotateX(FLUKE_SWING_RADIANS);
    fluke.rotateY(side * FLUKE_SPLAY_RADIANS);
    fluke.translate(side * 0.5, -0.06, 0.18);
    parts.push(fluke);
  }
  parts.push(buildShankGeometry());
  // The eye at the end of the shank, ring standing vertical.
  const eye = new THREE.TorusGeometry(0.17, 0.07, 10, 20);
  eye.rotateY(Math.PI / 2);
  eye.translate(0, 0, 3.58);
  parts.push(eye);
  // D-shackle through the eye, ring lying flat: the bow, two legs and the pin.
  const bow = new THREE.TorusGeometry(0.19, 0.055, 8, 16, Math.PI);
  bow.rotateX(-Math.PI / 2);
  bow.translate(0, 0, 3.86);
  parts.push(bow);
  for (const side of [-1, 1]) {
    const leg = new THREE.CylinderGeometry(0.055, 0.055, 0.2, 8);
    leg.rotateX(Math.PI / 2);
    leg.translate(side * 0.19, 0, 3.76);
    parts.push(leg);
  }
  const pin = new THREE.CylinderGeometry(0.045, 0.045, 0.5, 8);
  pin.rotateZ(Math.PI / 2);
  pin.translate(0, 0, 3.66);
  parts.push(pin);

  const nonIndexed = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  const merged = mergeGeometries(nonIndexed, false) ?? new THREE.BufferGeometry();
  parts.forEach((part) => part.dispose());
  nonIndexed.forEach((part) => part.dispose());
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return { group, shackleLocal: new THREE.Vector3(0, 0, 4.05) };
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
