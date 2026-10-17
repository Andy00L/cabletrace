"use client";

import type { BufferGeometry, Material, PerspectiveCamera, Scene } from "three";
import { useEffect, useRef, useState } from "react";
import { DiagnosticsReadout, type ReadoutRow } from "@/components/diagnostics/DiagnosticsReadout";
import { WEBGL_COLORS } from "@/lib/design/webgl-colors";
import { summarizeFrameDurations, type FrameSummary } from "@/lib/diagnostics/frame-stats";
import { classifyRenderer, readRendererName, type RendererKind } from "@/lib/diagnostics/webgl-renderer";

type ThreeModule = typeof import("three");

type SceneProbeState =
  | { kind: "starting" }
  | { kind: "measuring"; rendererName: string; rendererKind: RendererKind }
  | { kind: "measured"; rendererName: string; rendererKind: RendererKind; summary: FrameSummary }
  | { kind: "failed"; reason: string };

type SeabedScene = {
  scene: Scene;
  camera: PerspectiveCamera;
  disposables: (BufferGeometry | Material)[];
};

// Frames timed per run: about three seconds at 60 frames per second.
const MEASURED_FRAME_COUNT = 180;
// A software renderer (SwiftShader, llvmpipe) draws a frame in 30 ms or more, which stretched a 180-frame run to
// 6 or 7 seconds (docs/PERFORMANCE.md). Timing stops here instead; a 60 Hz display finishes 180 frames first.
const MAX_TIMED_MS = 3500;
// Longest wait for the map probe to settle before timing starts anyway.
const MAP_SETTLE_TIMEOUT_MS = 5000;
// Seabed patch in scene units and its grid (25,921 vertices), close to one tile of the replay's terrain.
// It reaches past the fog on every side, so the orbiting camera never sees its edge.
const SEABED_SIZE = 64;
const SEABED_SEGMENTS = 160;
const FOG_NEAR = 22;
const FOG_FAR = 46;
// The cable rests this far above the seabed so the tube never sinks into it.
const CABLE_CLEARANCE = 0.12;
const CABLE_RADIUS = 0.09;
// One control point per half unit, so the cable follows each sand wave instead of bridging it.
const CABLE_POINT_COUNT = 128;
const CAMERA_ORBIT_RADIUS = 18;
const CAMERA_HEIGHT = 9;
const ORBIT_RADIANS_PER_MS = 0.00012;
// Device pixel ratio cap: past 2 the cost grows faster than the visible gain.
const MAX_PIXEL_RATIO = 2;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The map probe's start-up (MapLibre's 1 MB bundle and first draw) holds the main thread for 50 to 90 ms at a time;
// frames timed alongside it landed in the 3D slow-frame figure. Resolves once the map probe on the page has left its
// loading state (read through its data-state, the same contract the end-to-end tests use), or at once when there is none.
function waitForMapProbeToSettle(): Promise<void> {
  return new Promise((resolve) => {
    const mapProbe = document.querySelector('[data-testid="map-probe"]');
    if (!(mapProbe instanceof HTMLElement) || mapProbe.dataset.state !== "loading") {
      resolve();
      return;
    }
    const finishWaiting = () => {
      observer.disconnect();
      clearTimeout(timeoutId);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (mapProbe.dataset.state !== "loading") finishWaiting();
    });
    observer.observe(mapProbe, { attributes: true, attributeFilter: ["data-state"] });
    const timeoutId = setTimeout(finishWaiting, MAP_SETTLE_TIMEOUT_MS);
  });
}

// Rolling sand waves and one ridge: enough relief for the lighting to work like the replay's seabed.
function measureSeabedHeight(positionX: number, positionZ: number): number {
  const sandWaves = 0.9 * Math.sin(positionX * 0.35) * Math.cos(positionZ * 0.42) + 0.35 * Math.sin(positionX * 1.3 + positionZ * 0.7);
  const ridge = 1.6 * Math.exp(-((positionZ - 2) ** 2) / 18);
  return sandWaves + ridge;
}

function traceCablePath(positionX: number): number {
  return -3 + 0.18 * positionX + 1.2 * Math.sin(positionX * 0.3);
}

