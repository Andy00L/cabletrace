/// <reference types="@webgpu/types" />
import type * as THREE from "three";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { denoise } from "three/addons/tsl/display/DenoiseNode.js";
import { context, convertToTexture, mrt, normalView, pass, screenUV, toneMapping, vec4 } from "three/tsl";
import { Color, NeutralToneMapping, NoToneMapping, PCFShadowMap, RenderPipeline, WebGPUBackend, WebGPURenderer, type Material, type Node, type NodeBuilder } from "three/webgpu";
import { SCENE_EXPOSURE, type SceneRenderer } from "@/lib/render/scene-renderer";
import type { DrawingBudget } from "@/lib/render/webgl-scene-renderer";
import { encodeSrgb } from "@/lib/render/webgpu/srgb-nodes";
import { createWebGpuKit } from "@/lib/render/webgpu/webgpu-kit";
import type { Result } from "@/lib/result";

// The WebGPU tier of the 3D replay. It draws the same scene as the WebGL tiers through three.js's WebGPURenderer, on
// the device made from the adapter src/lib/diagnostics/webgpu-adapter.ts checked, and adds what the WebGL tiers cannot
// afford or express:
//   - ground-truth ambient occlusion (GTAO, Jimenez et al. 2016) from a depth and normal pre-pass, denoised, applied
//     to the ambient light of lit materials only: hulls sit on the water, the anchor, chain and rocks in the sand,
//     the seabed's hollows deepen. Unlit data lines and transparent water never take it.
//   - per-material tone mapping, as the WebGL tiers do it: WebGPURenderer tone maps the whole frame in one pass and
//     ignores `toneMapped: false`, which would shift the data colours, so the frame is drawn without tone mapping and
//     each material that asks for it is tone mapped in its own shader (the scene pass's getOutput hook).
//   - sRGB encoding in each material's shader too, as WebGL draws into its sRGB canvas: blending and the 4x MSAA
//     resolve then mix encoded values, as on the WebGL hardware tier. Mixed in linear light instead, a 1 to 2 px blue
//     cable over the light seabed came out thinner and broken, and the see-through water, wake and signal halo read
//     lighter than the approved look.
// Loaded only when that tier is chosen (viewer.ts, createSceneRenderer).

// GTAO radius as a share of the camera's height over the sea (scene units): one rule for the overview (km, the camera
// 40 to 300 km up), the vessel view (under 1 km up) and the close-up (2 m units, about 13 units up), so the occlusion
// keeps about the same reach on screen in each. Clamped so a camera skimming the water still gets a usable radius.
const AO_RADIUS_PER_HEIGHT = 0.06;
const AO_MIN_RADIUS = 0.02;
// Occlusion strength on the ambient light (GTAO's own scale) and the effect's resolution share: half resolution,
// denoised, is what the three.js GTAO notes recommend for most scenes.
const AO_SCALE = 1;
const AO_RESOLUTION_SCALE = 0.5;

type ScenePipeline = { pipeline: RenderPipeline; setAoRadius: (radius: number) => void; dispose: () => void };

type GetAoContext = { material: Material };

/**
 * The scene pass's context: GTAO on the ambient light of opaque lit materials (three.js's builtinAOContext rule),
 * Neutral tone mapping at the WebGL tiers' exposure for every material that has `toneMapped` set, then sRGB encoding
 * for every material (the pipeline's output pass leaves the colour as it is).
 */
function createSceneContext(aoValue: Node<"float">) {
  return context({
    getAO: (inputNode: Node<"float"> | null, { material }: GetAoContext) => {
      if (material.transparent) return inputNode;
      return inputNode !== null ? inputNode.mul(aoValue) : aoValue;
    },
    getOutput: (outputNode: Node<"vec4">, builder: NodeBuilder) => {
      // Given the whole colour, the tone mapping node maps rgb and keeps alpha; only its rgb is used here.
      const color = builder.material.toneMapped ? toneMapping(NeutralToneMapping, SCENE_EXPOSURE, outputNode).rgb : outputNode.rgb;
      return vec4(encodeSrgb(color), outputNode.a);
    },
  });
}

