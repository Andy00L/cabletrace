import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { RendererKind } from "@/lib/diagnostics/webgl-renderer";
import { createDataColorMaterial } from "@/lib/render/data-colors";
import { SCENE_EXPOSURE, type SceneMaterialKit, type SceneRenderer, type SoftPoints, type SoftPointsOptions } from "@/lib/render/scene-renderer";
import type { Result } from "@/lib/result";
import { createCaustics } from "@/lib/seabed/scene/caustics";
import { createTerrainMaterial } from "@/lib/seabed/scene/terrain-material";
import { thinTubeWithDistance } from "@/lib/seabed/scene/tube-thinning";
import { createWaterSurfaceGlslMaterial } from "@/lib/seabed/scene/water-surface";
import { createKelvinWakeGlslMaterial } from "@/lib/ships/kelvin-wake";

// The WebGL tiers of the 3D replay: three.js's WebGLRenderer and the GLSL versions of the scene's custom materials.

/** What a tier may spend on each frame (viewer.ts, RENDER_TIERS). */
export type DrawingBudget = { antialias: boolean; shadows: boolean; maxPixelRatio: number };

/** Soft particles as WebGL points: one vertex each, sized in world units and smaller with distance. */
function createSoftPointCloud(count: number, { map, color, size, opacity }: SoftPointsOptions): SoftPoints {
  const positions = new Float32Array(count * 3);
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", positionAttribute);
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ map, color, size, transparent: true, opacity, depthWrite: false, sizeAttenuation: true }));
  // The particles move every frame; their bounds would have to follow.
  points.frustumCulled = false;
  return {
    object: points,
    positions,
    markMoved() {
      positionAttribute.needsUpdate = true;
    },
  };
}

/** Lets the page run (input, a frame) before the next piece of work. */
function yieldToPage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Compiles every material under `objects` with `scene`'s lights, then gives each program its first use in a task of
 * its own. Without KHR_parallel_shader_compile (Mesa's d3d12 driver here, every headless test browser) a program's
 * first use waits for the GPU process to link it, 50 to 300 ms each on this machine; done in one go, the first draw of
 * a full scene stalled the page for 4 to 5 s. Done one per task, the page answers input between them. A program
 * already used costs nothing here.
 */
async function compileProgramByProgram(renderer: THREE.WebGLRenderer, objects: THREE.Object3D, camera: THREE.PerspectiveCamera, scene: THREE.Scene): Promise<void> {
  renderer.compile(objects, camera, scene);
  for (const program of renderer.info.programs ?? []) {
    await yieldToPage();
    program.getUniforms();
  }
}

/** The scene's custom materials as GLSL patches on three.js's built-in materials. */
export function createWebGlKit(renderer: THREE.WebGLRenderer): SceneMaterialKit {
  return {
    createEnvironment() {
      const environmentGenerator = new THREE.PMREMGenerator(renderer);
      const environment = environmentGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
      environmentGenerator.dispose();
      return environment;
    },
    createTerrainMaterial,
    createWaterSurfaceMaterial: createWaterSurfaceGlslMaterial,
    createThinnedDataTubeMaterial: ({ hex, radiusKm, fullWidthDistanceKm, opacity, depthWrite }) =>
      thinTubeWithDistance(createDataColorMaterial(hex, { opacity, depthWrite }), radiusKm, fullWidthDistanceKm),
    createScreenLine: (geometry, { color, widthPx, hasVertexColors, opacity }) =>
      new Line2(geometry, new LineMaterial({ color, linewidth: widthPx, vertexColors: hasVertexColors, opacity, worldUnits: false })),
    createKelvinWakeMaterial: createKelvinWakeGlslMaterial,
    createCaustics,
    createSoftPoints: createSoftPointCloud,
  };
}

/**
 * The WebGL renderer for a tier: antialiasing, shadows and pixel ratio from its budget, Neutral tone mapping. It draws
 * on `opened` when given (a context opened with GPU_CONTEXT_ATTRIBUTES, webgl-canvas.ts), else opens its own. Fails as
 * a value when the browser refuses a WebGL 2 context.
 */
export function createWebGlSceneRenderer(kind: RendererKind, budget: DrawingBudget, opened: { canvas: HTMLCanvasElement; context: WebGL2RenderingContext } | null): Result<SceneRenderer> {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: budget.antialias, alpha: true, powerPreference: "high-performance", canvas: opened?.canvas, context: opened?.context });
  } catch (error) {
    return { ok: false, reason: `WebGL 2 is not available: ${error instanceof Error ? error.message : String(error)}` };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, budget.maxPixelRatio));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = SCENE_EXPOSURE;
  renderer.shadowMap.enabled = budget.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // The software tier draws at a lower pixel ratio and the browser scales the canvas up. Scaled smoothly, a 2 px data
  // line would blend into the seabed and lose its exact colour; scaled by nearest pixel it keeps it (and the tier has
  // no antialiasing to lose).
  if (kind === "software") renderer.domElement.style.imageRendering = "pixelated";
  return {
    ok: true,
    value: {
      tier: kind,
      canvas: renderer.domElement,
      kit: createWebGlKit(renderer),
      maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
      readPixelRatio: () => renderer.getPixelRatio(),
      setSize: (widthPx, heightPx) => renderer.setSize(widthPx, heightPx),
      draw: (scene, camera) => renderer.render(scene, camera),
      compile: (objects, camera, scene) => compileProgramByProgram(renderer, objects, camera, scene),
      dispose() {
        renderer.dispose();
        // Frees the GPU context now instead of at garbage collection.
        renderer.forceContextLoss();
      },
    },
  };
}
