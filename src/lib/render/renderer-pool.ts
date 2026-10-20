import type { RenderTierName, SceneRenderer } from "@/lib/render/scene-renderer";

// One renderer kept between 3D replays on the same page. Opening a case after another one (a client navigation) used
// to pay again for what the first one had already paid: the WebGPU adapter check, the WebGL context (300 to 900 ms on
// some machines, webgl-canvas.ts) and every shader program's link (50 to 300 ms each without
// KHR_parallel_shader_compile, webgl-scene-renderer.ts). A viewer that closes parks its renderer here with the
// materials it drew with, undisposed, so their programs stay linked; the next viewer takes it, compiles its own
// materials against those programs, then releases the old materials. Three-free (types only), so the replay's client
// component can ask what is parked before any three.js code loads.

/** A parked renderer and the call that frees the previous viewer's materials once the next viewer holds its programs. */
export type ParkedRenderer = { renderer: SceneRenderer; releaseHeldMaterials: () => void };

let parkedRenderer: ParkedRenderer | null = null;

/** The tier of the parked renderer, or null when none is parked: the next viewer draws on that tier. */
export function readParkedRendererTier(): RenderTierName | null {
  return parkedRenderer?.renderer.tier ?? null;
}

/** Parks `parked` for the next viewer. False when a renderer is parked already: the caller then frees its own. */
export function parkRenderer(parked: ParkedRenderer): boolean {
  if (parkedRenderer) return false;
  parkedRenderer = parked;
  return true;
}

/** Takes the parked renderer (null when none is): the slot is empty afterwards. */
export function claimParkedRenderer(): ParkedRenderer | null {
  const claimed = parkedRenderer;
  parkedRenderer = null;
  return claimed;
}
