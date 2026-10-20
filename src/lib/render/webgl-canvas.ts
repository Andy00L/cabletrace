import { classifyRenderer, readRendererName } from "@/lib/diagnostics/webgl-renderer";

// The 3D replay's WebGL context, opened before three.js loads. A page's first WebGL context took 300 to 900 ms to open on
// this machine (the browser starts its GPU channel then), and the viewer used to open two: a throwaway one to read the
// renderer's name (antialiasing is fixed at creation), then its own. Opened once, early, while the seabed files
// download, the GPU tiers draw on it; the software tier, which draws without antialiasing, opens its own.

/**
 * The context attributes of the GPU tiers' renderer: three.js's WebGLRenderer defaults with antialiasing, a transparent
 * canvas and the high-performance GPU (src/lib/render/webgl-scene-renderer.ts creates the renderer on this context).
 */
export const GPU_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  depth: true,
  stencil: false,
  antialias: true,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: "high-performance",
  failIfMajorPerformanceCaveat: false,
};

/** A WebGL 2 context ready for the GPU tiers, or the news that WebGL runs on the CPU here (or not at all). */
export type OpenedWebGl = { kind: "hardware"; canvas: HTMLCanvasElement; context: WebGL2RenderingContext } | { kind: "software" } | { kind: "none" };

/** Opens the GPU tiers' context and reads which renderer it runs on. A CPU renderer's context is closed again. Browser only. */
export function openWebGl(): OpenedWebGl {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", GPU_CONTEXT_ATTRIBUTES);
  if (!context) return { kind: "none" };
  if (classifyRenderer(readRendererName(context)) === "hardware") return { kind: "hardware", canvas, context };
  context.getExtension("WEBGL_lose_context")?.loseContext();
  return { kind: "software" };
}

/** Closes a context nothing will draw on (the WebGPU tier took over). */
export function closeWebGl(opened: OpenedWebGl) {
  if (opened.kind === "hardware") opened.context.getExtension("WEBGL_lose_context")?.loseContext();
}
