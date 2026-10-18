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
  const isBench = new URLSearchParams(window.location.search).has("bench");
  const { scene, camera, ready, setWaveTime } = buildHeroScene(createWebGlKit(renderer), isHardware, isBench);
  await ready;
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  if (isBench) document.body.dataset.bench = JSON.stringify(await runFrameBench(renderer, scene, camera, setWaveTime));
  document.body.dataset.state = "ready";
}

// The frame-time bench: this many frames drawn one per animation frame with the sea moving, after a warm-up.
const BENCH_FRAMES = 300;
const BENCH_WARM_UP_FRAMES = 30;

/**
 * Draws the scene once per animation frame with the waves moving and measures, per frame, the interval between
 * animation frames (what a viewer sees) and the time to draw and finish it (one pixel read back waits for the GPU).
 */
async function runFrameBench(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, setWaveTime: (seconds: number) => void) {
  const intervals: number[] = [];
  const drawTimes: number[] = [];
  const pixel = new Uint8Array(4);
  const context = renderer.getContext();
  let lastAt = performance.now();
  for (let frame = 0; frame < BENCH_FRAMES + BENCH_WARM_UP_FRAMES; frame += 1) {
    const frameAt = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
    setWaveTime(frame / 60);
    const drawStart = performance.now();
    renderer.render(scene, camera);
    context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
    const drawEnd = performance.now();
    if (frame >= BENCH_WARM_UP_FRAMES) {
      intervals.push(frameAt - lastAt);
      drawTimes.push(drawEnd - drawStart);
    }
    lastAt = frameAt;
  }
  const readQuantile = (values: number[], share: number) => [...values].sort((first, second) => first - second)[Math.floor(share * (values.length - 1))] ?? 0;
  return {
    frames: intervals.length,
    intervalMedianMs: readQuantile(intervals, 0.5),
    intervalP95Ms: readQuantile(intervals, 0.95),
    drawMedianMs: readQuantile(drawTimes, 0.5),
    drawP95Ms: readQuantile(drawTimes, 0.95),
    fps: 1000 / readQuantile(intervals, 0.5),
    // Frames shown at the display's 60 Hz pace (an interval under 17.5 ms).
    onPaceShare: intervals.filter((interval) => interval < 17.5).length / Math.max(1, intervals.length),
  };
}

drawHero().catch((error: unknown) => {
  console.error(`[drawHero] ${error instanceof Error ? error.message : String(error)}`);
  document.body.dataset.state = "failed";
});
