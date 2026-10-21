import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type { RendererKind } from "@/lib/diagnostics/webgl-renderer";
import { closeWebGl, openWebGl, type OpenedWebGl } from "@/lib/render/webgl-canvas";
import { requestWebGpuDevice, type WebGpuDevice } from "@/lib/diagnostics/webgpu-adapter";
import { claimParkedRenderer, parkRenderer, type ParkedRenderer } from "@/lib/render/renderer-pool";
import type { RenderTierName, SceneRenderer } from "@/lib/render/scene-renderer";
import { createWebGlSceneRenderer, type DrawingBudget } from "@/lib/render/webgl-scene-renderer";
import type { ReplaySceneInput } from "@/lib/replay/replay-scene";
import type { Result } from "@/lib/result";
import { clampValue, easeOutCubic } from "@/lib/seabed/math";
import { hideOverlappingLabels, type LabelRoom } from "@/lib/seabed/scene/labels";
import { buildCloseUp, type CloseUpScene } from "@/lib/seabed/scene/close-up";
import { findNearestCable, findNearestPass, sampleTrack, type CableRun, type TrackSample } from "@/lib/seabed/scene/director/hover-readout";
import type { CameraPose, DirectorSubjects, DirectorViewerPort, SecondView, ViewerFrame } from "@/lib/seabed/scene/director/viewer-port";
import { buildOverview, OVERVIEW_FOV_DEGREES, type OverviewViewName, type SceneSubject, type SceneTarget } from "@/lib/seabed/scene/overview";
import { chooseScenePalette } from "@/lib/seabed/scene/scene-look";
import { createSoftDotTexture } from "@/lib/seabed/scene/textures";
import { SKY_HDRI_URL } from "@/lib/seabed/scene/water-surface";
import type { SeabedScene } from "@/lib/seabed/scene/seabed-scene";
import { createElevationSampler, createProjection } from "@/lib/seabed/terrain";

// Camera moves inside the overview, and the crossfade between overview and close-up (docs/UI_DESIGN_SYSTEM.md, Motion).
const INTRO_MOVE_MS = 1800;
const VIEW_MOVE_MS = 900;
const CROSSFADE_OUT_MS = 190;
// The overview keeps the horizontal reach it has in a 16:10 frame: a narrower frame (a phone held upright) widens
// the vertical field of view instead of cropping the track, up to this limit.
const REFERENCE_ASPECT = 1.6;
const MAX_OVERVIEW_FOV_DEGREES = 60;
// Below this view width (CSS px, a phone) land and pipeline names are hidden so the case labels stay readable.
const COMPACT_LABEL_WIDTH_PX = 640;
const RADIANS_PER_DEGREE = Math.PI / 180;
// The follow camera sits off the vessel's starboard quarter, close enough to read the deck, and eases toward it.
// Offsets are in drawn ship lengths (tuned on Eagle S, 228.6 m drawn 1.37 km long), so every hull fills the frame alike.
const FOLLOW_BEHIND_LENGTHS = 1.06;
const FOLLOW_SIDE_LENGTHS = 1.13;
const FOLLOW_ABOVE_LENGTHS = 0.45;
// It aims a little ahead of and above the hull's origin (the waterline amidships).
const FOLLOW_AIM_AHEAD_LENGTHS = 0.22;
const FOLLOW_AIM_ABOVE_LENGTHS = 0.036;
// While the anchor drags (the water drawn 20 times deeper puts it 1 to 2 km under the hull), the follow camera stands
// this many times farther off, this many ship lengths higher, and aims this share of the way to the anchor.
const FOLLOW_DRAG_FRAMING = { reach: 1.9, riseLengths: 0.2, aimShare: 0.44 } as const;
const FOLLOW_EASE_PER_SECOND = 3.5;
// The follow camera counts as arrived within this distance (km), and stops asking for frames.
const FOLLOW_SETTLED_KM = 0.002;
// A press that ends within this distance (CSS px) and time of where it started is a click; anything longer orbits.
const CLICK_SLOP_PX = 6;
const CLICK_MAX_MS = 500;
// How far from a target's point a click still selects it (CSS px): a finger covers more than a mouse pointer.
const MOUSE_PICK_RADIUS_PX = 20;
const TOUCH_PICK_RADIUS_PX = 32;
// Poly Haven's aerial_beach_01 normal map (CC0), reduced to 512 px.
const RIPPLE_NORMAL_MAP_URL = "/textures/sand-ripples-normal.jpg";
// Lookdev colour probes skip data tubes drawn narrower than this many device pixels: below two, every pixel of the
// tube is an antialiased edge and none can hold the exact colour.
const MIN_PROBED_WIDTH_DEVICE_PX = 2;
// A close-up subject counts as hidden when the seabed is hit this much (units) before reaching it.
const CLOSE_UP_HIDDEN_MARGIN = 0.3;
// The anchor cam's picture is a second pass over the whole canvas, so it is drawn less often than the main view (ms of
// wall time between its frames): at most 8 times a second on a GPU (measured on the hardware tier here, 1,440 x 900:
// every frame took the replay from 23 to 15.5 frames a second), and as a still refreshed every 10 s on a CPU renderer,
// where a frame already takes 0.3 to 0.5 s.
const SECOND_VIEW_INTERVAL_MS: Record<"gpu" | "cpu", number> = { gpu: 125, cpu: 10_000 };
// Labels keep this far inside the stage's edges (CSS px), so a name is never cut by the stage's rounded frame.
const LABEL_EDGE_ROOM_PX = 8;

/**
 * Lookdev camera override (explore/natural-look storyboard): a page agent writes `data-camera-override` on the canvas
 * as JSON `{ "position": [x, y, z], "target": [x, y, z], "fovDegrees": n }` in the drawn scene's units (the overview's
 * km, or the close-up's units on the At the cut view). The camera then holds that pose, without the right panel's
 * view offset, until the attribute is removed.
 */
type CameraOverride = { position: THREE.Vector3; target: THREE.Vector3; fovDegrees: number };

function readVector(value: unknown): THREE.Vector3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [pointX, pointY, pointZ]: unknown[] = value;
  return typeof pointX === "number" && typeof pointY === "number" && typeof pointZ === "number" ? new THREE.Vector3(pointX, pointY, pointZ) : null;
}

/** Parses the override attribute; null when absent or malformed. */
function parseCameraOverride(text: string | undefined): CameraOverride | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.warn("[parseCameraOverride] data-camera-override is not JSON");
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const position = readVector(Reflect.get(parsed, "position"));
  const target = readVector(Reflect.get(parsed, "target"));
  const fovDegrees: unknown = Reflect.get(parsed, "fovDegrees");
  return position && target && typeof fovDegrees === "number" ? { position, target, fovDegrees } : null;
}

/**
 * Lookdev time override: a page agent writes `data-time-override` on the canvas as a replay moment in ms since the
 * epoch, and the scene draws that moment instead of the replay clock's until the attribute is removed. Frames between
 * the URL's whole minutes (the cut sequence at 10 s steps) are drawn this way.
 */
function parseTimeOverride(text: string | undefined): number | null {
  if (!text) return null;
  const atMs = Number(text);
  return Number.isFinite(atMs) ? atMs : null;
}

/** Puts a camera on an override pose (and its orbit target with it). */
function applyCameraOverride(override: CameraOverride, camera: THREE.PerspectiveCamera, orbitTarget: THREE.Vector3) {
  camera.position.copy(override.position);
  orbitTarget.copy(override.target);
  camera.fov = override.fovDegrees;
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
  camera.lookAt(override.target);
  camera.updateMatrixWorld();
}

