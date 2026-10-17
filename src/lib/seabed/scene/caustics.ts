import type * as THREE from "three";

// Animated caustic light on the seabed, injected into a standard material's shader. One uniform per viewer,
// so two viewers on a page never share a clock.

const CAUSTIC_GLSL = `
uniform float causticTime;
varying vec3 vCausticWorld;
float sampleCaustic(vec2 position, float time) {
  vec2 warped = position;
  float brightness = 0.0;
  for (int layer = 0; layer < 3; layer++) {
    float layerTime = time * (0.55 + 0.22 * float(layer));
    warped += vec2(sin(warped.y * 1.7 + layerTime), cos(warped.x * 1.9 - layerTime)) * 0.35;
    brightness += abs(sin(warped.x * 2.1 + layerTime) * cos(warped.y * 2.3 - layerTime));
  }
  brightness /= 3.0;
  return pow(1.0 - brightness, 6.0);
}`;

export type Caustics = {
  uniform: { value: number };
  apply: <MaterialType extends THREE.MeshStandardMaterial>(material: MaterialType, strength: number) => MaterialType;
};

export function createCaustics(): Caustics {
  const uniform = { value: 0 };
  return {
    uniform,
    apply(material, strength) {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.causticTime = uniform;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vCausticWorld;")
          .replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvec4 causticPosition = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\ncausticPosition = instanceMatrix * causticPosition;\n#endif\nvCausticWorld = (modelMatrix * causticPosition).xyz;",
          );
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", `#include <common>\n${CAUSTIC_GLSL}`)
          .replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.82, 0.93, 1.0) * sampleCaustic(vCausticWorld.xz * 0.11, causticTime) * ${strength.toFixed(3)};`,
          );
      };
      return material;
    },
  };
}
