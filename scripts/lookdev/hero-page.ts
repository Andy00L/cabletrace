// The hero shot on WebGL (hero-scene.ts), drawn once at 1,440 x 900 on the page tone. Bundled by hero.ts and opened
// from a file in headless Chromium; marks <body data-state="ready"> once the frame is drawn, as the turntable does.
import * as THREE from "three";
import { detectRendererKind } from "../../src/lib/diagnostics/webgl-renderer";
import { SCENE_EXPOSURE } from "../../src/lib/render/scene-renderer";
import { createWebGlKit } from "../../src/lib/render/webgl-scene-renderer";
import { buildHeroScene, HERO_FRAME } from "./hero-scene";

async function drawHero() {
  const isHardware = detectRendererKind() === "hardware";
  const renderer = new THREE.WebGLRenderer({ antialias: isHardware, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(HERO_FRAME.widthPx, HERO_FRAME.heightPx);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = SCENE_EXPOSURE;
  renderer.shadowMap.enabled = isHardware;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.dataset.renderer = isHardware ? "hardware" : "software";
  document.body.appendChild(renderer.domElement);
  const { scene, camera, ready } = buildHeroScene(createWebGlKit(renderer), isHardware);
  await ready;
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  document.body.dataset.state = "ready";
}

drawHero().catch((error: unknown) => {
  console.error(`[drawHero] ${error instanceof Error ? error.message : String(error)}`);
  document.body.dataset.state = "failed";
});
