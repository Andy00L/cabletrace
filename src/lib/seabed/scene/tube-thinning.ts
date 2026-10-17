import type * as THREE from "three";

// Seabed tubes are drawn far wider than the real cables so they read across the whole gulf. Next to the vessel
// that width would dwarf the ship, so each tube narrows as the camera comes closer, keeping its underside on
// the seabed. Full width from this camera distance (km) outward, down to this share of it up close.
const FULL_WIDTH_DISTANCE_KM = 60;
const MIN_WIDTH_SHARE = 0.12;

const THINNED_BEGIN_VERTEX = /* glsl */ `
vec3 tubeCentre = position - normal * tubeRadius;
float tubeCameraDistance = distance((modelMatrix * vec4(tubeCentre, 1.0)).xyz, cameraPosition);
float tubeWidthShare = clamp(tubeCameraDistance / ${FULL_WIDTH_DISTANCE_KM.toFixed(1)}, ${MIN_WIDTH_SHARE.toFixed(2)}, 1.0);
vec3 transformed = tubeCentre + normal * tubeRadius * tubeWidthShare - vec3(0.0, tubeRadius * (1.0 - tubeWidthShare), 0.0);
`;

/**
 * Makes `material` narrow its tube with camera distance. Only for TubeGeometry built with `radiusKm`: the shader
 * finds each vertex's centreline point from the tube's radial normal.
 */
export function thinTubeWithDistance<TMaterial extends THREE.Material>(material: TMaterial, radiusKm: number): TMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tubeRadius = { value: radiusKm };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float tubeRadius;")
      .replace("#include <begin_vertex>", THINNED_BEGIN_VERTEX);
  };
  material.customProgramCacheKey = () => "seabed-tube-thinning";
  return material;
}
