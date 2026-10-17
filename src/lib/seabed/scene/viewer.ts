import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { classifyRenderer, readRendererName, type RendererKind } from "@/lib/diagnostics/webgl-renderer";
import type { ReplaySceneInput } from "@/lib/replay/replay-scene";
import type { Result } from "@/lib/result";
import { clampValue, easeOutCubic } from "@/lib/seabed/math";
import { createCaustics } from "@/lib/seabed/scene/caustics";
import { buildCloseUp, type CloseUpScene } from "@/lib/seabed/scene/close-up";
import { buildOverview, OVERVIEW_FOV_DEGREES, type OverviewViewName } from "@/lib/seabed/scene/overview";
import { createSoftDotTexture } from "@/lib/seabed/scene/textures";
import type { SeabedData } from "@/lib/seabed/seabed-data";
import { createElevationSampler, createProjection, downsampleElevations, smoothElevations } from "@/lib/seabed/terrain";

// One 3x3 mean pass over the 232 m grid: removes single-cell survey spikes and keeps the real relief.
const SMOOTHING_PASSES = 1;
// Camera moves inside the overview, and the crossfade between overview and close-up (docs/UI_DESIGN_SYSTEM.md, Motion).
const INTRO_MOVE_MS = 1800;
const VIEW_MOVE_MS = 900;
const CROSSFADE_OUT_MS = 190;
// The overview keeps the horizontal reach it has in a 16:10 frame: a narrower frame (a phone held upright) widens
// the vertical field of view instead of cropping the track, up to this limit.
const REFERENCE_ASPECT = 1.6;
const MAX_OVERVIEW_FOV_DEGREES = 60;
const RADIANS_PER_DEGREE = Math.PI / 180;
// The follow camera sits off the vessel's starboard quarter (km), close enough to read the deck, and eases toward it.
const FOLLOW_BEHIND_KM = 1.45;
const FOLLOW_SIDE_KM = 1.55;
const FOLLOW_ABOVE_KM = 0.62;
const FOLLOW_EASE_PER_SECOND = 3.5;
// The follow camera counts as arrived within this distance (km), and stops asking for frames.
const FOLLOW_SETTLED_KM = 0.002;

/**
 * Drawing budget per renderer. On a CPU renderer (SwiftShader, llvmpipe: headless test browsers and machines
 * without a usable GPU) an overview frame drawn as for a GPU took 0.9 to 1.6 s and froze the page; without
 * antialiasing and shadows, at half the terrain grid and a low pixel ratio it takes about 0.12 s
 * (docs/PERFORMANCE.md, "For the lead: 3D replay").
 */
const RENDER_TIERS: Record<RendererKind, { antialias: boolean; shadows: boolean; maxPixelRatio: number; terrainStep: number }> = {
  hardware: { antialias: true, shadows: true, maxPixelRatio: 2, terrainStep: 1 },
  software: { antialias: false, shadows: false, maxPixelRatio: 0.75, terrainStep: 2 },
};

export type SeabedViewName = OverviewViewName | "vessel" | "closeup";

export type SeabedViewer = {
  setView: (view: SeabedViewName) => void;
  setIllustrated: (isIllustrated: boolean) => void;
  dispose: () => void;
};

