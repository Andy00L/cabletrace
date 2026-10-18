import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Line2 } from "three/addons/lines/webgpu/Line2.js";
import { Color, Line2NodeMaterial, PMREMGenerator, type WebGPURenderer } from "three/webgpu";
import type { SceneMaterialKit } from "@/lib/render/scene-renderer";
import { createCausticsNode } from "@/lib/render/webgpu/caustics-node";
import { createKelvinWakeNodeMaterial } from "@/lib/render/webgpu/kelvin-wake-node-material";
import { createTerrainNodeMaterial } from "@/lib/render/webgpu/terrain-node-material";
import { createThinnedDataTubeNodeMaterial } from "@/lib/render/webgpu/tube-node-material";
import { createWaterSurfaceNodeMaterial } from "@/lib/render/webgpu/water-node-material";

// The scene's custom materials as TSL node materials, for the WebGPU tier (src/lib/render/scene-renderer.ts says why
// there are two kits). Built-in materials (hulls, block sides, labels' anchors) need nothing here: WebGPURenderer turns
// them into their node versions itself.

export function createWebGpuKit(renderer: WebGPURenderer): SceneMaterialKit {
  return {
    createEnvironment() {
      const environmentGenerator = new PMREMGenerator(renderer);
      const environment = environmentGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
      environmentGenerator.dispose();
      return environment;
    },
    createTerrainMaterial: createTerrainNodeMaterial,
    createWaterSurfaceMaterial: ({ hasWaves, sun }) => createWaterSurfaceNodeMaterial(hasWaves, sun),
    createThinnedDataTubeMaterial: createThinnedDataTubeNodeMaterial,
    // Hard-edged like WebGL's LineMaterial: the node material's default alpha-to-coverage feathers a 2 px line until no
    // pixel holds its exact colour, and dithers it under MSAA.
    createScreenLine: (geometry, { color, widthPx, hasVertexColors, opacity }) =>
      new Line2(geometry, new Line2NodeMaterial({ color: new Color(color), linewidth: widthPx, vertexColors: hasVertexColors, opacity, transparent: opacity < 1, worldUnits: false, alphaToCoverage: false })),
    createKelvinWakeMaterial: createKelvinWakeNodeMaterial,
    createCaustics: createCausticsNode,
  };
}
