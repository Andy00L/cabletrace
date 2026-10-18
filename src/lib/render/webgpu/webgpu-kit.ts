import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Line2 } from "three/addons/lines/webgpu/Line2.js";
import { instancedBufferAttribute } from "three/tsl";
import { Color, InstancedBufferAttribute, Line2NodeMaterial, PMREMGenerator, PointsNodeMaterial, Sprite, type WebGPURenderer } from "three/webgpu";
import type { SceneMaterialKit, SoftPoints, SoftPointsOptions } from "@/lib/render/scene-renderer";
import { createCausticsNode } from "@/lib/render/webgpu/caustics-node";
import { createKelvinWakeNodeMaterial } from "@/lib/render/webgpu/kelvin-wake-node-material";
import { createTerrainNodeMaterial } from "@/lib/render/webgpu/terrain-node-material";
import { createThinnedDataTubeNodeMaterial } from "@/lib/render/webgpu/tube-node-material";
import { createWaterSurfaceNodeMaterial } from "@/lib/render/webgpu/water-node-material";

// The scene's custom materials as TSL node materials, for the WebGPU tier (src/lib/render/scene-renderer.ts says why
// there are two kits). Built-in materials (hulls, block sides, labels' anchors) need nothing here: WebGPURenderer turns
// them into their node versions itself.

/**
 * Soft particles as one instanced sprite per particle: WebGPU draws a point primitive 1 px wide whatever its size, so
 * a THREE.Points cloud of sediment would shrink to specks. PointsNodeMaterial sizes each sprite as WebGL sizes a point
 * (size times half the canvas height over the distance). Blended like WebGL's points, not alpha-to-coverage, which
 * would dither a 30% opaque dot under MSAA.
 */
function createSoftPointSprites(count: number, { map, color, size, opacity }: SoftPointsOptions): SoftPoints {
  const positions = new Float32Array(count * 3);
  const positionAttribute = new InstancedBufferAttribute(positions, 3);
  const material = new PointsNodeMaterial({ map, color: new Color(color), size, transparent: true, opacity, depthWrite: false, sizeAttenuation: true, alphaToCoverage: false });
  material.positionNode = instancedBufferAttribute(positionAttribute);
  const sprites = new Sprite(material);
  sprites.count = count;
  // The particles move every frame; one sprite's bounds say nothing about where the others are.
  sprites.frustumCulled = false;
  return {
    object: sprites,
    positions,
    markMoved() {
      positionAttribute.needsUpdate = true;
    },
  };
}

export function createWebGpuKit(renderer: WebGPURenderer): SceneMaterialKit {
  return {
    createEnvironment() {
      const environmentGenerator = new PMREMGenerator(renderer);
      const environment = environmentGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
      environmentGenerator.dispose();
      return environment;
    },
    createTerrainMaterial: createTerrainNodeMaterial,
    createWaterSurfaceMaterial: createWaterSurfaceNodeMaterial,
    createThinnedDataTubeMaterial: createThinnedDataTubeNodeMaterial,
    // Hard-edged like WebGL's LineMaterial: the node material's default alpha-to-coverage feathers a 2 px line until no
    // pixel holds its exact colour, and dithers it under MSAA.
    createScreenLine: (geometry, { color, widthPx, hasVertexColors, opacity }) =>
      new Line2(geometry, new Line2NodeMaterial({ color: new Color(color), linewidth: widthPx, vertexColors: hasVertexColors, opacity, transparent: opacity < 1, worldUnits: false, alphaToCoverage: false })),
    createKelvinWakeMaterial: createKelvinWakeNodeMaterial,
    createCaustics: createCausticsNode,
    createSoftPoints: createSoftPointSprites,
  };
}
