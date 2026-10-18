import * as THREE from "three";
import type { SceneMaterialKit, WaterSurfaceMaterial } from "@/lib/render/scene-renderer";
import { SCENE_COLORS } from "@/lib/seabed/scene/scene-colors";
import type { Projection } from "@/lib/seabed/terrain";

// The water over the overview block, as an FX technical director builds a sea:
//   - a body colour from light absorbed along the path through the water: the deeper the water and the flatter the
//     view, the more of the seabed is replaced by the water's own colour, so the seabed fades out with depth and stays
//     readable in the shallows. Seen from the map's height the seabed's colours already carry the water (the depth
//     tokens of terrain-material.ts), so the absorption fades out as the camera climbs past a few km: the overview and
//     the view from above keep their tokens, the Vessel view sees a sea;
//   - the sky's reflection weighted by Fresnel (water's reflectance at normal incidence being 0.02), its clouds read
//     from a CC0 sky HDRI (public/textures/CREDITS.md) and tinted to the look's sky colour;
//   - the sun's glints off the waves: Gerstner swell (Tessendorf, "Simulating Ocean Water", 2001, section 3.1) with
//     octaves of shorter chop on top, all evaluated per pixel for the normal and faded where a pixel would alias them.
// The waves move with the replay's clock, never on their own, so a paused replay holds still. The software tier draws
// the body colour on a flat surface. The surface's material comes from the renderer's kit: this GLSL on the WebGL
// tiers, a TSL port on the WebGPU tier (src/lib/render/webgpu/water-node-material.ts), both from the numbers here.

// Water's reflectance at normal incidence (refractive index 1.33: ((1.33 - 1) / (1.33 + 1))^2 = 0.02).
export const WATER_BASE_REFLECTANCE = 0.02;
// A moderate Baltic sea as a sum of Gerstner waves: wavelength (m), direction (degrees from east, toward north),
// amplitude (m) and steepness. The four long swells are the approved look's; the chop under them is spread over 16
// wavelengths from 30 m down to 2 m in a geometric series, their directions fanned up to 70 degrees either side of
// the wind (from 205 degrees, a south-westerly), each with the slope k a of a light breeze's sea (0.05 to 0.08), so
// no single crest line repeats across the frame. Deep-water dispersion gives each its speed (omega = sqrt(g k)); each
// fades out where a pixel spans half its wavelength.
const SWELL: readonly { wavelengthMetres: number; directionDegrees: number; amplitudeMetres: number; steepness: number }[] = [
  { wavelengthMetres: 61, directionDegrees: 200, amplitudeMetres: 0.55, steepness: 0.35 },
  { wavelengthMetres: 37, directionDegrees: 222, amplitudeMetres: 0.32, steepness: 0.35 },
  { wavelengthMetres: 23, directionDegrees: 185, amplitudeMetres: 0.18, steepness: 0.3 },
  { wavelengthMetres: 13, directionDegrees: 240, amplitudeMetres: 0.08, steepness: 0.25 },
];
const CHOP_COUNT = 16;
const CHOP_LONGEST_METRES = 30;
const CHOP_SHORTEST_METRES = 2;
const WIND_FROM_DEGREES = 205;
// Fan offsets (degrees) in a fixed order, so neighbouring wavelengths never share a direction.
const CHOP_FAN_DEGREES = [0, 47, -38, 21, -63, 70, -14, 33, -52, 58, -27, 9, -70, 41, -45, 26];
const WAVES = [
  ...SWELL,
  ...Array.from({ length: CHOP_COUNT }, (_slot, index) => {
    const wavelengthMetres = CHOP_LONGEST_METRES * (CHOP_SHORTEST_METRES / CHOP_LONGEST_METRES) ** (index / (CHOP_COUNT - 1));
    const slope = 0.05 + 0.03 * (index / (CHOP_COUNT - 1));
    return { wavelengthMetres, directionDegrees: WIND_FROM_DEGREES + (CHOP_FAN_DEGREES[index] ?? 0), amplitudeMetres: (slope * wavelengthMetres) / (2 * Math.PI), steepness: 0.2 };
  }),
];
const STANDARD_GRAVITY = 9.80665;
export const METRES_PER_KM = 1000;
// A wave fades out between these phase changes per pixel (radians): past half a wavelength a pixel would alias it.
export const WAVE_DETAIL_FADE = [1.5, 3.0] as const;

