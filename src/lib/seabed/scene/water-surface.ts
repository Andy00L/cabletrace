import * as THREE from "three";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import type { Projection } from "@/lib/seabed/terrain";

// The water over the overview block. The seabed's colours already carry the water (terrain-material.ts: they end in
// the depth tokens), so the surface itself adds only what a surface adds: the sky's reflection, weak looking down and
// strong toward the horizon (Fresnel, water's reflectance at normal incidence being 0.02), and the sun's glints off
// the waves. On the GPU tier the waves are Gerstner waves (Tessendorf, "Simulating Ocean Water", 2001, section 3.1)
// evaluated per pixel for the normal; on the software tier the surface is flat. The waves move with the replay's
// clock, never on their own, so a paused replay holds still (the house style allows no other ambient loops).
// The block's four sides show the water column, as before.

// Water's reflectance at normal incidence (refractive index 1.33: ((1.33 - 1) / (1.33 + 1))^2 = 0.02).
const WATER_BASE_REFLECTANCE = 0.02;
// Gerstner waves for a moderate Baltic sea: wavelength (m), direction (degrees from east, toward north), amplitude
// (m) and steepness. Deep-water dispersion gives each its speed (omega = sqrt(g k)).
const WAVES: readonly { wavelengthMetres: number; directionDegrees: number; amplitudeMetres: number; steepness: number }[] = [
  { wavelengthMetres: 61, directionDegrees: 200, amplitudeMetres: 0.55, steepness: 0.35 },
  { wavelengthMetres: 37, directionDegrees: 222, amplitudeMetres: 0.32, steepness: 0.35 },
  { wavelengthMetres: 23, directionDegrees: 185, amplitudeMetres: 0.18, steepness: 0.3 },
  { wavelengthMetres: 13, directionDegrees: 240, amplitudeMetres: 0.08, steepness: 0.25 },
];
const STANDARD_GRAVITY = 9.80665;
const METRES_PER_KM = 1000;

function buildWaveGlsl(): string {
  const terms = WAVES.map((wave) => {
    const wavenumber = (2 * Math.PI) / wave.wavelengthMetres;
    const angle = (wave.directionDegrees * Math.PI) / 180;
    // Scene x runs east and scene z runs south, so a wave heading north has a negative z component.
    const directionX = Math.cos(angle).toFixed(5);
    const directionZ = (-Math.sin(angle)).toFixed(5);
    const angularSpeed = Math.sqrt(STANDARD_GRAVITY * wavenumber).toFixed(5);
    return /* glsl */ `
  {
    vec2 direction = vec2(${directionX}, ${directionZ});
    float phase = ${wavenumber.toFixed(5)} * dot(direction, pointMetres) - ${angularSpeed} * waveTimeSeconds;
    float detail = 1.0 - smoothstep(1.5, 3.0, fwidth(phase));
    float slope = ${(wavenumber * wave.amplitudeMetres).toFixed(5)} * detail;
    normalSum.x -= direction.x * slope * cos(phase);
    normalSum.z -= direction.y * slope * cos(phase);
    normalSum.y -= ${wave.steepness.toFixed(3)} * slope * sin(phase);
  }`;
  }).join("");
  return /* glsl */ `
uniform float waveTimeSeconds;
varying vec3 vWaterWorld;
// Gerstner surface normal (Tessendorf 2001, section 3.1, differentiated) at a point in metres.
vec3 readGerstnerNormal(vec2 pointMetres) {
  vec3 normalSum = vec3(0.0, 1.0, 0.0);${terms}
  return normalize(normalSum);
}
`;
}

export type WaterBody = {
  group: THREE.Group;
  /** Moves the waves to a replay moment (seconds since the replay window opened). */
  setWaveTime: (seconds: number) => void;
};

/** The water column's sides, the surface and the white rim around the block's top. */
export function buildWaterBody(projection: Projection, deepestY: number, hasWaves: boolean): WaterBody {
  const inset = 0.04;
  const halfWidth = (projection.widthKm - inset) / 2;
  const halfDepth = (projection.depthKm - inset) / 2;
  const columnHeight = -deepestY;

  // The four sides of the water column (the top is the surface below; the bottom is hidden by the block). BoxGeometry
  // draws its faces in the order +x, -x, +y, -y, +z, -z, one material each.
  const sides = new THREE.BoxGeometry(projection.widthKm - inset, columnHeight, projection.depthKm - inset);
  sides.translate(0, -columnHeight / 2, 0);
  const sideMaterial = new THREE.MeshPhysicalMaterial({ color: SCENE_COLORS.water, transparent: true, opacity: 0.16, roughness: 0.16, metalness: 0, depthWrite: false });
  const hiddenFace = new THREE.MeshBasicMaterial({ visible: false });
  const column = new THREE.Mesh(sides, [sideMaterial, sideMaterial, hiddenFace, hiddenFace, sideMaterial, sideMaterial]);
  column.renderOrder = 2;

  const surfaceGeometry = new THREE.PlaneGeometry(projection.widthKm - inset, projection.depthKm - inset);
  surfaceGeometry.rotateX(-Math.PI / 2);
  const waveTime = { value: 0 };
  const surfaceMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.skyLight, roughness: 0.06, metalness: 0, transparent: true, depthWrite: false });
  surfaceMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.waveTimeSeconds = waveTime;
    shader.uniforms.waterSkyColor = { value: new THREE.Color(SCENE_COLORS.waterSky) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWaterWorld;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform vec3 waterSkyColor;\n${hasWaves ? buildWaveGlsl() : "varying vec3 vWaterWorld;"}`)
      .replace(
        "#include <normal_fragment_begin>",
        hasWaves
          ? `#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(readGerstnerNormal(vWaterWorld.xz * ${METRES_PER_KM.toFixed(1)}), 0.0)).xyz);`
          : "#include <normal_fragment_begin>",
      )
      // The surface is drawn premultiplied: the sky's reflection weighted by Fresnel, plus the sun's specular glint,
      // over the seabed seen through it.
      .replace(
        "#include <premultiplied_alpha_fragment>",
        /* glsl */ `float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
float reflectance = ${WATER_BASE_REFLECTANCE.toFixed(3)} + ${(1 - WATER_BASE_REFLECTANCE).toFixed(3)} * pow(1.0 - facing, 5.0);
gl_FragColor = vec4(waterSkyColor * reflectance + reflectedLight.directSpecular, reflectance);`,
      );
  };
  surfaceMaterial.premultipliedAlpha = true;
  surfaceMaterial.customProgramCacheKey = () => `water-surface-${hasWaves ? "waves" : "flat"}`;
  const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
  surface.renderOrder = 2;

  const rimPoints = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
    [-halfWidth, -halfDepth],
  ].map(([pointX = 0, pointZ = 0]) => new THREE.Vector3(pointX, 0.01, pointZ));
  const rim = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPoints), new THREE.LineBasicMaterial({ color: SCENE_COLORS.waterRim, transparent: true, opacity: 0.85 }));
  const group = new THREE.Group();
  group.add(column, surface, rim);
  return {
    group,
    setWaveTime(seconds) {
      waveTime.value = seconds;
    },
  };
}