function buildSeabedScene(three: ThreeModule, aspectRatio: number): SeabedScene {
  const scene = new three.Scene();
  scene.background = new three.Color(WEBGL_COLORS.depth30);
  scene.fog = new three.Fog(WEBGL_COLORS.depth30, FOG_NEAR, FOG_FAR);

  const seabedGeometry = new three.PlaneGeometry(SEABED_SIZE, SEABED_SIZE, SEABED_SEGMENTS, SEABED_SEGMENTS);
  seabedGeometry.rotateX(-Math.PI / 2);
  const positions = seabedGeometry.getAttribute("position");
  const deepColor = new three.Color(WEBGL_COLORS.depthDeep);
  const shallowColor = new three.Color(WEBGL_COLORS.depth30);
  const vertexColor = new three.Color();
  const colors = new Float32Array(positions.count * 3);
  for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex += 1) {
    const height = measureSeabedHeight(positions.getX(vertexIndex), positions.getZ(vertexIndex));
    positions.setY(vertexIndex, height);
    vertexColor.lerpColors(deepColor, shallowColor, Math.min(1, Math.max(0, (height + 1.3) / 3.2)));
    vertexColor.toArray(colors, vertexIndex * 3);
  }
  seabedGeometry.setAttribute("color", new three.BufferAttribute(colors, 3));
  seabedGeometry.computeVertexNormals();
  const seabedMaterial = new three.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  scene.add(new three.Mesh(seabedGeometry, seabedMaterial));

  const cablePoints = Array.from({ length: CABLE_POINT_COUNT }, (_slot, pointIndex) => {
    const positionX = -SEABED_SIZE / 2 + 1 + (pointIndex / (CABLE_POINT_COUNT - 1)) * (SEABED_SIZE - 2);
    const positionZ = traceCablePath(positionX);
    return new three.Vector3(positionX, measureSeabedHeight(positionX, positionZ) + CABLE_CLEARANCE, positionZ);
  });
  const cableGeometry = new three.TubeGeometry(new three.CatmullRomCurve3(cablePoints), CABLE_POINT_COUNT * 6, CABLE_RADIUS, 10, false);
  const cableMaterial = new three.MeshStandardMaterial({ color: WEBGL_COLORS.cable, roughness: 0.45, metalness: 0.1 });
  scene.add(new three.Mesh(cableGeometry, cableMaterial));

  scene.add(new three.HemisphereLight(0xffffff, WEBGL_COLORS.depthDeep, 1.2));
  const sunlight = new three.DirectionalLight(0xffffff, 1.8);
  sunlight.position.set(8, 14, 6);
  scene.add(sunlight);

  const camera = new three.PerspectiveCamera(40, aspectRatio, 0.1, 200);
  return { scene, camera, disposables: [seabedGeometry, seabedMaterial, cableGeometry, cableMaterial] };
}

function describeSceneState(probeState: SceneProbeState): string {
  switch (probeState.kind) {
    case "starting":
      return "Starting WebGL";
    case "measuring":
      return "Timing frames";
    case "measured":
      return "Measured";
    case "failed":
      return "WebGL failed";
    default: {
      const unhandledState: never = probeState;
      return unhandledState;
    }
  }
}

function buildReadoutRows(probeState: SceneProbeState): ReadoutRow[] {
  const statusRow: ReadoutRow = { label: "Status", value: describeSceneState(probeState), testId: "scene-status" };
  if (probeState.kind === "starting") return [statusRow];
  if (probeState.kind === "failed") return [statusRow, { label: "Error", value: probeState.reason, testId: "scene-error", isAlarm: true }];
  const rendererRows: ReadoutRow[] = [
    { label: "Renderer", value: probeState.rendererName, testId: "scene-renderer" },
    {
      label: "Renderer type",
      value: probeState.rendererKind === "hardware" ? "Graphics card (GPU)" : "Software (CPU fallback)",
      testId: "scene-renderer-kind",
    },
  ];
  if (probeState.kind === "measuring") return [statusRow, ...rendererRows];
  const { summary } = probeState;
  return [
    statusRow,
    ...rendererRows,
    { label: "Frames per second", value: summary.framesPerSecond.toFixed(1), testId: "scene-fps" },
    { label: "Average frame", value: `${summary.averageMs.toFixed(1)} ms`, testId: "scene-average-frame" },
    { label: "Slow frame (95th percentile)", value: `${summary.slowFrameMs.toFixed(1)} ms`, testId: "scene-slow-frame" },
    { label: "Frames timed", value: String(summary.frameCount), testId: "scene-frame-count" },
  ];
}

