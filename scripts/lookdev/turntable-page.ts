// The ship turntable: every ship kind the hull generator builds, at a typical length, side by side under the replay's
// light. Bundled by scripts/lookdev/turntable.ts and opened from a file in headless Chromium; the page marks
// <body data-state="ready"> once the frame is drawn. Ships that no case uses yet (fishing, tug, ro-ro, passenger,
// cable layer) are judged here before a case or the globe draws one.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { detectRendererKind } from "../../src/lib/diagnostics/webgl-renderer";
import type { ShipKind } from "../../src/lib/replay/replay-scene";
import { SCENE_COLORS } from "../../src/lib/seabed/scene/scene-colors";
import { buildShip } from "../../src/lib/ships/build-ship";
import { SHIP_KINDS } from "../../src/lib/ships/ship-specs";

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
const COLUMNS = 3;
const CELL_WIDTH_PX = 460;
const CELL_HEIGHT_PX = 240;
// Each ship is seen from its starboard bow quarter, a little above deck, at a distance set by its length.
const VIEW_DIRECTION = new THREE.Vector3(0.95, 0.42, 0.75).normalize();
const VIEW_DISTANCE_LENGTHS = 1.05;

function drawTurntable() {
  const isHardware = detectRendererKind() === "hardware";
  const rows = Math.ceil(SHIP_KINDS.length / COLUMNS);
  const renderer = new THREE.WebGLRenderer({ antialias: isHardware });
  renderer.setPixelRatio(1);
  renderer.setSize(CELL_WIDTH_PX * COLUMNS, CELL_HEIGHT_PX * rows);
  renderer.setClearColor("#F3F3F1");
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = isHardware;
  renderer.setScissorTest(true);
  renderer.domElement.dataset.renderer = isHardware ? "hardware" : "software";
  document.body.appendChild(renderer.domElement);

  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  const environment = environmentGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  SHIP_KINDS.forEach((kind, index) => {
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
    Object.assign(sun.shadow.camera, { left: -lengthMetres, right: lengthMetres, top: lengthMetres, bottom: -lengthMetres, near: 1, far: lengthMetres * 5 });
    scene.add(sun);
    const ship = buildShip({ kind, lengthMetres, tone: "suspect", isDetailed: isHardware });
    scene.add(ship.group);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(lengthMetres * 6, lengthMetres * 6),
      new THREE.MeshPhysicalMaterial({ color: SCENE_COLORS.water, transparent: true, opacity: 0.55, roughness: 0.16, depthWrite: false }),
    );
    water.rotation.x = -Math.PI / 2;
    water.receiveShadow = true;
    scene.add(water);
    const camera = new THREE.PerspectiveCamera(30, CELL_WIDTH_PX / CELL_HEIGHT_PX, 0.5, lengthMetres * 10);
    const target = new THREE.Vector3(0, ship.form.depth * 0.25, 0);
    camera.position.copy(target).addScaledVector(VIEW_DIRECTION, lengthMetres * VIEW_DISTANCE_LENGTHS + 20);
    camera.lookAt(target);
    const column = index % COLUMNS;
    const row = rows - 1 - Math.floor(index / COLUMNS);
    renderer.setViewport(column * CELL_WIDTH_PX, row * CELL_HEIGHT_PX, CELL_WIDTH_PX, CELL_HEIGHT_PX);
    renderer.setScissor(column * CELL_WIDTH_PX, row * CELL_HEIGHT_PX, CELL_WIDTH_PX, CELL_HEIGHT_PX);
    renderer.render(scene, camera);
    const label = document.createElement("p");
    label.textContent = `${kind}, ${lengthMetres} m`;
    label.style.cssText = `position:absolute;margin:0;left:${column * CELL_WIDTH_PX + 12}px;top:${Math.floor(index / COLUMNS) * CELL_HEIGHT_PX + 8}px;font:500 13px sans-serif;color:#62625D`;
    document.body.appendChild(label);
  });
  document.body.dataset.state = "ready";
}

try {
  drawTurntable();
} catch (error) {
  console.error(`[drawTurntable] ${error instanceof Error ? error.message : String(error)}`);
  document.body.dataset.state = "failed";
}
