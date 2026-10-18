import type * as THREE from "three";
import { abs, attribute, diffuseColor, float, fract, fwidth, luminance, max, min, mix, output, select, smoothstep, uniform, vec4, vertexColor } from "three/tsl";
import { Color, MeshLambertNodeMaterial, type Node } from "three/webgpu";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import { TERRAIN_SHADING, type TerrainLighting } from "@/lib/seabed/scene/terrain-material";

// The overview terrain for the WebGPU tier: the TSL port of src/lib/seabed/scene/terrain-material.ts, same numbers
// (TERRAIN_SHADING). Each pixel is its depth or land token times the light it receives over the light level ground
// receives, times the baked relief occlusion; contour lines and the shoreline are drawn into the colour first. The
// difference from WebGL: the light it receives includes the tier's GTAO on the sky light (webgpu-scene-renderer.ts),
// so hollows and the foot of every slope darken a little more, while level open ground still shows its token exactly.
// three.js's TSL Lambert material takes no light from the scene's environment map, so the level reference is the sun
// and sky alone.

const RECIPROCAL_PI = 1 / Math.PI;
// Below this level light the shade ratio is not computed (a guard against dividing by zero on unlit ground).
const MIN_LEVEL_LUMINANCE = 1e-5;

/** 1 on a contour line every `stepMetres`, 0 between; about 1.2 px wide, gone where lines crowd or on level terraces. */
function readContour(elevationMetres: Node<"float">, stepMetres: number): Node<"float"> {
  const level = elevationMetres.div(stepMetres);
  const levelPerPixel = fwidth(level);
  const distanceToLine = abs(fract(level.add(0.5)).sub(0.5));
  const line = float(1).sub(smoothstep(float(0), levelPerPixel.mul(TERRAIN_SHADING.lineWidthPixels), distanceToLine));
  const crowdedFade = float(1).sub(smoothstep(float(TERRAIN_SHADING.crowdedFade[0]), float(TERRAIN_SHADING.crowdedFade[1]), levelPerPixel));
  const terraceFade = smoothstep(float(TERRAIN_SHADING.terraceFade[0]), float(TERRAIN_SHADING.terraceFade[1]), levelPerPixel);
  return line.mul(crowdedFade).mul(terraceFade);
}

/**
 * The terrain's node material. The geometry needs `elevation` (metres, negative under water), `reliefOcclusion` and
 * vertex colours holding the tokens, as for the WebGL material. Tone mapping stays off (the tier honours `toneMapped`).
 */
export function createTerrainNodeMaterial(lighting: TerrainLighting, rippleNormalMap: THREE.Texture | null): MeshLambertNodeMaterial {
  const material = new MeshLambertNodeMaterial();
  material.toneMapped = false;
  if (rippleNormalMap) {
    material.normalMap = rippleNormalMap;
    material.normalScale.set(TERRAIN_SHADING.rippleNormalScale, TERRAIN_SHADING.rippleNormalScale);
  }
  const elevation = attribute("elevation", "float");
  const reliefOcclusion = attribute("reliefOcclusion", "float");
  const contourColor = select(elevation.greaterThanEqual(0), uniform(new Color(SCENE_COLORS.landContour)), uniform(new Color(SCENE_COLORS.seabedContour)));
  const contourWeight = max(readContour(elevation, TERRAIN_SHADING.minorStepMetres).mul(TERRAIN_SHADING.minorLineWeight), readContour(elevation, TERRAIN_SHADING.majorStepMetres).mul(TERRAIN_SHADING.majorLineWeight));
  const contoured = mix(vertexColor().rgb, contourColor, contourWeight);
  const elevationPerPixel = fwidth(elevation);
  const shoreline = float(1)
    .sub(smoothstep(float(0), elevationPerPixel.mul(TERRAIN_SHADING.shorelineWidthPixels), abs(elevation)))
    .mul(smoothstep(float(TERRAIN_SHADING.shorelineFade[0]), float(TERRAIN_SHADING.shorelineFade[1]), elevationPerPixel));
  material.colorNode = mix(contoured, uniform(new Color(SCENE_COLORS.shoreline)), shoreline.mul(TERRAIN_SHADING.shorelineWeight));
  // The lit result over what level ground receives (both carry the albedo and 1 / pi, which cancel), held to a tint
  // of the token, times the baked occlusion.
  const levelLight = diffuseColor.rgb.mul(uniform(lighting.levelIrradiance)).mul(RECIPROCAL_PI);
  const reliefShade = luminance(output.rgb).div(max(luminance(levelLight), MIN_LEVEL_LUMINANCE));
  material.outputNode = vec4(diffuseColor.rgb.mul(min(reliefShade, TERRAIN_SHADING.maxReliefBrightening)).mul(reliefOcclusion), output.a);
  return material;
}
