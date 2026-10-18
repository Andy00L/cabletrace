import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { detectRendererKind } from "@/lib/diagnostics/webgl-renderer";
import { requestWebGpuDevice } from "@/lib/diagnostics/webgpu-adapter";
import type { RenderTierName, SceneRenderer } from "@/lib/render/scene-renderer";
import { createWebGlSceneRenderer, type DrawingBudget } from "@/lib/render/webgl-scene-renderer";
import type { ReplaySceneInput } from "@/lib/replay/replay-scene";
import type { Result } from "@/lib/result";
import { clampValue, easeOutCubic } from "@/lib/seabed/math";
import { hideOverlappingLabels } from "@/lib/seabed/scene/labels";
import { buildCloseUp, type CloseUpScene } from "@/lib/seabed/scene/close-up";
import { buildOverview, OVERVIEW_FOV_DEGREES, type OverviewViewName, type SceneTarget } from "@/lib/seabed/scene/overview";
import { createSoftDotTexture } from "@/lib/seabed/scene/textures";
import type { SeabedData } from "@/lib/seabed/seabed-data";
import { chooseSmoothingPasses, createElevationSampler, createProjection, downsampleElevations, smoothElevations } from "@/lib/seabed/terrain";

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

/**
 * Drawing budget per tier. On a CPU renderer (SwiftShader, llvmpipe: headless test browsers and machines
 * without a usable GPU) an overview frame drawn as for a GPU took 0.9 to 1.6 s and froze the page; without
 * antialiasing and shadows, at half the terrain grid and a low pixel ratio it takes about 0.12 s
 * (docs/PERFORMANCE.md, "For the lead: 3D replay"). The WebGPU tier draws as the GPU tier and adds its own
 * post-processing (src/lib/render/webgpu/webgpu-scene-renderer.ts).
 */
const RENDER_TIERS: Record<RenderTierName, DrawingBudget & { terrainStep: number }> = {
  webgpu: { antialias: true, shadows: true, maxPixelRatio: 2, terrainStep: 1 },
  hardware: { antialias: true, shadows: true, maxPixelRatio: 2, terrainStep: 1 },
  software: { antialias: false, shadows: false, maxPixelRatio: 0.75, terrainStep: 2 },
};

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
  dispose: () => void;
};

type ViewerOptions = {
  container: HTMLElement;
  data: SeabedData;
  input: ReplaySceneInput;
  /** Read once per frame: the replay moment to draw. */
  readTimeMs: () => number;
  prefersReducedMotion: boolean;
  /** Called when a click or tap lands on the vessel or a cut marker (or on its label) in the overview. */
  onTargetPick: (target: SceneTarget) => void;
};

type CameraMove = {
  fromPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPosition: THREE.Vector3;
  toTarget: THREE.Vector3;
  startedAt: number;
  durationMs: number;
};

function disposeObjectTree(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.Line || child instanceof THREE.Sprite)) return;
    child.geometry.dispose();
    const materials: THREE.Material[] = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose();
      material.dispose();
    });
  });
}

/**
 * The renderer for this browser: the WebGPU tier when the browser offers a real GPU adapter (its code loads only
 * then), else WebGL on the GPU or on the CPU, as before. A WebGPU tier that fails to start falls back to WebGL, so the
 * canvas never reports `webgpu` for anything but a WebGPU backend.
 */
async function createSceneRenderer(): Promise<Result<SceneRenderer>> {
  const webGpuDevice = await requestWebGpuDevice();
  if (webGpuDevice.ok) {
    try {
      const webGpuModule = await import("@/lib/render/webgpu/webgpu-scene-renderer");
      const created = await webGpuModule.createWebGpuSceneRenderer({ device: webGpuDevice.value.device, budget: RENDER_TIERS.webgpu });
      if (created.ok) return created;
      console.warn(`[createSceneRenderer] the WebGPU tier did not start on ${webGpuDevice.value.adapterName}, drawing with WebGL: ${created.reason}`);
    } catch (error) {
      console.warn(`[createSceneRenderer] the WebGPU tier did not load, drawing with WebGL: ${error instanceof Error ? error.message : String(error)}`);
    }
    webGpuDevice.value.device.destroy();
  }
  const kind = detectRendererKind();
  return createWebGlSceneRenderer(kind, RENDER_TIERS[kind]);
}

function createLabelLayer(container: HTMLElement): CSS2DRenderer {
  const labels = new CSS2DRenderer();
  labels.domElement.style.position = "absolute";
  labels.domElement.style.inset = "0";
  labels.domElement.style.pointerEvents = "none";
  container.appendChild(labels.domElement);
  return labels;
}

