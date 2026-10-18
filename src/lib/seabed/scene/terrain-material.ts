import * as THREE from "three";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";

// The overview terrain's material: relief shading on colours that are already the map's tokens.
//
// The vertex colours are what the seabed looks like through the water at that depth (the depth tokens of
// docs/UI_DESIGN_SYSTEM.md, Map: light absorbed with depth ends in exactly those tones) and the land tokens on land. The
// lights then only shade the relief: each pixel is its token times the light it receives over the light a level
// surface receives, so level ground shows its token exactly, slopes facing the north-west sun are lighter, slopes
// facing away and ground in a ridge's shadow are darker, and a baked ambient occlusion darkens hollows and valley
// floors. Tone mapping is off for this material, so the tokens are not shifted by the renderer's tone curve.
//
// On top: contour lines every 10 m with a stronger line every 50 m and the shoreline at 0 m (constant on-screen width,
// fading where the slope packs them closer than a few pixels), and on the GPU tier a sand-ripple detail normal map.

/**
 * The numbers of the terrain's shading, shared by this GLSL material (WebGL tiers) and its TSL port for the WebGPU tier
 * (src/lib/render/webgpu/terrain-node-material.ts), so both draw the same contours and the same relief shade.
 */
export const TERRAIN_SHADING = {
  minorStepMetres: 10,
  majorStepMetres: 50,
  /** How far each contour line pulls the colour toward its contour tone. */
  minorLineWeight: 0.2,
  majorLineWeight: 0.42,
  /** Line half width in levels per pixel (about 1.2 px), and the bands that fade crowded lines and level terraces. */
  lineWidthPixels: 1.2,
  crowdedFade: [0.12, 0.3],
  terraceFade: [0.002, 0.01],
  /** The shoreline at 0 m: width in pixels, the slope band that fades it, and its weight. */
  shorelineWidthPixels: 1.4,
  shorelineFade: [0.02, 0.1],
  shorelineWeight: 0.6,
  /** A sunlit slope may be this much brighter than level ground: a tint of its band, never clipped to white. */
  maxReliefBrightening: 1.08,
  /** Strength of the sand-ripple detail normal map. */
  rippleNormalScale: 0.35,
} as const;

const SHADING = TERRAIN_SHADING;

const VERTEX_DECLARATIONS = /* glsl */ `
attribute float elevation;
attribute float reliefOcclusion;
varying float vElevation;
varying float vReliefOcclusion;
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
varying float vElevation;
varying float vReliefOcclusion;
uniform vec3 seabedContourColor;
uniform vec3 landContourColor;
uniform vec3 shorelineColor;
uniform vec3 levelIrradiance;

// 1 on a contour line every stepMetres, 0 between; about 1.2 px wide, gone where lines crowd. A terrace that lies
// exactly on a contour level (GEBCO areas store whole metres, so a flat at -40 m is a flat at a line) has no line to
// draw: there the level barely changes across a pixel and rounding would sprinkle the whole terrace with dots.
float readContour(float elevationMetres, float stepMetres) {
  float level = elevationMetres / stepMetres;
  float levelPerPixel = fwidth(level);
  float distanceToLine = abs(fract(level + 0.5) - 0.5);
  float line = 1.0 - smoothstep(0.0, levelPerPixel * ${SHADING.lineWidthPixels.toFixed(1)}, distanceToLine);
  return line * (1.0 - smoothstep(${SHADING.crowdedFade[0].toFixed(2)}, ${SHADING.crowdedFade[1].toFixed(1)}, levelPerPixel)) * smoothstep(${SHADING.terraceFade[0].toFixed(3)}, ${SHADING.terraceFade[1].toFixed(2)}, levelPerPixel);
}
`;