/** One measurement run: draws the seabed, times MEASURED_FRAME_COUNT frames (MAX_TIMED_MS at most), then stops rendering. */
function SceneMeasurement({ onMeasureAgain }: { onMeasureAgain: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [probeState, setProbeState] = useState<SceneProbeState>({ kind: "starting" });

  // Syncs with three.js, a WebGL renderer React does not own: built on mount, disposed on unmount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let isCancelled = false;
    let disposeScene: (() => void) | null = null;

    async function startScene(sceneCanvas: HTMLCanvasElement) {
      let three: ThreeModule;
      try {
        three = await import("three");
      } catch (error) {
        console.error(`[SceneMeasurement] ${describeError(error)}`);
        if (!isCancelled) setProbeState({ kind: "failed", reason: `three.js did not load: ${describeError(error)}` });
        return;
      }
      if (isCancelled) return;

      let renderer: InstanceType<ThreeModule["WebGLRenderer"]>;
      try {
        renderer = new three.WebGLRenderer({ canvas: sceneCanvas, antialias: true, powerPreference: "high-performance" });
      } catch (error) {
        console.error(`[SceneMeasurement] ${describeError(error)}`);
        if (!isCancelled) setProbeState({ kind: "failed", reason: `WebGL 2 is not available: ${describeError(error)}` });
        return;
      }
      const rendererName = readRendererName(renderer.getContext());
      const rendererKind = classifyRenderer(rendererName);
      setProbeState({ kind: "measuring", rendererName, rendererKind });

      renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
      const { scene, camera, disposables } = buildSeabedScene(three, sceneCanvas.clientWidth / Math.max(1, sceneCanvas.clientHeight));
      const fitToCanvas = () => {
        const width = Math.max(1, sceneCanvas.clientWidth);
        const height = Math.max(1, sceneCanvas.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      fitToCanvas();
      const placeCameraOnOrbit = (frameTime: number) => {
        const orbitAngle = frameTime * ORBIT_RADIANS_PER_MS;
        camera.position.set(Math.cos(orbitAngle) * CAMERA_ORBIT_RADIUS, CAMERA_HEIGHT, Math.sin(orbitAngle) * CAMERA_ORBIT_RADIUS);
        camera.lookAt(0, 0, 0);
      };

      let animationFrameId = 0;
      // Resizing clears the canvas, so a finished run draws one more frame at the new size.
      const resizeObserver = new ResizeObserver(() => {
        fitToCanvas();
        renderer.render(scene, camera);
      });
      // Set before the first await, so an unmount during the shader compile still frees the context.
      disposeScene = () => {
        cancelAnimationFrame(animationFrameId);
        resizeObserver.disconnect();
        disposables.forEach((disposable) => disposable.dispose());
        renderer.dispose();
        // Frees the GPU context now instead of at garbage collection, so repeated runs never hit the browser's context limit.
        renderer.forceContextLoss();
      };

      // Compiles the shaders before timing starts, so the first timed frame is not the compile. Where the browser has
      // KHR_parallel_shader_compile the compile also leaves the main thread free; elsewhere three.js compiles in place.
      try {
        await renderer.compileAsync(scene, camera);
      } catch (error) {
        console.error(`[SceneMeasurement] ${describeError(error)}`);
      }
      if (isCancelled) return;
      // One untimed frame shows the seabed while the map probe settles.
      placeCameraOnOrbit(performance.now());
      renderer.render(scene, camera);
      await waitForMapProbeToSettle();
      if (isCancelled) return;
      resizeObserver.observe(sceneCanvas);

      const frameDurations: number[] = [];
      let firstFrameTime: number | null = null;
      let previousFrameTime: number | null = null;
      const renderFrame = (frameTime: number) => {
        placeCameraOnOrbit(frameTime);
        renderer.render(scene, camera);
        if (previousFrameTime !== null) frameDurations.push(frameTime - previousFrameTime);
        previousFrameTime = frameTime;
        if (firstFrameTime === null) firstFrameTime = frameTime;
        const hasTimedEnough = frameDurations.length >= MEASURED_FRAME_COUNT || frameTime - firstFrameTime >= MAX_TIMED_MS;
        if (!hasTimedEnough) {
          animationFrameId = requestAnimationFrame(renderFrame);
          return;
        }
        const summary = summarizeFrameDurations(frameDurations);
        setProbeState(summary ? { kind: "measured", rendererName, rendererKind, summary } : { kind: "failed", reason: "No frame could be timed" });
      };
      animationFrameId = requestAnimationFrame(renderFrame);
    }

    void startScene(canvas);
    return () => {
      isCancelled = true;
      disposeScene?.();
    };
  }, []);

  const isMeasuring = probeState.kind === "starting" || probeState.kind === "measuring";
  return (
    <section
      className="flex flex-col gap-5 rounded-card bg-card p-6 shadow-card sm:p-7"
      data-testid="scene-probe"
      data-state={probeState.kind}
      data-renderer-kind={probeState.kind === "measuring" || probeState.kind === "measured" ? probeState.rendererKind : undefined}
      aria-labelledby="scene-probe-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="scene-probe-title" className="text-card-title">3D seabed</h2>
          <p className="text-small text-muted">
            three.js draws a lit seabed with a cable and times {MEASURED_FRAME_COUNT} frames, or {MAX_TIMED_MS / 1000} seconds of frames on a
            slow renderer.
          </p>
        </div>
        <button
          type="button"
          onClick={onMeasureAgain}
          disabled={isMeasuring}
          className="h-11 shrink-0 rounded-full bg-soft px-5 text-label text-ink transition-transform duration-80 ease-standard active:scale-[0.97] disabled:text-faint disabled:active:scale-100"
          data-testid="scene-measure-again"
        >
          Measure again
        </button>
      </div>
      <canvas ref={canvasRef} className="block h-80 w-full rounded-inner bg-soft" role="img" aria-label="3D seabed with a cable lying on it" />
      <DiagnosticsReadout rows={buildReadoutRows(probeState)} />
    </section>
  );
}

/** The 3D probe card; "Measure again" remounts the run through its key so every run starts clean. */
export function SceneProbe() {
  const [measurementRun, setMeasurementRun] = useState(0);
  return <SceneMeasurement key={measurementRun} onMeasureAgain={() => setMeasurementRun((previousRun) => previousRun + 1)} />;
}
