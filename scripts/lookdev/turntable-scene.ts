// One cell of the ship turntable: a ship kind at a typical length under the replay's sun, seen from its starboard bow
// quarter, on a patch of water. Shared by the WebGL page (turntable-page.ts) and the WebGPU page
// (turntable-webgpu-page.ts), so both tiers judge the same scenes. Browser only (the hull plating draws on a canvas).
import * as THREE from "three";
import type { SceneMaterialKit } from "../../src/lib/render/scene-renderer";
import type { ShipKind } from "../../src/lib/replay/replay-scene";
import { SCENE_COLORS } from "../../src/lib/seabed/scene/scene-colors";
import { buildShip } from "../../src/lib/ships/build-ship";
import { addShipDetail } from "../../src/lib/ships/ship-detail";
import { createKelvinWake } from "../../src/lib/ships/kelvin-wake";

// Typical lengths (m): the case ships where a case has the kind, common sizes otherwise.
const TURNTABLE_LENGTHS: Record<ShipKind, number> = {
  tanker: 228.6,
  "bulk-carrier": 224,
  "general-cargo": 132,
  "container-ship": 169,
  fishing: 45,
  tug: 32,
  "ro-ro": 190,
  passenger: 180,
  "cable-layer": 140,
};
// Each ship sails at 12 knots (6.2 m/s), so the GPU tiers show its bow wave and Kelvin wake.
const TURNTABLE_SPEED_METRES_PER_SECOND = 6.17;
// Each ship is seen from its starboard bow quarter, a little above deck, at a distance set by its length.
const VIEW_DIRECTION = new THREE.Vector3(0.95, 0.42, 0.75).normalize();
const VIEW_DISTANCE_LENGTHS = 1.05;

export const TURNTABLE_LAYOUT = { columns: 3, cellWidthPx: 460, cellHeightPx: 240 } as const;

/** The scene and camera of one cell; `isDetailed` adds the GPU tiers' plating relief and Kelvin wake. */
export function buildTurntableCell(kind: ShipKind, kit: SceneMaterialKit, environment: THREE.Texture, isDetailed: boolean): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const lengthMetres = TURNTABLE_LENGTHS[kind];
  const scene = new THREE.Scene();
  scene.environment = environment;
  scene.environmentIntensity = 0.38;
  scene.add(new THREE.HemisphereLight(SCENE_COLORS.skyLight, SCENE_COLORS.groundLight, 0.95));
  // The overview's sun: from the north-west, high (overview.ts).
  const sun = new THREE.DirectionalLight(SCENE_COLORS.skyLight, 2.1);
  sun.position.set(-42, 78, -26).setLength(lengthMetres * 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.0004 * lengthMetres;
  Object.assign(sun.shadow.camera, { left: -lengthMetres, right: lengthMetres, top: lengthMetres, bottom: -lengthMetres, near: 1, far: lengthMetres * 5 });
  scene.add(sun);
  const ship = buildShip({ kind, lengthMetres, tone: "suspect", isDetailed });
  addShipDetail(ship, null);
  scene.add(ship.group);
  if (isDetailed) {
    const wake = createKelvinWake(ship.form, kit, SCENE_COLORS.water);
    wake.setSpeed(TURNTABLE_SPEED_METRES_PER_SECOND);
    ship.group.add(wake.mesh);
  }
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(lengthMetres * 6, lengthMetres * 6),
    new THREE.MeshPhysicalMaterial({ color: SCENE_COLORS.water, transparent: true, opacity: 0.55, roughness: 0.16, depthWrite: false }),
  );
  water.rotation.x = -Math.PI / 2;
  water.receiveShadow = true;
  scene.add(water);
  const camera = new THREE.PerspectiveCamera(30, TURNTABLE_LAYOUT.cellWidthPx / TURNTABLE_LAYOUT.cellHeightPx, 0.5, lengthMetres * 10);
  const target = new THREE.Vector3(0, ship.form.depth * 0.25, 0);
  camera.position.copy(target).addScaledVector(VIEW_DIRECTION, lengthMetres * VIEW_DISTANCE_LENGTHS + 20);
  camera.lookAt(target);
  return { scene, camera };
}

/** The cell's caption, top left of its cell (index in SHIP_KINDS order, counted along rows from the top). */
export function addTurntableLabel(kind: ShipKind, index: number) {
  const label = document.createElement("p");
  label.textContent = `${kind}, ${TURNTABLE_LENGTHS[kind]} m`;
  const left = (index % TURNTABLE_LAYOUT.columns) * TURNTABLE_LAYOUT.cellWidthPx + 12;
  const top = Math.floor(index / TURNTABLE_LAYOUT.columns) * TURNTABLE_LAYOUT.cellHeightPx + 8;
  label.style.cssText = `position:absolute;margin:0;left:${left}px;top:${top}px;font:500 13px sans-serif;color:#62625D`;
  document.body.appendChild(label);
}
