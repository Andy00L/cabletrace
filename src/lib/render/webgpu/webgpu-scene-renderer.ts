/// <reference types="@webgpu/types" />
import type * as THREE from "three";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { SimplexNoise } from "three/addons/math/SimplexNoise.js";
import { denoise } from "three/addons/tsl/display/DenoiseNode.js";
import { context, convertToTexture, float, mix, mrt, normalView, pass, renderGroup, screenUV, texture, toneMapping, uniform, vec4 } from "three/tsl";
import { CanvasTarget, Color, DataTexture, DirectionalLight, NeutralToneMapping, PointLight, RepeatWrapping, NoToneMapping, PCFShadowMap, RenderPipeline, Scene, SpotLight, WebGPUBackend, WebGPURenderer, type LightShadow, type Material, type Node, type NodeBuilder } from "three/webgpu";
import { SCENE_EXPOSURE, type SceneRenderer } from "@/lib/render/scene-renderer";
import type { DrawingBudget } from "@/lib/render/webgl-scene-renderer";
import { encodeSrgb } from "@/lib/render/webgpu/srgb-nodes";
import { createWebGpuKit } from "@/lib/render/webgpu/webgpu-kit";
import type { Result } from "@/lib/result";
import { createSeededRandom } from "@/lib/seabed/math";

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
// denoised, is what the three.js GTAO notes recommend for most scenes. At three.js's default strength of 1 the contact
// shading under the close-up's cable and between the hatch covers barely read against the hardware tier; 2 grounds
// them while open seabed stays on its token.
const AO_SCALE = 2;
const AO_RESOLUTION_SCALE = 0.5;

// The denoiser's rotation noise: 64 x 64 texels of simplex noise, as three.js's DenoiseNode makes it, but from a fixed
// seed. three.js seeds it from Math.random, so two loads of the same frame differed by 1 to 3 pixels in the vessel
// views, and the lookdev harness needs every frame to be a pure function of the build.
const DENOISE_NOISE_SIZE = 64;
const DENOISE_NOISE_SEED = 20241225;

function createDenoiseNoise(): DataTexture {
  const simplex = new SimplexNoise({ random: createSeededRandom(DENOISE_NOISE_SEED) });
  const data = new Uint8Array(DENOISE_NOISE_SIZE * DENOISE_NOISE_SIZE * 4);
  const toByte = (noise: number) => (noise * 0.5 + 0.5) * 255;
  for (let row = 0; row < DENOISE_NOISE_SIZE; row += 1) {
    for (let column = 0; column < DENOISE_NOISE_SIZE; column += 1) {
      const offset = (row * DENOISE_NOISE_SIZE + column) * 4;
      data[offset] = toByte(simplex.noise(row, column));
      data[offset + 1] = toByte(simplex.noise(row + DENOISE_NOISE_SIZE, column));
      data[offset + 2] = toByte(simplex.noise(row, column + DENOISE_NOISE_SIZE));
      data[offset + 3] = toByte(simplex.noise(row + DENOISE_NOISE_SIZE, column + DENOISE_NOISE_SIZE));
    }
  }
  const noiseTexture = new DataTexture(data, DENOISE_NOISE_SIZE, DENOISE_NOISE_SIZE);
  noiseTexture.wrapS = RepeatWrapping;
  noiseTexture.wrapT = RepeatWrapping;
  noiseTexture.needsUpdate = true;
  return noiseTexture;
}

