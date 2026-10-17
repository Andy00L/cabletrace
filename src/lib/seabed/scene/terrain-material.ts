import * as THREE from "three";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";

// Contour lines drawn on the overview terrain, in metres of real elevation: every 10 m with a stronger line
// every 50 m, on the seabed and on land, and the shoreline at 0 m. Lines keep a constant on-screen width and
// fade out where the slope packs them closer than a few pixels.
const MINOR_STEP_METRES = 10;
const MAJOR_STEP_METRES = 50;

const VERTEX_DECLARATIONS = /* glsl */ `
attribute float elevation;
varying float vElevation;
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
varying float vElevation;
uniform vec3 seabedContourColor;
uniform vec3 landContourColor;
uniform vec3 shorelineColor;

// 1 on a contour line every stepMetres, 0 between; about 1.2 px wide, gone where lines crowd.
float readContour(float elevationMetres, float stepMetres) {
  float level = elevationMetres / stepMetres;
  float levelPerPixel = fwidth(level);
  float distanceToLine = abs(fract(level + 0.5) - 0.5);
  float line = 1.0 - smoothstep(0.0, levelPerPixel * 1.2, distanceToLine);
  return line * (1.0 - smoothstep(0.12, 0.3, levelPerPixel));
}
`;

const FRAGMENT_CONTOURS = /* glsl */ `
bool isLand = vElevation >= 0.0;
float minorLine = readContour(vElevation, ${MINOR_STEP_METRES.toFixed(1)});
float majorLine = readContour(vElevation, ${MAJOR_STEP_METRES.toFixed(1)});
diffuseColor.rgb = mix(diffuseColor.rgb, isLand ? landContourColor : seabedContourColor, max(minorLine * 0.2, majorLine * 0.42));
float shoreline = 1.0 - smoothstep(0.0, fwidth(vElevation) * 1.4, abs(vElevation));
diffuseColor.rgb = mix(diffuseColor.rgb, shorelineColor, shoreline * 0.6);
`;

/**
 * The overview terrain's lit material with contour lines. The geometry needs a per-vertex `elevation`
 * attribute holding the real elevation in metres (negative under water).
 */
export function createTerrainMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.seabedContourColor = { value: new THREE.Color(SCENE_COLORS.seabedContour) };
    shader.uniforms.landContourColor = { value: new THREE.Color(SCENE_COLORS.landContour) };
    shader.uniforms.shorelineColor = { value: new THREE.Color(SCENE_COLORS.shoreline) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvElevation = elevation;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${FRAGMENT_CONTOURS}`);
  };
  material.customProgramCacheKey = () => "seabed-terrain-contours";
  return material;
}