/**
 * Drawing budget per tier. On a CPU renderer (SwiftShader, llvmpipe: headless test browsers and machines
 * without a usable GPU) an overview frame drawn as for a GPU took 0.9 to 1.6 s and froze the page; without
 * antialiasing and shadows, at half the terrain grid and a low pixel ratio it takes about 0.12 s
 * (docs/PERFORMANCE.md, "For the lead: 3D replay"). The WebGPU tier draws as the GPU tier and adds its own
 * post-processing (src/lib/render/webgpu/webgpu-scene-renderer.ts).
 */
const RENDER_TIERS: Record<RenderTierName, DrawingBudget> = {
  webgpu: { antialias: true, shadows: true, maxPixelRatio: 2 },
  hardware: { antialias: true, shadows: true, maxPixelRatio: 2 },
  software: { antialias: false, shadows: false, maxPixelRatio: 0.75 },
};
// A phone on its GPU (src/lib/render/compact-screen.ts): no shadows, and at most 1.5 device pixels per CSS pixel on a
// screen of 3, which draws a quarter of the pixels.
const COMPACT_BUDGET: DrawingBudget = { antialias: true, shadows: false, maxPixelRatio: 1.5 };

export type SeabedViewName = OverviewViewName | "vessel" | "closeup";

/**
 * Where a target is on screen, for a card that follows it. `not-drawn`: the picture holds no such object now (the
 * close-up, or the vessel before its first position), so the card keeps a place of its own. `off-view`: drawn, but
 * behind the camera or outside the part of the view the rail leaves clear. `on-view`: its point in client px, and
 * the box of the label naming it (null when the label is hidden), so a card can open clear of both.
 */
export type SceneProjection = { kind: "not-drawn" } | { kind: "off-view" } | { kind: "on-view"; clientX: number; clientY: number; labelRect: DOMRect | null };

export type SeabedViewer = {
  setView: (view: SeabedViewName) => void;
  setIllustrated: (isIllustrated: boolean) => void;
  /** Moves the camera back to the current view's preset, undoing any orbit or zoom. */
  resetView: () => void;
  /**
   * Width in CSS px of a panel floating over the view's right edge. The picture shifts left by half of it, so the
   * subject sits in the middle of the part still visible; 0 centres it on the whole view again.
   */
  setRightInset: (insetPx: number) => void;
  /** Read every frame by a card anchored to a target; reflects the last drawn frame. */
  projectTarget: (target: SceneTarget) => SceneProjection;
  /** Slides the overview camera sideways until the target sits in the middle of the clear part, keeping angle and zoom. */
  centerOnTarget: (target: SceneTarget) => void;
  /** The camera director's hold on the cameras, the anchor cam and the hover readout (src/lib/seabed/scene/director). */
  director: DirectorViewerPort;
  dispose: () => void;
};

type ViewerOptions = {
  container: HTMLElement;
  /**
   * The area to draw, its terrain built at the grid step of the renderer `openedWebGl` names (seabed-scene.ts,
   * TERRAIN_STEPS: half the grid on a CPU renderer, which is how its frame stays near 0.12 s).
   */
  scene: SeabedScene;
  input: ReplaySceneInput;
  /** Read once per frame: the replay moment to draw. */
  readTimeMs: () => number;
  prefersReducedMotion: boolean;
  /** Called when a click or tap lands on the vessel or a cut marker (or on its label) in the overview. */
  onTargetPick: (target: SceneTarget) => void;
  /**
   * The WebGPU adapter check, started by the caller as early as it can (it takes hundreds of ms in a browser that
   * offers WebGPU), so it runs while the seabed files download. The viewer starts it when not given.
   */
  webGpuDevice?: Promise<Result<WebGpuDevice>>;
  /** The WebGL context the caller opened early (webgl-canvas.ts, openWebGl); opened here otherwise. */
  openedWebGl?: OpenedWebGl;
  /** A phone's screen (compact-screen.ts): the GPU tier draws with COMPACT_BUDGET, plain hulls and no sand ripples. */
  isCompact?: boolean;
};

type CameraMove = {
  fromPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPosition: THREE.Vector3;
  toTarget: THREE.Vector3;
  startedAt: number;
  durationMs: number;
};

/**
 * Frees a tree's geometries, textures and materials. With `heldMaterials`, the materials go there instead of being
 * freed: a parked renderer keeps them, so their shader programs stay linked for the next viewer (renderer-pool.ts).
 */
function disposeObjectTree(root: THREE.Object3D, heldMaterials: THREE.Material[] | null = null) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.Line || child instanceof THREE.Sprite)) return;
    child.geometry.dispose();
    const materials: THREE.Material[] = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose();
      if (heldMaterials) heldMaterials.push(material);
      else material.dispose();
    });
  });
}

/**
 * The renderer for this browser: the WebGPU tier when the browser offers a real GPU adapter (its code loads only
 * then), else WebGL on the GPU or on the CPU, as before. A WebGPU tier that fails to start falls back to WebGL, so the
 * canvas never reports `webgpu` for anything but a WebGPU backend.
 */
async function createSceneRenderer(webGpuDeviceRequest: Promise<Result<WebGpuDevice>>, kind: RendererKind, budget: DrawingBudget, openedWebGl: OpenedWebGl, parked: ParkedRenderer | null): Promise<Result<SceneRenderer>> {
  const webGpuDevice = await webGpuDeviceRequest;
  if (parked) {
    // The previous replay's renderer, its context open and its programs linked: nothing new to start.
    if (webGpuDevice.ok) webGpuDevice.value.device.destroy();
    closeWebGl(openedWebGl);
    return { ok: true, value: parked.renderer };
  }
  if (webGpuDevice.ok) {
    try {
      const webGpuModule = await import("@/lib/render/webgpu/webgpu-scene-renderer");
      const created = await webGpuModule.createWebGpuSceneRenderer({ device: webGpuDevice.value.device, budget: RENDER_TIERS.webgpu });
      if (created.ok) {
        closeWebGl(openedWebGl);
        return created;
      }
      console.warn(`[createSceneRenderer] the WebGPU tier did not start on ${webGpuDevice.value.adapterName}, drawing with WebGL: ${created.reason}`);
    } catch (error) {
      console.warn(`[createSceneRenderer] the WebGPU tier did not load, drawing with WebGL: ${error instanceof Error ? error.message : String(error)}`);
    }
    webGpuDevice.value.device.destroy();
  } else {
    // Not a fault (most browsers have no WebGPU adapter), but the reason tells a slow adapter from a missing one.
    console.info(`[createSceneRenderer] drawing with WebGL: ${webGpuDevice.reason}`);
  }
  return createWebGlSceneRenderer(kind, budget, openedWebGl.kind === "hardware" ? openedWebGl : null);
}

function createLabelLayer(container: HTMLElement): CSS2DRenderer {
  const labels = new CSS2DRenderer();
  labels.domElement.style.position = "absolute";
  labels.domElement.style.inset = "0";
  labels.domElement.style.pointerEvents = "none";
  // The renderer gives each label a z-index by depth; isolated, those stay inside the layer, under the stage's controls.
  labels.domElement.style.isolation = "isolate";
  container.appendChild(labels.domElement);
  return labels;
}

/** Vertical field of view (degrees) that gives a frame of `aspect` the reference frame's horizontal reach. */
function fitOverviewFov(aspect: number): number {
  const referenceHalfWidth = Math.tan((OVERVIEW_FOV_DEGREES / 2) * RADIANS_PER_DEGREE) * REFERENCE_ASPECT;
  const fittedFov = (2 * Math.atan(referenceHalfWidth / aspect)) / RADIANS_PER_DEGREE;
  return clampValue(fittedFov, OVERVIEW_FOV_DEGREES, MAX_OVERVIEW_FOV_DEGREES);
}

