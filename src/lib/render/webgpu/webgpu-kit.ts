import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Line2 } from "three/addons/lines/webgpu/Line2.js";
import { densityFogFactor, float, fog, instancedBufferAttribute, mix, rangeFogFactor, reference, renderGroup, uniform } from "three/tsl";
import { Color, InstancedBufferAttribute, Line2NodeMaterial, PMREMGenerator, PointsNodeMaterial, Sprite, type Fog, type FogExp2, type NodeBuilder, type Scene, type WebGPURenderer } from "three/webgpu";
import type { SceneFogSwitch, SceneMaterialKit, SoftPoints, SoftPointsOptions } from "@/lib/render/scene-renderer";
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

/**
 * A fat line of opacity 1 that the caller still marks transparent, only so it sorts after the water
 * (src/lib/render/data-colors.ts). three's Line2NodeMaterial draws without blending and, when transparent, mixes its
 * colour in its shader over a mipmapped copy of the opaque frame (viewportOpaqueMipTexture; sourceRef:
 * node_modules/three/src/materials/nodes/Line2NodeMaterial.js, setupDiffuseColor). At opacity 1 with alpha-to-coverage
 * off that mix is rgb * 1 + copy * 0, the line's own colour, yet each render call that drew such a line copied its
 * frame and built the copy's mipmaps, and the anchor cam's pass swapped the copy every material reads. Measured on
 * Windows Chrome (Eagle S, Vessel view, anchor cam open, 22 Oct 2026): the GPU process spent 13.8 ms a frame on WebGPU
 * commands against 5.3 ms without the anchor cam; hiding only the cam's fat lines brought it to 7.3 ms. This material
 * builds the shader as for an opaque line, so the copy is never made; the pixels are the same. The shader is built
 * once, so it holds only for lines whose opacity stays 1 (no caller changes a screen line's opacity after making it).
 */
class OpaqueScreenLineNodeMaterial extends Line2NodeMaterial {
  setupDiffuseColor(builder: NodeBuilder) {
    const isTransparent = this.transparent;
    this.transparent = false;
    super.setupDiffuseColor(builder);
    this.transparent = isTransparent;
  }
}

/**
 * One fog node for both fogs, blended by an "underwater" uniform: the colour and the factor of the range fog above
 * the surface and of the density fog below it, read from the two fog objects every draw (reference nodes). The scene
 * keeps no scene.fog, so its fog node never changes.
 * sourceRef: node_modules/three/src/renderers/common/nodes/NodeManager.js (updateFog, getFogNode reads scene.fogNode).
 */
function createFogNodeSwitch(scene: Scene, aboveWater: Fog | null, underwater: FogExp2): SceneFogSwitch {
  const underwaterShare = uniform(0).setGroup(renderGroup);
  const underwaterColor = reference("color", "color", underwater);
  const underwaterFactor = densityFogFactor(reference("density", "float", underwater));
  const aboveColor = aboveWater ? reference("color", "color", aboveWater) : underwaterColor;
  const aboveFactor = aboveWater ? rangeFogFactor(reference("near", "float", aboveWater), reference("far", "float", aboveWater)) : float(0);
  scene.fog = null;
  // three.js's Scene type does not declare the WebGPU renderer's fogNode.
  Reflect.set(scene, "fogNode", fog(mix(aboveColor, underwaterColor, underwaterShare), mix(aboveFactor, underwaterFactor, underwaterShare)));
  return {
    setUnderwater(isUnderwater) {
      underwaterShare.value = isUnderwater ? 1 : 0;
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
    createScreenLine: (geometry, { color, widthPx, hasVertexColors, opacity }) => {
      const parameters = { color: new Color(color), linewidth: widthPx, vertexColors: hasVertexColors, opacity, transparent: opacity < 1, worldUnits: false, alphaToCoverage: false };
      return new Line2(geometry, opacity >= 1 ? new OpaqueScreenLineNodeMaterial(parameters) : new Line2NodeMaterial(parameters));
    },
    createKelvinWakeMaterial: createKelvinWakeNodeMaterial,
    createCaustics: createCausticsNode,
    createSoftPoints: createSoftPointSprites,
    createFogSwitch: createFogNodeSwitch,
  };
}