/** Vertical field of view (degrees) that gives a frame of `aspect` the reference frame's horizontal reach. */
function fitOverviewFov(aspect: number): number {
  const referenceHalfWidth = Math.tan((OVERVIEW_FOV_DEGREES / 2) * RADIANS_PER_DEGREE) * REFERENCE_ASPECT;
  const fittedFov = (2 * Math.atan(referenceHalfWidth / aspect)) / RADIANS_PER_DEGREE;
  return clampValue(fittedFov, OVERVIEW_FOV_DEGREES, MAX_OVERVIEW_FOV_DEGREES);
}

/**
 * Builds the overview inside `container` (the close-up on first use) and draws. Ambient motion (the running
 * signal, caustics, drifting silt) is off for reduced motion and on CPU renderers; the scene is then "calm" and
 * a frame is drawn only when the replay moment, the camera, the view or the size changes. The renderer tier is chosen
 * first (createSceneRenderer), which is why this waits. Never throws.
 */
export async function createSeabedViewer(options: ViewerOptions): Promise<Result<SeabedViewer>> {
  const { container, data, input, readTimeMs, prefersReducedMotion, onTargetPick } = options;
  const createdRenderer = await createSceneRenderer();
  if (!createdRenderer.ok) return createdRenderer;
  const renderer = createdRenderer.value;
  const tier = RENDER_TIERS[renderer.tier];
  const isGpuTier = renderer.tier !== "software";
  const isCalm = prefersReducedMotion || !isGpuTier;
  const canvas = renderer.canvas;
  canvas.style.display = "block";
  canvas.style.outline = "none";
  canvas.dataset.renderer = renderer.tier;
  container.appendChild(canvas);
  const overviewLabels = createLabelLayer(container);
  const closeUpLabels = createLabelLayer(container);
  closeUpLabels.domElement.hidden = true;

  const grid = downsampleElevations(data.elevations, data.features.grid, tier.terrainStep);
  const features = { ...data.features, grid: grid.grid };
  const elevations = smoothElevations(grid.elevations, grid.grid, chooseSmoothingPasses(data.features.sources.depth));
  const projection = createProjection(features.region);
  const sampleElevationMetres = createElevationSampler(elevations, grid.grid, projection);
  const softDot = createSoftDotTexture();
  // The sand-ripple detail (GPU tiers only): a CC0 normal map from Poly Haven (docs/LOOKDEV.md, Credits) that arrives
  // after the first frame. The canvas says how many such assets are still loading, so a screenshot tool can wait.
  let pendingAssetCount = 0;
  canvas.dataset.pendingAssets = "0";
  function settleAsset() {
    pendingAssetCount -= 1;
    canvas.dataset.pendingAssets = String(pendingAssetCount);
    markDirty();
  }
  let rippleNormalMap: THREE.Texture | null = null;
  if (isGpuTier) {
    pendingAssetCount += 1;
    canvas.dataset.pendingAssets = String(pendingAssetCount);
    rippleNormalMap = new THREE.TextureLoader().load(RIPPLE_NORMAL_MAP_URL, settleAsset, undefined, () => {
      console.error(`[createSeabedViewer] the sand-ripple map ${RIPPLE_NORMAL_MAP_URL} did not load`);
      settleAsset();
    });
    rippleNormalMap.wrapS = THREE.RepeatWrapping;
    rippleNormalMap.wrapT = THREE.RepeatWrapping;
    rippleNormalMap.anisotropy = renderer.maxAnisotropy;
  }
  const overview = buildOverview({
    kit: renderer.kit,
    domElement: canvas,
    features,
    elevations,
    projection,
    sampleElevationMetres,
    input,
    softDot,
    prefersReducedMotion: isCalm,
    isHighDetail: isGpuTier,
    rippleNormalMap,
  });

  // Set whenever the picture must be redrawn even though the replay moment did not change.
  let isDirty = true;
  function markDirty() {
    isDirty = true;
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
      trackDirection: overview.trackDirection,
      cableDirection: overview.cableDirection,
      cableLabel: input.cuts[0].label,
      environment: overview.scene.environment,
      softDot,
      caustics: renderer.kit.createCaustics(),
      prefersReducedMotion: isCalm,
      chainShape: overview.primaryCutChain,
    });
    built.setIllustrated(isIllustrated);
    built.controls.addEventListener("change", markDirty);
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
    const canvasData = canvas.dataset;
    canvasData.frameCount = String(drawnFrameCount);
    if (canvasData.drawnView !== activeView) canvasData.drawnView = activeView;
    const drawnAt = String(Math.round(atMs));
    if (canvasData.drawnAtMs !== drawnAt) canvasData.drawnAtMs = drawnAt;
  }

  function renderCloseUp(closeUpScene: CloseUpScene, nowSeconds: number, deltaSeconds: number) {
    const hasCameraMoved = closeUpScene.controls.update();
    if (isCalm && !isDirty && !hasCameraMoved) return;
    closeUpScene.update(nowSeconds, deltaSeconds);
    renderer.draw(closeUpScene.scene, closeUpScene.camera);
    closeUpLabels.render(closeUpScene.scene, closeUpScene.camera);
    isDirty = false;
    recordDrawnFrame(readTimeMs());
  }

  function renderOverview(now: number, elapsedSeconds: number, deltaSeconds: number) {
    const atMs = readTimeMs();
    const hasTimeChanged = atMs !== lastDrawnAtMs;
    let isCameraEasing = false;
    const vesselFrame = activeView === "vessel" ? overview.readVesselFrame() : null;
    if (vesselFrame) {
      const { position, heading, drawnLengthKm } = vesselFrame;
      const behindKm = FOLLOW_BEHIND_LENGTHS * drawnLengthKm;
      const sideKm = FOLLOW_SIDE_LENGTHS * drawnLengthKm;
      followPosition.set(position.x - heading.x * behindKm - heading.z * sideKm, position.y + FOLLOW_ABOVE_LENGTHS * drawnLengthKm, position.z - heading.z * behindKm + heading.x * sideKm);
      const aimAheadKm = FOLLOW_AIM_AHEAD_LENGTHS * drawnLengthKm;
      followTarget.set(position.x + heading.x * aimAheadKm, position.y + FOLLOW_AIM_ABOVE_LENGTHS * drawnLengthKm, position.z + heading.z * aimAheadKm);
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
    const hasCameraMoved = vesselFrame ? false : overview.controls.update();
    if (isCalm && !isDirty && !hasTimeChanged && !hasCameraMoved && !isCameraEasing) return;
    // A paused calm scene holds still: silt drifts only while the replay moves.
    overview.update(atMs, isCalm && !hasTimeChanged ? 0 : deltaSeconds, now / 1000);
    // The vessel moved with the replay, so the follow camera has a new target: one more frame after this one.
    isDirty = activeView === "vessel" && hasTimeChanged;
    lastDrawnAtMs = atMs;
    renderer.draw(overview.scene, overview.camera);
    overviewLabels.render(overview.scene, overview.camera);
    hideOverlappingLabels(overviewLabels.domElement);
    recordDrawnFrame(atMs);
    if (canvas.dataset.lookdev === "on") recordColorProbes();
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
      return isInClearPart ? [{ tone: probe.tone, x: Math.round(canvasX * 10) / 10, y: Math.round(canvasY * 10) / 10 }] : [];
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

  // Compiles every shader before the first frame, hidden objects included: three.js compiles only what is visible,
  // and the cut pieces, markers and anchor first appear at the moment the replay is about. Where the browser has
  // KHR_parallel_shader_compile the compile also leaves the main thread free.
  const hiddenObjects: THREE.Object3D[] = [];
  overview.scene.traverse((object) => {
    if (object.visible) return;
    hiddenObjects.push(object);
    object.visible = true;
  });
  renderer
    .compile(overview.scene, overview.camera)
    .catch((error: unknown) => console.error(`[createSeabedViewer] shader compile failed: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      hiddenObjects.forEach((object) => {
        object.visible = false;
      });
      if (!isDisposed) frameHandle = requestAnimationFrame(renderFrame);
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
      dispose() {
        isDisposed = true;
        cancelAnimationFrame(frameHandle);
        if (switchTimer !== null) clearTimeout(switchTimer);
        resizeObserver.disconnect();
        visibilityObserver.disconnect();
        canvas.removeEventListener("pointerdown", handlePointerDown);
        canvas.removeEventListener("pointerup", handlePointerUp);
        canvas.removeEventListener("pointercancel", handlePointerCancel);
        canvas.removeEventListener("pointermove", handlePointerMove);
        overview.controls.removeEventListener("start", stopCameraMove);
        overview.controls.removeEventListener("change", markDirty);
        overview.controls.dispose();
        disposeObjectTree(overview.scene);
        if (closeUp) {
          closeUp.controls.removeEventListener("change", markDirty);
          closeUp.controls.dispose();
          disposeObjectTree(closeUp.scene);
        }
        overview.scene.environment?.dispose();
        softDot.dispose();
        rippleNormalMap?.dispose();
        renderer.dispose();
        canvas.remove();
        overviewLabels.domElement.remove();
        closeUpLabels.domElement.remove();
      },
    },
  };
}