const FRAGMENT_CONTOURS = /* glsl */ `
bool isLand = vElevation >= 0.0;
float minorLine = readContour(vElevation, ${SHADING.minorStepMetres.toFixed(1)});
float majorLine = readContour(vElevation, ${SHADING.majorStepMetres.toFixed(1)});
diffuseColor.rgb = mix(diffuseColor.rgb, isLand ? landContourColor : seabedContourColor, max(minorLine * ${SHADING.minorLineWeight.toFixed(1)}, majorLine * ${SHADING.majorLineWeight.toFixed(2)}));
float shoreline = (1.0 - smoothstep(0.0, fwidth(vElevation) * ${SHADING.shorelineWidthPixels.toFixed(1)}, abs(vElevation))) * smoothstep(${SHADING.shorelineFade[0].toFixed(2)}, ${SHADING.shorelineFade[1].toFixed(1)}, fwidth(vElevation));
diffuseColor.rgb = mix(diffuseColor.rgb, shorelineColor, shoreline * ${SHADING.shorelineWeight.toFixed(1)});
`;

// Replaces the Lambert sum: the token times the light here over the light on level ground (both include 1 / pi and
// the albedo, which cancel), times the baked occlusion. Brighter than level ground is held to 8% over the token so
// a sunlit slope stays a tint of its band and the light tokens never clip to white. three.js r186 also lights Lambert
// materials with the scene's environment map (lights_fragment_end adds its irradiance), so the level reference adds
// what that map gives a level surface; without it level ground came out 4 levels over its token.
const FRAGMENT_RELIEF_SHADE = /* glsl */ `
const float MAX_RELIEF_BRIGHTENING = ${SHADING.maxReliefBrightening.toFixed(2)};
vec3 receivedLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
vec3 levelReference = levelIrradiance;
#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
levelReference += getIBLIrradiance(normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
#endif
vec3 levelLight = diffuseColor.rgb * levelReference * RECIPROCAL_PI;
float reliefShade = dot(receivedLight, vec3(0.2126, 0.7152, 0.0722)) / max(dot(levelLight, vec3(0.2126, 0.7152, 0.0722)), 1e-5);
vec3 outgoingLight = diffuseColor.rgb * min(reliefShade, MAX_RELIEF_BRIGHTENING) * vReliefOcclusion;
`;

export type TerrainLighting = {
  /** Irradiance a level surface receives from the lights (sun times the cosine of its elevation, plus the sky). */
  levelIrradiance: THREE.Color;
  /**
   * The scene's environment map and intensity. The GLSL material gets them from three.js's own lighting; the WebGPU
   * tier's TSL Lambert material takes no environment light, so its port adds this term itself.
   */
  environment: { texture: THREE.Texture | null; intensity: number };
};

/** What a level surface receives from a directional sun and a hemisphere sky (three.js light units, linear). */
export function measureLevelIrradiance(sun: THREE.DirectionalLight, sky: THREE.HemisphereLight): THREE.Color {
  const sunElevationCosine = Math.max(0, sun.position.clone().normalize().y);
  return sun.color.clone().multiplyScalar(sun.intensity * sunElevationCosine).add(sky.color.clone().multiplyScalar(sky.intensity));
}

/**
 * The overview terrain's material. The geometry needs `elevation` (real metres, negative under water) and
 * `reliefOcclusion` (1 open, lower in hollows) per vertex, vertex colours holding the tokens, and UVs for the detail map.
 */
export function createTerrainMaterial(lighting: TerrainLighting, rippleNormalMap: THREE.Texture | null): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.toneMapped = false;
  if (rippleNormalMap) {
    material.normalMap = rippleNormalMap;
    material.normalScale.set(SHADING.rippleNormalScale, SHADING.rippleNormalScale);
  }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.seabedContourColor = { value: new THREE.Color(SCENE_COLORS.seabedContour) };
    shader.uniforms.landContourColor = { value: new THREE.Color(SCENE_COLORS.landContour) };
    shader.uniforms.shorelineColor = { value: new THREE.Color(SCENE_COLORS.shoreline) };
    shader.uniforms.levelIrradiance = { value: lighting.levelIrradiance };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvElevation = elevation;\nvReliefOcclusion = reliefOcclusion;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${FRAGMENT_CONTOURS}`)
      .replace("vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;", FRAGMENT_RELIEF_SHADE);
  };
  material.customProgramCacheKey = () => `seabed-terrain-relief-${rippleNormalMap ? "ripples" : "plain"}`;
  return material;
}