/** The pre-pass, GTAO and scene pass for one scene and its camera, built on its first frame. */
function buildScenePipeline(renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): ScenePipeline {
  // Opaque objects only: water and the data lines must not write normals over the seabed's.
  const prePass = pass(scene, camera, { samples: 0 });
  prePass.transparent = false;
  prePass.setMRT(mrt({ output: normalView }));
  const prePassNormal = prePass.getTextureNode();
  const prePassDepth = prePass.getTextureNode("depth");
  const aoPass = ao(prePassDepth, prePassNormal, camera);
  aoPass.resolutionScale = AO_RESOLUTION_SCALE;
  aoPass.scale.value = AO_SCALE;
  const aoTexture = convertToTexture(denoise(aoPass.getTextureNode(), prePassDepth, prePassNormal, camera));
  const scenePass = pass(scene, camera);
  scenePass.contextNode = createSceneContext(aoTexture.sample(screenUV).r);
  const pipeline = new RenderPipeline(renderer, scenePass);
  // The scene pass already holds encoded colours (createSceneContext).
  pipeline.outputColorTransform = false;
  return {
    pipeline,
    setAoRadius(radius) {
      aoPass.radius.value = radius;
    },
    dispose() {
      pipeline.dispose();
      aoPass.dispose();
      prePass.dispose();
      scenePass.dispose();
    },
  };
}

/**
 * Starts the WebGPU renderer on `device`. Fails as a value when it does not start or lands on anything but a WebGPU
 * backend (WebGPURenderer would otherwise fall back to WebGL 2 silently).
 */
export async function createWebGpuSceneRenderer(options: { device: GPUDevice; budget: DrawingBudget }): Promise<Result<SceneRenderer>> {
  const { device, budget } = options;
  const renderer = new WebGPURenderer({ device, antialias: budget.antialias, alpha: true });
  try {
    await renderer.init();
  } catch (error) {
    renderer.dispose();
    return { ok: false, reason: `WebGPURenderer did not start: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!(renderer.backend instanceof WebGPUBackend)) {
    renderer.dispose();
    return { ok: false, reason: "WebGPURenderer fell back to its WebGL 2 backend" };
  }
  device.lost
    .then((lost) => console.error(`[createWebGpuSceneRenderer] the GPU device was lost (${lost.reason}): ${lost.message}`))
    .catch(() => undefined);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, budget.maxPixelRatio));
  renderer.setClearColor(0x000000, 0);
  // Tone mapping happens per material in the scene pass (createSceneContext); the output pass only encodes sRGB.
  renderer.toneMapping = NoToneMapping;
  renderer.shadowMap.enabled = budget.shadows;
  renderer.shadowMap.type = PCFShadowMap;
  const pipelines = new Map<THREE.Scene, ScenePipeline>();
  const encodedBackground = new Color();

  function readPipeline(scene: THREE.Scene, camera: THREE.PerspectiveCamera): ScenePipeline {
    const existing = pipelines.get(scene);
    if (existing) return existing;
    const built = buildScenePipeline(renderer, scene, camera);
    pipelines.set(scene, built);
    return built;
  }

  return {
    ok: true,
    value: {
      tier: "webgpu",
      canvas: renderer.domElement,
      kit: createWebGpuKit(renderer),
      maxAnisotropy: renderer.getMaxAnisotropy(),
      readPixelRatio: () => renderer.getPixelRatio(),
      setSize: (widthPx, heightPx) => renderer.setSize(widthPx, heightPx),
      draw(scene, camera) {
        const scenePipeline = readPipeline(scene, camera);
        scenePipeline.setAoRadius(Math.max(AO_MIN_RADIUS, Math.abs(camera.position.y) * AO_RADIUS_PER_HEIGHT));
        // A colour background is a clear, which no material encodes: it is cleared with its encoded value instead.
        const background = scene.background;
        if (background instanceof Color) scene.background = encodedBackground.copy(background).convertLinearToSRGB();
        scenePipeline.pipeline.render();
        scene.background = background;
      },
      compile: async (scene, camera) => {
        await renderer.compileAsync(scene, camera);
      },
      dispose() {
        pipelines.forEach((scenePipeline) => scenePipeline.dispose());
        pipelines.clear();
        renderer.dispose();
        device.destroy();
      },
    },
  };
}
