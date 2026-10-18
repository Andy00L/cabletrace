import { cameraPosition, cameraViewMatrix, clamp, cos, equirectUV, exp, float, fwidth, max, mix, normalize, positionViewDirection, positionWorld, pow, reflect, sin, smoothstep, sqrt, texture, uniform, vec2, vec3, vec4 } from "three/tsl";
import { Color, MeshBasicNodeMaterial, Vector3, type Node } from "three/webgpu";
import type { WaterSurfaceMaterial } from "@/lib/render/scene-renderer";
import { decodeSrgb, encodeSrgb } from "@/lib/render/webgpu/srgb-nodes";
import { DEPTH_MAP_MAX_METRES, METRES_PER_KM, readGerstnerTerms, SKY_MEAN_LUMINANCE, SKY_STRUCTURE_WEIGHT, WATER_ABSORPTION, WATER_BASE_REFLECTANCE, WAVE_DETAIL_FADE, type WaterSurfaceOptions } from "@/lib/seabed/scene/water-surface";

// The water surface for the WebGPU tier: the TSL port of src/lib/seabed/scene/water-surface.ts, from the same numbers:
// the body colour absorbed along the path through the water (fading out as the camera climbs), the HDRI sky's
// reflection weighted by Fresnel, and the sun's glints off the Gerstner swell and chop that follow the replay's clock.
// The glint is the GGX specular three.js's standard material gives the WebGL surface (roughness 0.06, a dielectric's
// 4%), written out here so the surface needs no lighting pass of its own.

const SURFACE_ROUGHNESS = 0.06;
// A dielectric's reflectance at normal incidence as three.js's standard material sets it (specular colour 0.04).
const GLINT_BASE_REFLECTANCE = 0.04;

/** A hex colour as linear RGB in a vector (TSL's colour uniforms do not type as vec3). */
function readLinearVector(hex: string): Vector3 {
  const color = new Color(hex);
  return new Vector3(color.r, color.g, color.b);
}

/** Gerstner surface normal (Tessendorf 2001, section 3.1, differentiated) at a point in metres, in world space. */
function readGerstnerNormal(pointMetres: Node<"vec2">, waveTimeSeconds: Node<"float">): Node<"vec3"> {
  let normalX: Node<"float"> = float(0);
  let normalY: Node<"float"> = float(1);
  let normalZ: Node<"float"> = float(0);
  for (const term of readGerstnerTerms()) {
    const phase = vec2(term.directionX, term.directionZ).dot(pointMetres).mul(term.wavenumber).sub(waveTimeSeconds.mul(term.angularSpeed));
    // A wave fades out where a pixel spans more than half its wavelength, instead of turning into moire.
    const slope = float(1).sub(smoothstep(float(WAVE_DETAIL_FADE[0]), float(WAVE_DETAIL_FADE[1]), fwidth(phase))).mul(term.slope);
    normalX = normalX.sub(slope.mul(cos(phase)).mul(term.directionX));
    normalZ = normalZ.sub(slope.mul(cos(phase)).mul(term.directionZ));
    normalY = normalY.sub(slope.mul(sin(phase)).mul(term.steepness));
  }
  return normalize(vec3(normalX, normalY, normalZ));
}

/**
 * The sun's specular glint off a surface with view-space normal `normal` (three.js's BRDF_GGX: GGX distribution,
 * correlated Smith visibility, Schlick Fresnel), times the sun's irradiance on it.
 */
function readSunGlint(normal: Node<"vec3">, sunDirection: Node<"vec3">, sunIrradiance: Node<"vec3">): Node<"vec3"> {
  const viewDirection = positionViewDirection;
  const halfDirection = normalize(sunDirection.add(viewDirection));
  const lightDot = clamp(normal.dot(sunDirection), float(0), float(1));
  const viewDot = clamp(normal.dot(viewDirection), float(0), float(1));
  const halfDot = clamp(normal.dot(halfDirection), float(0), float(1));
  const viewHalfDot = clamp(viewDirection.dot(halfDirection), float(0), float(1));
  const alphaSquared = SURFACE_ROUGHNESS ** 4;
  const distributionDenominator = halfDot.mul(halfDot).mul(alphaSquared - 1).add(1);
  const distribution = float(alphaSquared / Math.PI).div(distributionDenominator.mul(distributionDenominator));
  const lightTerm = viewDot.mul(sqrt(lightDot.mul(lightDot).mul(1 - alphaSquared).add(alphaSquared)));
  const viewTerm = lightDot.mul(sqrt(viewDot.mul(viewDot).mul(1 - alphaSquared).add(alphaSquared)));
  const visibility = float(0.5).div(max(lightTerm.add(viewTerm), float(1e-6)));
  const fresnel = pow(float(1).sub(viewHalfDot), float(5)).mul(1 - GLINT_BASE_REFLECTANCE).add(GLINT_BASE_REFLECTANCE);
  return sunIrradiance.mul(lightDot.mul(distribution).mul(visibility).mul(fresnel));
}