type ViewerOptions = {
  container: HTMLElement;
  data: SeabedData;
  input: ReplaySceneInput;
  /** Read once per frame: the replay moment to draw. */
  readTimeMs: () => number;
  prefersReducedMotion: boolean;
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

/** Asks a throwaway context which renderer WebGL runs on; antialiasing is fixed at creation, so this comes first. */
function detectRendererKind(): RendererKind {
  const probeCanvas = document.createElement("canvas");
  const context = probeCanvas.getContext("webgl2");
  if (!context) return "hardware";
  const kind = classifyRenderer(readRendererName(context));
  context.getExtension("WEBGL_lose_context")?.loseContext();
  return kind;
}

/**
 * Builds the overview inside `container` (the close-up on first use) and draws. Ambient motion (the running
 * signal, caustics, drifting silt) is off for reduced motion and on CPU renderers; the scene is then "calm" and
 * a frame is drawn only when the replay moment, the camera, the view or the size changes. Never throws.
 */
export function createSeabedViewer(options: ViewerOptions): Result<SeabedViewer> {
  const { container, data, input, readTimeMs, prefersReducedMotion } = options;
  const rendererKind = detectRendererKind();
  const tier = RENDER_TIERS[rendererKind];
  const isCalm = prefersReducedMotion || rendererKind === "software";
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: tier.antialias, alpha: true, powerPreference: "high-performance" });
  } catch (error) {
    return { ok: false, reason: `WebGL 2 is not available: ${error instanceof Error ? error.message : String(error)}` };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.maxPixelRatio));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = tier.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.outline = "none";
  renderer.domElement.dataset.renderer = rendererKind;
  container.appendChild(renderer.domElement);
  const overviewLabels = createLabelLayer(container);
  const closeUpLabels = createLabelLayer(container);
  closeUpLabels.domElement.hidden = true;

  const grid = downsampleElevations(data.elevations, data.features.grid, tier.terrainStep);
  const features = { ...data.features, grid: grid.grid };
  const elevations = smoothElevations(grid.elevations, grid.grid, SMOOTHING_PASSES);
  const projection = createProjection(features.region);
  const sampleElevationMetres = createElevationSampler(elevations, grid.grid, projection);
  const softDot = createSoftDotTexture();
  const overview = buildOverview({
    renderer,
    domElement: renderer.domElement,
    features,
    elevations,
    projection,
    sampleElevationMetres,
    input,
    softDot,
    prefersReducedMotion: isCalm,
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
      domElement: renderer.domElement,
      sampleElevationMetres,
      cutScene: overview.primaryCutScene,
      trackDirection: overview.trackDirection,
      cableDirection: overview.cableDirection,
      cableLabel: input.cuts[0].label,
      environment: overview.scene.environment,
      softDot,
      caustics: createCaustics(),
      prefersReducedMotion: isCalm,
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

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    overview.camera.fov = fitOverviewFov(width / height);
    const cameras = closeUp ? [overview.camera, closeUp.camera] : [overview.camera];
    for (const camera of cameras) {
      camera.aspect = width / height;
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

  let frameHandle = 0;
  let isDisposed = false;
  let lastFrameAt: number | null = null;
  let lastDrawnAtMs = Number.NaN;
  const followPosition = new THREE.Vector3();
  const followTarget = new THREE.Vector3();

  function renderCloseUp(closeUpScene: CloseUpScene, nowSeconds: number, deltaSeconds: number) {
    const hasCameraMoved = closeUpScene.controls.update();
    if (isCalm && !isDirty && !hasCameraMoved) return;
    closeUpScene.update(nowSeconds, deltaSeconds);
    renderer.render(closeUpScene.scene, closeUpScene.camera);
    closeUpLabels.render(closeUpScene.scene, closeUpScene.camera);
    isDirty = false;
  }

  function renderOverview(now: number, elapsedSeconds: number, deltaSeconds: number) {
    const atMs = readTimeMs();
    const hasTimeChanged = atMs !== lastDrawnAtMs;
    let isCameraEasing = false;
    const vesselFrame = activeView === "vessel" ? overview.readVesselFrame() : null;
    if (vesselFrame) {
      const { position, heading } = vesselFrame;
      followPosition.set(
        position.x - heading.x * FOLLOW_BEHIND_KM - heading.z * FOLLOW_SIDE_KM,
        position.y + FOLLOW_ABOVE_KM,
        position.z - heading.z * FOLLOW_BEHIND_KM + heading.x * FOLLOW_SIDE_KM,
      );
      followTarget.set(position.x + heading.x * 0.3, position.y + 0.05, position.z + heading.z * 0.3);
      const ease = isCalm ? 1 : 1 - Math.exp(-elapsedSeconds * FOLLOW_EASE_PER_SECOND);
      overview.camera.position.lerp(followPosition, ease);
      overview.controls.target.lerp(followTarget, ease);
      isCameraEasing = overview.camera.position.distanceTo(followPosition) > FOLLOW_SETTLED_KM;
    } else if (cameraMove) {
      const amount = clampValue((now - cameraMove.startedAt) / cameraMove.durationMs, 0, 1);
      const eased = easeOutCubic(amount);
      overview.camera.position.lerpVectors(cameraMove.fromPosition, cameraMove.toPosition, eased);
      overview.controls.target.lerpVectors(cameraMove.fromTarget, cameraMove.toTarget, eased);
      isCameraEasing = true;
      if (amount >= 1) cameraMove = null;
    }
    const hasCameraMoved = overview.controls.update();
    if (isCalm && !isDirty && !hasTimeChanged && !hasCameraMoved && !isCameraEasing) return;
    // A paused calm scene holds still: silt drifts only while the replay moves.
    overview.update(atMs, isCalm && !hasTimeChanged ? 0 : deltaSeconds, now / 1000);
    // The vessel moved with the replay, so the follow camera has a new target: one more frame after this one.
    isDirty = activeView === "vessel" && hasTimeChanged;
    lastDrawnAtMs = atMs;
    renderer.render(overview.scene, overview.camera);
    overviewLabels.render(overview.scene, overview.camera);
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
    .compileAsync(overview.scene, overview.camera)
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
      dispose() {
        isDisposed = true;
        cancelAnimationFrame(frameHandle);
        if (switchTimer !== null) clearTimeout(switchTimer);
        resizeObserver.disconnect();
        visibilityObserver.disconnect();
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
        renderer.dispose();
        // Frees the GPU context now instead of at garbage collection.
        renderer.forceContextLoss();
        renderer.domElement.remove();
        overviewLabels.domElement.remove();
        closeUpLabels.domElement.remove();
      },
    },
  };
}