/**
 * The body colour's absorption: per metre of path (the scene draws the water 20 times deeper, the path is counted in
 * real metres) and the camera heights (km) between which it fades out, full below the first.
 */
export const WATER_ABSORPTION = { perMetre: 0.016, fadeHeightKm: [4, 12] as const, minFacing: 0.15 } as const;
// The sky HDRI's mean luminance over its upper hemisphere (linear, cos-latitude weighted), measured on the 512 px file:
// its clouds are read as luminance over this mean, so the look's sky colour sets the average reflection.
export const SKY_MEAN_LUMINANCE = 0.284;
// How far the HDRI's cloud pattern moves the reflection off the look's sky colour (0 flat sky, 1 the HDRI's contrast).
export const SKY_STRUCTURE_WEIGHT = 0.7;
// Deepest depth the depth map holds (m): one byte per texel, a metre a step.
export const DEPTH_MAP_MAX_METRES = 255;
// The CC0 sky (public/textures/CREDITS.md), stored with linear values.
export const SKY_HDRI_URL = "/hdri/kloofendal-48d-partly-cloudy-512-linear.jpg";

/**
 * The water's colours: the column (what the water itself looks like where the seabed is gone) and the sky it
 * reflects. Two candidates for Andy's palette gate (18 Oct 2026); `?water=b` picks the second.
 */
export const WATER_LOOKS = {
  // Baltic winter, measured (explore/natural-look, palettes.md).
  a: { column: "#2E435D", sky: "#BDC7D6" },
  // A lighter teal that keeps the console's light feel.
  b: { column: "#3F7E86", sky: "#D8E3E5" },
} as const;

export type WaterLookName = keyof typeof WATER_LOOKS;
export type WaterLook = (typeof WATER_LOOKS)[WaterLookName];

/** The look named by the page's `water` query parameter, the first candidate otherwise. */
export function readWaterLook(search: string): WaterLook {
  const requested = new URLSearchParams(search).get("water");
  return requested === "b" ? WATER_LOOKS.b : WATER_LOOKS.a;
}

/** Depth under the surface in metres, one byte per grid point, and the scene box (km) it covers. */
export type WaterDepthMap = { texture: THREE.DataTexture; minX: number; minZ: number; sizeX: number; sizeZ: number };

/**
 * The block's depth grid as a texture for the surface (row 0 is the block's north edge, as the terrain grid is laid
 * out); land reads 0 m. Texel centres sit on the grid points.
 */
