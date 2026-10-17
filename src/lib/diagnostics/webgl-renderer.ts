export type RendererKind = "hardware" | "software";

// Renderer names that mean WebGL runs on the CPU, not a GPU (Chrome's SwiftShader, Mesa's llvmpipe and softpipe).
const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|softpipe|software/i;

/** Tells a GPU renderer from a CPU fallback using the WebGL renderer string. */
export function classifyRenderer(rendererName: string): RendererKind {
  return SOFTWARE_RENDERER_PATTERN.test(rendererName) ? "software" : "hardware";
}

/**
 * Reads the name of the GPU (or CPU fallback) behind a WebGL context.
 * Browsers that hide it behind WEBGL_debug_renderer_info still answer the generic RENDERER string.
 */
export function readRendererName(context: WebGLRenderingContext | WebGL2RenderingContext): string {
  const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
  const unmaskedName: unknown = debugInfo ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null;
  if (typeof unmaskedName === "string" && unmaskedName !== "") return unmaskedName;
  const genericName: unknown = context.getParameter(context.RENDERER);
  return typeof genericName === "string" && genericName !== "" ? genericName : "unknown";
}

/**
 * Asks a throwaway WebGL 2 context which renderer the browser runs on, for a 3D view to pick its drawing budget
 * before it creates its own context (antialiasing is fixed at creation). Browser only.
 */
export function detectRendererKind(): RendererKind {
  const probeCanvas = document.createElement("canvas");
  const context = probeCanvas.getContext("webgl2");
  if (!context) return "hardware";
  const kind = classifyRenderer(readRendererName(context));
  context.getExtension("WEBGL_lose_context")?.loseContext();
  return kind;
}
