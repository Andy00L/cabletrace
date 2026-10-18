import type * as THREE from "three";
import type { LineGeometry } from "three/addons/lines/LineGeometry.js";
import type { RendererKind } from "@/lib/diagnostics/webgl-renderer";
import type { TerrainLighting } from "@/lib/seabed/scene/terrain-material";
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

export type SceneMaterialKit = {
  /** The studio room's reflections (three.js RoomEnvironment, prefiltered) for the scene's metal and glass. */
  createEnvironment: () => THREE.Texture;
  createTerrainMaterial: (lighting: TerrainLighting, rippleNormalMap: THREE.Texture | null) => THREE.Material;
  /** `hasWaves`: Gerstner waves (the GPU tiers) or a flat surface; `sun`: the light its glints reflect. */
  createWaterSurfaceMaterial: (options: { hasWaves: boolean; sun: THREE.DirectionalLight }) => WaterSurfaceMaterial;
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
};

/** The drawing backend of the 3D replay: one canvas, one renderer, the kit that matches it. */
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
  /** Compiles the scene's materials before its first frame, hidden objects included when the caller shows them. */
  compile: (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => Promise<void>;
  /** Frees the GPU resources and the context now, not at garbage collection. */
  dispose: () => void;
};