export function createWaterDepthMap(elevations: Float32Array, grid: { width: number; height: number }, projection: Pick<Projection, "widthKm" | "depthKm">): WaterDepthMap {
  const data = new Uint8Array(grid.width * grid.height);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.round(Math.min(DEPTH_MAP_MAX_METRES, Math.max(0, -(elevations[index] ?? 0))));
  const texture = new THREE.DataTexture(data, grid.width, grid.height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  // The texture's 0 to 1 spans the grid's outer texel edges: half a cell beyond the first and last points.
  const cellX = projection.widthKm / Math.max(1, grid.width - 1);
  const cellZ = projection.depthKm / Math.max(1, grid.height - 1);
  return { texture, minX: -projection.widthKm / 2 - cellX / 2, minZ: -projection.depthKm / 2 - cellZ / 2, sizeX: projection.widthKm + cellX, sizeZ: projection.depthKm + cellZ };
}

/** A depth map of one depth everywhere (the hero shot's open sea). */
export function createUniformDepthMap(depthMetres: number): WaterDepthMap {
  const texture = new THREE.DataTexture(Uint8Array.from([Math.round(Math.min(DEPTH_MAP_MAX_METRES, depthMetres))]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  texture.needsUpdate = true;
  return { texture, minX: -1, minZ: -1, sizeX: 2, sizeZ: 2 };
}

/** What the surface's material is made from, on every tier. */
export type WaterSurfaceOptions = {
  /** Gerstner swell and chop (the GPU tiers) or a flat surface. */
  hasWaves: boolean;
  /** The light whose glints the waves reflect (the WebGPU material reads it; WebGL takes the scene's lights). */
  sun: THREE.DirectionalLight;
  look: WaterLook;
  /** The sky HDRI (linear equirectangular), or null for a sky of the look's colour alone. */
  sky: THREE.Texture | null;
  depthMap: WaterDepthMap;
};

/** One Gerstner wave as both shaders use it: unit direction in the scene's x and z, wavenumber, speed and slope. */
export type GerstnerTerm = { directionX: number; directionZ: number; wavenumber: number; angularSpeed: number; slope: number; steepness: number };

/** The wave table in the terms the shaders evaluate (deep-water dispersion: omega = sqrt(g k)). */
export function readGerstnerTerms(): GerstnerTerm[] {
  return WAVES.map((wave) => {
    const wavenumber = (2 * Math.PI) / wave.wavelengthMetres;
    const angle = (wave.directionDegrees * Math.PI) / 180;
    // Scene x runs east and scene z runs south, so a wave heading north has a negative z component.
    return { directionX: Math.cos(angle), directionZ: -Math.sin(angle), wavenumber, angularSpeed: Math.sqrt(STANDARD_GRAVITY * wavenumber), slope: wavenumber * wave.amplitudeMetres, steepness: wave.steepness };
  });
}

function buildWaveGlsl(): string {
  const terms = readGerstnerTerms().map((term) => {
    return /* glsl */ `
  {
    vec2 direction = vec2(${term.directionX.toFixed(5)}, ${term.directionZ.toFixed(5)});
    float phase = ${term.wavenumber.toFixed(5)} * dot(direction, pointMetres) - ${term.angularSpeed.toFixed(5)} * waveTimeSeconds;
    float detail = 1.0 - smoothstep(${WAVE_DETAIL_FADE[0].toFixed(1)}, ${WAVE_DETAIL_FADE[1].toFixed(1)}, fwidth(phase));
    float slope = ${term.slope.toFixed(5)} * detail;
    normalSum.x -= direction.x * slope * cos(phase);
    normalSum.z -= direction.y * slope * cos(phase);
    normalSum.y -= ${term.steepness.toFixed(3)} * slope * sin(phase);
  }`;
  }).join("");
  return /* glsl */ `
uniform float waveTimeSeconds;
// Gerstner surface normal (Tessendorf 2001, section 3.1, differentiated) at a point in metres.
vec3 readGerstnerNormal(vec2 pointMetres) {
  vec3 normalSum = vec3(0.0, 1.0, 0.0);${terms}
  return normalize(normalSum);
}
`;
}

const BODY_GLSL = /* glsl */ `
varying vec3 vWaterWorld;
uniform vec3 waterSkyColor;
uniform vec3 waterMapSkyColor;
uniform vec3 waterColumnColor;
uniform sampler2D waterDepthMap;
uniform vec4 waterDepthExtent;
#ifdef WATER_SKY_MAP
uniform sampler2D waterSkyMap;
#endif
// The sky in a world direction: the look's colour, its brightness following the HDRI's clouds.
vec3 readSkyReflection(vec3 direction) {
#ifdef WATER_SKY_MAP
  vec3 upward = normalize(vec3(direction.x, max(direction.y, 0.02), direction.z));
  vec3 hdri = texture2D(waterSkyMap, equirectUv(upward)).rgb;
  float structure = dot(hdri, vec3(0.2126, 0.7152, 0.0722)) / ${SKY_MEAN_LUMINANCE.toFixed(3)};
  return waterSkyColor * mix(1.0, clamp(structure, 0.35, 2.4), ${SKY_STRUCTURE_WEIGHT.toFixed(2)});
#else
  return waterSkyColor;
#endif
}
// 1 for a camera close to the water (the sea's look), 0 from the map's height (the approved map look, tokens intact).
float readCloseness() {
  return 1.0 - smoothstep(${WATER_ABSORPTION.fadeHeightKm[0].toFixed(1)}, ${WATER_ABSORPTION.fadeHeightKm[1].toFixed(1)}, cameraPosition.y);
}
// Share of the seabed's light the water replaces with its own colour on the way to the eye.
float readAbsorbed(vec3 worldPoint, float facing) {
  vec2 depthUv = (worldPoint.xz - waterDepthExtent.xy) / waterDepthExtent.zw;
  float depthMetres = texture2D(waterDepthMap, depthUv).r * ${DEPTH_MAP_MAX_METRES.toFixed(1)};
  float pathFactor = 1.0 + 1.0 / max(facing, ${WATER_ABSORPTION.minFacing.toFixed(2)});
  return readCloseness() * (1.0 - exp(-${WATER_ABSORPTION.perMetre.toFixed(4)} * depthMetres * pathFactor));
}
`;

/**
 * The surface's GLSL material for the WebGL tiers: Gerstner normals with chop (GPU tier), the body colour, the HDRI
 * sky's Fresnel reflection and the sun's glints (from the scene's own lights, so it needs no sun of its own).
 */
export function createWaterSurfaceGlslMaterial(options: WaterSurfaceOptions): WaterSurfaceMaterial {
  const { hasWaves, look, sky, depthMap } = options;
  const waveTime = { value: 0 };
  const surfaceMaterial = new THREE.MeshStandardMaterial({ color: SCENE_COLORS.skyLight, roughness: 0.06, metalness: 0, transparent: true, depthWrite: false });
  const hasSkyMap = sky !== null;
  if (hasSkyMap) surfaceMaterial.defines = { WATER_SKY_MAP: "" };
  surfaceMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.waveTimeSeconds = waveTime;
    shader.uniforms.waterSkyColor = { value: new THREE.Color(look.sky) };
    shader.uniforms.waterMapSkyColor = { value: new THREE.Color(SCENE_COLORS.waterSky) };
    shader.uniforms.waterColumnColor = { value: new THREE.Color(look.column) };
    shader.uniforms.waterDepthMap = { value: depthMap.texture };
    shader.uniforms.waterDepthExtent = { value: new THREE.Vector4(depthMap.minX, depthMap.minZ, depthMap.sizeX, depthMap.sizeZ) };
    if (sky) shader.uniforms.waterSkyMap = { value: sky };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWaterWorld;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${hasWaves ? buildWaveGlsl() : ""}\n${BODY_GLSL}`)
      .replace(
        "#include <normal_fragment_begin>",
        hasWaves
          ? `#include <normal_fragment_begin>\nvec3 waterWorldNormal = readGerstnerNormal(vWaterWorld.xz * ${METRES_PER_KM.toFixed(1)});\nnormal = normalize((viewMatrix * vec4(waterWorldNormal, 0.0)).xyz);`
          : "#include <normal_fragment_begin>\nvec3 waterWorldNormal = vec3(0.0, 1.0, 0.0);",
      )
      // Drawn premultiplied over the seabed already in the canvas: the sky's reflection weighted by Fresnel plus the
      // sun's glint, then the water's body colour over what the water lets through. The canvas holds sRGB-encoded
      // values and this runs after three.js's own encoding, so the colours are encoded here before they are weighted.
      .replace(
        "#include <premultiplied_alpha_fragment>",
        /* glsl */ `vec3 waterToEye = normalize(cameraPosition - vWaterWorld);
float facing = clamp(dot(waterWorldNormal, waterToEye), 0.0, 1.0);
float reflectance = ${WATER_BASE_REFLECTANCE.toFixed(3)} + ${(1 - WATER_BASE_REFLECTANCE).toFixed(3)} * pow(1.0 - facing, 5.0);
float absorbed = readAbsorbed(vWaterWorld, facing);
// From the map's height the reflection is the approved map look's (its sky colour written as it was); close to the
// water, the look's sky with the HDRI's clouds.
vec3 skyReflection = mix(waterMapSkyColor, sRGBTransferOETF(vec4(readSkyReflection(reflect(-waterToEye, waterWorldNormal)), 1.0)).rgb, readCloseness());
vec3 columnEncoded = sRGBTransferOETF(vec4(waterColumnColor, 1.0)).rgb;
gl_FragColor = vec4(skyReflection * reflectance + reflectedLight.directSpecular + columnEncoded * absorbed * (1.0 - reflectance), reflectance + absorbed * (1.0 - reflectance));`,
      );
  };
  surfaceMaterial.premultipliedAlpha = true;
  surfaceMaterial.customProgramCacheKey = () => `water-surface-${hasWaves ? "waves" : "flat"}-${hasSkyMap ? "sky" : "plain"}`;
  return {
    material: surfaceMaterial,
    setWaveTime(seconds) {
      waveTime.value = seconds;
    },
  };
}

export type WaterBody = {
  group: THREE.Group;
  /** Moves the waves to a replay moment (seconds since the replay window opened). */
  setWaveTime: (seconds: number) => void;
};

/** The water column's sides, the surface (its material from the renderer's kit) and the white rim around the block's top. */
export function buildWaterBody(options: { projection: Pick<Projection, "widthKm" | "depthKm">; deepestY: number; kit: SceneMaterialKit; surface: WaterSurfaceOptions }): WaterBody {
  const { projection, deepestY, kit } = options;
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
  const surfaceMaterial = kit.createWaterSurfaceMaterial(options.surface);
  const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial.material);
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
  return { group, setWaveTime: surfaceMaterial.setWaveTime };
}
