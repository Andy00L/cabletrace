import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { RendererKind } from "@/lib/diagnostics/webgl-renderer";
import { createDataColorMaterial } from "@/lib/render/data-colors";
import { SCENE_EXPOSURE, type SceneMaterialKit, type SceneRenderer } from "@/lib/render/scene-renderer";
import type { Result } from "@/lib/result";
import { createCaustics } from "@/lib/seabed/scene/caustics";
import { createTerrainMaterial } from "@/lib/seabed/scene/terrain-material";
import { thinTubeWithDistance } from "@/lib/seabed/scene/tube-thinning";
import { createWaterSurfaceGlslMaterial } from "@/lib/seabed/scene/water-surface";
import { createKelvinWakeGlslMaterial } from "@/lib/ships/kelvin-wake";

// The WebGL tiers of the 3D replay: three.js's WebGLRenderer and the GLSL versions of the scene's custom materials.

/** What a tier may spend on each frame (viewer.ts, RENDER_TIERS). */
export type DrawingBudget = { antialias: boolean; shadows: boolean; maxPixelRatio: number };

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
  };
}

/**
 * The WebGL renderer for a tier: antialiasing, shadows and pixel ratio from its budget, Neutral tone mapping. Fails
 * as a value when the browser refuses a WebGL 2 context.
 */
export function createWebGlSceneRenderer(kind: RendererKind, budget: DrawingBudget): Result<SceneRenderer> {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: budget.antialias, alpha: true, powerPreference: "high-performance" });
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
      compile: async (scene, camera) => {
        await renderer.compileAsync(scene, camera);
      },
      dispose() {
        renderer.dispose();
        // Frees the GPU context now instead of at garbage collection.
        renderer.forceContextLoss();
      },
    },
  };
}
