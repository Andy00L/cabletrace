import type * as THREE from "three";
import { cameraViewMatrix, clamp, cos, float, fwidth, max, normalize, positionViewDirection, positionWorld, pow, sin, smoothstep, sqrt, uniform, vec2, vec3, vec4 } from "three/tsl";
import { Color, MeshBasicNodeMaterial, Vector3, type Node } from "three/webgpu";
import type { WaterSurfaceMaterial } from "@/lib/render/scene-renderer";
import { decodeSrgb } from "@/lib/render/webgpu/srgb-nodes";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import { METRES_PER_KM, readGerstnerTerms, WATER_BASE_REFLECTANCE, WAVE_DETAIL_FADE } from "@/lib/seabed/scene/water-surface";

// The water surface for the WebGPU tier: the TSL port of src/lib/seabed/scene/water-surface.ts. The surface adds only
// what a surface adds over a seabed whose colours already carry the water: the sky's reflection weighted by Fresnel
// (0.02 looking straight down) and the sun's glints off Gerstner waves that follow the replay's clock. The glint is
// the GGX specular three.js's standard material gives the WebGL surface (roughness 0.06, a dielectric's 4%), written
// out here so the surface needs no lighting pass of its own.

const SURFACE_ROUGHNESS = 0.06;
// A dielectric's reflectance at normal incidence as three.js's standard material sets it (specular colour 0.04).
const GLINT_BASE_REFLECTANCE = 0.04;

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
 * The surface's material: drawn premultiplied over the seabed, outside tone mapping as on the WebGL tiers. `sun` is
 * the scene's sun (the WebGL material takes it from the scene's lights instead).
 */
export function createWaterSurfaceNodeMaterial(hasWaves: boolean, sun: THREE.DirectionalLight): WaterSurfaceMaterial {
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
  const facing = clamp(viewNormal.dot(positionViewDirection), float(0), float(1));
  const reflectance = pow(float(1).sub(facing), float(5)).mul(1 - WATER_BASE_REFLECTANCE).add(WATER_BASE_REFLECTANCE);
  const skyReflection = uniform(new Color(SCENE_COLORS.waterSky)).mul(reflectance);
  // The WebGL surface writes this sum into its sRGB canvas as it is, unencoded (water-surface.ts); the tier encodes
  // every material's output, so the sum is decoded first and lands on the same values.
  material.outputNode = vec4(decodeSrgb(skyReflection.add(readSunGlint(viewNormal, sunViewDirection, sunIrradiance))), reflectance);
  return {
    material,
    setWaveTime(seconds) {
      waveTime.value = seconds;
    },
  };
}