/**
 * The surface's material: drawn premultiplied over the seabed, outside tone mapping as on the WebGL tiers. The sun is
 * read from `options.sun` (the WebGL material takes it from the scene's lights instead).
 */
export function createWaterSurfaceNodeMaterial(options: WaterSurfaceOptions): WaterSurfaceMaterial {
  const { hasWaves, sun, look, sky, depthMap } = options;
  const waveTime = uniform(0);
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.premultipliedAlpha = true;
  material.toneMapped = false;
  const worldNormal = hasWaves ? readGerstnerNormal(positionWorld.xz.mul(METRES_PER_KM), waveTime) : vec3(0, 1, 0);
  const viewNormal = normalize(cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz);
  // The sun shines from its position toward its target (the origin).
  const sunWorldDirection = uniform(new Vector3().copy(sun.position).sub(sun.target.position).normalize());
  const sunViewDirection = normalize(cameraViewMatrix.mul(vec4(sunWorldDirection, 0)).xyz);
  // Linear RGB of the sun's colour times its intensity, as a vector so the glint can scale it.
  const sunIrradiance = uniform(new Vector3(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.intensity));
  const toEye = normalize(cameraPosition.sub(positionWorld));
  const facing = clamp(worldNormal.dot(toEye), float(0), float(1));
  const reflectance = pow(float(1).sub(facing), float(5)).mul(1 - WATER_BASE_REFLECTANCE).add(WATER_BASE_REFLECTANCE);
  // The sky: the look's colour, its brightness following the HDRI's clouds.
  const skyColor = uniform(readLinearVector(look.sky));
  let skyReflection: Node<"vec3"> = skyColor;
  if (sky) {
    const reflected = reflect(toEye.negate(), worldNormal);
    const upward = normalize(vec3(reflected.x, max(reflected.y, float(0.02)), reflected.z));
    const structure = texture(sky, equirectUV(upward)).rgb.dot(vec3(0.2126, 0.7152, 0.0722)).div(SKY_MEAN_LUMINANCE);
    skyReflection = skyColor.mul(mix(float(1), clamp(structure, float(0.35), float(2.4)), SKY_STRUCTURE_WEIGHT));
  }
  // The body colour: the share of the seabed's light the water replaces on the way to the eye.
  const depthUv = positionWorld.xz.sub(vec2(depthMap.minX, depthMap.minZ)).div(vec2(depthMap.sizeX, depthMap.sizeZ));
  const depthMetres = texture(depthMap.texture, depthUv).r.mul(DEPTH_MAP_MAX_METRES);
  const pathFactor = float(1).add(float(1).div(max(facing, float(WATER_ABSORPTION.minFacing))));
  const gate = float(1).sub(smoothstep(float(WATER_ABSORPTION.fadeHeightKm[0]), float(WATER_ABSORPTION.fadeHeightKm[1]), cameraPosition.y));
  const absorbed = gate.mul(float(1).sub(exp(depthMetres.mul(pathFactor).mul(-WATER_ABSORPTION.perMetre))));
  const transmitted = float(1).sub(reflectance);
  const columnColor = uniform(readLinearVector(look.column));
  // Weighted as encoded values, as the WebGL surface weighs them over its sRGB canvas.
  const premultiplied = encodeSrgb(skyReflection).mul(reflectance).add(readSunGlint(viewNormal, sunViewDirection, sunIrradiance)).add(encodeSrgb(columnColor).mul(absorbed.mul(transmitted)));
  // The WebGL surface writes this sum into its sRGB canvas as it is, unencoded (water-surface.ts); the tier encodes
  // every material's output, so the sum is decoded first and lands on the same values.
  material.outputNode = vec4(decodeSrgb(premultiplied), reflectance.add(absorbed.mul(transmitted)));
  return {
    material,
    setWaveTime(seconds) {
      waveTime.value = seconds;
    },
  };
}
