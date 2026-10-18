// The ship turntable on the WebGPU tier: the same cells as the WebGL page (turntable-scene.ts), each drawn by the
// tier's own renderer (src/lib/render/webgpu/webgpu-scene-renderer.ts: GTAO, per-material tone mapping, the TSL Kelvin
// wake) into its own canvas, all on one device. Bundled by scripts/lookdev/turntable.ts and served by the WebGPU
// tier's proxy (webgpu-capture.ts); marks <body data-state> like the WebGL page.
import { requestWebGpuDevice } from "../../src/lib/diagnostics/webgpu-adapter";
import { createWebGpuSceneRenderer } from "../../src/lib/render/webgpu/webgpu-scene-renderer";
import { SHIP_KINDS } from "../../src/lib/ships/ship-specs";
import { addTurntableLabel, buildTurntableCell, TURNTABLE_LAYOUT } from "./turntable-scene";

// The WebGPU tier's drawing budget at the turntable's fixed pixel ratio (viewer.ts, RENDER_TIERS).
const BUDGET = { antialias: true, shadows: true, maxPixelRatio: 1 };

async function drawWebGpuTurntable() {
  const device = await requestWebGpuDevice();
  if (!device.ok) throw new Error(device.reason);
  const { columns, cellWidthPx, cellHeightPx } = TURNTABLE_LAYOUT;
  for (const [index, kind] of SHIP_KINDS.entries()) {
    const created = await createWebGpuSceneRenderer({ device: device.value.device, budget: BUDGET });
    if (!created.ok) throw new Error(created.reason);
    const renderer = created.value;
    renderer.canvas.dataset.renderer = renderer.tier;
    renderer.canvas.style.cssText = `position:absolute;left:${(index % columns) * cellWidthPx}px;top:${Math.floor(index / columns) * cellHeightPx}px`;
    document.body.appendChild(renderer.canvas);
    renderer.setSize(cellWidthPx, cellHeightPx);
    const { scene, camera } = buildTurntableCell(kind, renderer.kit, renderer.kit.createEnvironment(), true);
    renderer.draw(scene, camera);
    addTurntableLabel(kind, index);
  }
  // The body holds only absolutely placed canvases: give it the grid's height so a screenshot of it holds them all.
  document.body.style.height = `${Math.ceil(SHIP_KINDS.length / columns) * cellHeightPx}px`;
  document.body.dataset.state = "ready";
}

drawWebGpuTurntable().catch((error: unknown) => {
  console.error(`[drawWebGpuTurntable] ${error instanceof Error ? error.message : String(error)}`);
  document.body.dataset.state = "failed";
});
