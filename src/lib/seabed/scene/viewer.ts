import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type { ReplaySceneInput } from "@/lib/replay/replay-scene";
import type { Result } from "@/lib/result";
import { clampValue, easeOutCubic } from "@/lib/seabed/math";
import { createCaustics } from "@/lib/seabed/scene/caustics";
import { buildCloseUp } from "@/lib/seabed/scene/close-up";
import { buildOverview, OVERVIEW_FOV_DEGREES, type OverviewViewName } from "@/lib/seabed/scene/overview";
import { createSoftDotTexture } from "@/lib/seabed/scene/textures";
import type { SeabedData } from "@/lib/seabed/seabed-data";
import { createElevationSampler, createProjection, smoothElevations } from "@/lib/seabed/terrain";

// One 3x3 mean pass over the 232 m grid: removes single-cell survey spikes and keeps the real relief.
const SMOOTHING_PASSES = 1;
// Camera moves inside the overview, and the crossfade between overview and close-up (docs/UI_DESIGN_SYSTEM.md, Motion).
const INTRO_MOVE_MS = 1800;
const VIEW_MOVE_MS = 900;
const CROSSFADE_OUT_MS = 190;
// Below this width the overview camera widens so the block still fits.
const NARROW_WIDTH_PX = 720;
const NARROW_FOV_DEGREES = 44;
// The follow camera sits off the vessel's starboard quarter (km), close enough to read the deck, and eases toward it.
const FOLLOW_BEHIND_KM = 1.45;
const FOLLOW_SIDE_KM = 1.55;
const FOLLOW_ABOVE_KM = 0.62;
const FOLLOW_EASE_PER_SECOND = 3.5;

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