type ScenePipeline = {
  render: () => void;
  /**
   * A second picture of the scene (openSecondPicture), drawn after `render` in the same frame: a scene pass of its
   * own, sized to the current canvas target, with the stage pass's context, no AO, and the shadow maps `render` drew.
   */
  renderSecond: () => void;
  setAoRadius: (radius: number) => void;
  dispose: () => void;
};

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
  const denoiseNoise = createDenoiseNoise();
  const denoised = denoise(aoPass.getTextureNode(), prePassDepth, prePassNormal, camera);
  denoised.noiseNode = texture(denoiseNoise);
  const aoTexture = convertToTexture(denoised);
  // 1 on the stage, 0 in a second picture, which runs no AO passes of its own.
  const aoShare = uniform(1).setGroup(renderGroup);
  const scenePass = pass(scene, camera);
  scenePass.contextNode = createSceneContext(mix(float(1), aoTexture.sample(screenUV).r, aoShare));
  const pipeline = new RenderPipeline(renderer, scenePass);
  // The scene pass already holds encoded colours (createSceneContext).
  pipeline.outputColorTransform = false;
  // The second picture's scene pass keeps the stage pass's context node: a context of its own rebuilt every material
  // on each switch between the two (5 fps), and an MRT of its own changed the shader code, so every GPU pipeline
  // compiled again (stalls of seconds). It renders one render call deeper instead: three keys render contexts by
  // formats, MRT and call depth, so its render objects (and their uniform buffers) are its own, while the materials'
  // builds and the GPU pipelines are the stage's. Sharing the stage's render objects left the stage drawn with the
  // window's sizes (lookdev, 21 Oct 2026). Its AO sample reads the stage's AO of this frame at a share of 0. Built at
  // the first second picture.
  let secondPass: { scenePass: ReturnType<typeof pass>; pipeline: RenderPipeline; nesting: Scene } | null = null;
  // three runs these passes once per browser frame, keyed on each node's update reference, so a second draw in the
  // same frame (the anchor cam's, then the main view) reused the first one's pictures: the main view showed the anchor
  // cam (lookdev, 21 Oct 2026). Each draw hands them new references (onReference), so they run once per draw; once,
  // because the pre-pass draws materials that read the AO it feeds.
  const passNodes = [prePass, aoPass, denoised, aoTexture, scenePass];
  let drawReferences = passNodes.map(() => ({}));
  passNodes.forEach((passNode, index) => passNode.onReference(() => drawReferences[index]));
  // three redraws a light's shadow map in every render call that meets it (its once per camera and frame check reads a
  // frame id each render call moves on), so the second picture drew the whole scene's shadows again: each draw asks
  // for one update instead, and the second picture uses that map. The lights are the scene's shadow casters at its
  // first frame.
  const shadows: LightShadow[] = [];
  scene.traverse((object) => {
    if ((object instanceof DirectionalLight || object instanceof SpotLight || object instanceof PointLight) && object.castShadow) shadows.push(object.shadow);
  });
  shadows.forEach((shadow) => {
    shadow.autoUpdate = false;
  });
  return {
    render() {
      drawReferences = passNodes.map(() => ({}));
      shadows.forEach((shadow) => {
        shadow.needsUpdate = true;
      });
      pipeline.render();
    },
    renderSecond() {
      if (!secondPass) {
        const secondScenePass = pass(scene, camera);
        secondScenePass.contextNode = scenePass.contextNode;
        const secondPipeline = new RenderPipeline(renderer, secondScenePass);
        secondPipeline.outputColorTransform = false;
        // An empty scene whose render runs the pipeline from inside it: one call deeper, and it draws nothing itself.
        const nesting = new Scene();
        nesting.onBeforeRender = () => secondPipeline.render();
        secondPass = { scenePass: secondScenePass, pipeline: secondPipeline, nesting };
      }
      const autoClear = renderer.autoClear;
      // The outer, empty render must not clear what the pipeline drew; the passes inside clear their own targets.
      renderer.autoClear = false;
      aoShare.value = 0;
      renderer.render(secondPass.nesting, camera);
      aoShare.value = 1;
      renderer.autoClear = autoClear;
    },
    setAoRadius(radius) {
      aoPass.radius.value = radius;
    },
    dispose() {
      pipeline.dispose();
      secondPass?.pipeline.dispose();
      secondPass?.scenePass.dispose();
      aoPass.dispose();
      prePass.dispose();
      scenePass.dispose();
      denoiseNoise.dispose();
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

  /** Runs `drawPicture` with the scene's colour background swapped for its encoded value (a clear, which no material encodes). */
  function withEncodedBackground(scene: THREE.Scene, drawPicture: () => void) {
    const background = scene.background;
    if (background instanceof Color) scene.background = encodedBackground.copy(background).convertLinearToSRGB();
    drawPicture();
    scene.background = background;
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
        withEncodedBackground(scene, () => scenePipeline.render());
      },
      openSecondPicture(windowCanvas) {
        const windowTarget = new CanvasTarget(windowCanvas);
        return {
          ok: true,
          value: {
            // It reads the stage's AO and shadow maps of this frame (renderSecond).
            isDrawnAfterStage: true,
            draw(scene, camera, widthPx, heightPx) {
              const stageTarget = renderer.getCanvasTarget();
              // Current first, so a resize reaches the renderer and the window's buffers follow it.
              renderer.setCanvasTarget(windowTarget);
              if (windowTarget.getPixelRatio() !== renderer.getPixelRatio()) windowTarget.setPixelRatio(renderer.getPixelRatio());
              if (windowTarget.domElement.width !== Math.floor(widthPx * windowTarget.getPixelRatio()) || windowTarget.domElement.height !== Math.floor(heightPx * windowTarget.getPixelRatio())) windowTarget.setSize(widthPx, heightPx, false);
              const scenePipeline = readPipeline(scene, camera);
              withEncodedBackground(scene, () => scenePipeline.renderSecond());
              renderer.setCanvasTarget(stageTarget);
            },
            dispose: () => windowTarget.dispose(),
          },
        };
      },
      compile: async (objects, camera, scene) => {
        // WebGPU builds its pipelines asynchronously; compileAsync walks the objects at once (the renderer is ready).
        await renderer.compileAsync(objects, camera, scene);
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
