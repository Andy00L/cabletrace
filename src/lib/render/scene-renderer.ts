import type * as THREE from "three";
import type { LineGeometry } from "three/addons/lines/LineGeometry.js";
import type { RendererKind } from "@/lib/diagnostics/webgl-renderer";
import type { TerrainLighting } from "@/lib/seabed/scene/terrain-material";
import type { WaterSurfaceOptions } from "@/lib/seabed/scene/water-surface";
import type { Result } from "@/lib/result";
import type { KelvinWakeShape } from "@/lib/ships/kelvin-wake";

// The seam between the 3D replay's scene code and the renderer that draws it. The scene (overview.ts, close-up.ts, the
// ships) is built from plain three.js objects; the few materials with custom shading come from a kit, because WebGL
// takes them as GLSL patches (onBeforeCompile, ShaderMaterial) and WebGPU only as TSL node materials. The WebGL kit is
// src/lib/render/webgl-scene-renderer.ts; the WebGPU tier's kit and renderer live in src/lib/render/webgpu/ and load
// only when that tier is chosen, so the other tiers never download them.

/** Exposure of the Neutral tone mapping every tier applies to lit materials (data lines and the terrain opt out). */
export const SCENE_EXPOSURE = 1.02;

/** The tier the replay draws on: WebGPU on a real GPU adapter, else WebGL on a GPU (`hardware`) or on the CPU. */
export type RenderTierName = "webgpu" | RendererKind;

/** A line drawn a fixed number of pixels wide (the track, the furrow, the overview's anchor chain). */
export type ScreenLineOptions = {
  /** Device pixels. */
  widthPx: number;
  /** One colour for the line, or white when `hasVertexColors` (the geometry then carries a colour per point). */
  color: string;
  hasVertexColors: boolean;
  opacity: number;
};

/** The water surface's material and the replay clock its waves follow. */
export type WaterSurfaceMaterial = { material: THREE.Material; setWaveTime: (seconds: number) => void };

/** The Kelvin wake patch's material and the wave its ship's speed sets (wavenumber in rad/m, amplitude in m). */
export type KelvinWakeMaterial = { material: THREE.Material; setWave: (wavenumber: number, amplitudeMetres: number) => void };

/** Caustic light on the close-up's seabed: one clock per viewer, and seabed materials that carry the light. */
export type Caustics = {
  setTime: (seconds: number) => void;
  createMaterial: (parameters: THREE.MeshStandardMaterialParameters, strength: number) => THREE.Material;
};

/** Soft round particles (sediment) of one world size, smaller with distance, see-through and never writing depth. */
export type SoftPointsOptions = { map: THREE.Texture; color: string; size: number; opacity: number };

/**
 * A cloud of soft particles: the caller writes each particle's position (x, y, z) into `positions`, then calls
 * `markMoved` so the next frame draws them there.
 */
export type SoftPoints = { object: THREE.Object3D; positions: Float32Array; markMoved: () => void };

/** The fog a scene switches between per camera: the haze above the surface, the water column below it. */
export type SceneFogSwitch = { setUnderwater: (isUnderwater: boolean) => void };

export type SceneMaterialKit = {
  /** The studio room's reflections (three.js RoomEnvironment, prefiltered) for the scene's metal and glass. */
  createEnvironment: () => THREE.Texture;
  createTerrainMaterial: (lighting: TerrainLighting, rippleNormalMap: THREE.Texture | null) => THREE.Material;
  /** The sea's surface (water-surface.ts, WaterSurfaceOptions): waves or flat, body colour, sky, the sun's glints. */
  createWaterSurfaceMaterial: (options: WaterSurfaceOptions) => WaterSurfaceMaterial;
  /**
   * A data-coloured tube material (exact colour, drawn after the water; src/lib/render/data-colors.ts) that narrows
   * its tube with camera distance (tube-thinning.ts). Only for TubeGeometry built with `radiusKm`.
   */
  createThinnedDataTubeMaterial: (options: { hex: string; radiusKm: number; fullWidthDistanceKm: number; opacity?: number; depthWrite?: boolean }) => THREE.Material;
  /** A fixed-pixel-width line on `geometry`; data colours stay exact when the caller passes the line through keepDataColorExact. */
  createScreenLine: (geometry: LineGeometry, options: ScreenLineOptions) => THREE.Mesh;
  createKelvinWakeMaterial: (shape: KelvinWakeShape) => KelvinWakeMaterial;
  createCaustics: () => Caustics;
  /**
   * `count` soft particles. WebGL draws them as points; WebGPU draws every point 1 px wide whatever its size, so its
   * kit draws them as instanced sprites of the same size.
   */
  createSoftPoints: (count: number, options: SoftPointsOptions) => SoftPoints;
  /**
   * Fogs `scene` with `aboveWater` (or none) above the surface and `underwater` below it, switched per camera (the
   * anchor cam draws the same scene from under the surface). WebGL swaps scene.fog: its programs for both fogs stay
   * cached. WebGPU keeps one fog node and moves a uniform: there a different fog changes every material's cache key,
   * and swapping fogs rebuilt every shader twice each time the anchor cam drew (2 to 4 fps on Windows Chrome,
   * scripts/perf/windows-frame-pacing.ts, 21 Oct 2026).
   */
  createFogSwitch: (scene: THREE.Scene, aboveWater: THREE.Fog | null, underwater: THREE.FogExp2) => SceneFogSwitch;
};

/** The drawing backend of the 3D replay: one canvas, one renderer, the kit that matches it. */
/** A second picture of the scene in a canvas of its own (SceneRenderer.openSecondPicture). */
export type SecondPicture = {
  /**
   * Where it goes in a frame: WebGPU draws it after the stage (it reuses the stage's passes of that frame), WebGL
   * before (it borrows a corner of the stage's canvas, which the stage's frame then clears).
   */
  isDrawnAfterStage: boolean;
  /** Draws `scene` from `camera` (whose aspect the caller sets to the window's) at the window's size in CSS px. */
  draw: (scene: THREE.Scene, camera: THREE.PerspectiveCamera, widthPx: number, heightPx: number) => void;
  dispose: () => void;
};

export type SceneRenderer = {
  tier: RenderTierName;
  canvas: HTMLCanvasElement;
  kit: SceneMaterialKit;
  /** Largest anisotropic filtering the GPU offers, for the sand-ripple map. */
  maxAnisotropy: number;
  /** Device pixels per CSS pixel the canvas is drawn at. */
  readPixelRatio: () => number;
  /** Sizes the canvas in CSS px. */
  setSize: (widthPx: number, heightPx: number) => void;
  draw: (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void;
  /**
   * Opens a second picture of the scene in `canvas`, the anchor cam's window. WebGPU draws into that canvas directly
   * (three's CanvasTarget), through a scene pass sized to it that shares the stage pass's materials; WebGL draws into
   * a corner of its own canvas at the window's size and copies it out before the main frame. Either way the pass
   * costs the window's pixels, not the stage's, so the window can follow every frame.
   */
  openSecondPicture: (canvas: HTMLCanvasElement) => Result<SecondPicture>;
  /**
   * Compiles the materials under `objects` with `scene`'s lights and settings (hidden objects included when the caller
   * shows them while it is called: the walk happens at once). Resolves when every program can draw, the page free
   * between programs.
   */
  compile: (objects: THREE.Object3D, camera: THREE.PerspectiveCamera, scene: THREE.Scene) => Promise<void>;
  /** Frees the GPU resources and the context now, not at garbage collection. */
  dispose: () => void;
};