/** Starts loading a texture now (it needs no renderer); `onSettled` runs once it has loaded or failed. */
function startTextureLoad(url: string, onSettled: () => void): THREE.Texture {
  return new THREE.TextureLoader().load(url, onSettled, undefined, () => {
    console.error(`[startTextureLoad] ${url} did not load`);
    onSettled();
  });
}

/**
 * Builds the overview inside `container` (the close-up on first use) and draws. Ambient motion (the running
 * signal, caustics, drifting silt) is off for reduced motion and on CPU renderers; the scene is then "calm" and
 * a frame is drawn only when the replay moment, the camera, the view or the size changes.
 *
 * The load is ordered for a fast first frame (docs/PERFORMANCE.md, Case load): the textures start downloading, the
 * terrain's arrays are built in a worker and the renderer tier is chosen, all at once; the first frame draws the block,
 * its data lines and the labels; then the vessel, its wakes, the anchor rig and the water compile in the background
 * and appear (completeScene). Never throws.
 */
export async function createSeabedViewer(options: ViewerOptions): Promise<Result<SeabedViewer>> {
  const { container, scene: seabedScene, input, readTimeMs, prefersReducedMotion, onTargetPick } = options;
  // The previous replay's renderer when one is parked (renderer-pool.ts); else software or GPU is known from the WebGL
  // context at once, and WebGPU (a GPU tier too) after its adapter check.
  const parked = claimParkedRenderer();
  const openedWebGl: OpenedWebGl = parked ? { kind: "none" } : (options.openedWebGl ?? openWebGl());
  const rendererKind: RendererKind = (parked ? parked.renderer.tier === "software" : openedWebGl.kind === "software") ? "software" : "hardware";
  const isGpuTier = rendererKind !== "software";
  const isCompact = isGpuTier && options.isCompact === true;
  // The full GPU look: detailed hulls and wakes, sand ripples (a phone gets the plain ones, compact-screen.ts).
  const isHighDetail = isGpuTier && !isCompact;
  const isCalm = prefersReducedMotion || !isGpuTier;
  // Set whenever the picture must be redrawn even though the replay moment did not change. Declared first: a texture
  // can finish loading while the renderer is still being chosen.
  let isDirty = true;
  function markDirty() {
    isDirty = true;
  }
  // The canvas says how many assets are still on their way (textures, the refinement), so a screenshot tool can wait.
  let pendingAssetCount = 0;
  let assetCanvas: HTMLCanvasElement | null = null;
  function changePendingAssets(delta: number) {
    pendingAssetCount += delta;
    if (assetCanvas) assetCanvas.dataset.pendingAssets = String(pendingAssetCount);
  }
  function settleAsset() {
    changePendingAssets(-1);
    markDirty();
  }
  // The sand-ripple detail (Poly Haven, CC0, docs/LOOKDEV.md) and the sky HDRI (CC0, public/textures/CREDITS.md) for
  // the water's reflection and the ships' light: GPU tiers only, requested before anything else is built.
  const rippleNormalMap = isHighDetail ? startTextureLoad(RIPPLE_NORMAL_MAP_URL, settleAsset) : null;
  let markSkyLoaded = () => {};
  const skyLoaded = new Promise<void>((resolve) => {
    markSkyLoaded = resolve;
  });
  const skyMap = isGpuTier
    ? startTextureLoad(SKY_HDRI_URL, () => {
        settleAsset();
        markSkyLoaded();
      })
    : null;
  if (rippleNormalMap) {
    changePendingAssets(1);
    rippleNormalMap.wrapS = THREE.RepeatWrapping;
    rippleNormalMap.wrapT = THREE.RepeatWrapping;
  }
  if (skyMap) {
    changePendingAssets(1);
    skyMap.mapping = THREE.EquirectangularReflectionMapping;
    // Stored with linear values (it is light, not a picture).
    skyMap.colorSpace = THREE.LinearSRGBColorSpace;
  }
  // Natural look C with the nearest sampled region's values (scene-look.ts); the terrain was built in it already.
  const { features, terrain: terrainGrid } = seabedScene;
  const palette = chooseScenePalette(features.region);
  const projection = createProjection(features.region);
  const webGpuDeviceRequest: Promise<Result<WebGpuDevice>> = parked ? Promise.resolve({ ok: false, reason: "a renderer is parked" }) : (options.webGpuDevice ?? requestWebGpuDevice());
  const createdRenderer = await createSceneRenderer(webGpuDeviceRequest, rendererKind, isCompact ? COMPACT_BUDGET : RENDER_TIERS[rendererKind], openedWebGl, parked);
  performance.mark("seabed:renderer");
  if (!createdRenderer.ok) return createdRenderer;
  const renderer = createdRenderer.value;
  const canvas = renderer.canvas;
  assetCanvas = canvas;
  canvas.dataset.pendingAssets = String(pendingAssetCount);
  if (rippleNormalMap) rippleNormalMap.anisotropy = renderer.maxAnisotropy;
  canvas.style.display = "block";
  canvas.style.outline = "none";
  canvas.dataset.renderer = renderer.tier;
  container.appendChild(canvas);
  const overviewLabels = createLabelLayer(container);
  const closeUpLabels = createLabelLayer(container);
  closeUpLabels.domElement.hidden = true;

  const sampleElevationMetres = createElevationSampler(terrainGrid.elevations, terrainGrid.grid, projection);
  const softDot = createSoftDotTexture();
  const overview = buildOverview({
    palette,
    kit: renderer.kit,
    domElement: canvas,
    features,
    terrainGrid,
    projection,
    sampleElevationMetres,
    input,
    softDot,
    prefersReducedMotion: isCalm,
    isHighDetail,
    rippleNormalMap,
    skyMap,
  });

  performance.mark("seabed:overview");
  // Lookdev hooks on the canvas: the camera and time overrides, and the anchor hidden for the contrast check.
  let cameraOverride: CameraOverride | null = null;
  let timeOverrideMs: number | null = null;
  const overrideObserver = new MutationObserver(() => {
    cameraOverride = parseCameraOverride(canvas.dataset.cameraOverride);
    timeOverrideMs = parseTimeOverride(canvas.dataset.timeOverride);
    overview.setAnchorHidden(canvas.dataset.lookdevHide === "anchor");
    markDirty();
  });
  overrideObserver.observe(canvas, { attributes: true, attributeFilter: ["data-camera-override", "data-time-override", "data-lookdev-hide", "data-lookdev-traces"] });
  /** The replay moment to draw: the lookdev override when one is set, the replay clock's otherwise. */
  const readDrawTimeMs = () => timeOverrideMs ?? readTimeMs();

  // The camera director's hold on the cameras (the `director` port below): a pose for the overview camera, an angle for
  // the close-up's, the anchor cam's second view, and the listeners told before each frame. All empty until used, so
  // nothing here runs before the first frame.
  let directedPose: CameraPose | null = null;
  let closeUpOrbitDegrees: number | null = null;
  let closeUpHome: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  let secondView: SecondView | null = null;
  let lastSecondViewAt = Number.NEGATIVE_INFINITY;
  const frameListeners = new Set<(frame: ViewerFrame) => void>();
  function notifyFrame(atMs: number, nowMs: number) {
    frameListeners.forEach((listener) => listener({ atMs, nowMs }));
  }

  // The close-up takes 0.2 to 0.4 s to build on a slow machine, so it is built the first time it is shown.
  let closeUp: CloseUpScene | null = null;
  let isIllustrated = true;
  function ensureCloseUp(): CloseUpScene {
    if (closeUp) return closeUp;
    const built = buildCloseUp({
      domElement: canvas,
      sampleElevationMetres,
      cutScene: overview.primaryCutScene,
      cutAtMs: input.cuts[0].atMs,
      sky: skyMap,
      trackDirection: overview.trackDirection,
      cableDirection: overview.cableDirection,
      cableLabel: input.cuts[0].label,
      environment: ensureEnvironment(),
      softDot,
      kit: renderer.kit,
      prefersReducedMotion: isCalm,
      chainShape: overview.primaryCutChain,
    });
    built.setIllustrated(isIllustrated);
    built.controls.addEventListener("change", markDirty);
    // The close-up's own camera as built: the director's orbit turns about this pose.
    closeUpHome = { position: built.camera.position.clone(), target: built.controls.target.clone() };
    closeUp = built;
    resize();
    return built;
  }

  let activeView: SeabedViewName = "overview";
  let cameraMove: CameraMove | null = null;
  let switchTimer: ReturnType<typeof setTimeout> | null = null;
  const homePosition = overview.presets.overview.position;
  const introStart = homePosition.clone().sub(overview.presets.overview.target).multiplyScalar(1.6).add(overview.presets.overview.target);
  overview.camera.position.copy(isCalm ? homePosition : introStart);
  overview.controls.target.copy(overview.presets.overview.target);
  if (!isCalm) {
    cameraMove = {
      fromPosition: introStart.clone(),
      fromTarget: overview.presets.overview.target.clone(),
      toPosition: homePosition.clone(),
      toTarget: overview.presets.overview.target.clone(),
      startedAt: performance.now(),
      durationMs: INTRO_MOVE_MS,
    };
  }
  // Grabbing the scene ends any scripted camera move.
  const stopCameraMove = () => {
    cameraMove = null;
  };
  overview.controls.addEventListener("start", stopCameraMove);
  overview.controls.addEventListener("change", markDirty);

  function applyView(view: SeabedViewName) {
    const isCloseUp = view === "closeup";
    activeView = view;
    markDirty();
    overview.controls.enabled = !isCloseUp;
    overviewLabels.domElement.hidden = isCloseUp;
    closeUpLabels.domElement.hidden = !isCloseUp;
    if (closeUp) closeUp.controls.enabled = isCloseUp;
    if (isCloseUp) {
      const closeUpScene = ensureCloseUp();
      closeUpScene.controls.enabled = true;
      closeUpScene.resetCamera();
      return;
    }
    if (view === "vessel") {
      // The follow camera takes over from any scripted move; orbiting would fight it.
      cameraMove = null;
      overview.controls.enabled = false;
      return;
    }
    const preset = overview.presets[view];
    if (isCalm) {
      overview.camera.position.copy(preset.position);
      overview.controls.target.copy(preset.target);
      return;
    }
    cameraMove = {
      fromPosition: overview.camera.position.clone(),
      fromTarget: overview.controls.target.clone(),
      toPosition: preset.position.clone(),
      toTarget: preset.target.clone(),
      startedAt: performance.now(),
      durationMs: VIEW_MOVE_MS,
    };
  }

  function setView(view: SeabedViewName) {
    const crossesScenes = (view === "closeup") !== (activeView === "closeup");
    if (!crossesScenes || isCalm) {
      applyView(view);
      return;
    }
    if (switchTimer !== null) clearTimeout(switchTimer);
    container.style.opacity = "0";
    switchTimer = setTimeout(() => {
      applyView(view);
      container.style.opacity = "1";
      switchTimer = null;
    }, CROSSFADE_OUT_MS);
  }

  let rightInsetPx = 0;
  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    overview.camera.fov = fitOverviewFov(width / height);
    overview.setCompactLabels(width < COMPACT_LABEL_WIDTH_PX);
    const cameras = closeUp ? [overview.camera, closeUp.camera] : [overview.camera];
    // A view offset renders the window starting this far right, so the picture (and its labels) shift left.
    const shiftPx = Math.min(rightInsetPx / 2, width / 4);
    for (const camera of cameras) {
      camera.aspect = width / height;
      if (shiftPx > 0) camera.setViewOffset(width, height, shiftPx, 0, width, height);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
    }
    renderer.setSize(width, height);
    overviewLabels.setSize(width, height);
    closeUpLabels.setSize(width, height);
    markDirty();
  }
  // Syncs the canvas with its container: the card resizes with the page, not only with the window.
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();
  // Nothing is drawn while the view is scrolled out of sight.
  let isOnScreen = true;
  const visibilityObserver = new IntersectionObserver((entries) => {
    isOnScreen = entries.some((entry) => entry.isIntersecting);
    if (isOnScreen) markDirty();
  });
  visibilityObserver.observe(container);

  const projectedPoint = new THREE.Vector3();
  /** A scene point in client px on the last drawn frame, or null when it lies at or behind the camera's near plane. */
  function projectToClient(position: THREE.Vector3, canvasRect: DOMRect): { clientX: number; clientY: number } | null {
    // The camera looks down its own negative z axis.
    projectedPoint.copy(position).applyMatrix4(overview.camera.matrixWorldInverse);
    if (projectedPoint.z > -overview.camera.near) return null;
    // The projection matrix carries the view offset, so these coordinates already match the shifted picture.
    projectedPoint.copy(position).project(overview.camera);
    return { clientX: canvasRect.left + ((projectedPoint.x + 1) / 2) * canvasRect.width, clientY: canvasRect.top + ((1 - projectedPoint.y) / 2) * canvasRect.height };
  }

  // A label's text box, without the padding that lifts it off its point (labels.ts): what a click on a name hits.
  const labelTextRange = document.createRange();
  function readLabelTextRect(label: HTMLElement): DOMRect | null {
    labelTextRange.selectNodeContents(label);
    const textRect = labelTextRange.getBoundingClientRect();
    return textRect.width > 0 ? textRect : null;
  }

  function projectTarget(target: SceneTarget): SceneProjection {
    if (activeView === "closeup") return { kind: "not-drawn" };
    const located = overview.locateTarget(target);
    if (!located) return { kind: "not-drawn" };
    const canvasRect = canvas.getBoundingClientRect();
    const screenPoint = projectToClient(located.position, canvasRect);
    if (!screenPoint) return { kind: "off-view" };
    const isInClearPart =
      screenPoint.clientX >= canvasRect.left && screenPoint.clientX <= canvasRect.right - rightInsetPx && screenPoint.clientY >= canvasRect.top && screenPoint.clientY <= canvasRect.bottom;
    return isInClearPart ? { kind: "on-view", ...screenPoint, labelRect: readLabelTextRect(located.label) } : { kind: "off-view" };
  }

  function centerOnTarget(target: SceneTarget) {
    // The follow camera already frames the vessel, and the close-up has its own camera.
    if (activeView === "closeup" || activeView === "vessel") return;
    const located = overview.locateTarget(target);
    if (!located) return;
    const shift = new THREE.Vector3(located.position.x - overview.controls.target.x, 0, located.position.z - overview.controls.target.z);
    const toPosition = overview.camera.position.clone().add(shift);
    const toTarget = overview.controls.target.clone().add(shift);
    if (isCalm) {
      overview.camera.position.copy(toPosition);
      overview.controls.target.copy(toTarget);
      markDirty();
      return;
    }
    cameraMove = { fromPosition: overview.camera.position.clone(), fromTarget: overview.controls.target.clone(), toPosition, toTarget, startedAt: performance.now(), durationMs: VIEW_MOVE_MS };
  }

  /** The target drawn nearest a client point, within `radiusPx` of its point or on its name; null when there is none. */
  function findTargetAt(clientX: number, clientY: number, radiusPx: number): SceneTarget | null {
    if (activeView === "closeup") return null;
    const canvasRect = canvas.getBoundingClientRect();
    let nearest: { target: SceneTarget; distancePx: number } | null = null;
    for (const pickable of overview.readPickables()) {
      const screenPoint = projectToClient(pickable.position, canvasRect);
      if (!screenPoint) continue;
      const textRect = readLabelTextRect(pickable.label);
      const isOnLabel = textRect !== null && clientX >= textRect.left && clientX <= textRect.right && clientY >= textRect.top && clientY <= textRect.bottom;
      const pointDistancePx = Math.hypot(screenPoint.clientX - clientX, screenPoint.clientY - clientY);
      // A click on a name counts as within reach; where two names overlap, the target whose point is nearer wins.
      const distancePx = isOnLabel ? Math.min(pointDistancePx, radiusPx) : pointDistancePx;
      if (distancePx <= radiusPx && (nearest === null || distancePx < nearest.distancePx)) nearest = { target: pickable.target, distancePx };
    }
    return nearest?.target ?? null;
  }

  // Picking listens on the canvas next to the orbit controls: a short press is a click, a drag stays an orbit.
  let press: { clientX: number; clientY: number; atMs: number } | null = null;
  let isPointerOverTarget = false;
  const handlePointerDown = (event: PointerEvent) => {
    press = { clientX: event.clientX, clientY: event.clientY, atMs: event.timeStamp };
  };
  const handlePointerUp = (event: PointerEvent) => {
    const started = press;
    press = null;
    if (!started || event.timeStamp - started.atMs > CLICK_MAX_MS || Math.hypot(event.clientX - started.clientX, event.clientY - started.clientY) > CLICK_SLOP_PX) return;
    const target = findTargetAt(event.clientX, event.clientY, event.pointerType === "mouse" ? MOUSE_PICK_RADIUS_PX : TOUCH_PICK_RADIUS_PX);
    if (target) onTargetPick(target);
  };
  const handlePointerCancel = () => {
    press = null;
  };
  // A mouse hovering a target gets the pointer cursor; the style is written only when that changes.
  const handlePointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || event.buttons !== 0) return;
    const isOverTarget = findTargetAt(event.clientX, event.clientY, MOUSE_PICK_RADIUS_PX) !== null;
    if (isOverTarget === isPointerOverTarget) return;
    isPointerOverTarget = isOverTarget;
    canvas.style.cursor = isOverTarget ? "pointer" : "";
  };
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerCancel);
  canvas.addEventListener("pointermove", handlePointerMove);

  let frameHandle = 0;
  let isDisposed = false;
  let lastFrameAt: number | null = null;
  let lastDrawnAtMs = Number.NaN;
  let drawnFrameCount = 0;
  const followPosition = new THREE.Vector3();
  const followTarget = new THREE.Vector3();

  // Test hooks on the canvas: what the last frame showed and how many frames were drawn, so a screenshot tool
  // (scripts/lookdev) can wait until the picture it asked for has been drawn and has stopped changing.
  function recordDrawnFrame(atMs: number) {
    drawnFrameCount += 1;
    if (drawnFrameCount === 1) performance.mark("seabed:first-frame");
    const canvasData = canvas.dataset;
    canvasData.frameCount = String(drawnFrameCount);
    if (canvasData.drawnView !== activeView) canvasData.drawnView = activeView;
    const drawnAt = String(Math.round(atMs));
    if (canvasData.drawnAtMs !== drawnAt) canvasData.drawnAtMs = drawnAt;
  }

  /** Turns the close-up's camera `degrees` about the vertical through its home target (the director's slow orbit). */
  function applyCloseUpOrbit(closeUpScene: CloseUpScene, home: { position: THREE.Vector3; target: THREE.Vector3 }, degrees: number) {
    const offset = home.position.clone().sub(home.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, degrees * RADIANS_PER_DEGREE);
    closeUpScene.camera.position.copy(home.target).add(offset);
    closeUpScene.controls.target.copy(home.target);
    closeUpScene.camera.lookAt(home.target);
  }

  function renderCloseUp(closeUpScene: CloseUpScene, nowSeconds: number, deltaSeconds: number) {
    notifyFrame(readDrawTimeMs(), nowSeconds * 1000);
    const isOrbitHeld = !cameraOverride && closeUpOrbitDegrees !== null && closeUpHome !== null;
    if (cameraOverride) applyCameraOverride(cameraOverride, closeUpScene.camera, closeUpScene.controls.target);
    else if (closeUpOrbitDegrees !== null && closeUpHome) applyCloseUpOrbit(closeUpScene, closeUpHome, closeUpOrbitDegrees);
    const hasCameraMoved = cameraOverride || isOrbitHeld ? false : closeUpScene.controls.update();
    // The cut plays out on the replay's clock, so a new moment is a new frame.
    const atMs = readDrawTimeMs();
    const hasTimeChanged = atMs !== lastDrawnAtMs;
    if (isCalm && !isDirty && !hasCameraMoved && !hasTimeChanged) return;
    lastDrawnAtMs = atMs;
    closeUpScene.update(atMs, nowSeconds, deltaSeconds);
    renderer.draw(closeUpScene.scene, closeUpScene.camera);
    closeUpLabels.render(closeUpScene.scene, closeUpScene.camera);
    isDirty = false;
    recordDrawnFrame(atMs);
    if (canvas.dataset.lookdev === "on") recordCloseUpSubjects(closeUpScene);
  }

  function renderOverview(now: number, elapsedSeconds: number, deltaSeconds: number) {
    const atMs = readDrawTimeMs();
    // The director sets this frame's pose before the camera is placed (setCameraPose).
    notifyFrame(atMs, now);
    const hasTimeChanged = atMs !== lastDrawnAtMs;
    let isCameraEasing = false;
    const vesselFrame = activeView === "vessel" && !cameraOverride && !directedPose ? overview.readVesselFrame() : null;
    if (cameraOverride) {
      applyCameraOverride(cameraOverride, overview.camera, overview.controls.target);
    } else if (directedPose) {
      applyCameraOverride(directedPose, overview.camera, overview.controls.target);
    } else if (vesselFrame) {
      const { position, heading, drawnLengthKm } = vesselFrame;
      // While the anchor drags, the camera stands back, rises and tips down toward it, so the ship, its chain and the
      // anchor on the seabed share the frame.
      const anchorPosition = overview.readAnchorPosition();
      const reach = anchorPosition ? FOLLOW_DRAG_FRAMING.reach : 1;
      const behindKm = FOLLOW_BEHIND_LENGTHS * drawnLengthKm * reach;
      const sideKm = FOLLOW_SIDE_LENGTHS * drawnLengthKm * reach;
      const aboveKm = (FOLLOW_ABOVE_LENGTHS + (anchorPosition ? FOLLOW_DRAG_FRAMING.riseLengths : 0)) * drawnLengthKm;
      followPosition.set(position.x - heading.x * behindKm - heading.z * sideKm, position.y + aboveKm, position.z - heading.z * behindKm + heading.x * sideKm);
      const aimAheadKm = FOLLOW_AIM_AHEAD_LENGTHS * drawnLengthKm;
      followTarget.set(position.x + heading.x * aimAheadKm, position.y + FOLLOW_AIM_ABOVE_LENGTHS * drawnLengthKm, position.z + heading.z * aimAheadKm);
      if (anchorPosition) followTarget.lerp(anchorPosition, FOLLOW_DRAG_FRAMING.aimShare);
      const ease = isCalm ? 1 : 1 - Math.exp(-elapsedSeconds * FOLLOW_EASE_PER_SECOND);
      overview.camera.position.lerp(followPosition, ease);
      overview.controls.target.lerp(followTarget, ease);
      overview.camera.lookAt(overview.controls.target);
      isCameraEasing = overview.camera.position.distanceTo(followPosition) > FOLLOW_SETTLED_KM;
    } else if (cameraMove) {
      const amount = clampValue((now - cameraMove.startedAt) / cameraMove.durationMs, 0, 1);
      const eased = easeOutCubic(amount);
      overview.camera.position.lerpVectors(cameraMove.fromPosition, cameraMove.toPosition, eased);
      overview.controls.target.lerpVectors(cameraMove.fromTarget, cameraMove.toTarget, eased);
      isCameraEasing = true;
      if (amount >= 1) cameraMove = null;
    }
    // The follow camera owns the camera in the Vessel view: the orbit controls would pull it out to their minimum
    // distance (1.5 km), closer than a short hull's follow offset allows, and the two would fight every frame.
    const hasCameraMoved = vesselFrame || cameraOverride || directedPose ? false : overview.controls.update();
    if (isCalm && !isDirty && !hasTimeChanged && !hasCameraMoved && !isCameraEasing) return;
    // A paused calm scene holds still: silt drifts only while the replay moves.
    overview.update(atMs, isCalm && !hasTimeChanged ? 0 : deltaSeconds, now / 1000);
    // The vessel moved with the replay, so the follow camera has a new target: one more frame after this one.
    isDirty = activeView === "vessel" && hasTimeChanged;
    lastDrawnAtMs = atMs;
    // The anchor cam draws at its own, lower rate (SECOND_VIEW_INTERVAL_MS), and at once whenever it opens.
    if (secondView && now - lastSecondViewAt >= SECOND_VIEW_INTERVAL_MS[isGpuTier ? "gpu" : "cpu"]) {
      drawSecondView(secondView, atMs, now / 1000);
      lastSecondViewAt = now;
    }
    overview.followCamera(overview.camera.position, overview.camera.position.distanceTo(overview.controls.target));
    overview.camera.updateMatrixWorld();
    overview.fitScreenSizes(overview.camera, container.clientHeight);
    renderer.draw(overview.scene, overview.camera);
    overviewLabels.render(overview.scene, overview.camera);
    hideOverlappingLabels(overviewLabels.domElement, readLabelRoom());
    recordDrawnFrame(atMs);
    if (canvas.dataset.lookdev === "on") recordColorProbes();
    if (canvas.dataset.lookdevTraces === "request") recordLineTraces();
  }

  /**
   * Lookdev hook (asked for with data-lookdev-traces="request", answered with "done"): every shown data line's drawn
   * path in canvas px, each point marked in sight or not, and the anchor's point, for the continuity and contrast checks.
   */
  function recordLineTraces() {
    const canvasRect = canvas.getBoundingClientRect();
    const toCanvasPoint = (position: THREE.Vector3) => {
      const screenPoint = projectToClient(position, canvasRect);
      return screenPoint ? [Math.round((screenPoint.clientX - canvasRect.left) * 10) / 10, Math.round((screenPoint.clientY - canvasRect.top) * 10) / 10] : null;
    };
    const traces = overview.readLineTraces(overview.camera.position).map((trace) => ({
      tone: trace.tone,
      points: trace.points.map((point) => {
        const canvasPoint = toCanvasPoint(point.position);
        return canvasPoint ? [...canvasPoint, point.isInSight ? 1 : 0] : null;
      }),
    }));
    const anchorPosition = overview.readAnchorPosition();
    canvas.dataset.lineTraces = JSON.stringify({ traces, anchor: anchorPosition ? toCanvasPoint(anchorPosition) : null });
    canvas.dataset.lookdevTraces = "done";
  }

  // Lookdev hook (scripts/lookdev sets data-lookdev="on" on the canvas): where each data line is on this frame, in
  // canvas px, so the harness can check those pixels hold the exact data colour. Skips points under the rail.
  function recordColorProbes() {
    const canvasRect = canvas.getBoundingClientRect();
    const cameraRight = new THREE.Vector3().setFromMatrixColumn(overview.camera.matrixWorld, 0);
    const probes = overview.readColorProbes(overview.camera.position).flatMap((probe) => {
      const screenPoint = projectToClient(probe.position, canvasRect);
      if (!screenPoint) return [];
      if (probe.widthKm !== null) {
        const edgePoint = projectToClient(probe.position.clone().addScaledVector(cameraRight, probe.widthKm), canvasRect);
        const widthDevicePx = edgePoint ? Math.hypot(edgePoint.clientX - screenPoint.clientX, edgePoint.clientY - screenPoint.clientY) * renderer.readPixelRatio() : 0;
        if (widthDevicePx < MIN_PROBED_WIDTH_DEVICE_PX) return [];
      }
      const canvasX = screenPoint.clientX - canvasRect.left;
      const canvasY = screenPoint.clientY - canvasRect.top;
      const isInClearPart = canvasX >= 0 && canvasX <= canvasRect.width - rightInsetPx && canvasY >= 0 && canvasY <= canvasRect.height;
      return isInClearPart ? [{ tone: probe.tone, x: Math.round(canvasX * 10) / 10, y: Math.round(canvasY * 10) / 10, isCased: probe.isCased }] : [];
    });
    canvas.dataset.colorProbes = JSON.stringify(probes);
    const seabedProbes = overview.readSeabedProbes(overview.camera.position).flatMap((probe) => {
      const screenPoint = projectToClient(probe.position, canvasRect);
      if (!screenPoint) return [];
      const canvasX = screenPoint.clientX - canvasRect.left;
      const canvasY = screenPoint.clientY - canvasRect.top;
      const isInClearPart = canvasX >= 0 && canvasX <= canvasRect.width - rightInsetPx && canvasY >= 0 && canvasY <= canvasRect.height;
      return isInClearPart ? [{ hex: probe.expectedHex, x: Math.round(canvasX * 10) / 10, y: Math.round(canvasY * 10) / 10 }] : [];
    });
    canvas.dataset.seabedProbes = JSON.stringify(seabedProbes);
    recordStoryboardHooks(
      overview.camera,
      overview.controls.target,
      overview.readSubjects().map((subject) => ({ subject, isHidden: overview.isBehindRelief(subject.position, overview.camera.position) })),
    );
    canvas.dataset.anchorFacts = JSON.stringify(overview.readAnchorFacts(readTimeMs()));
  }

  // Lookdev hooks for the storyboard (explore/natural-look): the camera's pose and where each named subject lands on
  // the canvas (CSS px, null behind the camera), and whether the seabed hides it from the camera.
  function recordStoryboardHooks(camera: THREE.PerspectiveCamera, target: THREE.Vector3, subjects: { subject: SceneSubject; isHidden: boolean }[]) {
    const canvasRect = canvas.getBoundingClientRect();
    const toArray = (vector: THREE.Vector3) => vector.toArray().map((value) => Math.round(value * 1000) / 1000);
    canvas.dataset.cameraPose = JSON.stringify({ view: activeView, position: toArray(camera.position), target: toArray(target), fovDegrees: Math.round(camera.fov * 100) / 100, aspect: camera.aspect });
    const projected = subjects.map(({ subject, isHidden }) => {
      projectedPoint.copy(subject.position).applyMatrix4(camera.matrixWorldInverse);
      const isInFront = projectedPoint.z < -camera.near;
      projectedPoint.copy(subject.position).project(camera);
      return {
        name: subject.name,
        scene: toArray(subject.position),
        x: isInFront ? Math.round(((projectedPoint.x + 1) / 2) * canvasRect.width * 10) / 10 : null,
        y: isInFront ? Math.round(((1 - projectedPoint.y) / 2) * canvasRect.height * 10) / 10 : null,
        isHidden,
      };
    });
    canvas.dataset.subjects = JSON.stringify(projected);
  }

  const closeUpRaycaster = new THREE.Raycaster();
  function recordCloseUpSubjects(closeUpScene: CloseUpScene) {
    const subjects = closeUpScene.readSubjects().map((subject) => {
      const toSubject = subject.position.clone().sub(closeUpScene.camera.position);
      const distance = toSubject.length();
      closeUpRaycaster.set(closeUpScene.camera.position, toSubject.normalize());
      closeUpRaycaster.far = distance;
      const hit = closeUpRaycaster.intersectObject(closeUpScene.seabed, false)[0];
      return { subject, isHidden: hit !== undefined && hit.distance < distance - CLOSE_UP_HIDDEN_MARGIN };
    });
    recordStoryboardHooks(closeUpScene.camera, closeUpScene.controls.target, subjects);
  }

  /**
   * Where the overview's labels may sit: inside the stage, LABEL_EDGE_ROOM_PX from its edges, and off every control
   * and card over it (the console marks those `data-label-blocker`: the stage controls, the rail, the anchor cam, cards).
   */
  function readLabelRoom(): LabelRoom {
    const stageRect = container.getBoundingClientRect();
    const bounds = { left: stageRect.left + LABEL_EDGE_ROOM_PX, top: stageRect.top + LABEL_EDGE_ROOM_PX, right: stageRect.right - LABEL_EDGE_ROOM_PX, bottom: stageRect.bottom - LABEL_EDGE_ROOM_PX };
    const blockers = [...document.querySelectorAll<HTMLElement>("[data-label-blocker]")]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0 && rect.right > stageRect.left && rect.left < stageRect.right && rect.bottom > stageRect.top && rect.top < stageRect.bottom);
    return { bounds, blockers };
  }

  /**
   * Draws the anchor cam: the overview scene from the second view's pose, into the whole canvas, copied (centre crop at
   * the window's aspect) into the window's own 2D canvas before the main frame overwrites it. One extra pass, only
   * while the window is open; the overview camera is borrowed and put back, so no second renderer or target exists.
   */
  function drawSecondView(view: SecondView, atMs: number, nowSeconds: number) {
    const pose = view.readPose();
    const context = view.canvas.getContext("2d");
    if (!pose || !context) return;
    const camera = overview.camera;
    const pixelRatio = renderer.readPixelRatio();
    const targetWidth = Math.max(1, Math.round(view.widthPx * pixelRatio));
    const targetHeight = Math.max(1, Math.round(view.heightPx * pixelRatio));
    if (view.canvas.width !== targetWidth) view.canvas.width = targetWidth;
    if (view.canvas.height !== targetHeight) view.canvas.height = targetHeight;
    const viewAspect = view.widthPx / view.heightPx;
    const cropWidth = Math.min(canvas.width, canvas.height * viewAspect);
    const cropHeight = cropWidth / viewAspect;
    // The crop keeps the pose's vertical field of view: a canvas taller than the window's aspect widens the full frame's.
    const fullFovDegrees = (2 * Math.atan(Math.tan((pose.fovDegrees / 2) * RADIANS_PER_DEGREE) * (canvas.height / cropHeight))) / RADIANS_PER_DEGREE;
    const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov, view: camera.view ? { ...camera.view } : null, target: overview.controls.target.clone() };
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    camera.fov = fullFovDegrees;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // The scene reads the camera as it updates (under the surface or not, chain links or hairline, lines up close), so
    // it is updated for this camera without moving on (no time step), and again for the main camera afterwards.
    overview.update(atMs, 0, nowSeconds);
    overview.followCamera(camera.position, camera.position.distanceTo(pose.target));
    overview.fitScreenSizes(camera, container.clientHeight);
    renderer.draw(overview.scene, camera);
    context.clearRect(0, 0, targetWidth, targetHeight);
    context.drawImage(canvas, (canvas.width - cropWidth) / 2, (canvas.height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight);
    camera.position.copy(saved.position);
    camera.quaternion.copy(saved.quaternion);
    camera.fov = saved.fov;
    if (saved.view?.enabled) camera.setViewOffset(saved.view.fullWidth, saved.view.fullHeight, saved.view.offsetX, saved.view.offsetY, saved.view.width, saved.view.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    overview.controls.target.copy(saved.target);
    overview.update(atMs, 0, nowSeconds);
  }

  // The hover readout's data, built on the first hover: the cables in scene km and the ship's track a minute apart.
  let cableRuns: CableRun[] | null = null;
  let trackSamples: TrackSample[] | null = null;
  const groundRaycaster = new THREE.Raycaster();
  const seaLevel = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const groundPoint = new THREE.Vector3();

  /** The director's port: the subjects, cameras, second view and readouts it works with. */
  function createDirectorPort(): DirectorViewerPort {
    const cutPointNames = input.cuts.map((cut) => `${cut.label} cut point`);
    return {
      readSubjects(): DirectorSubjects {
        const subjects = overview.readSubjects();
        const named = (name: string) => subjects.find((subject) => subject.name === name)?.position ?? null;
        const vesselFrame = overview.readVesselFrame();
        const anchorPosition = named("anchor");
        const hawse = named("hawse (chain top)");
        const chainMiddle = named("chain middle");
        return {
          vessel: vesselFrame ? { position: vesselFrame.position.clone(), heading: new THREE.Vector3(vesselFrame.heading.x, 0, vesselFrame.heading.z).normalize(), drawnLengthKm: vesselFrame.drawnLengthKm } : null,
          anchor: anchorPosition && hawse && chainMiddle ? { position: anchorPosition, hawse, chainMiddle } : null,
          cutPoints: cutPointNames.map(named),
          trackPoints: subjects.filter((subject) => subject.name.startsWith("track ")).map((subject) => subject.position),
        };
      },
      isHiddenByRelief: (point, cameraPosition) => overview.isBehindRelief(point, cameraPosition),
      projectToCanvas(point) {
        projectedPoint.copy(point).applyMatrix4(overview.camera.matrixWorldInverse);
        const isInFront = projectedPoint.z < -overview.camera.near;
        projectedPoint.copy(point).project(overview.camera);
        return { x: ((projectedPoint.x + 1) / 2) * container.clientWidth, y: ((1 - projectedPoint.y) / 2) * container.clientHeight, isInFront };
      },
      readCanvasSize: () => ({ widthPx: container.clientWidth, heightPx: container.clientHeight }),
      readCameraPose: () => ({ position: overview.camera.position.clone(), target: overview.controls.target.clone(), fovDegrees: overview.camera.fov }),
      readOverviewFovDegrees: () => fitOverviewFov(Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight)),
      setCameraPose(pose) {
        const isSame = pose !== null && directedPose !== null && pose.position.equals(directedPose.position) && pose.target.equals(directedPose.target) && pose.fovDegrees === directedPose.fovDegrees;
        if (isSame || (pose === null && directedPose === null)) return;
        const isRelease = pose === null;
        directedPose = pose;
        // Handed back: the view's own field of view and the rail's view offset return.
        if (isRelease) resize();
        markDirty();
      },
      setCloseUpOrbit(degrees) {
        if (degrees === closeUpOrbitDegrees) return;
        closeUpOrbitDegrees = degrees;
        markDirty();
      },
      readAnchorFacts: (atMs) => overview.readAnchorFacts(atMs),
      setSecondView(view) {
        secondView = view;
        // A window that opens or changes size draws at once, on every tier.
        lastSecondViewAt = Number.NEGATIVE_INFINITY;
        markDirty();
      },
      onBeforeFrame(listener) {
        frameListeners.add(listener);
        return () => frameListeners.delete(listener);
      },
      readGroundAt(clientX, clientY) {
        if (activeView === "closeup") return null;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2);
        groundRaycaster.setFromCamera(pointer, overview.camera);
        if (!groundRaycaster.ray.intersectPlane(seaLevel, groundPoint)) return null;
        if (Math.abs(groundPoint.x) > projection.widthKm / 2 || Math.abs(groundPoint.z) > projection.depthKm / 2) return null;
        cableRuns ??= features.lines
          .filter((line) => line.kind !== "pipeline")
          .map((line) => ({ name: line.name, points: line.points.map(([longitude, latitude]) => projection.toScene(longitude, latitude)) }));
        trackSamples ??= sampleTrack(input.track, projection.toScene);
        const point = { x: groundPoint.x, z: groundPoint.z };
        const elevationMetres = sampleElevationMetres(point.x, point.z);
        return { waterDepthMetres: elevationMetres < 0 ? -elevationMetres : null, nearestCable: findNearestCable(cableRuns, point), shipPass: findNearestPass(trackSamples, point) };
      },
      recordDirection(direction) {
        if (!direction) {
          delete canvas.dataset.directorShot;
          delete canvas.dataset.directorSubjects;
          delete canvas.dataset.safeArea;
          return;
        }
        canvas.dataset.directorShot = direction.shotKind;
        canvas.dataset.directorSubjects = JSON.stringify(direction.subjectNames);
        canvas.dataset.safeArea = JSON.stringify(direction.safeArea);
      },
    };
  }

  function renderFrame(now: number) {
    frameHandle = requestAnimationFrame(renderFrame);
    const elapsedSeconds = lastFrameAt === null ? 0 : (now - lastFrameAt) / 1000;
    lastFrameAt = now;
    if (!isOnScreen) return;
    // Scene motion steps at most 0.1 s per frame; the follow camera uses real time so it arrives even on slow GPUs.
    const deltaSeconds = Math.min(0.1, elapsedSeconds);
    if (activeView === "closeup" && closeUp) renderCloseUp(closeUp, now / 1000, deltaSeconds);
    else renderOverview(now, elapsedSeconds, deltaSeconds);
  }

  // The room's prefiltered reflections, made the first time something needs them (the close-up's metal, the refinement
  // on the software tier, which has no sky HDRI): never on the way to the first frame.
  let environment: THREE.Texture | null = null;
  function ensureEnvironment(): THREE.Texture {
    environment ??= renderer.kit.createEnvironment();
    return environment;
  }

  /**
   * The second step of the load, after the first frame is on screen: builds the refinement's deferred parts, then
   * compiles every shader the replay will need (the refinement and every hidden object, such as the cut pieces and markers that
   * first appear at the moment the replay is about) one program per task (SceneRenderer.compile), then shows the refinement.
   * The sky's prefiltering, which three.js does inside the first compile that meets it, gets a compile of its own.
   */
  async function completeScene() {
    await overview.prepareRefinement(isGpuTier ? null : ensureEnvironment());
    if (skyMap) {
      await skyLoaded;
      const skyProbe = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial({ envMap: skyMap }));
      await compileWithoutStalling(skyProbe);
      skyProbe.geometry.dispose();
      skyProbe.material.dispose();
    }
    if (isDisposed) return;
    // Hidden objects are shown only while the compile walks the scene: it reads visibility at once, then waits.
    const hiddenObjects: THREE.Object3D[] = [];
    overview.scene.traverse((object) => {
      if (object.visible) return;
      hiddenObjects.push(object);
      object.visible = true;
    });
    const compiled = compileWithoutStalling(overview.scene);
    hiddenObjects.forEach((object) => {
      object.visible = false;
    });
    await compiled;
    if (isDisposed) return;
    performance.mark("seabed:complete");
    // This scene's materials now hold every program it uses: the previous replay's can go.
    parked?.releaseHeldMaterials();
    overview.revealRefinement();
    settleAsset();
  }

  /** Compiles `objects` under the overview's lights and settings; a failure is logged, never thrown. */
  function compileWithoutStalling(objects: THREE.Object3D): Promise<void> {
    return renderer.compile(objects, overview.camera, overview.scene).catch((error: unknown) => {
      console.error(`[compileWithoutStalling] shader compile failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  // The first frame is drawn as soon as the overview is built (three.js compiles what it shows, nothing more); the rest
  // follows one frame later, once that frame has reached the screen. It counts as a pending asset from now, so a reader
  // of data-pending-assets (the lookdev harness) never takes the frames before the refinement for the finished scene.
  changePendingAssets(1);
  frameHandle = requestAnimationFrame(renderFrame);
  let completionHandle = requestAnimationFrame(() => {
    completionHandle = requestAnimationFrame(() => {
      if (!isDisposed) void completeScene();
    });
  });

  return {
    ok: true,
    value: {
      setView,
      setIllustrated(nextIsIllustrated) {
        isIllustrated = nextIsIllustrated;
        closeUp?.setIllustrated(nextIsIllustrated);
        markDirty();
      },
      resetView() {
        applyView(activeView);
      },
      setRightInset(insetPx) {
        const nextInsetPx = Math.max(0, insetPx);
        if (nextInsetPx === rightInsetPx) return;
        rightInsetPx = nextInsetPx;
        resize();
      },
      projectTarget,
      centerOnTarget,
      director: createDirectorPort(),
      dispose() {
        isDisposed = true;
        frameListeners.clear();
        secondView = null;
        cancelAnimationFrame(frameHandle);
        cancelAnimationFrame(completionHandle);
        if (switchTimer !== null) clearTimeout(switchTimer);
        resizeObserver.disconnect();
        overrideObserver.disconnect();
        visibilityObserver.disconnect();
        canvas.removeEventListener("pointerdown", handlePointerDown);
        canvas.removeEventListener("pointerup", handlePointerUp);
        canvas.removeEventListener("pointercancel", handlePointerCancel);
        canvas.removeEventListener("pointermove", handlePointerMove);
        overview.controls.removeEventListener("start", stopCameraMove);
        overview.controls.removeEventListener("change", markDirty);
        overview.controls.dispose();
        // The materials are held, not freed, so a parked renderer keeps their programs linked for the next replay.
        const heldMaterials: THREE.Material[] = [];
        disposeObjectTree(overview.scene, heldMaterials);
        if (closeUp) {
          closeUp.controls.removeEventListener("change", markDirty);
          closeUp.controls.dispose();
          disposeObjectTree(closeUp.scene, heldMaterials);
        }
        environment?.dispose();
        softDot.dispose();
        rippleNormalMap?.dispose();
        skyMap?.dispose();
        // Closed before this scene finished compiling: the previous replay's materials go now.
        parked?.releaseHeldMaterials();
        canvas.remove();
        // The test hooks (data-frame-count, data-renderer...) belong to this replay, not to the next one's canvas.
        Object.keys(canvas.dataset).forEach((key) => delete canvas.dataset[key]);
        overviewLabels.domElement.remove();
        closeUpLabels.domElement.remove();
        const releaseHeldMaterials = () => heldMaterials.splice(0).forEach((material) => material.dispose());
        if (!parkRenderer({ renderer, releaseHeldMaterials })) {
          releaseHeldMaterials();
          renderer.dispose();
        }
      },
    },
  };
}
