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
import { yieldToPage } from "@/lib/render/yield-to-page";
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
    createFogSwitch: (scene, aboveWater, underwater) => ({
      setUnderwater(isUnderwater) {
        scene.fog = isUnderwater ? underwater : aboveWater;
      },
    }),
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
  // three draws the shadow maps in every render call: the stage's draw asks for them, and a second picture, drawn just
  // before the stage in the same frame, uses the last frame's (the anchor cam drew the whole scene's shadows again).
  renderer.shadowMap.autoUpdate = false;
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
      draw(scene, camera) {
        renderer.shadowMap.needsUpdate = true;
        renderer.render(scene, camera);
      },
      openSecondPicture(windowCanvas) {
        const windowContext = windowCanvas.getContext("2d");
        if (!windowContext) return { ok: false, reason: "the window's canvas gave no 2D context" };
        const stageSize = new THREE.Vector2();
        return {
          ok: true,
          value: {
            isDrawnAfterStage: false,
            draw(scene, camera, widthPx, heightPx) {
              // three's viewport counts CSS px from the bottom left: the picture lands in that corner, the main frame
              // clears it afterwards.
              renderer.getSize(stageSize);
              const cornerWidthPx = Math.min(widthPx, stageSize.x);
              const cornerHeightPx = Math.min(heightPx, stageSize.y);
              renderer.setViewport(0, 0, cornerWidthPx, cornerHeightPx);
              renderer.setScissor(0, 0, cornerWidthPx, cornerHeightPx);
              renderer.setScissorTest(true);
              renderer.render(scene, camera);
              renderer.setScissorTest(false);
              renderer.setViewport(0, 0, stageSize.x, stageSize.y);
              const pixelRatio = renderer.getPixelRatio();
              const pictureWidth = Math.max(1, Math.round(cornerWidthPx * pixelRatio));
              const pictureHeight = Math.max(1, Math.round(cornerHeightPx * pixelRatio));
              if (windowCanvas.width !== pictureWidth) windowCanvas.width = pictureWidth;
              if (windowCanvas.height !== pictureHeight) windowCanvas.height = pictureHeight;
              const stageCanvas = renderer.domElement;
              windowContext.drawImage(stageCanvas, 0, stageCanvas.height - pictureHeight, pictureWidth, pictureHeight, 0, 0, pictureWidth, pictureHeight);
            },
            dispose() {},
          },
        };
      },
      compile: (objects, camera, scene) => compileProgramByProgram(renderer, objects, camera, scene),
      dispose() {
        renderer.dispose();
        // Frees the GPU context now instead of at garbage collection.
        renderer.forceContextLoss();
      },
    },
  };
}
