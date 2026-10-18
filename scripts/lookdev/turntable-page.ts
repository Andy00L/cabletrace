// The ship turntable on WebGL: every ship kind the hull generator builds, at a typical length, side by side under the
// replay's light (turntable-scene.ts). Bundled by scripts/lookdev/turntable.ts and opened from a file in headless
// Chromium; the page marks <body data-state="ready"> once the frame is drawn. Ships that no case uses yet (fishing,
// tug, ro-ro, passenger, cable layer) are judged here before a case or the globe draws one.
import * as THREE from "three";
import { detectRendererKind } from "../../src/lib/diagnostics/webgl-renderer";
import { SCENE_EXPOSURE } from "../../src/lib/render/scene-renderer";
import { createWebGlKit } from "../../src/lib/render/webgl-scene-renderer";
import { SHIP_KINDS } from "../../src/lib/ships/ship-specs";
import { addTurntableLabel, buildTurntableCell, TURNTABLE_LAYOUT } from "./turntable-scene";

function drawTurntable() {
  const isHardware = detectRendererKind() === "hardware";
  const { columns, cellWidthPx, cellHeightPx } = TURNTABLE_LAYOUT;
  const rows = Math.ceil(SHIP_KINDS.length / columns);
  const renderer = new THREE.WebGLRenderer({ antialias: isHardware });
  renderer.setPixelRatio(1);
  renderer.setSize(cellWidthPx * columns, cellHeightPx * rows);
  renderer.setClearColor("#F3F3F1");
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = SCENE_EXPOSURE;
  renderer.shadowMap.enabled = isHardware;
  renderer.setScissorTest(true);
  renderer.domElement.dataset.renderer = isHardware ? "hardware" : "software";
  document.body.appendChild(renderer.domElement);

  const kit = createWebGlKit(renderer);
  const environment = kit.createEnvironment();
  SHIP_KINDS.forEach((kind, index) => {
    const { scene, camera } = buildTurntableCell(kind, kit, environment, isHardware);
    const column = index % columns;
    const row = rows - 1 - Math.floor(index / columns);
    renderer.setViewport(column * cellWidthPx, row * cellHeightPx, cellWidthPx, cellHeightPx);
    renderer.setScissor(column * cellWidthPx, row * cellHeightPx, cellWidthPx, cellHeightPx);
    renderer.render(scene, camera);
    addTurntableLabel(kind, index);
  });
  document.body.dataset.state = "ready";
}

try {
  drawTurntable();
} catch (error) {
  console.error(`[drawTurntable] ${error instanceof Error ? error.message : String(error)}`);
  document.body.dataset.state = "failed";
}
