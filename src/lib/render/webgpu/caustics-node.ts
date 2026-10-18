import { abs, cos, float, positionWorld, pow, sin, uniform, vec2, vec3 } from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import type { Caustics } from "@/lib/render/scene-renderer";
import { CAUSTIC_TINT, CAUSTIC_WORLD_SCALE } from "@/lib/seabed/scene/caustics";

// Caustic light on the close-up's seabed for the WebGPU tier: the TSL port of src/lib/seabed/scene/caustics.ts (three
// warped layers of interfering waves), added as emitted light. One clock per viewer, as on WebGL.

const LAYER_COUNT = 3;

/** Brightness of the caustic pattern at a point at a time: thin bright lines where the warped waves cancel. */
function sampleCaustic(position: Node<"vec2">, time: Node<"float">): Node<"float"> {
  let warped: Node<"vec2"> = position;
  let brightness: Node<"float"> = float(0);
  for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
    const layerTime = time.mul(0.55 + 0.22 * layer);
    warped = warped.add(vec2(sin(warped.y.mul(1.7).add(layerTime)), cos(warped.x.mul(1.9).sub(layerTime))).mul(0.35));
    brightness = brightness.add(abs(sin(warped.x.mul(2.1).add(layerTime)).mul(cos(warped.y.mul(2.3).sub(layerTime)))));
  }
  return pow(float(1).sub(brightness.div(LAYER_COUNT)), float(6));
}

export function createCausticsNode(): Caustics {
  const time = uniform(0);
  return {
    setTime(seconds) {
      time.value = seconds;
    },
    createMaterial(parameters, strength) {
      const material = new MeshStandardNodeMaterial(parameters);
      material.emissiveNode = vec3(...CAUSTIC_TINT).mul(sampleCaustic(positionWorld.xz.mul(CAUSTIC_WORLD_SCALE), time)).mul(strength);
      return material;
    },
  };
}