/** Builds the overview and close-up scenes inside `container` and starts drawing. Never throws. */
export function createSeabedViewer(options: ViewerOptions): Result<SeabedViewer> {
  const { container, data, input, readTimeMs, prefersReducedMotion } = options;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (error) {
    return { ok: false, reason: `WebGL 2 is not available: ${error instanceof Error ? error.message : String(error)}` };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.outline = "none";
  container.appendChild(renderer.domElement);
  const overviewLabels = createLabelLayer(container);
  const closeUpLabels = createLabelLayer(container);
  closeUpLabels.domElement.hidden = true;

  const elevations = smoothElevations(data.elevations, data.features.grid, SMOOTHING_PASSES);
  const projection = createProjection(data.features.region);
  const sampleElevationMetres = createElevationSampler(elevations, data.features.grid, projection);
  const softDot = createSoftDotTexture();
  const overview = buildOverview({
    renderer,
    domElement: renderer.domElement,
    features: data.features,
    elevations,
    projection,
    sampleElevationMetres,
    input,
    softDot,
    prefersReducedMotion,
  });
  const closeUp = buildCloseUp({
    domElement: renderer.domElement,
    sampleElevationMetres,
    cutScene: overview.primaryCutScene,
    trackDirection: overview.trackDirection,
    cableDirection: overview.cableDirection,
    cableLabel: input.cuts[0].label,
    environment: overview.scene.environment,
    softDot,
    caustics: createCaustics(),
    prefersReducedMotion,
  });

  let activeView: SeabedViewName = "overview";
  let cameraMove: CameraMove | null = null;
  let switchTimer: ReturnType<typeof setTimeout> | null = null;
  const homePosition = overview.presets.overview.position;
  const introStart = homePosition.clone().sub(overview.presets.overview.target).multiplyScalar(1.6).add(overview.presets.overview.target);
  overview.camera.position.copy(prefersReducedMotion ? homePosition : introStart);
  overview.controls.target.copy(overview.presets.overview.target);
  if (!prefersReducedMotion) {
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

  function applyView(view: SeabedViewName) {
    const isCloseUp = view === "closeup";
    activeView = view;
    overview.controls.enabled = !isCloseUp;
    closeUp.controls.enabled = isCloseUp;
    overviewLabels.domElement.hidden = isCloseUp;
    closeUpLabels.domElement.hidden = !isCloseUp;
    if (isCloseUp) {
      closeUp.resetCamera();
      return;
    }
    if (view === "vessel") {
      // The follow camera takes over from any scripted move; orbiting would fight it.
      cameraMove = null;
      overview.controls.enabled = false;
      return;
    }
    const preset = overview.presets[view];
    if (prefersReducedMotion) {
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
    if (!crossesScenes || prefersReducedMotion) {
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
    overview.camera.fov = width < NARROW_WIDTH_PX ? NARROW_FOV_DEGREES : OVERVIEW_FOV_DEGREES;
    for (const camera of [overview.camera, closeUp.camera]) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    renderer.setSize(width, height);
    overviewLabels.setSize(width, height);
    closeUpLabels.setSize(width, height);
  }
  // Syncs the canvas with its container: the card resizes with the page, not only with the window.
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  let frameHandle = 0;
  let lastFrameAt: number | null = null;
  const followPosition = new THREE.Vector3();
  const followTarget = new THREE.Vector3();
  function renderFrame(now: number) {
    const elapsedSeconds = lastFrameAt === null ? 0 : (now - lastFrameAt) / 1000;
    // Scene motion steps at most 0.1 s per frame; the follow camera uses real time so it arrives even on slow GPUs.
    const deltaSeconds = Math.min(0.1, elapsedSeconds);
    lastFrameAt = now;
    if (activeView === "closeup") {
      closeUp.update(now / 1000, deltaSeconds);
      closeUp.controls.update();
      renderer.render(closeUp.scene, closeUp.camera);
      closeUpLabels.render(closeUp.scene, closeUp.camera);
    } else {
      overview.update(readTimeMs(), deltaSeconds, now / 1000);
      const vesselFrame = activeView === "vessel" ? overview.readVesselFrame() : null;
      if (vesselFrame) {
        const { position, heading } = vesselFrame;
        followPosition.set(
          position.x - heading.x * FOLLOW_BEHIND_KM - heading.z * FOLLOW_SIDE_KM,
          position.y + FOLLOW_ABOVE_KM,
          position.z - heading.z * FOLLOW_BEHIND_KM + heading.x * FOLLOW_SIDE_KM,
        );
        followTarget.set(position.x + heading.x * 0.3, position.y + 0.05, position.z + heading.z * 0.3);
        const ease = prefersReducedMotion ? 1 : 1 - Math.exp(-elapsedSeconds * FOLLOW_EASE_PER_SECOND);
        overview.camera.position.lerp(followPosition, ease);
        overview.controls.target.lerp(followTarget, ease);
      } else if (cameraMove) {
        const amount = clampValue((now - cameraMove.startedAt) / cameraMove.durationMs, 0, 1);
        const eased = easeOutCubic(amount);
        overview.camera.position.lerpVectors(cameraMove.fromPosition, cameraMove.toPosition, eased);
        overview.controls.target.lerpVectors(cameraMove.fromTarget, cameraMove.toTarget, eased);
        if (amount >= 1) cameraMove = null;
      }
      overview.controls.update();
      renderer.render(overview.scene, overview.camera);
      overviewLabels.render(overview.scene, overview.camera);
    }
    frameHandle = requestAnimationFrame(renderFrame);
  }
  frameHandle = requestAnimationFrame(renderFrame);

  return {
    ok: true,
    value: {
      setView,
      setIllustrated: closeUp.setIllustrated,
      dispose() {
        cancelAnimationFrame(frameHandle);
        if (switchTimer !== null) clearTimeout(switchTimer);
        resizeObserver.disconnect();
        overview.controls.removeEventListener("start", stopCameraMove);
        overview.controls.dispose();
        closeUp.controls.dispose();
        disposeObjectTree(overview.scene);
        disposeObjectTree(closeUp.scene);
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
